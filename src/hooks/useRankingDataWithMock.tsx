import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { AUTO_REFRESH_INTERVAL_MS } from '@/lib/sync'

export interface RankingUser {
  user_id: string
  name: string
  totalVendas: number
  quantidadeVendas: number
  conversao: number
  isCurrentUser?: boolean
}

// Kept as a compatible export for existing pages; all entries now come from approved sales.
export function useRankingDataWithMock() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['team-ranking', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_team_ranking')
      if (error) throw error
      return (data as unknown as RankingUser[]).map(seller => ({ ...seller, isCurrentUser: seller.user_id === user?.id }))
    },
    staleTime: 10_000,
    refetchInterval: AUTO_REFRESH_INTERVAL_MS,
  })
  return { ranking: query.data ?? [], loading: query.isPending, error: query.error?.message ?? null }
}
