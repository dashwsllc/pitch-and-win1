import { pollEvery, MIN_POLL_MS } from '@/lib/polling'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { arenaRpc } from '@/lib/arena-api'
import type { TrafficOperation } from '@/lib/meta-connection'

export function useTrafficOperation(active: boolean, refetchInterval: number | false = false) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['meta-traffic-operation', user?.id], enabled: active && !!user, refetchInterval: active && refetchInterval ? pollEvery(Math.max(refetchInterval, MIN_POLL_MS)) : false,
    queryFn: () => arenaRpc<TrafficOperation>('meta_traffic_operation', {}) })
}
