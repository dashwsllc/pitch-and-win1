import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'

interface RankingUser {
  user_id: string
  name: string
  totalVendas: number
  quantidadeVendas: number
  conversao: number
  isCurrentUser?: boolean
}

export function useRankingData() {
  const { user } = useAuth()
  const [ranking, setRanking] = useState<RankingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchRankingData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Buscar vendas agrupadas por usuário
        const { data: vendas, error: vendasError } = await supabase
          .from('vendas')
          .select('user_id, valor_venda')

        if (vendasError) throw vendasError

        // Buscar perfis de usuários
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, display_name')

        if (profilesError) throw profilesError

        // Buscar todas as abordagens
        const { data: abordagens, error: abordagensError } = await supabase
          .from('abordagens')
          .select('user_id')

        if (abordagensError) throw abordagensError

        // Agrupar por usuário
        const userMap = new Map<string, {
          name: string
          totalVendas: number
          quantidadeVendas: number
          abordagens: number
        }>()

        // Processar vendas
        vendas?.forEach(venda => {
          const userId = venda.user_id
          const profile = profiles?.find(p => p.user_id === userId)
          const userName = profile?.display_name || 'Usuário'
          
          if (userMap.has(userId)) {
            const existing = userMap.get(userId)!
            userMap.set(userId, {
              ...existing,
              totalVendas: existing.totalVendas + Number(venda.valor_venda),
              quantidadeVendas: existing.quantidadeVendas + 1
            })
          } else {
            userMap.set(userId, {
              name: userName,
              totalVendas: Number(venda.valor_venda),
              quantidadeVendas: 1,
              abordagens: 0
            })
          }
        })

        // Processar abordagens
        abordagens?.forEach(abordagem => {
          const userId = abordagem.user_id
          if (userMap.has(userId)) {
            const existing = userMap.get(userId)!
            userMap.set(userId, {
              ...existing,
              abordagens: existing.abordagens + 1
            })
          }
        })

        // Converter para array e calcular ranking
        const rankingData: RankingUser[] = Array.from(userMap.entries())
          .map(([userId, data]) => ({
            user_id: userId,
            name: data.name,
            totalVendas: data.totalVendas,
            quantidadeVendas: data.quantidadeVendas,
            conversao: data.abordagens > 0 ? (data.quantidadeVendas / data.abordagens) * 100 : 0,
            isCurrentUser: userId === user?.id
          }))
          .sort((a, b) => b.totalVendas - a.totalVendas)

        setRanking(rankingData)
      } catch (err) {
        console.error('Erro ao buscar dados do ranking:', err)
        setError('Erro ao carregar dados do ranking')
      } finally {
        setLoading(false)
      }
    }

    fetchRankingData()
  }, [user])

  return { ranking, loading, error }
}