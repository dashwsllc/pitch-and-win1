export const scope = { start: '2026-10-07', end: '2026-10-09', level: 'campaign', accountId: null, campaignId: null, source: null }
export function metricRow(patch = {}) {
  return { id: 'metric', date: '2026-10-09', account_id: '123', account_name: 'Account', level: 'campaign',
    campaign_id: 'A', campaign_name: 'Campaign A', adset_id: '', adset_name: '', ad_id: '', ad_name: '',
    currency: 'BRL', attribution_window: '7d_click,1d_view', spend: 100, leads: 10, purchases: 2, purchase_value: 200,
    impressions: 1000, reach: 900, link_clicks: 50, messaging_conversations_started: 5, objective: 'OUTCOME_LEADS', source: 'api', updated_at: '',
    available_metrics: ['spend', 'leads', 'purchases', 'purchase_value', 'impressions', 'reach', 'link_clicks', 'messaging_conversations_started'],
    metric_metadata: { version: 1, definition_version: 'canonical-v1', account_timezone: 'America/Sao_Paulo', graph_version: 'v23.0', lead_action: 'lead', purchase_action: 'purchase', messaging_action: 'onsite_conversion.messaging_conversation_started_7d' }, ...patch }
}
export const cohort = { state: 'ready', reasons: [], unattributed_contacts: 0, campaigns: [{ campaign_id: 'A', campaign_name: 'Campaign A',
  received: 5, pending: 1, approved: 4, linked_crm: 4, confirmed_sales: 1, confirmed_revenue: 200, coverage: 'complete' }] }
