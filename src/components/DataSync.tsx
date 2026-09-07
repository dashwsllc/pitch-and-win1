import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/integrations/supabase/client'

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
    let timeout: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['sales-board'] })
        void queryClient.invalidateQueries({ queryKey: ['team-ranking'] })
        void queryClient.invalidateQueries({ queryKey: ['executive-users'] })
        void queryClient.invalidateQueries({ queryKey: ['executive-audit'] })
        void queryClient.invalidateQueries({ queryKey: ['executive-withdrawals'] })
        void queryClient.invalidateQueries({ queryKey: ['profile'] })
        window.dispatchEvent(new Event('dashboard-data-changed'))
      }, 180)
    }
    // Only anonymous invalidation signals are published; no buyer or Auth payloads.
    let disposed = false
    const channel = supabase.channel(`dashboard-events-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dashboard_events' }, refresh)
    // Authenticate the socket before joining; REST authentication alone does not
    // guarantee that a newly opened Realtime channel has the current session.
    void supabase.realtime.setAuth(accessToken).then(() => {
      if (!disposed) channel.subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    }).catch(() => { if (!disposed) refresh() })
    window.addEventListener('focus', refresh)
    const interval = setInterval(() => { if (!document.hidden) refresh() }, 30_000)
    return () => {
      disposed = true
      clearTimeout(timeout)
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
      void supabase.removeChannel(channel)
    }
  }, [userId, accessToken, queryClient])
  return null
}
