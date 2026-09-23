import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'
import { fetchAllPages } from '@/lib/supabase-pages'
import { millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import {
  buildDashboardSeries,
  createDefaultDashboardCustomRange,
  DashboardCustomRange,
  DashboardDateFilter,
  resolveDashboardPeriod,
} from '@/lib/dashboard-period'

interface ExecutiveDashboardData {
  totalSellers: number
  totalSales: number
  totalRevenue: number
  totalApproaches: number
  totalSubscriptions: number
  activeSubscriptions: number
  conversionRate: number
  salesByPeriod: Array<{
    month: string
    vendas: number
    abordagens: number
  }>
  topSellers: Array<{
    user_id: string
    seller_name: string
    total_sales: number
    total_revenue: number
    conversion_rate: number
  }>
  recentActivity: Array<{
    type: 'sale' | 'approach' | 'subscription'
    seller_name: string
    details: string
    created_at: string
  }>
}

export function useExecutiveDashboard(
  dateFilter: DashboardDateFilter = '30dias',
  customRange: DashboardCustomRange = createDefaultDashboardCustomRange(),
) {
  const { user } = useAuth()
  const [data, setData] = useState<ExecutiveDashboardData>({
    totalSellers: 0,
    totalSales: 0,
    totalRevenue: 0,
    totalApproaches: 0,
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    conversionRate: 0,
    salesByPeriod: [],
    topSellers: [],
    recentActivity: []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latestFetch = useRef(0)
  const customStart = customRange.start
  const customEnd = customRange.end

  const fetchExecutiveDashboard = useCallback(async (showLoading = false) => {
    const requestId = ++latestFetch.current
    if (!user) return

    if (showLoading) setLoading(true)
    setError(null)

    try {
      const period = resolveDashboardPeriod(dateFilter, { start: customStart, end: customEnd })

      // Fetch profiles for name resolution
      const profilesData = await fetchAllPages((from, to) => supabase
        .from('profiles')
        .select('user_id, display_name, suspended')
        .order('user_id')
        .range(from, to))

      const profileMap = new Map<string, string>()
      const activeProfiles = new Set<string>()
      profilesData?.forEach(p => {
        profileMap.set(p.user_id, p.display_name || 'Usuário')
        if (!p.suspended) activeProfiles.add(p.user_id)
      })

      // Fetch total sellers count
      const sellerRoles = await fetchAllPages((from, to) => supabase.from('user_roles')
        .select('id, user_id').in('role', ['seller','closer','sdr','bdr'])
        .order('id')
        .range(from, to))
      // Count each active collaborator once, including accumulated roles.
      const totalSellers = new Set(
        (sellerRoles ?? []).map(role => role.user_id).filter(id => activeProfiles.has(id))
      ).size

      // Fetch sales in period (apenas aprovadas)
      const salesData = await fetchAllPages((from, to) => {
        let request = supabase
          .from('vendas')
          .select('id, user_id, nome_produto, valor_venda, updated_at')
          .eq('approval_status', 'aprovada')
        if (period.start && period.end) {
          request = request
            .gte('updated_at', period.start.toISOString())
            .lt('updated_at', period.end.toISOString())
        }
        return request
          .order('updated_at', { ascending: false })
          .order('id')
          .range(from, to)
      })

      // Fetch approaches in period
      const approachesData = await fetchAllPages((from, to) => {
        let request = supabase
          .from('abordagens')
          .select('id, user_id, nomes_abordados, created_at')
        if (period.start && period.end) {
          request = request
            .gte('created_at', period.start.toISOString())
            .lt('created_at', period.end.toISOString())
        }
        return request
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
      })

      // Fetch subscriptions
      const subscriptionsData = await fetchAllPages((from, to) => supabase
        .from('assinaturas')
        .select('id, status')
        .order('id')
        .range(from, to))

      const totalSales = salesData?.length || 0
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.valor_venda), 0) || 0
      const totalApproaches = approachesData?.length || 0
      const totalSubscriptions = subscriptionsData?.length || 0
      const activeSubscriptions = subscriptionsData?.filter(sub => sub.status === 'ativa').length || 0
      const conversionRate = totalApproaches > 0 ? (totalSales / totalApproaches) * 100 : 0

      const salesByPeriod = buildDashboardSeries(salesData.map(sale => ({ created_at: sale.updated_at })), approachesData, period)

      // Top sellers - use profileMap for real names
      const sellerStats = new Map<string, {
        seller_name: string
        total_sales: number
        total_revenue: number
        approaches: number
      }>()

      salesData?.forEach(sale => {
        const sellerName = profileMap.get(sale.user_id) || `Seller ${sale.user_id.substring(0, 8)}`
        if (!sellerStats.has(sale.user_id)) {
          sellerStats.set(sale.user_id, {
            seller_name: sellerName,
            total_sales: 0,
            total_revenue: 0,
            approaches: 0
          })
        }
        const stats = sellerStats.get(sale.user_id)!
        stats.total_sales += 1
        stats.total_revenue += Number(sale.valor_venda)
      })

      approachesData?.forEach(approach => {
        const sellerName = profileMap.get(approach.user_id) || `Seller ${approach.user_id.substring(0, 8)}`
        if (!sellerStats.has(approach.user_id)) {
          sellerStats.set(approach.user_id, {
            seller_name: sellerName,
            total_sales: 0,
            total_revenue: 0,
            approaches: 0
          })
        }
        const stats = sellerStats.get(approach.user_id)!
        stats.approaches += 1
      })

      const topSellers = Array.from(sellerStats.entries())
        .map(([user_id, stats]) => ({
          ...stats,
          user_id,
          conversion_rate: stats.approaches > 0 ? (stats.total_sales / stats.approaches) * 100 : 0
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 5)

      // Recent activity
      const recentActivity: ExecutiveDashboardData['recentActivity'] = [
        ...(salesData?.slice(0, 5).map(sale => ({
          type: 'sale' as const,
          seller_name: profileMap.get(sale.user_id) || `Seller ${sale.user_id.substring(0, 8)}`,
          details: `Venda de ${sale.nome_produto} - R$ ${Number(sale.valor_venda).toLocaleString('pt-BR')}`,
          created_at: sale.updated_at
        })) || []),
        ...(approachesData?.slice(0, 5).map(approach => ({
          type: 'approach' as const,
          seller_name: profileMap.get(approach.user_id) || `Seller ${approach.user_id.substring(0, 8)}`,
          details: `Prospects abordados: ${approach.nomes_abordados}`,
          created_at: approach.created_at
        })) || [])
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)

      if (requestId !== latestFetch.current) return
      setData({
        totalSellers,
        totalSales,
        totalRevenue,
        totalApproaches,
        totalSubscriptions,
        activeSubscriptions,
        conversionRate,
        salesByPeriod,
        topSellers,
        recentActivity
      })

    } catch (err) {
      if (requestId !== latestFetch.current) return
      console.error('Error fetching executive dashboard:', err)
      setError('Erro ao carregar dados do dashboard')
    } finally {
      if (requestId === latestFetch.current) setLoading(false)
    }
  }, [customEnd, customStart, dateFilter, user])

  useEffect(() => {
    void fetchExecutiveDashboard(true)
    const refresh = () => { void fetchExecutiveDashboard(false) }
    window.addEventListener('dashboard-data-changed', refresh)

    return () => {
      window.removeEventListener('dashboard-data-changed', refresh)
    }
  }, [fetchExecutiveDashboard])

  useEffect(() => {
    if (!user || dateFilter === 'all' || dateFilter === 'custom') return
    let timeout: number
    const schedule = () => {
      timeout = window.setTimeout(() => {
        void fetchExecutiveDashboard(false)
        schedule()
      }, millisecondsUntilBrasiliaMidnight() + 100)
    }
    schedule()
    return () => window.clearTimeout(timeout)
  }, [dateFilter, fetchExecutiveDashboard, user])

  return {
    data,
    loading,
    error,
    refetch: () => fetchExecutiveDashboard(true)
  }
}
