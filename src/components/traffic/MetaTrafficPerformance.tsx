import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MetaMetricReferences } from './MetaMetricReferences'
import { money } from '@/lib/sales'
import { summarizeObjectives } from '@/lib/meta-traffic'
import { buildTrafficCsv, crmTrafficRates, trafficCsvText, type QueryState, type TrafficMetricTotals, type TrafficView } from '@/lib/meta-traffic-view'
import type { MetaDailyRow, TrafficCohortResult } from '../../../shared/meta-contract'

type Kind = 'money' | 'count' | 'percent' | 'ratio'
const format = (value: number | null, kind: Kind = 'count') => value === null ? '—' : kind === 'money' ? money(value)
  : kind === 'percent' ? value.toFixed(2) + '%' : kind === 'ratio' ? value.toFixed(2) + 'x' : value.toLocaleString('pt-BR')
const cards: [keyof TrafficMetricTotals, string, Kind][] = [
  ['spend', 'Valor gasto', 'money'], ['leads', 'Leads Meta', 'count'], ['cpl', 'CPL · custo por lead', 'money'],
  ['purchases', 'Compras Meta', 'count'], ['cpa', 'CPA Meta · custo por compra', 'money'], ['roas', 'ROAS Meta', 'ratio'],
  ['messagesStarted', 'Conversas iniciadas', 'count'], ['costPerMessage', 'Custo por mensagem iniciada', 'money'],
  ['linkClicks', 'Cliques no link', 'count'], ['cpc', 'CPC · custo por clique', 'money'], ['ctr', 'CTR · cliques no link', 'percent'],
  ['impressions', 'Impressões', 'count'], ['cpm', 'CPM · custo por mil impressões', 'money'],
  ['purchaseValue', 'Valor das compras Meta', 'money'], ['landingPageViews', 'Visualizações da página de destino', 'count'],
  ['costPerLandingPageView', 'Custo por visualização da página', 'money'], ['viewToPurchaseRate', 'Taxa página → compra', 'percent'],
  ['addsToCart', 'Adições ao carrinho', 'count'], ['checkoutsInitiated', 'Finalizações de compra iniciadas', 'count'],
  ['costPerCheckout', 'Custo por finalização iniciada', 'money'],
]
const essential = { leads: ['spend', 'leads', 'cpl', 'ctr'], vendas: ['spend', 'purchases', 'cpa', 'roas', 'purchaseValue', 'landingPageViews', 'costPerLandingPageView', 'viewToPurchaseRate'],
  mensagens: ['spend', 'messagesStarted', 'costPerMessage', 'ctr'], reconhecimento: ['spend', 'impressions', 'cpm', 'ctr'] }
