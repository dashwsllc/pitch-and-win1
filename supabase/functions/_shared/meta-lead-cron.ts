import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { jsonResponse, preflightResponse } from './http.ts'
import { requireCronSecret } from './meta-auth.ts'
import { allowedMetaPages, leadRpc, leadErrorMessage } from './meta-lead-ingest.ts'
import { runLeadWorker } from './meta-lead-worker.ts'
import { createLeadPageTokenResolver } from './meta-page-token.ts'

export async function handleLeadCron(req: Request, discover: boolean): Promise<Response> {
  const preflight = preflightResponse(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método inválido' }, 405)
  if (!requireCronSecret(req)) return jsonResponse(req, { error: 'Acesso negado' }, 403)
  const deadlineMs = Date.now() + 45000
  const pageIds = allowedMetaPages()
  const pageToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || null
  const systemToken = Deno.env.get('META_SYSTEM_USER_TOKEN') || null
  const token = pageToken || systemToken
  const resolveToken = createLeadPageTokenResolver(pageIds, pageToken, systemToken)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadlineMs - Date.now()))) }) },
  })
  const results = []
  const turn = pageIds.length ? Math.floor(Date.now() / (discover ? 3600000 : 60000)) % pageIds.length : 0
  const ordered = [...pageIds.slice(turn), ...pageIds.slice(0, turn)]
  for (const pageId of ordered.length ? ordered : [null]) {
    let runId: string | null = null
    try {
      if (Date.now() + 5000 >= deadlineMs) { results.push({ pageId, partial: true }); break }
      runId = await leadRpc<string>(admin, 'meta_lead_run_start', { p_page_id: pageId, p_discover: discover })
      const result = await runLeadWorker(admin, { pageIds: pageId ? [pageId] : [], token, deadlineMs, discover, resolveToken })
      const error = result.errors.length ? result.errors.join(' · ').slice(0, 1000) : null
      await leadRpc(admin, 'meta_sync_run_finish', { p_id: runId, p_status: error ? 'error' : result.partial ? 'partial' : 'success', p_rows_synced: result.processed, p_error_message: error })
      results.push({ pageId, leadsFound: result.discovered, leadsProcessed: result.processed, leadsFailed: result.failed, leadsIgnored: result.ignored, partial: result.partial, ...(error ? { error } : {}) })
    } catch (error) {
      const message = leadErrorMessage(error, token || '')
      if (runId) try { await leadRpc(admin, 'meta_sync_run_finish', { p_id: runId, p_status: 'error', p_rows_synced: 0, p_error_message: message }) } catch { /* Preserve failing HTTP result. */ }
      results.push({ pageId, error: message })
    }
  }
  const ok = !results.some(result => result.error)
  const configMissing = !pageIds.length || !token
  return jsonResponse(req, { ok, results }, configMissing ? 500 : !ok ? 502 : results.some(result => result.partial) ? 202 : 200)
}
