import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useBrasiliaToday } from '@/hooks/useGoals'

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

export interface DailyCallRankingUser {
  user_id: string
  name: string
  avatarUrl: string | null
  sdrCalls: number
  closerCalls: number
  total: number
  isCurrentUser?: boolean
}

export interface DailyCallRanking {
  day: string
  sdrCalls: number
  closerCalls: number
  ranking: DailyCallRankingUser[]
}

// Kept as a compatible export for existing pages. The Closer ranking uses the
// same current Brasília month and sale facts as the Arena's monthly cycle.
export function useRankingDataWithMock() {
  const { user } = useAuth()
  const today = useBrasiliaToday()
  const month = today.slice(0, 7)
  const query = useQuery({
    queryKey: ['team-ranking', user?.id, month],
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
  const callQuery = useQuery({
    queryKey: ['daily-call-ranking', user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_daily_call_ranking')
      if (error) throw error
      const result = data as unknown as DailyCallRanking
      return {
        ...result,
        ranking: result.ranking.map(item => ({ ...item, isCurrentUser: item.user_id === user?.id })),
      }
    },
    staleTime: 10_000,
  })
  return {
    ranking: query.data ?? [],
    sdrRanking: sdrQuery.data ?? [],
    callRanking: callQuery.data ?? null,
    loading: query.isPending || sdrQuery.isPending,
    error: query.error?.message ?? null,
    sdrError: sdrQuery.error?.message ?? null,
    callError: callQuery.error?.message ?? null,
  }
}
