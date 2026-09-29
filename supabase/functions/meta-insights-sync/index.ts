import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { isTrustedOrigin, jsonResponse, preflightResponse, readJsonBody, RequestError } from '../_shared/http.ts'
import { requireCronSecret, requireTrafficUser } from '../_shared/meta-auth.ts'
import {
  describeMetaGraphError, fetchAllPages, LEAD_ACTION_TYPES, MESSAGING_ACTION_TYPES,
  MetaGraphError, metaGraphGet, PURCHASE_ACTION_TYPES, sumActions, type MetaAction,
} from '../_shared/meta-graph.ts'

type Level = 'campaign' | 'adset' | 'ad'
const LEVELS: Level[] = ['campaign', 'adset', 'ad']

interface InsightRow {
  date_start: string
  campaign_id: string; campaign_name?: string
  adset_id?: string; adset_name?: string
  ad_id?: string; ad_name?: string
  spend?: string; impressions?: string; reach?: string; inline_link_clicks?: string
  actions?: MetaAction[]; action_values?: MetaAction[]
}

function buildRow(row: InsightRow, level: Level, accountId: string, objective: string) {
  return {
    date: row.date_start, account_id: accountId, account_name: '',
    campaign_id: row.campaign_id, campaign_name: row.campaign_name || '',
    adset_id: level === 'campaign' ? '' : (row.adset_id || ''),
    adset_name: level === 'campaign' ? '' : (row.adset_name || ''),
    ad_id: level === 'ad' ? (row.ad_id || '') : '',
    ad_name: level === 'ad' ? (row.ad_name || '') : '',
    level, currency: 'BRL', attribution_window: 'Conforme configuração da conta Meta',
    objective, spend: Number(row.spend) || 0,
    leads: Math.round(sumActions(row.actions, LEAD_ACTION_TYPES)),
    purchases: Math.round(sumActions(row.actions, PURCHASE_ACTION_TYPES)),
    purchase_value: sumActions(row.action_values, PURCHASE_ACTION_TYPES),
    impressions: Math.round(Number(row.impressions) || 0),
    reach: Math.round(Number(row.reach) || 0),
    link_clicks: Math.round(Number(row.inline_link_clicks) || 0),
    messaging_conversations_started: Math.round(sumActions(row.actions, MESSAGING_ACTION_TYPES)),
  }
}

async function fetchCampaignObjectives(campaignIds: string[], token: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (let index = 0; index < campaignIds.length; index += 50) {
    const batch = campaignIds.slice(index, index + 50)
    if (!batch.length) continue
    const data = await metaGraphGet<Record<string, { objective?: string }>>('/', { ids: batch.join(',') }, token)
    for (const id of batch) result[id] = data[id]?.objective || ''
  }
  return result
}

async function syncAccountLevel(admin: SupabaseClient, token: string, accountId: string, level: Level,
  since: string, until: string, actor: string | null, triggeredBy: 'cron' | 'manual') {
  const { data: runId, error: startError } = await admin.rpc('meta_sync_run_start', {
    p_kind: 'insights', p_account_id: accountId, p_triggered_by: triggeredBy,
    p_triggered_by_user: actor, p_window_start: since, p_window_end: until,
  })
  if (startError) {
    if (startError.code === '55006') return { accountId, level, skipped: true }
    throw startError
  }
  let rowsSynced = 0
  try {
    const insights = await fetchAllPages<{ data: InsightRow[]; paging?: { next?: string } }>(
      `/act_${accountId}/insights`,
      {
        level, time_increment: '1', time_range: JSON.stringify({ since, until }),
        fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions,action_values',
        limit: '500',
      },
      token,
    )
    const campaignIds = [...new Set(insights.map(row => row.campaign_id))]
    const objectives = await fetchCampaignObjectives(campaignIds, token)
    const payload = insights.map(row => buildRow(row, level, accountId, objectives[row.campaign_id] || ''))
    if (payload.length) {
      const { data, error } = await admin.rpc('meta_import_daily_system', {
        p_rows: payload, p_sync_run_id: runId, p_actor: actor,
      })
      if (error) throw error
      rowsSynced = data?.rows ?? payload.length
    }
    await admin.rpc('meta_sync_run_finish', { p_id: runId, p_status: 'success', p_rows_synced: rowsSynced })
    return { accountId, level, rowsSynced }
  } catch (error) {
    const message = error instanceof MetaGraphError ? describeMetaGraphError(error)
      : error instanceof Error ? error.message : 'Falha desconhecida na sincronização'
    await admin.rpc('meta_sync_run_finish', { p_id: runId, p_status: 'error', p_rows_synced: rowsSynced, p_error_message: message })
    return { accountId, level, error: message }
  }
}

Deno.serve(async (req) => {
  const preflight = preflightResponse(req)
  if (preflight) return preflight
  if (!isTrustedOrigin(req)) return jsonResponse(req, { error: 'Origem não autorizada' }, 403)
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método inválido' }, 405)
  try {
    const isCron = requireCronSecret(req)
    let actor: string | null = null
    const triggeredBy: 'cron' | 'manual' = isCron ? 'cron' : 'manual'
    if (!isCron) {
      const { userId } = await requireTrafficUser(req)
      actor = userId
    }
    const token = Deno.env.get('META_SYSTEM_USER_TOKEN')
    if (!token) return jsonResponse(req, { error: 'META_SYSTEM_USER_TOKEN não configurado' }, 500)

    const body = await readJsonBody<{ days?: number }>(req).catch(() => ({}) as { days?: number })
    const days = Math.min(30, Math.max(1, body.days || Number(Deno.env.get('META_SYNC_LOOKBACK_DAYS')) || 3))
    const until = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const since = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date(Date.now() - days * 86_400_000))

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: accounts, error: accountsError } = await admin
      .from('meta_ad_accounts').select('account_id').eq('status', 'active')
    if (accountsError) throw accountsError

    const results = []
    for (const account of accounts ?? []) {
      for (const level of LEVELS) {
        results.push(await syncAccountLevel(admin, token, account.account_id, level, since, until, actor, triggeredBy))
      }
    }
    return jsonResponse(req, { since, until, results })
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse(req, { error: error.message }, error.status)
    console.error('meta-insights-sync failed', error)
    return jsonResponse(req, { error: 'Não foi possível sincronizar as métricas da Meta.' }, 500)
  }
})
