import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'

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

  const getDateRange = (filter: string) => {
    const now = new Date()
    const start = new Date()
    
    switch (filter) {
      case 'hoje':
        start.setHours(0, 0, 0, 0)
        break
      case 'ontem':
        start.setDate(now.getDate() - 1)
        start.setHours(0, 0, 0, 0)
        now.setDate(now.getDate() - 1)
        now.setHours(23, 59, 59, 999)
        break
      case '7dias':
        start.setDate(now.getDate() - 7)
        break
      case '14dias':
        start.setDate(now.getDate() - 14)
        break
      case '30dias':
      default:
        start.setDate(now.getDate() - 30)
        break
    }
    
    return { start: start.toISOString(), end: now.toISOString() }
  }

  const fetchExecutiveDashboard = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const { start, end } = getDateRange(dateFilter)

      // Fetch profiles for name resolution
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, display_name, suspended')
      if (profilesError) throw profilesError

      const profileMap = new Map<string, string>()
      const activeProfiles = new Set<string>()
      profilesData?.forEach(p => {
        profileMap.set(p.user_id, p.display_name || 'Usuário')
        if (!p.suspended) activeProfiles.add(p.user_id)
      })

      // Fetch total sellers count
      const { data: sellerRoles, error: sellerError } = await supabase.from('user_roles')
        .select('user_id').in('role', ['seller','closer','sdr','bdr'])
      if (sellerError) throw sellerError
      // user_roles nao tem chave estrangeira para auth.users e mantem linhas de
      // contas ja removidas. Conta apenas quem ainda tem perfil ativo, como em
      // get_team_ranking.
      const totalSellers = new Set(
        (sellerRoles ?? []).map(role => role.user_id).filter(id => activeProfiles.has(id))
      ).size

      // Fetch sales in period (apenas aprovadas)
      const { data: salesData, error: salesError } = await supabase
        .from('vendas')
        .select('user_id, nome_produto, valor_venda, created_at')
        .eq('approval_status', 'aprovada')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .limit(1000)
      if (salesError) throw salesError

      // Fetch approaches in period
      const { data: approachesData, error: approachesError } = await supabase
        .from('abordagens')
        .select('user_id, nomes_abordados, created_at')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .limit(1000)
      if (approachesError) throw approachesError

      // Fetch subscriptions
      const { data: subscriptionsData, error: subscriptionsError } = await supabase
        .from('assinaturas')
        .select('status')
        .limit(1000)
      if (subscriptionsError) throw subscriptionsError

      const totalSales = salesData?.length || 0
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.valor_venda), 0) || 0
      const totalApproaches = approachesData?.length || 0
      const totalSubscriptions = subscriptionsData?.length || 0
      const activeSubscriptions = subscriptionsData?.filter(sub => sub.status === 'ativa').length || 0
      const conversionRate = totalApproaches > 0 ? (totalSales / totalApproaches) * 100 : 0

      // Sales by period (last 7 days)
      const salesByPeriod = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        
        const daySales = salesData?.filter(sale => 
          sale.created_at.startsWith(dateStr)
        ) || []
        
        const dayApproaches = approachesData?.filter(approach => 
          approach.created_at.startsWith(dateStr)
        ) || []
        
        salesByPeriod.push({
          month: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          vendas: daySales.length,
          abordagens: dayApproaches.length
        })
      }

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

      const topSellers = Array.from(sellerStats.values())
        .map(stats => ({
          ...stats,
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
          details: `${approach.nomes_abordados} pessoas abordadas`,
          created_at: approach.created_at
        })) || [])
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)

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
      console.error('Error fetching executive dashboard:', err)
      setError('Erro ao carregar dados do dashboard')
    } finally {
      setLoading(false)
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
