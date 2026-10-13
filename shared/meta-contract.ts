export type MetaLevel = 'campaign' | 'adset' | 'ad'

export interface MetaDailyRow {
  id: string
  date: string
  account_id: string
  account_name: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  ad_id: string
  ad_name: string
  level: MetaLevel
  currency: string
  attribution_window: string
  spend: number
  leads: number
  purchases: number
  purchase_value: number
  impressions: number
  reach: number
  link_clicks: number
  messaging_conversations_started: number
  // Funil de campanhas de Vendas (site). Ausentes em linhas antigas: aparecem como indisponíveis, nunca como zero.
  landing_page_views?: number
  adds_to_cart?: number
  checkouts_initiated?: number
  objective: string
  source: 'csv' | 'api' | 'manual_legacy'
  updated_at: string
  available_metrics?: string[] | null
  metric_metadata?: { version?: number; definition_version?: string; account_timezone?: string; graph_version?: string; lead_action?: string | null; purchase_action?: string | null; messaging_action?: string | null; manual_metrics?: string[]
    landing_page_view_action?: string | null; add_to_cart_action?: string | null; checkout_action?: string | null; attribution_setting?: 'unified' } | null
}

export type ImportRow = Omit<MetaDailyRow, 'id' | 'updated_at' | 'source'> & { present_metrics?: string[] }
export interface MetaAction { action_type: string; value: string }
export interface MetaInsight {
  date_start: string
  campaign_id: string; campaign_name?: string
  adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string
  spend?: string; impressions?: string; reach?: string; inline_link_clicks?: string
  actions?: MetaAction[]; action_values?: MetaAction[]
}
export interface InsightContext {
  account: { id: string; name: string; currency: 'BRL'; timezone: string }
  level: MetaLevel; objective: string; params: Record<string, string>; graphVersion: string
}
export interface CapturedTrafficRow extends ImportRow {
  available_metrics: string[]
  metric_metadata: {
    version: 1; definition_version: 'canonical-v1'; lead_action: string | null; purchase_action: string | null; messaging_action?: string | null; manual_metrics?: string[]
    landing_page_view_action?: string | null; add_to_cart_action?: string | null; checkout_action?: string | null; attribution_setting?: 'unified'
    raw_actions: MetaAction[]; raw_action_values: MetaAction[]; account_timezone: string; graph_version: string
    request_params: Record<string, string>
  }
}

export interface CampaignCohort {
  campaign_id: string; campaign_name: string
  received: number; pending: number; approved: number; linked_crm: number
  confirmed_sales: number; confirmed_revenue: number
  coverage: 'complete' | 'partial' | 'unknown'
}
export interface TrafficCohortResult {
  state: 'ready' | 'insufficient'; reasons: string[]; campaigns: CampaignCohort[]; unattributed_contacts: number
}
