import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { AUTO_REFRESH_INTERVAL_MS } from '@/lib/sync'

export function DataSync() {
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!userId) {
      queryClient.clear()
      return
    }
    const interval = setInterval(() => {
      if (!document.hidden) window.dispatchEvent(new Event('dashboard-data-changed'))
    }, AUTO_REFRESH_INTERVAL_MS)
    return () => {
      clearInterval(interval)
    }
  }, [userId, queryClient])
  return null
}
