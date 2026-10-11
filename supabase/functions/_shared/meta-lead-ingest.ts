import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { metaGraphGet, MetaGraphError, describeMetaGraphError, isAuthError, isPermissionError, type GraphBudget } from './meta-graph.ts'
import { extractLeadFields, type FieldAnswer } from './meta-lead-extract.ts'

import { callJev } from './meta-typesafe.ts'

interface LeadDetail {
  id: string; created_time: string; form_id: string; ad_id?: string
  campaign_id?: string; campaign_name?: string
  field_data?: FieldAnswer[]; custom_disclaimer_responses?: unknown
}

export type LeadIngestOutcome = { status: 'processed' } | { status: 'ignored' } | { status: 'pending' } | { status: 'error'; error: string }

export interface ClaimedLeadEvent {
  id: string; leadgen_id: string; page_id: string; form_id: string; claim_token: string; processing_attempts: number
}
export function allowedMetaPages(): string[] {
  return [...new Set((Deno.env.get('META_PAGE_IDS') || '').split(',').map(id => id.trim()).filter(Boolean))]
}
export function leadErrorMessage(error: unknown, token = ''): string {
  const message = error instanceof MetaGraphError ? describeMetaGraphError(error)
    : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Falha ao processar lead'
  return (token ? message.replaceAll(token, '[credencial]').replaceAll(encodeURIComponent(token), '[credencial]') : message)
    .replace(/(access_token|appsecret_proof|authorization)([=:\s]+)[^\s&]+/gi, '$1$2[credencial]').slice(0, 1000)
}
export async function leadRpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}
export async function receiveLeadgenEvent(admin: SupabaseClient, event: { leadgenId: string; pageId: string; formId: string }, allowedPages: string[]): Promise<{ eventId: string; status: 'pending' | 'ignored' }> {
  if (![event.leadgenId, event.pageId, event.formId].every(value => /^[A-Za-z0-9_-]{1,100}$/.test(value))) throw new Error('Identidade de lead inválida')
  const eventId = await leadRpc<string>(admin, 'meta_webhook_event_receive', {
    p_leadgen_id: event.leadgenId, p_page_id: event.pageId, p_form_id: event.formId,
  })
  if (!allowedPages.includes(event.pageId)) {
    await leadRpc(admin, 'meta_lead_event_ignore', { p_id: eventId, p_reason: 'Página fora da lista META_PAGE_IDS autorizada' })
    return { eventId, status: 'ignored' }
  }
  return { eventId, status: 'pending' }
}
export async function processClaimedLead(admin: SupabaseClient, event: ClaimedLeadEvent, token: string, budget: GraphBudget): Promise<LeadIngestOutcome> {
  try {
    const detail = await metaGraphGet<LeadDetail>(`/${event.leadgen_id}`, {
      fields: 'id,created_time,form_id,ad_id,campaign_id,campaign_name,field_data,custom_disclaimer_responses',
    }, token, budget)
    if (detail.id !== event.leadgen_id || detail.form_id !== event.form_id || !Number.isFinite(Date.parse(detail.created_time))) throw new Error('Identidade ou data de lead divergente')
    let formName = ''
    if (Date.now() + 4000 < budget.deadlineMs) {
      try { formName = (await metaGraphGet<{ name?: string }>(`/${event.form_id}`, { fields: 'name' }, token,
        { deadlineMs: Math.min(budget.deadlineMs, Date.now() + 4000) })).name || '' } catch { /* Informational metadata only. */ }
    }
    const extracted = await extractLeadFields(detail.field_data, (criteria, instructions) => callJev(criteria, instructions, { ...budget, deadlineMs: budget.deadlineMs - 1000 }))
    if (Date.now() >= budget.deadlineMs) throw new Error('Orçamento de processamento esgotado')
    await leadRpc(admin, 'meta_lead_event_ingest', { p_id: event.id, p_claim: event.claim_token, p_data: {
      meta_lead_id: detail.id, page_id: event.page_id, form_id: detail.form_id,
      campaign_id: detail.campaign_id || '', campaign_name: detail.campaign_name || '', ad_id: detail.ad_id || '',
      form_name: formName.slice(0, 160), created_time: detail.created_time,
      field_data: detail.field_data || [], custom_disclaimer_responses: detail.custom_disclaimer_responses || [], ...extracted,
    } })
    return { status: 'processed' }
  } catch (error) {
    const message = leadErrorMessage(error, token)
    const errorClass = error instanceof MetaGraphError ? isPermissionError(error) ? 'permission' : isAuthError(error) ? 'configuration' : 'transient'
      : error && typeof error === 'object' && 'code' in error && String(error.code).startsWith('22') || /divergente|inválida/.test(message) ? 'invalid_data' : 'transient'
    try { await leadRpc(admin, 'meta_lead_event_fail', { p_id: event.id, p_claim: event.claim_token, p_error: message, p_class: errorClass }) }
    catch { return { status: 'error', error: message + ' · Falha ao registrar tentativa; o lease será retomado.' } }
    return { status: 'error', error: message }
  }
}
// Compatibility callers use the same protected queue, including replay handling.
export async function ingestLeadgenId(admin: SupabaseClient, leadgenId: string, pageId: string, formIdHint: string, token: string): Promise<LeadIngestOutcome> {
  try {
    const receipt = await receiveLeadgenEvent(admin, { leadgenId, pageId, formId: formIdHint }, allowedMetaPages())
    if (receipt.status === 'ignored') return { status: 'ignored' }
    const { data, error } = await admin.from('meta_webhook_events').select('status').eq('id', receipt.eventId).single()
    if (error) throw error
    if (data?.status === 'processed') return { status: 'processed' }
    const events = await leadRpc<ClaimedLeadEvent[]>(admin, 'meta_lead_events_claim', { p_limit: 10, p_lease_seconds: 60, p_page_ids: [pageId] })
    let outcome: LeadIngestOutcome = { status: 'pending' }
    const pageToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || token
    const budget = { deadlineMs: Date.now() + 40000 }
    for (const event of events) {
      const result = await processClaimedLead(admin, event, pageToken, budget)
      if (event.id === receipt.eventId) outcome = result
      if (Date.now() >= budget.deadlineMs) break
    }
    return outcome
  } catch (error) { return { status: 'error', error: leadErrorMessage(error, token) } }
}
