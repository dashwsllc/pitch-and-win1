import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'

export interface RankingUser {
  user_id: string
  name: string
  avatarUrl: string | null
  totalVendas: number
  quantidadeVendas: number
  abordagens: number
  conversao: number
  isCurrentUser?: boolean
}

export interface SDRRankingUser {
  user_id: string
  name: string
  avatarUrl: string | null
  totalLeads: number
  leadsAbordados: number
  abordagens: number
  repasses: number
  vendasOriginadas: number
  receitaOriginada: number
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
  })
  const sdrQuery = useQuery({
    queryKey: ['sdr-ranking', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sdr_ranking')
      if (error) throw error
      return (data as unknown as SDRRankingUser[]).map(sdr => ({
        ...sdr,
        isCurrentUser: sdr.user_id === user?.id,
      }))
    },
    staleTime: 10_000,
  })
  return {
    ranking: query.data ?? [],
    sdrRanking: sdrQuery.data ?? [],
    loading: query.isPending || sdrQuery.isPending,
    error: query.error?.message ?? null,
    sdrError: sdrQuery.error?.message ?? null,
  }
}
