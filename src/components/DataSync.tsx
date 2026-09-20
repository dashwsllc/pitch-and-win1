import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'
import { AUTO_REFRESH_INTERVAL_MS, refreshDashboardData } from '@/lib/sync'

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
    let debounce: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    let refreshQueued = false

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
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh()
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
        if (!disposed) channel.subscribe()
      })
      .catch(refresh)

    const interval = window.setInterval(refreshWhenVisible, AUTO_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)

    return () => {
      disposed = true
      window.clearTimeout(debounce)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [userId, accessToken, queryClient])

  return null
}
