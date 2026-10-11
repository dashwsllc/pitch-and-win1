import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import type { MetaLevel, MetaInsight, InsightContext } from '../../../shared/meta-contract.ts'
import { normalizeMetaAccountId } from '../../../shared/meta-identity.ts'
import { fetchGraphPage, GRAPH_API_VERSION, metaGraphGet, MetaGraphError, describeMetaGraphError, type MetaGraphRequest } from './meta-graph.ts'
import { buildInsightRow } from './meta-insights.ts'

const caches = new WeakMap<SupabaseClient, { accounts: Map<string, Promise<InsightContext['account']>>; objectives: Map<string, Promise<string>> }>()
function cacheFor(admin: SupabaseClient) {
  let cache = caches.get(admin)
  if (!cache) { cache = { accounts: new Map(), objectives: new Map() }; caches.set(admin, cache) }
  return cache
}
export function readMetaAccount(admin: SupabaseClient, accountId: string, token: string, deadlineMs: number): Promise<InsightContext['account']> {
  const id = normalizeMetaAccountId(accountId), cache = cacheFor(admin)
  if (!cache.accounts.has(id)) cache.accounts.set(id, (async () => {
    const data = await metaGraphGet<{ id: string; name: string; currency: string; timezone_name: string }>(`/act_${id}`, { fields: 'id,name,currency,timezone_name' }, token, { deadlineMs })
    if (normalizeMetaAccountId(data.id) !== id || data.currency !== 'BRL') throw new Error('Conta Meta deve usar BRL e a identidade conectada')
    if (!data.timezone_name) throw new Error('Fuso da conta Meta não informado')
    new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone_name }).format(new Date())
    const { error } = await admin.from('meta_ad_accounts').update({ account_name: data.name, currency: data.currency, timezone: data.timezone_name }).eq('account_id', id)
    if (error) throw error
    return { id, name: data.name, currency: 'BRL' as const, timezone: data.timezone_name }
  })())
  return cache.accounts.get(id)!
}
export function accountWindow(timezone: string, days: number, now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const part = (type: string) => parts.find(value => value.type === type)!.value
  const until = `${part('year')}-${part('month')}-${part('day')}`
  const start = new Date(`${until}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return { since: start.toISOString().slice(0, 10), until }
}
async function rpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}
interface CaptureRun {
  id: string; claim_token: string; account_id: string; level: MetaLevel; page_count: number; rows_synced: number
  next_request: MetaGraphRequest | null; request_params: Record<string, string>; account_metadata: InsightContext['account']
}
interface CaptureInput { accountId: string; level: MetaLevel; since: string; until: string; actor: string | null; triggeredBy: 'cron' | 'manual'; deadlineMs: number; pageLimit?: number }
interface CaptureResult { runId: string; state: 'complete' | 'partial' | 'error' | 'skipped'; rowsCaptured: number; reviewId?: string; error?: string }
export async function captureAccountLevel(admin: SupabaseClient, input: CaptureInput, token: string): Promise<CaptureResult> {
  let runId = '', run: CaptureRun | null = null
  const networkDeadline = input.deadlineMs - 5000
  try {
    const account = await readMetaAccount(admin, input.accountId, token, networkDeadline)
    const params = { level: input.level, time_increment: '1', time_range: JSON.stringify({ since: input.since, until: input.until }),
      fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions,action_values', limit: '500' }
    runId = await rpc<string>(admin, 'meta_capture_open', { p_account_id: account.id, p_level: input.level, p_start: input.since, p_end: input.until,
      p_params: params, p_metadata: account, p_triggered_by: input.triggeredBy, p_actor: input.actor })
    run = await rpc<CaptureRun | null>(admin, 'meta_capture_claim', { p_id: runId, p_lease_seconds: 60 })
    if (!run) return { runId, state: 'skipped', rowsCaptured: 0 }
    if (run.account_metadata.timezone !== account.timezone || run.account_metadata.currency !== account.currency) throw new MetaGraphError(100, undefined, 'Metadados da conta mudaram; recapture a janela')
    const seen = new Set<string>()
    let pagesThisTurn = 0
    while (run.next_request && Date.now() < networkDeadline && pagesThisTurn < (input.pageLimit ?? Infinity)) {
      const request = run.next_request, serialized = JSON.stringify(request)
      if (seen.has(serialized)) throw new MetaGraphError(100, undefined, 'Cursor de captura repetido')
      seen.add(serialized)
      const page = await fetchGraphPage<MetaInsight>(request, token, { deadlineMs: networkDeadline })
      const objectives = cacheFor(admin).objectives
      for (const campaign of new Set(page.data.map(row => row.campaign_id))) {
        if (Date.now() >= networkDeadline) break
        if (!objectives.has(campaign)) objectives.set(campaign, metaGraphGet<{ objective?: string }>(`/${campaign}`, { fields: 'objective' }, token, { deadlineMs: networkDeadline }).then(value => value.objective ?? ''))
        await objectives.get(campaign)
      }
      const payload = await Promise.all(page.data.map(async row => buildInsightRow(row, { account: run!.account_metadata, level: run!.level,
        objective: objectives.has(row.campaign_id) ? await objectives.get(row.campaign_id)! : '', params: run!.request_params, graphVersion: GRAPH_API_VERSION })))
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized)))).map(value => value.toString(16).padStart(2, '0')).join('')
      const saved = await rpc<{ page_count: number; next_request: MetaGraphRequest | null }>(admin, 'meta_capture_append', {
        p_id: runId, p_claim: run.claim_token, p_page_no: run.page_count, p_request_hash: hash, p_rows: payload, p_next: page.next })
      run.page_count = saved.page_count; run.next_request = saved.next_request; run.rows_synced += payload.length
      pagesThisTurn++
    }
    if (run.next_request) {
      await rpc(admin, 'meta_capture_release', { p_id: runId, p_claim: run.claim_token })
      return { runId, state: 'partial', rowsCaptured: run.rows_synced }
    }
    const reviewId = await rpc<string>(admin, 'meta_capture_prepare', { p_id: runId, p_claim: run.claim_token })
    return { runId, state: 'complete', rowsCaptured: run.rows_synced, reviewId }
  } catch (error) {
    let message = error instanceof MetaGraphError ? describeMetaGraphError(error) : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Falha de captura'
    message = message.replaceAll(token, '[credencial]').replaceAll(encodeURIComponent(token), '[credencial]')
    if (run) {
      const terminal = error instanceof MetaGraphError && [100, 190, 10, 200, 272, 299].includes(error.code)
      try { await rpc(admin, terminal ? 'meta_capture_abort' : 'meta_capture_release', { p_id: runId, p_claim: run.claim_token, p_error: message,
        ...(!terminal ? { p_retry_at: new Date(Date.now() + 60000).toISOString() } : {}) }) }
      catch { message += '; falha ao registrar interrupção, aguarde o lease expirar' }
    }
    return { runId, state: 'error', rowsCaptured: run?.rows_synced ?? 0, error: message }
  }
}
