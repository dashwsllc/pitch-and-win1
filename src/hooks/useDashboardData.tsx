import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'

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
      case "ontem":
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
        return { start: yesterday, end: today }
      case "7dias":
        return { start: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      case "14dias":
        return { start: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000), end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      case "30dias":
      default:
        return { start: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000), end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
    }
  }

  const fetchDashboardData = async () => {
    if (!user) return

    try {
      setLoading(true)
      setError(null)

      const { start, end } = getDateRange(dateFilter)

      // Buscar vendas do usuário no período
      const { data: vendas, error: vendasError } = await supabase
        .from('vendas')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())

      if (vendasError) throw vendasError

      // Buscar abordagens do usuário no período
      const { data: abordagens, error: abordagensError } = await supabase
        .from('abordagens')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())

      if (abordagensError) throw abordagensError

      // Calcular métricas
      const totalVendas = vendas?.reduce((sum, venda) => sum + Number(venda.valor_venda), 0) || 0
      const quantidadeVendas = vendas?.length || 0
      const ticketMedio = quantidadeVendas > 0 ? totalVendas / quantidadeVendas : 0
      const totalAbordagens = abordagens?.length || 0
      const conversao = totalAbordagens > 0 ? (quantidadeVendas / totalAbordagens) * 100 : 0

      // Dados por mês (últimos 6 meses)
      const vendasPorMes = new Map()
      const abordagensPorMes = new Map()
      
      const últimos6Meses = Array.from({ length: 6 }, (_, i) => {
        const date = new Date()
        date.setMonth(date.getMonth() - i)
        return date.toISOString().slice(0, 7) // YYYY-MM
      }).reverse()

      // Inicializar com zeros
      últimos6Meses.forEach(mes => {
        vendasPorMes.set(mes, 0)
        abordagensPorMes.set(mes, 0)
      })

      // Agrupar vendas por mês
      vendas?.forEach(venda => {
        const mes = new Date(venda.created_at).toISOString().slice(0, 7)
        if (vendasPorMes.has(mes)) {
          vendasPorMes.set(mes, vendasPorMes.get(mes) + Number(venda.valor_venda))
        }
      })

      // Agrupar abordagens por mês
      abordagens?.forEach(abordagem => {
        const mes = new Date(abordagem.created_at).toISOString().slice(0, 7)
        if (abordagensPorMes.has(mes)) {
          abordagensPorMes.set(mes, abordagensPorMes.get(mes) + 1)
        }
      })

      const vendasMes = últimos6Meses.map(mes => ({
        month: new Date(mes + '-01').toLocaleDateString('pt-BR', { month: 'short' }),
        vendas: vendasPorMes.get(mes),
        abordagens: abordagensPorMes.get(mes)
      }))

      // Produtos mais vendidos
      const produtosCont = new Map()
      vendas?.forEach(venda => {
        if (produtosCont.has(venda.nome_produto)) {
          const existing = produtosCont.get(venda.nome_produto)
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
  }

  useEffect(() => {
    fetchDashboardData()
  }, [user, dateFilter])

  return { metrics, loading, error, refetch: fetchDashboardData }
}