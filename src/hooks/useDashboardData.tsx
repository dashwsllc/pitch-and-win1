import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'

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

  const getDateRange = (filter: string) => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    switch (filter) {
      case "hoje":
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      case "ontem": {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
        return { start: yesterday, end: today }
      }
      case "7dias":
        return { start: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      case "14dias":
        return { start: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000), end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      case "30dias":
      default:
        return { start: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000), end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
    }
  }

  const fetchDashboardData = useCallback(async () => {
    if (!userId || rolesLoading) return

    try {
      setLoading(true)
      setError(null)

      const { start, end } = getDateRange(dateFilter)

      // Executives see the consolidated commercial operation. Sellers see only
      // their own data. RLS remains the final source of authorization.
      let vendasQuery = supabase
        .from('vendas')
        .select('nome_produto, valor_venda, created_at')
        .eq('approval_status', 'aprovada')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .limit(1000)

      let abordagensQuery = supabase
        .from('abordagens')
        .select('created_at')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .limit(1000)

      if (!isExecutive) {
        vendasQuery = vendasQuery.eq('user_id', userId)
        abordagensQuery = abordagensQuery.eq('user_id', userId)
      }

      const [
        { data: vendas, error: vendasError },
        { data: abordagens, error: abordagensError }
      ] = await Promise.all([vendasQuery, abordagensQuery])

      if (vendasError) throw vendasError

      if (abordagensError) throw abordagensError

      // Calculate metrics
      const totalVendas = vendas?.reduce((sum, venda) => sum + Number(venda.valor_venda), 0) || 0
      const quantidadeVendas = vendas?.length || 0
      const ticketMedio = quantidadeVendas > 0 ? totalVendas / quantidadeVendas : 0
      const totalAbordagens = abordagens?.length || 0
      const conversao = totalAbordagens > 0 ? (quantidadeVendas / totalAbordagens) * 100 : 0

      // Monthly data (last 6 months)
      const vendasPorMes = new Map<string, number>()
      const abordagensPorMes = new Map<string, number>()
      
      // Meses no fuso local. Usar setMonth sobre a data de hoje pula ou repete
      // meses quando o dia atual nao existe no mes anterior (dia 29 a 31).
      const hoje = new Date()
      const chaveMes = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const ultimos6Meses = Array.from({ length: 6 }, (_, i) =>
        chaveMes(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1))
      ).reverse()

      ultimos6Meses.forEach(mes => {
        vendasPorMes.set(mes, 0)
        abordagensPorMes.set(mes, 0)
      })

      vendas?.forEach(venda => {
        const mes = chaveMes(new Date(venda.created_at))
        if (vendasPorMes.has(mes)) {
          vendasPorMes.set(mes, vendasPorMes.get(mes)! + Number(venda.valor_venda))
        }
      })

      abordagens?.forEach(abordagem => {
        const mes = chaveMes(new Date(abordagem.created_at))
        if (abordagensPorMes.has(mes)) {
          abordagensPorMes.set(mes, abordagensPorMes.get(mes)! + 1)
        }
      })

      const vendasMes = ultimos6Meses.map(mes => ({
        // new Date('2026-09-01') e meia-noite UTC e cai no mes anterior em UTC-3.
        month: new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)
          .toLocaleDateString('pt-BR', { month: 'short' }),
        vendas: vendasPorMes.get(mes) || 0,
        abordagens: abordagensPorMes.get(mes) || 0
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
      console.error('Erro ao buscar dados do dashboard:', err)
      setError('Erro ao carregar dados do dashboard')
    } finally {
      setLoading(false)
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
