import type { MetaDailyRow, MetaLevel, TrafficCohortResult } from '../../shared/meta-contract.ts'
import { normalizeMetaAccountId } from '../../shared/meta-identity.ts'
export interface TrafficScope {
  start: string; end: string; level: MetaLevel; accountId: string | null; campaignId: string | null
  source: MetaDailyRow['source'] | null
}
export interface TrafficMetricTotals {
  spend: number | null; leads: number | null; purchases: number | null; purchaseValue: number | null
  impressions: number | null; linkClicks: number | null; messagesStarted: number | null
  cpl: number | null; cpa: number | null; roas: number | null; cpm: number | null; cpc: number | null
  costPerMessage: number | null; ctr: number | null
}
export interface TrafficGroup {
  key: string; account_id: string; campaign_id: string; campaign_name: string
  adset_id: string; adset_name: string; ad_id: string; ad_name: string; metrics: TrafficMetricTotals
}
export interface TrafficView {
  scope: TrafficScope; rows: MetaDailyRow[]; total: TrafficMetricTotals
  daily: { date: string; metrics: TrafficMetricTotals }[]; groups: TrafficGroup[]; warnings: string[]
}
export type QueryState<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string }
export function validTrafficDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
function accountKey(value: string) { try { return normalizeMetaAccountId(value) } catch { return value } }
export function selectTrafficRows(rows: MetaDailyRow[], scope: TrafficScope): MetaDailyRow[] {
  if (!validTrafficDate(scope.start) || !validTrafficDate(scope.end) || scope.start > scope.end) throw new Error('Período inválido')
  const account = scope.accountId ? normalizeMetaAccountId(scope.accountId) : null
  return rows.filter(row => row.level === scope.level && row.date >= scope.start && row.date <= scope.end
    && (!account || accountKey(row.account_id) === account) && (!scope.campaignId || row.campaign_id === scope.campaignId)
    && (!scope.source || row.source === scope.source)).map(row => {
      if (!validTrafficDate(row.date)) throw new Error('Data publicada inválida')
      return { ...row, account_id: accountKey(row.account_id) }
    })
}
const metricFields = { spend: 'spend', leads: 'leads', purchases: 'purchases', purchaseValue: 'purchase_value',
  impressions: 'impressions', linkClicks: 'link_clicks', messagesStarted: 'messaging_conversations_started' } as const
