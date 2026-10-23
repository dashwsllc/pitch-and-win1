import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import {
  DASHBOARD_SALES_CHANNEL,
  isRevisionNewer,
  maxRevision,
  refreshDashboardData,
  shouldRefreshDashboardRevision,
} from '@/lib/sync'
import { arenaRpc } from '@/lib/arena-api'
import { nextRefreshDelay, REMOTE_REFRESH_MIN_GAP_MS, REMOTE_REFRESH_JITTER_MS } from '@/lib/polling'
import type { ArenaEvent, ArenaNotification } from '@/lib/arena'

// When a renewed session replaces a live channel, its first cursor read only needs
// to catch up on its own if Realtime does not (the SUBSCRIBED handler already
// refreshes). Waiting briefly lets both merge into one round of requests.
const INITIAL_CATCH_UP_MS = 1_500

export function DataSync() {
  const { user, session } = useAuth()
  const userId = user?.id
  const accessToken = session?.access_token
  const queryClient = useQueryClient()
  // True once this session already synchronized. The very first run happens before
  // any screen has loaded data; later runs (token renewal) replace a live channel.
  const synchronized = useRef(false)

  useEffect(() => {
    if (!userId || !accessToken) {
      queryClient.clear()
      synchronized.current = false
      return
    }

    // On the first run the cursor read below is taken before the page's own queries
    // start, so everything they fetch is at least as new as it. Nothing is stale
    // yet and a blanket refresh would only repeat (or cancel) their requests.
    const firstRun = !synchronized.current
    synchronized.current = true

    let disposed = false
    let debounce: number | undefined
    let catchUp: number | undefined
    let refreshing = false
    let refreshQueued = false
    let liveAfter: number | null = null
    let connectionGeneration = 0
    let lastRevision: string | undefined
    let checkingRevision = false
    let lastRefreshStartedAt = 0
    let refreshRequested = false
    let recheckCursor = false
    let skippedWhileHidden = false
    // Highest revision per topic that a refresh already covers (delivered by
    // Realtime or observed by an earlier poll).
    const seen = new Map<string, string>()

    // Limitação de ritmo (não debounce): vários avisos em sequência (várias vendas, a rajada de um lote) viram UMA releitura de todas as consultas, no máximo uma a
    // cada REMOTE_REFRESH_MIN_GAP_MS por aba e com uma folga aleatória, para as abas abertas não consultarem o banco juntas. Nunca adia indefinidamente: a releitura
    // agendada já busca o dado mais novo na hora em que roda. O que a própria pessoa grava usa refreshDashboardMutation e continua imediato.
    let pendingRefresh = false
    let lastRunAt = 0   // diferente de lastRefreshStartedAt: não volta a 0 numa falha, senão o servidor lento seria consultado de novo na verificação seguinte
    const refresh = () => {
      if (disposed) return
      // A hidden tab shows nothing: catching up is deferred until it is visible
      // again (see checkWhenVisible) instead of re-fetching every screen unseen.
      if (document.hidden) {
        skippedWhileHidden = true
        return
      }
      refreshRequested = true
      if (pendingRefresh) return
      pendingRefresh = true
      debounce = window.setTimeout(async () => {
        pendingRefresh = false
        if (refreshing) {
          refreshQueued = true
          return
        }
        refreshing = true
        try {
          refreshQueued = false
          lastRunAt = Date.now()
          lastRefreshStartedAt = lastRunAt
          await refreshDashboardData(queryClient)
        } catch (error) {
          // Keep the revision fallback alive after a transient fetch failure.
          lastRefreshStartedAt = 0
          console.warn('Dashboard synchronization retry scheduled', error)
        } finally {
          refreshing = false
          // Chegou aviso durante a releitura: agenda a próxima respeitando o intervalo mínimo (antes repetia na hora).
          if (refreshQueued && !disposed) { refreshQueued = false; refresh() }
        }
      }, nextRefreshDelay({ now: Date.now(), lastStartedAt: lastRunAt, minGapMs: REMOTE_REFRESH_MIN_GAP_MS, baseMs: 120, jitterMs: REMOTE_REFRESH_JITTER_MS }))
    }
    // Realtime can miss a change while another route, tab or browser is asleep.
    // Check only the lightweight revision cursor; fetch records only when it moves.
    const checkRevision = async () => {
      if (disposed || checkingRevision || document.hidden) return
      checkingRevision = true
      try {
        const { data, error } = await supabase.from('dashboard_events')
          .select('topic, revision').order('topic')
        if (disposed || error || !data) return
        const revision = data.map(row => `${row.topic}:${row.revision}`).join('|')
        // Revisions Realtime (or an earlier poll) already refreshed for are not news:
        // without this every change caused one refresh from Realtime and a second,
        // identical one from the next poll.
        const covered = data.every(row => !isRevisionNewer(seen.get(row.topic), row.revision))
        const firstRead = lastRevision === undefined
        // A change can land between the first page request and subscription.
        // The initial cursor read also refreshes the page to close that gap.
        const comparable = covered && lastRevision !== undefined ? lastRevision : revision
        if (shouldRefreshDashboardRevision(lastRevision, comparable, lastRefreshStartedAt, Date.now())) {
          if (firstRead && firstRun) {
            // Baseline only (see above); real changes surface through the cursor.
            // The screens' initial load counts as the latest refresh, so the
            // periodic reconciliation window starts now rather than at epoch 0.
            lastRefreshStartedAt = Date.now()
          } else if (firstRead) {
            window.clearTimeout(catchUp)
            catchUp = window.setTimeout(() => { if (!refreshRequested) refresh() }, INITIAL_CATCH_UP_MS)
          } else {
            refresh()
          }
        }
        data.forEach(row => seen.set(row.topic, maxRevision(seen.get(row.topic), row.revision)))
        lastRevision = revision
      } finally {
        checkingRevision = false
        if (recheckCursor) {
          recheckCursor = false
          void checkRevision().catch(() => undefined)
        }
      }
    }
    // The database publishes anonymous revision signals only; records and
    // customer data are fetched afterward under the current user's RLS rules.
    const channel = supabase
      .channel(`dashboard-events-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'dashboard_events',
      }, payload => {
        const row = payload.new as { topic?: string; revision?: number | string } | undefined
        if (row?.topic && row.revision !== undefined && !document.hidden) {
          seen.set(row.topic, maxRevision(seen.get(row.topic), row.revision))
        }
        refresh()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_feed' }, payload => {
        const event = payload.new as ArenaEvent
        // A server-time barrier is reset on every reconnect. Neither query
        // results nor old events received during catch-up can ring the bell.
        if (liveAfter !== null && Date.parse(payload.commit_timestamp) > liveAfter) {
          window.dispatchEvent(new CustomEvent('arena-fresh-event', { detail: event }))
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'arena_notifications', filter: `recipient_id=eq.${userId}` }, payload => {
        if (liveAfter !== null && Date.parse(payload.commit_timestamp) > liveAfter) {
          window.dispatchEvent(new CustomEvent<ArenaNotification>('arena-fresh-notification', { detail: payload.new as ArenaNotification }))
        }
      })

    let subscribedBefore = false
    void supabase.realtime.setAuth(accessToken)
      .then(() => {
        if (!disposed) channel.subscribe(status => {
          liveAfter = null
          const generation = ++connectionGeneration
          if (status !== 'SUBSCRIBED') return
          void arenaRpc<string>('arena_live_cursor', {}).then(time => { if (!disposed && generation === connectionGeneration) liveAfter = Date.parse(time) }).catch(() => undefined)
          if (firstRun && !subscribedBefore) {
            // Changes committed between the page's first reads and this subscription
            // were not pushed to us; one cursor read tells whether there were any.
            if (checkingRevision) recheckCursor = true // that read may predate the subscription
            else void checkRevision().catch(() => undefined)
          } else {
            refresh() // Catch up on every reconnect and on a renewed session.
          }
          subscribedBefore = true
        })
      })
      .catch(refresh)

    void checkRevision().catch(() => undefined)
    const revisionTimer = window.setInterval(() => { void checkRevision().catch(() => undefined) }, 10_000)
    const checkWhenVisible = () => {
      if (document.hidden) return
      if (skippedWhileHidden) {
        skippedWhileHidden = false
        refresh()
      }
      void checkRevision().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', checkWhenVisible)
    window.addEventListener('focus', checkWhenVisible)
    const crossTab = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DASHBOARD_SALES_CHANNEL) : null
    if (crossTab) crossTab.onmessage = refresh

    // Network recovery starts a refresh immediately. The revision loop above
    // also reconciles periodically if a prior screen read failed silently.
    window.addEventListener('online', refresh)

    return () => {
      disposed = true
      window.clearTimeout(debounce)
      window.clearTimeout(catchUp)
      window.clearInterval(revisionTimer)
      document.removeEventListener('visibilitychange', checkWhenVisible)
      window.removeEventListener('focus', checkWhenVisible)
      crossTab?.close()
      window.removeEventListener('online', refresh)
      void supabase.removeChannel(channel)
    }
  }, [userId, accessToken, queryClient])

  return null
}
