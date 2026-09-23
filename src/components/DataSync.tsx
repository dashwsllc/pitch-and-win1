import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import { DASHBOARD_SALES_CHANNEL, refreshDashboardData } from '@/lib/sync'
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
    let subscribedOnce = false
    let liveAfter: number | null = null
    let connectionGeneration = 0
    let lastRevision: string | undefined
    let checkingRevision = false

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
            await refreshDashboardData(queryClient)
          } while (refreshQueued && !disposed)
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
        if (lastRevision !== undefined && revision !== lastRevision) refresh()
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
          if (subscribedOnce) refresh() // Catch up once after a socket reconnect.
          subscribedOnce = true
        })
      })
      .catch(refresh)

    void checkRevision().catch(() => undefined)
    const revisionTimer = window.setInterval(() => { void checkRevision().catch(() => undefined) }, 30_000)
    const checkWhenVisible = () => { if (!document.hidden) void checkRevision().catch(() => undefined) }
    document.addEventListener('visibilitychange', checkWhenVisible)
    window.addEventListener('focus', checkWhenVisible)
    const crossTab = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DASHBOARD_SALES_CHANNEL) : null
    if (crossTab) crossTab.onmessage = refresh

    // A fixed poll made monitor dashboards repeatedly re-fetch and animate.
    // Reconnect once after network recovery; normal changes arrive by Realtime.
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
