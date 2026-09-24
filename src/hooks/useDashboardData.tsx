import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { fetchAllPages } from '@/lib/supabase-pages'
import { millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import {
  buildDashboardSeries,
  createDefaultDashboardCustomRange,
  DashboardCustomRange,
  DashboardDateFilter,
  resolveDashboardPeriod,
} from '@/lib/dashboard-period'

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

export function useDashboardData(
  dateFilter: DashboardDateFilter = '30dias',
  customRange: DashboardCustomRange = createDefaultDashboardCustomRange(),
) {
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
  const customStart = customRange.start
  const customEnd = customRange.end

  const fetchDashboardData = useCallback(async (showLoading = false) => {
    const requestId = ++latestFetch.current
    if (!userId || rolesLoading) return

    try {
      if (showLoading) setLoading(true)
      setError(null)

      const period = resolveDashboardPeriod(dateFilter, { start: customStart, end: customEnd })

      // Executives see the consolidated commercial operation. Sellers see only
      // their own data. RLS remains the final source of authorization.
      const [vendas, abordagens] = await Promise.all([
        fetchAllPages((from, to) => {
          let request = supabase
            .from('vendas')
            .select('id, nome_produto, valor_venda, created_at')
            .eq('approval_status', 'aprovada')
          if (period.start && period.end) {
            request = request
              .gte('created_at', period.start.toISOString())
              .lt('created_at', period.end.toISOString())
          }
          request = request.order('created_at').order('id')
          if (!isExecutive) request = request.eq('user_id', userId)
          return request.range(from, to)
        }),
        fetchAllPages((from, to) => {
          let request = supabase
            .from('abordagens')
            .select('id, created_at')
          if (period.start && period.end) {
            request = request
              .gte('created_at', period.start.toISOString())
              .lt('created_at', period.end.toISOString())
          }
          request = request.order('created_at').order('id')
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

      // Short ranges stay daily; long and all-time ranges are aggregated so
      // the commercial evolution remains readable.
      const vendasMes = buildDashboardSeries(vendas, abordagens, period)

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
  }, [customEnd, customStart, dateFilter, isExecutive, rolesLoading, userId])

  useEffect(() => {
    if (!userId || rolesLoading) return

    void fetchDashboardData(true)
    const refresh = () => { void fetchDashboardData(false) }
    window.addEventListener('dashboard-data-changed', refresh)

    return () => {
      window.removeEventListener('dashboard-data-changed', refresh)
    }
  }, [fetchDashboardData, isExecutive, rolesLoading, userId])

  useEffect(() => {
    if (!userId || rolesLoading || dateFilter === 'all' || dateFilter === 'custom') return
    let timeout: number
    const schedule = () => {
      timeout = window.setTimeout(() => {
        void fetchDashboardData(false)
        schedule()
      }, millisecondsUntilBrasiliaMidnight() + 100)
    }
    schedule()
    return () => window.clearTimeout(timeout)
  }, [dateFilter, fetchDashboardData, rolesLoading, userId])

  return { metrics, loading, error, refetch: () => fetchDashboardData(true) }
}
