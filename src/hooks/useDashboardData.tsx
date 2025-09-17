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

export function useDashboardData() {
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

  useEffect(() => {
    if (!user) return

    const fetchDashboardData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Buscar vendas do usuário
        const { data: vendas, error: vendasError } = await supabase
          .from('vendas')
          .select('*')
          .eq('user_id', user.id)

        if (vendasError) throw vendasError

        // Buscar abordagens do usuário
        const { data: abordagens, error: abordagensError } = await supabase
          .from('abordagens')
          .select('*')
          .eq('user_id', user.id)

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

    fetchDashboardData()
  }, [user])

  return { metrics, loading, error }
}