function knownValue(row: MetaDailyRow, field: string): number | null {
  if (row.available_metrics && !row.available_metrics.includes(field)) return null
  const value = row[field as keyof MetaDailyRow]
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return null
  if (['spend', 'purchase_value'].includes(field) && row.currency !== 'BRL') return null
  return Number(value)
}
function definition(row: MetaDailyRow): string | null {
  if (!row.available_metrics) return null
  if (row.source === 'csv' && row.attribution_window) return JSON.stringify(['csv-declared', row.attribution_window, row.metric_metadata?.account_timezone || 'export-calendar'])
  if (row.source === 'api' && row.metric_metadata?.definition_version === 'canonical-v1' && row.metric_metadata.account_timezone && row.attribution_window)
    return JSON.stringify(['canonical-v1', row.attribution_window, row.metric_metadata.account_timezone, row.metric_metadata.graph_version || 'unknown'])
  return null
}
function aggregate(rows: MetaDailyRow[]): TrafficMetricTotals {
  const values = Object.fromEntries(Object.entries(metricFields).map(([key, field]) => {
    const numbers = rows.map(row => knownValue(row, field))
    return [key, numbers.some(value => value === null) ? null : numbers.reduce<number>((sum, value) => sum + value!, 0)]
  })) as Pick<TrafficMetricTotals, keyof typeof metricFields>
  const definitions = new Set(rows.map(definition))
  const compatible = rows.length > 0 && !definitions.has(null) && definitions.size === 1 && rows.every(row => row.currency === 'BRL')
  const divide = (numerator: number | null, denominator: number | null, scale = 1) => compatible && numerator !== null && denominator !== null && denominator > 0 ? numerator * scale / denominator : null
  return { ...values, cpl: divide(values.spend, values.leads), cpa: divide(values.spend, values.purchases), roas: divide(values.purchaseValue, values.spend),
    cpm: divide(values.spend, values.impressions, 1000), cpc: divide(values.spend, values.linkClicks), costPerMessage: divide(values.spend, values.messagesStarted), ctr: divide(values.linkClicks, values.impressions, 100) }
}
export function buildTrafficView(input: MetaDailyRow[], scope: TrafficScope): TrafficView {
  const rows = selectTrafficRows(input, scope), days = new Map<string, MetaDailyRow[]>(), entities = new Map<string, MetaDailyRow[]>()
  for (const row of rows) {
    const day = days.get(row.date) || []; day.push(row); days.set(row.date, day)
    const key = JSON.stringify([row.account_id, row.campaign_id, scope.level === 'campaign' ? '' : row.adset_id, scope.level === 'ad' ? row.ad_id : ''])
    const entity = entities.get(key) || []; entity.push(row); entities.set(key, entity)
  }
  const warnings: string[] = []
  if (rows.some(row => !row.available_metrics)) warnings.push('Histórico legado: valores registrados preservados; disponibilidade e taxas não comprovadas.')
  if (rows.some(row => row.available_metrics && !definition(row))) warnings.push('Definição ou calendário das métricas não comprovado; taxas indisponíveis.')
  if (new Set(rows.map(definition)).size > 1) warnings.push('O recorte mistura definições, atribuições ou fusos; taxas consolidadas indisponíveis.')
  if (rows.some(row => row.currency !== 'BRL')) warnings.push('Moeda incompatível com BRL; valores monetários indisponíveis.')
  const groups = [...entities].map(([key, items]) => {
    const row = items.at(-1)!
    return { key, account_id: row.account_id, campaign_id: row.campaign_id, campaign_name: row.campaign_name,
      adset_id: scope.level === 'campaign' ? '' : row.adset_id, adset_name: scope.level === 'campaign' ? '' : row.adset_name,
      ad_id: scope.level === 'ad' ? row.ad_id : '', ad_name: scope.level === 'ad' ? row.ad_name : '', metrics: aggregate(items) }
  }).sort((a, b) => (b.metrics.spend || 0) - (a.metrics.spend || 0) || a.key.localeCompare(b.key))
  return { scope, rows, total: aggregate(rows), daily: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, metrics: aggregate(items) })), groups, warnings }
}
export function crmTrafficRates(cohort: TrafficCohortResult, view: TrafficView): { cpa: number | null; roas: number | null; reason: string | null } {
  const unavailable = (reason: string) => ({ cpa: null, roas: null, reason })
  if (view.scope.level !== 'campaign') return unavailable('Atribuição CRM disponível no nível campanha.')
  if (cohort.state !== 'ready') return unavailable(cohort.reasons.join(' · ') || 'Cobertura comercial insuficiente.')
  if (view.total.spend === null || view.rows.some(row => row.currency !== 'BRL' || row.metric_metadata?.account_timezone !== 'America/Sao_Paulo')) return unavailable('Gasto e calendário incompatíveis com a coorte de Brasília.')
  if (view.groups.some(group => !cohort.campaigns.some(campaign => campaign.campaign_id === group.campaign_id && campaign.coverage === 'complete'))) return unavailable('Campanha sem cobertura comercial comprovada.')
  const campaigns = cohort.campaigns.filter(row => !view.scope.campaignId || row.campaign_id === view.scope.campaignId)
  const sales = campaigns.reduce((sum, row) => sum + row.confirmed_sales, 0), revenue = campaigns.reduce((sum, row) => sum + row.confirmed_revenue, 0)
  return { cpa: sales > 0 ? view.total.spend / sales : null, roas: view.total.spend > 0 ? revenue / view.total.spend : null, reason: null }
}
export function buildTrafficCsv(view: TrafficView): { headers: string[]; rows: (string | number)[][] } {
  return { headers: ['Período inicial', 'Período final', 'Data', 'Conta ID', 'Campanha ID', 'Campanha', 'Conjunto ID', 'Conjunto', 'Anúncio ID', 'Anúncio', 'Nível', 'Origem', 'Definição', 'Atribuição', 'Gasto BRL', 'Leads', 'Compras', 'Receita Meta BRL', 'Impressões', 'Cliques', 'Conversas'],
    rows: view.rows.map(row => [view.scope.start, view.scope.end, row.date, row.account_id, row.campaign_id, row.campaign_name, row.adset_id, row.adset_name,
      row.ad_id, row.ad_name, row.level, row.source, row.metric_metadata?.definition_version || (row.available_metrics ? 'csv-declared' : 'legado'), row.attribution_window,
      ...Object.values(metricFields).map(field => knownValue(row, field) ?? '')]) }
}
export function trafficCsvText(csv: { headers: string[]; rows: (string | number)[][] }) {
  const cell = (value: string | number) => { const text = String(value); return /[";\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text }
  return '\uFEFF' + [csv.headers, ...csv.rows].map(row => row.map(cell).join(';')).join('\r\n')
}
