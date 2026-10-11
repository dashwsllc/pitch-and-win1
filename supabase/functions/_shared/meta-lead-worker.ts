import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { fetchGraphPage, type MetaGraphRequest } from './meta-graph.ts'
import { leadRpc, leadErrorMessage, processClaimedLead, receiveLeadgenEvent, type ClaimedLeadEvent } from './meta-lead-ingest.ts'

interface Form { id: string; name?: string }
interface DiscoveryState {
  page_id: string; version: number; claim_token: string; window_since: string; window_until: string
  forms_next: MetaGraphRequest | null; form_id: string | null; leads_next: MetaGraphRequest | null
  form_queue: Form[]; active_form_name: string | null; last_completed_until?: string
}
export interface LeadWorkerResult {
  processed: number; failed: number; ignored: number; discovered: number; partial: boolean; errors: string[]
}
function requireIds(rows: Form[]) {
  if (rows.length > 500 || rows.some(row => !/^[A-Za-z0-9_-]{1,100}$/.test(row.id))) throw new Error('Página de descoberta inválida')
}
async function discoverPage(admin: SupabaseClient, pageId: string, token: string, deadlineMs: number, result: LeadWorkerResult) {
  const state = await leadRpc<DiscoveryState | null>(admin, 'meta_lead_discovery_claim', { p_page_id: pageId, p_lease_seconds: 60 })
  if (!state) { result.partial = true; return }
  let failure: string | null = null
  const checkpoint = async (update: Record<string, unknown>, received: string[] = []) => {
    state.version = await leadRpc<number>(admin, 'meta_lead_discovery_checkpoint', {
      p_page_id: pageId, p_claim: state.claim_token, p_expected_version: state.version, p_state: { ...update, received_ids: received },
    })
    Object.assign(state, update)
  }
  try {
    while (Date.now() + 2000 < deadlineMs) {
      if (!state.form_id && state.form_queue.length) {
        const [form, ...rest] = state.form_queue
        await checkpoint({ form_id: form.id, active_form_name: form.name || '', form_queue: rest,
          leads_next: { path: `/${form.id}/leads`, params: { fields: 'id', limit: '50',
            filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(Date.parse(state.window_since) / 1000) }]) } } })
      }
      if (state.form_id && state.leads_next) {
        const request = state.leads_next
        const page = await fetchGraphPage<{ id: string }>(request, token, { deadlineMs })
        requireIds(page.data)
        if (page.next && JSON.stringify(page.next) === JSON.stringify(request)) throw new Error('Cursor de descoberta repetido')
        const received: string[] = []
        for (const lead of page.data) {
          if (Date.now() >= deadlineMs) throw new Error('Orçamento de descoberta esgotado; recibos já gravados serão deduplicados')
          await receiveLeadgenEvent(admin, { leadgenId: lead.id, pageId, formId: state.form_id }, [pageId])
          received.push(lead.id)
        }
        // The entire page is durable before moving its cursor. Replay is harmless.
        await checkpoint({ leads_next: page.next, ...(page.next ? {} : { form_id: null, active_form_name: null }) }, received)
        result.discovered += received.length
        continue
      }
      if (state.forms_next) {
        const request = state.forms_next
        const page = await fetchGraphPage<Form>(request, token, { deadlineMs })
        requireIds(page.data)
        if (page.next && JSON.stringify(page.next) === JSON.stringify(request)) throw new Error('Cursor de descoberta repetido')
        await checkpoint({ forms_next: page.next, form_queue: page.data.map(form => ({ id: form.id, name: String(form.name || '').slice(0, 160) })) })
        continue
      }
      await checkpoint({ last_completed_until: state.window_until })
      return
    }
    result.partial = true
  } catch (error) {
    failure = leadErrorMessage(error, token); result.errors.push(failure); result.partial = true
  } finally {
    try { await leadRpc(admin, 'meta_lead_discovery_release', { p_page_id: pageId, p_claim: state.claim_token, p_error: failure }) }
    catch (error) { result.errors.push(leadErrorMessage(error, token)); result.partial = true }
  }
}
export async function runLeadWorker(admin: SupabaseClient, input: { pageIds: string[]; token: string | null; deadlineMs: number; discover: boolean }): Promise<LeadWorkerResult> {
  const result: LeadWorkerResult = { processed: 0, failed: 0, ignored: 0, discovered: 0, partial: false, errors: [] }
  if (!input.pageIds.length) { result.errors.push('META_PAGE_IDS não configurado; nenhuma página autorizada'); return result }
  if (!input.token) { result.errors.push('Token de acesso da Meta não configurado; recebimentos mantidos na fila'); return result }
  const token = input.token, networkDeadline = input.deadlineMs - 5000
  const drain = async (deadlineMs: number) => {
    while (Date.now() + 4000 < deadlineMs) {
      const events = await leadRpc<ClaimedLeadEvent[]>(admin, 'meta_lead_events_claim', { p_limit: 10, p_lease_seconds: 60, p_page_ids: input.pageIds })
      if (!events.length) return
      for (const event of events) {
        if (Date.now() + 4000 >= deadlineMs) { result.partial = true; return }
        const outcome = await processClaimedLead(admin, event, token, { deadlineMs })
        if (outcome.status === 'processed') result.processed++
        else if (outcome.status === 'error') { result.failed++; if (result.errors.length < 10) result.errors.push(outcome.error) }
      }
    }
    result.partial = true
  }
  try {
    // Old receipts take priority; leave ten seconds for discovering missed webhooks.
    await drain(input.discover ? Math.max(Date.now(), networkDeadline - 10000) : networkDeadline)
    if (input.discover) for (const pageId of input.pageIds) {
      if (Date.now() + 4000 >= networkDeadline) { result.partial = true; break }
      await discoverPage(admin, pageId, token, networkDeadline, result)
    }
    if (input.discover && Date.now() + 4000 < networkDeadline) await drain(networkDeadline)
  } catch (error) { result.errors.push(leadErrorMessage(error, token)); result.partial = true }
  return result
}
