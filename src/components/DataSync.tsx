import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import { DASHBOARD_SALES_CHANNEL, refreshDashboardData, shouldRefreshDashboardRevision } from '@/lib/sync'
import { arenaRpc } from '@/lib/arena-api'
import type { ArenaEvent, ArenaNotification } from '@/lib/arena'

export function DataSync() {
  const { user, session } = useAuth()
  const userId = user?.id
  const accessToken = session?.access_token
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId || !accessToken) {
      queryClient.clear()
      return
    }

    let disposed = false
    let debounce: number | undefined
    let refreshing = false
    let refreshQueued = false
    let liveAfter: number | null = null
    let connectionGeneration = 0
    let lastRevision: string | undefined
    let checkingRevision = false
    let lastRefreshStartedAt = 0

    const refresh = () => {
      if (disposed) return
      window.clearTimeout(debounce)
      debounce = window.setTimeout(async () => {
        if (refreshing) {
          refreshQueued = true
          return
        }
        refreshing = true
        try {
          do {
            refreshQueued = false
            lastRefreshStartedAt = Date.now()
            await refreshDashboardData(queryClient)
          } while (refreshQueued && !disposed)
        } catch (error) {
          // Keep the revision fallback alive after a transient fetch failure.
          lastRefreshStartedAt = 0
          console.warn('Dashboard synchronization retry scheduled', error)
        } finally {
          refreshing = false
        }
      }, 120)
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
        // A change can land between the first page request and subscription.
        // The initial cursor read also refreshes the page to close that gap.
        if (shouldRefreshDashboardRevision(lastRevision, revision, lastRefreshStartedAt, Date.now())) refresh()
        lastRevision = revision
      } finally {
        checkingRevision = false
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
      }, refresh)
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

    void supabase.realtime.setAuth(accessToken)
      .then(() => {
        if (!disposed) channel.subscribe(status => {
          liveAfter = null
          const generation = ++connectionGeneration
          if (status !== 'SUBSCRIBED') return
          void arenaRpc<string>('arena_live_cursor', {}).then(time => { if (!disposed && generation === connectionGeneration) liveAfter = Date.parse(time) }).catch(() => undefined)
          refresh() // Catch up on first subscribe and every reconnect.
        })
      })
      .catch(refresh)

    void checkRevision().catch(() => undefined)
    const revisionTimer = window.setInterval(() => { void checkRevision().catch(() => undefined) }, 10_000)
    const checkWhenVisible = () => { if (!document.hidden) void checkRevision().catch(() => undefined) }
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
