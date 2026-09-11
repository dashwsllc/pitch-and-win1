import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { fetchAllPages } from '@/lib/supabase-pages'
import { addDaysToDateKey, brasiliaDateKey, brasiliaDateRange, formatDateKey } from '@/lib/brasilia-time'

interface DashboardMetrics {
  totalVendas: number
  quantidadeVendas: number
  ticketMedio: number
  abordagens: number
  conversao: number
  vendasMes: Array<{
    month: string
    vendas: number
    abordagens: number
  }>
  produtosMaisVendidos: Array<{
    nome: string
    quantidade: number
    valor: number
  }>
}

export function useDashboardData(dateFilter: string = "30dias") {
  const { user } = useAuth()
  const { isExecutive, loading: rolesLoading } = useRoles()
  const userId = user?.id
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalVendas: 0,
    quantidadeVendas: 0,
    ticketMedio: 0,
    abordagens: 0,
    conversao: 0,
    vendasMes: [],
    produtosMaisVendidos: []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latestFetch = useRef(0)

  const getDateRange = (filter: string) => {
    const today = brasiliaDateKey()
    const days = filter === '7dias' ? 7 : filter === '14dias' ? 14 : filter === '30dias' ? 30 : 1
    const lastDay = filter === 'ontem' ? addDaysToDateKey(today, -1) : today
    return { ...brasiliaDateRange(days, lastDay), days, lastDay }
  }

  const fetchDashboardData = useCallback(async () => {
    const requestId = ++latestFetch.current
    if (!userId || rolesLoading) return

    try {
      setLoading(true)
      setError(null)

      const { start, end, days, lastDay } = getDateRange(dateFilter)

      // Executives see the consolidated commercial operation. Sellers see only
      // their own data. RLS remains the final source of authorization.
      const [vendas, abordagens] = await Promise.all([
        fetchAllPages((from, to) => {
          let request = supabase
            .from('vendas')
            .select('id, nome_produto, valor_venda, created_at')
            .eq('approval_status', 'aprovada')
            .gte('created_at', start.toISOString())
            .lt('created_at', end.toISOString())
            .order('created_at')
            .order('id')
          if (!isExecutive) request = request.eq('user_id', userId)
          return request.range(from, to)
        }),
        fetchAllPages((from, to) => {
          let request = supabase
            .from('abordagens')
            .select('id, created_at')
            .gte('created_at', start.toISOString())
            .lt('created_at', end.toISOString())
            .order('created_at')
            .order('id')
          if (!isExecutive) request = request.eq('user_id', userId)
          return request.range(from, to)
        }),
      ])

      // Calculate metrics
      const totalVendas = vendas?.reduce((sum, venda) => sum + Number(venda.valor_venda), 0) || 0
      const quantidadeVendas = vendas?.length || 0
      const ticketMedio = quantidadeVendas > 0 ? totalVendas / quantidadeVendas : 0
      const totalAbordagens = abordagens?.length || 0
      const conversao = totalAbordagens > 0 ? (quantidadeVendas / totalAbordagens) * 100 : 0

      // The chart follows the selected period and compares event counts with
      // event counts. Revenue remains in the dedicated revenue metrics.
      const dateKeys = Array.from({ length: days }, (_, index) =>
        addDaysToDateKey(lastDay, index - days + 1),
      )
      const vendasPorDia = new Map(dateKeys.map((key) => [key, 0]))
      const abordagensPorDia = new Map(dateKeys.map((key) => [key, 0]))
      vendas?.forEach((venda) => {
        const key = brasiliaDateKey(venda.created_at)
        if (vendasPorDia.has(key)) vendasPorDia.set(key, vendasPorDia.get(key)! + 1)
      })
      abordagens?.forEach((abordagem) => {
        const key = brasiliaDateKey(abordagem.created_at)
        if (abordagensPorDia.has(key)) abordagensPorDia.set(key, abordagensPorDia.get(key)! + 1)
      })
      const vendasMes = dateKeys.map((key) => ({
        month: formatDateKey(key, { day: '2-digit', month: '2-digit', year: undefined }),
        vendas: vendasPorDia.get(key) || 0,
        abordagens: abordagensPorDia.get(key) || 0,
      }))

      // Top products
      const produtosCont = new Map<string, { quantidade: number; valor: number }>()
      vendas?.forEach(venda => {
        const existing = produtosCont.get(venda.nome_produto)
        if (existing) {
          produtosCont.set(venda.nome_produto, {
            quantidade: existing.quantidade + 1,
            valor: existing.valor + Number(venda.valor_venda)
          })
        } else {
          produtosCont.set(venda.nome_produto, {
            quantidade: 1,
            valor: Number(venda.valor_venda)
          })
        }
      })

      const produtosMaisVendidos = Array.from(produtosCont.entries())
        .map(([nome, data]) => ({ nome, ...data }))
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5)

      if (requestId !== latestFetch.current) return
      setMetrics({
        totalVendas,
        quantidadeVendas,
        ticketMedio,
        abordagens: totalAbordagens,
        conversao,
        vendasMes,
        produtosMaisVendidos
      })
    } catch (err) {
      if (requestId !== latestFetch.current) return
      console.error('Erro ao buscar dados do dashboard:', err)
      setError('Erro ao carregar dados do dashboard')
    } finally {
      if (requestId === latestFetch.current) setLoading(false)
    }
  }, [dateFilter, isExecutive, rolesLoading, userId])

  useEffect(() => {
    if (!userId || rolesLoading) return

    void fetchDashboardData()
    const refresh = () => { void fetchDashboardData() }
    window.addEventListener('dashboard-data-changed', refresh)

    // The executive channel must receive every seller change. The seller
    // channel stays scoped to its owner to avoid unnecessary refreshes.
    const realtimeScope = isExecutive
      ? {}
      : { filter: `user_id=eq.${userId}` }

    const channel = supabase.channel(`dashboard-data-${isExecutive ? 'all' : userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vendas', ...realtimeScope },
        () => { void fetchDashboardData() }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'abordagens', ...realtimeScope },
        () => { void fetchDashboardData() }
      )
      .subscribe()

    return () => {
      window.removeEventListener('dashboard-data-changed', refresh)
      supabase.removeChannel(channel)
    }
  }, [fetchDashboardData, isExecutive, rolesLoading, userId])

  return { metrics, loading, error, refetch: fetchDashboardData }
}
