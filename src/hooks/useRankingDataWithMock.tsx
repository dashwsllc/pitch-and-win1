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

// Dados fictícios para fomentar participação
const mockUsers: Omit<RankingUser, 'isCurrentUser'>[] = [
  { user_id: 'mock-1', name: 'Carlos Silva', totalVendas: 45800, quantidadeVendas: 23, conversao: 85.2 },
  { user_id: 'mock-2', name: 'Marina Santos', totalVendas: 42300, quantidadeVendas: 19, conversao: 79.1 },
  { user_id: 'mock-3', name: 'Rafael Oliveira', totalVendas: 38900, quantidadeVendas: 21, conversao: 73.6 },
  { user_id: 'mock-4', name: 'Ana Costa', totalVendas: 35200, quantidadeVendas: 18, conversao: 81.4 },
  { user_id: 'mock-5', name: 'Pedro Almeida', totalVendas: 32800, quantidadeVendas: 16, conversao: 76.9 },
  { user_id: 'mock-6', name: 'Juliana Lima', totalVendas: 29500, quantidadeVendas: 14, conversao: 70.3 },
  { user_id: 'mock-7', name: 'Lucas Ferreira', totalVendas: 26100, quantidadeVendas: 12, conversao: 68.7 },
  { user_id: 'mock-8', name: 'Camila Rocha', totalVendas: 23700, quantidadeVendas: 11, conversao: 65.2 },
]

export function useRankingDataWithMock() {
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

        // Processar vendas reais
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

        // Processar abordagens reais
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

        // Converter dados reais para array
        const realUsers: RankingUser[] = Array.from(userMap.entries())
          .map(([userId, data]) => ({
            user_id: userId,
            name: data.name,
            totalVendas: data.totalVendas,
            quantidadeVendas: data.quantidadeVendas,
            conversao: data.abordagens > 0 ? (data.quantidadeVendas / data.abordagens) * 100 : 0,
            isCurrentUser: userId === user?.id
          }))

        // Combinar dados reais com dados fictícios
        const allUsers = [...realUsers, ...mockUsers]
        
        // Ordenar por total de vendas e marcar usuário atual
        const rankingData = allUsers
          .map(userData => ({
            ...userData,
            isCurrentUser: userData.user_id === user?.id
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