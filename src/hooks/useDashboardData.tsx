import { useState, useEffect, useCallback, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { fetchAllPages } from '@/lib/supabase-pages'
import { millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import { callsDoPeriodo, type CallLinha, type VendaLinha } from '@/painel/lib/visao'
import {
  buildDashboardSeries,
  createDefaultDashboardCustomRange,
  DashboardCustomRange,
  DashboardDateFilter,
  ResolvedDashboardPeriod,
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

// As mesmas linhas que as métricas acima resumem (vendas aprovadas e abordagens do período). A Home nova as usa para
// o que não cabe num total: série por hora, feed ao vivo, "na última hora" e a divisão das abordagens pela
// demonstração da IA (campo obrigatório do formulário).
export interface DashboardRows {
  // Vendas aprovadas COMPRADAS no período (created_at): é o que dá os totais e os gráficos. reviewed_at é a hora da
  // aprovação, que o feed, o "na última hora" e a "última às" usam.
  vendas: VendaLinha[]
  // Vendas aprovadas NO período (reviewed_at) cuja compra veio ANTES dele. Não entram nos totais (a venda conta no dia
  // da compra, regra de 23/09: aprovar não faz uma compra antiga virar venda nova), mas aprovar é algo que acabou de
  // acontecer: o feed as mostra e um aviso diz onde elas foram contadas.
  compradasAntes: VendaLinha[]
  abordagens: Array<{ id: string; created_at: string; mostrou_ia: boolean }>
  // Calls feitas no período: qualificação ou fechamento concluída no CRM (com resultado: venda, perda, repasse,
  // avançou) e sem cancelamento, no momento em que aconteceu (momentoDaCall: a hora marcada, ou a do fechamento se
  // ela veio antes). O time quase não registra presença (performed_at), então ela não é exigida.
  calls: CallLinha[]
}

// As funções dashboard_home_* (migração 20261007130000) ainda não estão nos tipos gerados: as consultas saem pelo mesmo
// cliente e a mesma sessão, só sem a checagem de tipos delas.
const clienteSemTipos = supabase as unknown as SupabaseClient

interface VendaDoBanco {
  id: string
  nome_produto: string
  valor_venda: number | string
  created_at: string
  reviewed_at: string | null
}

export function useDashboardData(
  dateFilter: DashboardDateFilter = '30dias',
  customRange: DashboardCustomRange = createDefaultDashboardCustomRange(),
) {
  const { user } = useAuth()
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
  const [rows, setRows] = useState<DashboardRows>({ vendas: [], compradasAntes: [], abordagens: [], calls: [] })
  const [loading, setLoading] = useState(true)
  // Algum pedido em andamento (inclusive os de fundo, que não mostram "carregando").
  const [fetching, setFetching] = useState(false)
  // Quando o último pedido terminou bem: alimenta o "atualizado há X" da barra superior.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  // Sobe a cada carga pedida (primeira, troca de filtro, botão Atualizar), nunca nas atualizações de fundo: quem
  // anima só o que chega ao vivo (o feed) usa isto para tratar uma carga nova como "já visto".
  const [generation, setGeneration] = useState(0)
  // O recorte das linhas que estão na tela. O filtro escolhido muda na hora; este só quando os dados dele chegam, e
  // quem desenha a série (por hora ou por dia) segue ele para nunca misturar o formato novo com os números antigos.
  const [loadedPeriod, setLoadedPeriod] = useState<ResolvedDashboardPeriod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latestFetch = useRef(0)
  const lastSignature = useRef('')
  const customStart = customRange.start
  const customEnd = customRange.end

  const fetchDashboardData = useCallback(async (showLoading = false) => {
    const requestId = ++latestFetch.current
    if (!userId) return

    try {
      if (showLoading) setLoading(true)
      setFetching(true)
      setError(null)

      const period = resolveDashboardPeriod(dateFilter, { start: customStart, end: customEnd })

      // A Visão geral é a do time todo, para qualquer conta ativa (não só Executive): as tabelas só entregam a cada pessoa
      // as próprias linhas (RLS, e vendas carrega os dados do comprador), então a leitura passa pelas funções
      // dashboard_home_*, que devolvem só as colunas que a Home desenha e exigem conta ativa e aprovada.
      const inicioDoPeriodo = period.start
      const fimDoPeriodo = period.end
      const janela = { p_start: inicioDoPeriodo?.toISOString() ?? null, p_end: fimDoPeriodo?.toISOString() ?? null }
      const [vendas, compradasAntes, abordagens, calls] = await Promise.all([
        fetchAllPages<VendaDoBanco>((from, to) =>
          clienteSemTipos.rpc('dashboard_home_sales', janela).order('created_at').order('id').range(from, to),
        ),
        // Aprovadas NESTE período, compradas ANTES dele (ver DashboardRows.compradasAntes). Em "todo o período" não há
        // compra anterior: nada a buscar.
        inicioDoPeriodo && fimDoPeriodo
          ? fetchAllPages<VendaDoBanco>((from, to) =>
              clienteSemTipos.rpc('dashboard_home_sales', { ...janela, p_late: true }).order('reviewed_at').order('id').range(from, to),
            )
          : Promise.resolve([] as VendaDoBanco[]),
        fetchAllPages<{ id: string; created_at: string; mostrou_ia: boolean | null }>((from, to) =>
          clienteSemTipos.rpc('dashboard_home_approaches', janela).order('created_at').order('id').range(from, to),
        ),
        // Calls feitas: concluídas e não canceladas, do time todo. A janela traz as que têm a hora marcada ou a do
        // fechamento no período; o momento exato (o mais cedo dos dois) é recortado logo abaixo.
        fetchAllPages<{ id: string; scheduled_at: string | null; completed_at: string | null }>((from, to) =>
          clienteSemTipos.rpc('dashboard_home_calls', janela).order('scheduled_at').order('id').range(from, to),
        ),
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
      const next: DashboardMetrics = {
        totalVendas,
        quantidadeVendas,
        ticketMedio,
        abordagens: totalAbordagens,
        conversao,
        vendasMes,
        produtosMaisVendidos
      }
      const comoLinha = (venda: VendaDoBanco): VendaLinha => ({
        id: venda.id,
        nome_produto: venda.nome_produto,
        valor_venda: Number(venda.valor_venda),
        created_at: venda.created_at,
        reviewed_at: venda.reviewed_at,
      })
      const nextRows: DashboardRows = {
        vendas: (vendas ?? []).map(comoLinha),
        compradasAntes: (compradasAntes ?? []).map(comoLinha),
        abordagens: (abordagens ?? []).map(abordagem => ({
          id: abordagem.id,
          created_at: abordagem.created_at,
          mostrou_ia: abordagem.mostrou_ia === true,
        })),
        calls: callsDoPeriodo(calls ?? [], period),
      }
      // Background refreshes usually return the same numbers. Keeping the current
      // state then avoids re-rendering the page and restarting the chart animation.
      const signature = JSON.stringify([next, nextRows])
      if (signature !== lastSignature.current) {
        lastSignature.current = signature
        setMetrics(next)
        setRows(nextRows)
      }
      setLoadedPeriod(period)
      setUpdatedAt(new Date().toISOString())
      if (showLoading) setGeneration(g => g + 1)
    } catch (err) {
      if (requestId !== latestFetch.current) return
      console.error('Erro ao buscar dados do dashboard:', err)
      setError('Erro ao carregar dados do dashboard')
    } finally {
      if (requestId === latestFetch.current) {
        setLoading(false)
        setFetching(false)
      }
    }
  }, [customEnd, customStart, dateFilter, userId])

  useEffect(() => {
    if (!userId) return

    void fetchDashboardData(true)
    const refresh = () => { void fetchDashboardData(false) }
    window.addEventListener('dashboard-data-changed', refresh)

    return () => {
      window.removeEventListener('dashboard-data-changed', refresh)
    }
  }, [fetchDashboardData, userId])

  useEffect(() => {
    if (!userId || dateFilter === 'all' || dateFilter === 'custom') return
    let timeout: number
    const schedule = () => {
      timeout = window.setTimeout(() => {
        void fetchDashboardData(false)
        schedule()
      }, millisecondsUntilBrasiliaMidnight() + 100)
    }
    schedule()
    return () => window.clearTimeout(timeout)
  }, [dateFilter, fetchDashboardData, userId])

  return { metrics, rows, loading, fetching, error, updatedAt, generation, loadedPeriod, refetch: () => fetchDashboardData(true) }
}