function median(values: (number | null)[]) {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return !sorted.length ? null : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
function exportCsv(view: TrafficView) {
  const url = URL.createObjectURL(new Blob([trafficCsvText(buildTrafficCsv(view))], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `trafego_${view.scope.level}_${view.scope.start}_a_${view.scope.end}.csv`; link.click()
  URL.revokeObjectURL(url)
}
export function MetaTrafficPerformance({ view, queryState, cohortState, onRetry }: {
  view: TrafficView | null; queryState: QueryState<MetaDailyRow[]>; cohortState: QueryState<TrafficCohortResult> | null; onRetry: () => void
}) {
  const [page, setPage] = useState(0), [showAll, setShowAll] = useState(false)
  useEffect(() => { setPage(0) }, [view?.scope.start, view?.scope.end, view?.scope.level, view?.scope.accountId, view?.scope.campaignId, view?.scope.source])
  if (queryState.state === 'error') return <section role="alert" className="surface-panel space-y-3 rounded-xl p-5"><p className="text-destructive">{queryState.message}</p><Button variant="outline" onClick={onRetry}>Tentar novamente</Button></section>
  if (queryState.state === 'loading' || !view) return <p role="status">Carregando métricas…</p>
  const { total, groups, warnings } = view, objectives = summarizeObjectives(view.rows)
  const keys = objectives.dominant ? essential[objectives.dominant] : null
  const renderCard = ([key, label, kind]: typeof cards[number]) => <article key={key} className="surface-panel rounded-xl p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{format(total[key], kind)}</p></article>
  const crm = cohortState?.state === 'ready' ? cohortState.data : null
  const rates = crm ? crmTrafficRates(crm, view) : { cpa: null, roas: null, reason: null }
  const entities = view.scope.level === 'ad' ? 'Anúncios' : view.scope.level === 'adset' ? 'Conjuntos de anúncios' : 'Campanhas'
  const pages = Math.max(1, Math.ceil(groups.length / 50)), at = Math.min(page, pages - 1)
  const chart = view.daily.map(item => ({ date: item.date.split('-').reverse().join('/'), ...item.metrics }))
  const metaLeads = (campaign: string) => {
    const values = groups.filter(group => group.campaign_id === campaign).map(group => group.metrics.leads)
    return values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0)
  }
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.filter(([key]) => !keys || keys.includes(key)).map(renderCard)}</div>
    <Collapsible open={showAll} onOpenChange={setShowAll}>
      <div className="flex flex-wrap items-center gap-2">
        {keys && <CollapsibleTrigger asChild><Button variant="outline" size="sm">{showAll ? 'Ocultar todas as métricas' : 'Ver todas as métricas'}</Button></CollapsibleTrigger>}
        <MetaMetricReferences />
      </div>
      {keys && <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(renderCard)}</CollapsibleContent>}
    </Collapsible>
    {objectives.mixed && <p className="text-sm text-amber-500">O recorte mistura objetivos. Todas as métricas estão visíveis.</p>}
    {warnings.map(warning => <p key={warning} role="status" className="text-sm text-amber-500">{warning}</p>)}
    <p className="text-xs text-muted-foreground">CPL = gasto ÷ leads; CPA Meta = gasto ÷ compras; ROAS Meta = valor das compras ÷ gasto. CTR = cliques ÷ impressões × 100; CPM = gasto ÷ impressões × 1.000. Custo por visualização = gasto ÷ visualizações da página de destino; taxa página → compra = compras ÷ visualizações × 100. “—” indica métrica indisponível, definição incompatível ou denominador zero. Os resultados usam a atribuição de cada conjunto de anúncios, a mesma do Gerenciador de Anúncios.</p>
    {view.scope.level === 'campaign' && <section className="surface-panel space-y-3 rounded-2xl p-5">
      <h2 className="font-medium">Resultados comerciais · CRM</h2>
      {cohortState?.state === 'error' && <div role="alert" className="flex flex-wrap items-center gap-3"><p className="text-sm text-destructive">{cohortState.message}</p><Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button></div>}
      <div className="grid gap-3 sm:grid-cols-2"><article><p className="text-xs text-muted-foreground">CPA real (CRM) · vendas aprovadas</p><p className="mt-2 text-xl font-semibold">{cohortState?.state === 'loading' ? '…' : format(rates.cpa, 'money')}</p></article><article><p className="text-xs text-muted-foreground">ROAS real (CRM) · vendas aprovadas</p><p className="mt-2 text-xl font-semibold">{cohortState?.state === 'loading' ? '…' : format(rates.roas, 'ratio')}</p></article></div>
      {rates.reason && <p role="status" className="text-sm text-amber-500">{rates.reason}</p>}
      {crm?.reasons.filter(reason => reason !== rates.reason).map(reason => <p key={reason} className="text-xs text-muted-foreground">{reason}</p>)}
      <p className="text-xs text-muted-foreground">Coorte pela data de geração do lead em Brasília. Vendas aprovadas ainda válidas; cancelamentos e estornos saem automaticamente. Origem parcial do gasto não rateia vendas ou receita.</p>
      {crm && <><p className="text-xs text-muted-foreground">Leads Meta são ações agregadas do relatório; formulários recebidos são contatos individuais e podem ter atraso de sincronização.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Campanha', 'Leads Meta', 'Formulários recebidos', 'Pendentes', 'Aprovados', 'No CRM', 'Vendas válidas', 'Receita válida'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{crm.campaigns.filter(row => !view.scope.campaignId || row.campaign_id === view.scope.campaignId).map(row => <tr key={row.campaign_id} className="border-t"><td className="p-2">{row.campaign_name || row.campaign_id}</td><td className="p-2">{format(metaLeads(row.campaign_id))}</td>{[row.received, row.pending, row.approved, row.linked_crm, row.confirmed_sales].map((value, i) => <td className="p-2" key={i}>{format(value)}</td>)}<td className="p-2">{money(row.confirmed_revenue)}</td></tr>)}</tbody></table></div>{crm.unattributed_contacts > 0 && <p className="text-sm">{crm.unattributed_contacts} contatos sem campanha/conta comprovada.</p>}</>}
    </section>}
    {!!groups.length && <section className="surface-panel space-y-2 rounded-2xl p-5"><h2 className="font-medium">Referência do próprio recorte</h2><p className="text-sm text-muted-foreground">Medianas: CPL {format(total.cpl === null ? null : median(groups.map(group => group.metrics.cpl)), 'money')} · CPA Meta {format(total.cpa === null ? null : median(groups.map(group => group.metrics.cpa)), 'money')}. Compare entidades com objetivos e públicos semelhantes.</p><p className="text-xs text-muted-foreground">Atribuição: {[...new Set(view.rows.map(row => row.attribution_window))].join(' · ')}</p></section>}
    <section className="surface-panel rounded-2xl p-5"><h2 className="mb-4 font-medium">Investimento e resultados por dia</h2>{chart.length ? <div className="h-72" role="img" aria-label="Gráfico diário do recorte selecionado"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis yAxisId="brl" tick={{ fontSize: 11 }} /><YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Area yAxisId="brl" type="monotone" dataKey="spend" name="Investimento BRL" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.18} connectNulls={false} /><Area yAxisId="count" type="monotone" dataKey="leads" name="Leads Meta" stroke="#22c55e" fill="#22c55e" fillOpacity={0.08} connectNulls={false} /><Area yAxisId="count" type="monotone" dataKey="purchases" name="Compras Meta" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} connectNulls={false} /></AreaChart></ResponsiveContainer></div> : <p className="py-8 text-center text-sm text-muted-foreground">Nenhum dado publicado neste filtro.</p>}</section>
    <section className="surface-panel overflow-hidden rounded-2xl"><div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-medium">{entities}</h2><p className="text-xs text-muted-foreground">{groups.length} entidades · investimento no recorte completo: {format(total.spend, 'money')}</p></div><Button variant="outline" size="sm" disabled={!view.rows.length} onClick={() => exportCsv(view)}>Exportar CSV do recorte</Button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1240px] text-left text-sm"><thead><tr>{[entities, 'Gasto', 'Leads Meta', 'CPL', 'Compras Meta', 'CPA Meta', 'ROAS Meta', 'Visualizações da página', 'CTR', 'CPC', 'Conversas', 'Custo por mensagem'].map(label => <th key={label} className="px-4 py-3 text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead><tbody>{groups.slice(at * 50, at * 50 + 50).map(group => <tr key={group.key} className="border-t"><td className="px-4 py-3">{view.scope.level === 'ad' ? group.ad_name || group.ad_id : view.scope.level === 'adset' ? group.adset_name || group.adset_id : group.campaign_name || group.campaign_id}<p className="text-xs text-muted-foreground">Conta {group.account_id} · campanha {group.campaign_id}{group.adset_id && ' · conjunto ' + group.adset_id}{group.ad_id && ' · anúncio ' + group.ad_id}</p></td>{(['spend', 'leads', 'cpl', 'purchases', 'cpa', 'roas', 'landingPageViews', 'ctr', 'cpc', 'messagesStarted', 'costPerMessage'] as const).map(key => <td key={key} className="px-4 py-3 tabular-nums">{format(group.metrics[key], key === 'ctr' ? 'percent' : key === 'roas' ? 'ratio' : ['spend', 'cpl', 'cpa', 'cpc', 'costPerMessage'].includes(key) ? 'money' : 'count')}</td>)}</tr>)}</tbody></table></div>
      <div className="flex items-center justify-between p-5"><p className="text-xs text-muted-foreground">Página {at + 1} de {pages} · até 50 linhas por página</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!at} onClick={() => setPage(at - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={at + 1 >= pages} onClick={() => setPage(at + 1)}>Próxima</Button></div></div>
    </section>
  </div>
}
