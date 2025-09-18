import { useState, useEffect } from 'react'
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

  const fetchExecutiveDashboard = async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const { start, end } = getDateRange(dateFilter)

      // Buscar total de sellers
      const { data: sellersData } = await supabase
        .from('profiles')
        .select('id', { count: 'exact' })

      // Buscar vendas no período
      const { data: salesData } = await supabase
        .from('vendas')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)

      // Buscar abordagens no período
      const { data: approachesData } = await supabase
        .from('abordagens')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)

      // Buscar assinaturas
      const { data: subscriptionsData } = await supabase
        .from('assinaturas')
        .select('*')

      const totalSellers = sellersData?.length || 0
      const totalSales = salesData?.length || 0
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.valor_venda), 0) || 0
      const totalApproaches = approachesData?.length || 0
      const totalSubscriptions = subscriptionsData?.length || 0
      const activeSubscriptions = subscriptionsData?.filter(sub => sub.status === 'ativa').length || 0
      const conversionRate = totalApproaches > 0 ? (totalSales / totalApproaches) * 100 : 0

      // Calcular vendas por período (últimos 7 dias)
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

      // Top sellers
      const sellerStats = new Map()
      
      salesData?.forEach(sale => {
        const sellerName = `Seller ${sale.user_id.substring(0, 8)}`
        if (!sellerStats.has(sellerName)) {
          sellerStats.set(sellerName, {
            seller_name: sellerName,
            total_sales: 0,
            total_revenue: 0,
            approaches: 0
          })
        }
        const stats = sellerStats.get(sellerName)
        stats.total_sales += 1
        stats.total_revenue += Number(sale.valor_venda)
      })

      approachesData?.forEach(approach => {
        const sellerName = `Seller ${approach.user_id.substring(0, 8)}`
        if (!sellerStats.has(sellerName)) {
          sellerStats.set(sellerName, {
            seller_name: sellerName,
            total_sales: 0,
            total_revenue: 0,
            approaches: 0
          })
        }
        const stats = sellerStats.get(sellerName)
        stats.approaches += 1
      })

      const topSellers = Array.from(sellerStats.values())
        .map(stats => ({
          ...stats,
          conversion_rate: stats.approaches > 0 ? (stats.total_sales / stats.approaches) * 100 : 0
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 5)

      // Atividade recente
      const recentActivity = [
        ...salesData?.slice(0, 5).map(sale => ({
          type: 'sale' as const,
          seller_name: `Seller ${sale.user_id.substring(0, 8)}`,
          details: `Venda de ${sale.nome_produto} - R$ ${Number(sale.valor_venda).toLocaleString('pt-BR')}`,
          created_at: sale.created_at
        })) || [],
        ...approachesData?.slice(0, 5).map(approach => ({
          type: 'approach' as const,
          seller_name: `Seller ${approach.user_id.substring(0, 8)}`,
          details: `${approach.nomes_abordados} pessoas abordadas`,
          created_at: approach.created_at
        })) || []
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
        salesByPeriod: salesByPeriod,
        topSellers,
        recentActivity
      })

    } catch (err) {
      console.error('Error fetching executive dashboard:', err)
      setError('Erro ao carregar dados do dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchExecutiveDashboard()
  }, [user, dateFilter])

  return {
    data,
    loading,
    error,
    refetch: fetchExecutiveDashboard
  }
}