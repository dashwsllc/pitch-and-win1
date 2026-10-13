import type { CapturedTrafficRow, InsightContext, MetaInsight } from '../../../shared/meta-contract.ts'
import { normalizeMetaAccountId } from '../../../shared/meta-identity.ts'
import { LEAD_ACTION_TYPES, PURCHASE_ACTION_TYPES, MESSAGING_ACTION_TYPES, LANDING_PAGE_VIEW_ACTION_TYPES, ADD_TO_CART_ACTION_TYPES, INITIATE_CHECKOUT_ACTION_TYPES, selectCanonicalAction } from './meta-graph.ts'

// A captura pede use_unified_attribution_setting=true: a Meta devolve os resultados com a atribuição
// de cada conjunto de anúncios, a mesma usada pelo Gerenciador de Anúncios.
export const ATTRIBUTION_LABEL = 'Atribuição do conjunto de anúncios (igual ao Gerenciador)'

export function buildInsightRow(input: MetaInsight, context: InsightContext): CapturedTrafficRow {
  const available: string[] = []
  const fields = new Set(context.params.fields?.split(',') ?? [])
  const numeric = (field: keyof MetaInsight, metric: string, integer = false) => {
    const raw = input[field]
    if (!fields.has(field) || raw === undefined) return 0
    if (typeof raw !== 'string' || !/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Métrica Meta inválida: ${metric}`)
    const value = Number(raw)
    if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value))) throw new Error(`Métrica Meta fora dos limites: ${metric}`)
    available.push(metric)
    return value
  }
  const lead = selectCanonicalAction(input.actions, LEAD_ACTION_TYPES)
  const purchase = selectCanonicalAction(input.actions, PURCHASE_ACTION_TYPES)
  const message = selectCanonicalAction(input.actions, MESSAGING_ACTION_TYPES)
  const landing = selectCanonicalAction(input.actions, LANDING_PAGE_VIEW_ACTION_TYPES)
  const cart = selectCanonicalAction(input.actions, ADD_TO_CART_ACTION_TYPES)
  const checkout = selectCanonicalAction(input.actions, INITIATE_CHECKOUT_ACTION_TYPES)
  const revenue = selectCanonicalAction(input.action_values, purchase.actionType ? [purchase.actionType] : [])
  const count = (selected: { value: number | null }, metric: string) => {
    if (!fields.has('actions') || selected.value === null) return 0
    if (!Number.isSafeInteger(selected.value)) throw new Error(`Contagem Meta inválida: ${metric}`)
    available.push(metric)
    return selected.value
  }
  const row: CapturedTrafficRow = {
    date: input.date_start, account_id: normalizeMetaAccountId(context.account.id), account_name: context.account.name,
    campaign_id: input.campaign_id, campaign_name: input.campaign_name ?? '',
    adset_id: context.level === 'campaign' ? '' : input.adset_id ?? '', adset_name: context.level === 'campaign' ? '' : input.adset_name ?? '',
    ad_id: context.level === 'ad' ? input.ad_id ?? '' : '', ad_name: context.level === 'ad' ? input.ad_name ?? '' : '',
    level: context.level, currency: context.account.currency, attribution_window: ATTRIBUTION_LABEL,
    objective: context.objective, spend: numeric('spend', 'spend'), impressions: numeric('impressions', 'impressions', true),
    reach: numeric('reach', 'reach', true), link_clicks: numeric('inline_link_clicks', 'link_clicks', true),
    leads: count(lead, 'leads'), purchases: count(purchase, 'purchases'), messaging_conversations_started: count(message, 'messaging_conversations_started'),
    landing_page_views: count(landing, 'landing_page_views'), adds_to_cart: count(cart, 'adds_to_cart'), checkouts_initiated: count(checkout, 'checkouts_initiated'),
    purchase_value: fields.has('action_values') ? revenue.value ?? 0 : 0, available_metrics: available,
    metric_metadata: { version: 1, definition_version: 'canonical-v1', lead_action: lead.actionType, purchase_action: purchase.actionType, messaging_action: message.actionType,
      landing_page_view_action: landing.actionType, add_to_cart_action: cart.actionType, checkout_action: checkout.actionType, attribution_setting: 'unified',
      raw_actions: input.actions ?? [], raw_action_values: input.action_values ?? [], account_timezone: context.account.timezone,
      graph_version: context.graphVersion, request_params: Object.fromEntries(Object.entries(context.params).filter(([key]) => !['access_token', 'appsecret_proof'].includes(key.toLowerCase()))) },
  }
  if (fields.has('action_values') && revenue.value !== null) available.push('purchase_value')
  return row
}
