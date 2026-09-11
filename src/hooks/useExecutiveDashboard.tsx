import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'
import { fetchAllPages } from '@/lib/supabase-pages'
import { addDaysToDateKey, brasiliaDateKey, brasiliaDateRange, formatDateKey } from '@/lib/brasilia-time'

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

export function useExecutiveDashboard(dateFilter: string = '30dias') {
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

  const getDateRange = (filter: string) => {
    const today = brasiliaDateKey()
    const days = filter === '7dias' ? 7 : filter === '14dias' ? 14 : filter === '30dias' ? 30 : 1
    const lastDay = filter === 'ontem' ? addDaysToDateKey(today, -1) : today
    const range = brasiliaDateRange(days, lastDay)
    return { start: range.start.toISOString(), end: range.end.toISOString(), days, lastDay }
  }

  const fetchExecutiveDashboard = useCallback(async () => {
    const requestId = ++latestFetch.current
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const { start, end, days, lastDay } = getDateRange(dateFilter)

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
      const salesData = await fetchAllPages((from, to) => supabase
        .from('vendas')
        .select('id, user_id, nome_produto, valor_venda, created_at')
        .eq('approval_status', 'aprovada')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to))

      // Fetch approaches in period
      const approachesData = await fetchAllPages((from, to) => supabase
        .from('abordagens')
        .select('id, user_id, nomes_abordados, created_at')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to))

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

      const dateKeys = Array.from({ length: days }, (_, index) =>
        addDaysToDateKey(lastDay, index - days + 1),
      )
      const salesByPeriod = dateKeys.map((dateKey) => ({
        month: formatDateKey(dateKey, { day: '2-digit', month: '2-digit', year: undefined }),
        vendas: salesData?.filter((sale) => brasiliaDateKey(sale.created_at) === dateKey).length || 0,
        abordagens: approachesData?.filter((approach) => brasiliaDateKey(approach.created_at) === dateKey).length || 0,
      }))

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
          created_at: sale.created_at
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
  }, [user, dateFilter])

  useEffect(() => {
    fetchExecutiveDashboard()
    const refresh = () => { void fetchExecutiveDashboard() }
    window.addEventListener('dashboard-data-changed', refresh)

    // Sincronização em Tempo Real (Dashboard Executivo)
    const channel = supabase.channel('executive-dashboard-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vendas' },
        () => fetchExecutiveDashboard()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'abordagens' },
        () => fetchExecutiveDashboard()
      )
      .subscribe()

    return () => {
      window.removeEventListener('dashboard-data-changed', refresh)
      supabase.removeChannel(channel)
    }
  }, [fetchExecutiveDashboard])

  return {
    data,
    loading,
    error,
    refetch: fetchExecutiveDashboard
  }
}
