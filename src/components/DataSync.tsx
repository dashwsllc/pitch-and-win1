import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import { refreshDashboardData } from '@/lib/sync'

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

    void supabase.realtime.setAuth(accessToken)
      .then(() => {
        if (!disposed) channel.subscribe(status => {
          if (status !== 'SUBSCRIBED') return
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
