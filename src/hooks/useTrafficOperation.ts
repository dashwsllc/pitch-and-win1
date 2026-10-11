import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { arenaRpc } from '@/lib/arena-api'
import type { TrafficOperation } from '@/lib/meta-connection'

export function useTrafficOperation(active: boolean) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['meta-traffic-operation', user?.id], enabled: active && !!user, queryFn: () => arenaRpc<TrafficOperation>('meta_traffic_operation', {}) })
}
