import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { jsonResponse, preflightResponse, RequestError } from '../_shared/http.ts'
import { requireCronSecret } from '../_shared/meta-auth.ts'
import { fetchAllPages } from '../_shared/meta-graph.ts'
import { ingestLeadgenId } from '../_shared/meta-lead-ingest.ts'

interface LeadgenForm { id: string; name?: string }
interface LeadSummary { id: string }

// So cron - varredura periodica para recuperar webhooks perdidos. O webhook
// (tempo real) e esta reconciliacao (cobertura) convergem para o mesmo
// ingestLeadgenId, dando um log unico independente da origem.
Deno.serve(async (req) => {
  const preflight = preflightResponse(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método inválido' }, 405)
  try {
    if (!requireCronSecret(req)) return jsonResponse(req, { error: 'Acesso negado' }, 403)
    const token = Deno.env.get('META_PAGE_ACCESS_TOKEN') || Deno.env.get('META_SYSTEM_USER_TOKEN')
    if (!token) return jsonResponse(req, { error: 'Token de acesso da Meta não configurado' }, 500)
    const pageIds = (Deno.env.get('META_PAGE_IDS') || '').split(',').map(id => id.trim()).filter(Boolean)
    if (!pageIds.length) return jsonResponse(req, { error: 'META_PAGE_IDS não configurado' }, 500)

    const lookbackHours = Number(Deno.env.get('META_RECONCILIATION_LOOKBACK_HOURS')) || 48
    const sinceUnix = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const results = []
    for (const pageId of pageIds) {
      const { data: runId, error: startError } = await admin.rpc('meta_sync_run_start', {
        p_kind: 'leads_reconciliation', p_account_id: pageId, p_triggered_by: 'cron',
      })
      if (startError) {
        results.push({ pageId, skipped: startError.code === '55006', error: startError.code !== '55006' ? startError.message : undefined })
        continue
      }
      let leadsFound = 0
      let leadsProcessed = 0
      let leadsIgnored = 0
      let leadsFailed = 0
      const leadErrors: string[] = []
      try {
        const forms = await fetchAllPages<{ data: LeadgenForm[]; paging?: { next?: string } }>(
          `/${pageId}/leadgen_forms`, { fields: 'id,name', limit: '100' }, token,
        )
        for (const form of forms) {
          const leads = await fetchAllPages<{ data: LeadSummary[]; paging?: { next?: string } }>(
            `/${form.id}/leads`,
            {
              fields: 'id', limit: '100',
              filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }]),
            },
            token,
          )
          for (const lead of leads) {
            leadsFound += 1
            const outcome = await ingestLeadgenId(admin, lead.id, pageId, form.id, token)
            if (outcome.status === 'processed') leadsProcessed += 1
            else if (outcome.status === 'ignored') leadsIgnored += 1
            else {
              leadsFailed += 1
              if (leadErrors.length < 3) leadErrors.push(outcome.error)
            }
          }
        }
        const error = leadsFailed ? `${leadsFailed} lead(s) não processado(s): ${leadErrors.join(' · ')}` : undefined
        const { error: finishError } = await admin.rpc('meta_sync_run_finish', {
          p_id: runId, p_status: error ? 'error' : 'success', p_rows_synced: leadsProcessed, p_error_message: error,
        })
        if (finishError) throw finishError
        results.push({ pageId, leadsFound, leadsProcessed, leadsIgnored, leadsFailed, ...(error ? { error } : {}) })
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Falha desconhecida na reconciliação'
        await admin.rpc('meta_sync_run_finish', { p_id: runId, p_status: 'error', p_rows_synced: leadsProcessed, p_error_message: message })
        results.push({ pageId, leadsFound, leadsProcessed, leadsIgnored, leadsFailed, error: message })
      }
    }
    const ok = !results.some(result => result.error)
    return jsonResponse(req, { ok, results }, ok ? 200 : 502)
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse(req, { error: error.message }, error.status)
    console.error('meta-leads-reconciliation failed', error)
    return jsonResponse(req, { error: 'Não foi possível reconciliar os leads da Meta.' }, 500)
  }
})
