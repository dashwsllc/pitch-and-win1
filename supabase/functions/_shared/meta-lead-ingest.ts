import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { GRAPH_BASE_URL } from './meta-graph.ts'
import { extractLeadFields, type ChoiceAnswer, type FieldAnswer } from './meta-lead-extract.ts'

interface LeadDetail {
  id: string; created_time: string; form_id: string; ad_id?: string
  campaign_id?: string; campaign_name?: string
  field_data?: FieldAnswer[]; custom_disclaimer_responses?: unknown
}

export type LeadIngestOutcome = { status: 'processed' } | { status: 'ignored' } | { status: 'error'; error: string }

const TYPESAFE_API_URL = 'https://api.typesafe.ai/v1/systemone'

// Pede pro Jev escolher, entre as respostas reais do formulario, qual
// corresponde a nome/telefone/email - ver meta-lead-extract.ts. Se
// TYPESAFE_API_KEY nao estiver configurado ou a API falhar, extractLeadFields
// cai sozinho pro casamento exato de rotulo (comportamento de sempre).
async function callJev(
  criteria: Record<string, string>,
  instructions: Record<'full_name' | 'phone' | 'email', string>,
): Promise<Record<string, ChoiceAnswer>> {
  const apiKey = Deno.env.get('TYPESAFE_API_KEY')
  if (!apiKey) throw new Error('TYPESAFE_API_KEY não configurado')
  const questions: Record<string, unknown> = {}
  for (const [key, instructionText] of Object.entries(instructions)) {
    questions[key] = { type: 'choice', instructions: instructionText, criteria }
  }
  const response = await fetch(TYPESAFE_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'Formulário de captação de leads (agência esportiva) via Meta Lead Ads.',
      model: 'jev-latest',
      questions,
    }),
  })
  if (!response.ok) throw new Error(`TypeSafe API respondeu ${response.status}`)
  const data = await response.json()
  const result: Record<string, ChoiceAnswer> = {}
  for (const key of Object.keys(instructions)) {
    const answer = data.answers?.[key]
    result[key] = { choice: answer?.choice ?? '', confidence: answer?.confidence ?? 0 }
  }
  return result
}

async function fetchFormName(formId: string, token: string): Promise<string> {
  try {
    const url = new URL(`${GRAPH_BASE_URL}/${formId}`)
    url.searchParams.set('fields', 'name')
    url.searchParams.set('access_token', token)
    const response = await fetch(url.toString())
    const data = await response.json()
    return response.ok ? (data.name || '') : ''
  } catch { return '' } // nome do formulario e so informativo, segue sem ele
}

// Caminho unico de ingestao usado tanto pelo webhook (tempo real) quanto pela
// reconciliacao (varredura periodica) - garante o mesmo log e a mesma logica
// de contato para leads vindos de qualquer uma das duas origens.
export async function ingestLeadgenId(
  admin: SupabaseClient, leadgenId: string, pageId: string, formIdHint: string, token: string,
): Promise<LeadIngestOutcome> {
  const allowedPages = (Deno.env.get('META_PAGE_IDS') || '').split(',').map(id => id.trim()).filter(Boolean)
  const { data: eventId, error: receiveError } = await admin.rpc('meta_webhook_event_receive', {
    p_leadgen_id: leadgenId, p_page_id: pageId, p_form_id: formIdHint,
  })
  if (receiveError) {
    console.error('meta_webhook_event_receive failed', receiveError)
    return { status: 'error', error: receiveError.message }
  }
  if (allowedPages.length && !allowedPages.includes(pageId)) {
    const { error } = await admin.rpc('meta_webhook_event_complete', { p_id: eventId, p_status: 'ignored' })
    return error ? { status: 'error', error: error.message } : { status: 'ignored' }
  }
  try {
    const url = new URL(`${GRAPH_BASE_URL}/${leadgenId}`)
    url.searchParams.set('fields', 'id,created_time,form_id,ad_id,campaign_id,campaign_name,field_data,custom_disclaimer_responses')
    url.searchParams.set('access_token', Deno.env.get('META_PAGE_ACCESS_TOKEN') || token)
    const response = await fetch(url.toString())
    const detail = await response.json() as LeadDetail & { error?: { message?: string } }
    if (!response.ok || detail.error) throw new Error(detail.error?.message || 'Falha ao buscar o lead na Graph API')

    const formName = await fetchFormName(detail.form_id, Deno.env.get('META_PAGE_ACCESS_TOKEN') || token)
    const extracted = await extractLeadFields(detail.field_data, callJev)
    const { data: formLeadId, error: ingestError } = await admin.rpc('meta_ingest_form_lead', {
      p_data: {
        meta_lead_id: detail.id, page_id: pageId, form_id: detail.form_id,
        campaign_id: detail.campaign_id || '', campaign_name: detail.campaign_name || '',
        ad_id: detail.ad_id || '', form_name: formName, created_time: detail.created_time,
        field_data: detail.field_data || [], custom_disclaimer_responses: detail.custom_disclaimer_responses || [],
        full_name: extracted.full_name,
        phone: extracted.phone,
        email: extracted.email,
      },
    })
    if (ingestError) throw ingestError
    const { error: completeError } = await admin.rpc('meta_webhook_event_complete', { p_id: eventId, p_status: 'processed', p_meta_form_lead_id: formLeadId })
    if (completeError) throw completeError
    return { status: 'processed' }
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Falha desconhecida ao processar o lead'
    console.error('ingestLeadgenId failed', { leadgenId, message })
    const { error: logError } = await admin.rpc('meta_webhook_event_complete', { p_id: eventId, p_status: 'error', p_error: message })
    if (logError) console.error('meta_webhook_event_complete failed', logError)
    return { status: 'error', error: message }
  }
}
