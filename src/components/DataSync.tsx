import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import { refreshDashboardData } from '@/lib/sync'
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

    // A fixed poll made monitor dashboards repeatedly re-fetch and animate.
    // Reconnect once after network recovery; normal changes arrive by Realtime.
    window.addEventListener('online', refresh)

    return () => {
      disposed = true
      window.clearTimeout(debounce)
      window.removeEventListener('online', refresh)
      void supabase.removeChannel(channel)
    }
  }, [userId, accessToken, queryClient])

  return null
}
