import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { GRAPH_BASE_URL } from './meta-graph.ts'

interface FieldAnswer { name?: string; values?: string[] }
interface LeadDetail {
  id: string; created_time: string; form_id: string; ad_id?: string
  campaign_id?: string; campaign_name?: string
  field_data?: FieldAnswer[]; custom_disclaimer_responses?: unknown
}

// Mesmos rotulos de campo que src/lib/meta-leads.ts (firstAnswer) reconhece no
// formulario de importacao manual. Mantenha os dois em sincronia se a Meta
// mudar os nomes de pergunta padrao ou se o negocio adicionar variantes novas.
function firstAnswer(fields: FieldAnswer[] | undefined, names: string[]): string {
  if (!Array.isArray(fields)) return ''
  const match = fields.find(field => names.includes((field.name || '').toLowerCase()))
  return match?.values?.[0] || ''
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
): Promise<void> {
  const allowedPages = (Deno.env.get('META_PAGE_IDS') || '').split(',').map(id => id.trim()).filter(Boolean)
  const { data: eventId, error: receiveError } = await admin.rpc('meta_webhook_event_receive', {
    p_leadgen_id: leadgenId, p_page_id: pageId, p_form_id: formIdHint,
  })
  if (receiveError) { console.error('meta_webhook_event_receive failed', receiveError); return }
  if (allowedPages.length && !allowedPages.includes(pageId)) {
    await admin.rpc('meta_webhook_event_complete', { p_id: eventId, p_status: 'ignored' })
    return
  }
  try {
    const url = new URL(`${GRAPH_BASE_URL}/${leadgenId}`)
    url.searchParams.set('fields', 'id,created_time,form_id,ad_id,campaign_id,campaign_name,field_data,custom_disclaimer_responses')
    url.searchParams.set('access_token', Deno.env.get('META_PAGE_ACCESS_TOKEN') || token)
    const response = await fetch(url.toString())
    const detail = await response.json() as LeadDetail & { error?: { message?: string } }
    if (!response.ok || detail.error) throw new Error(detail.error?.message || 'Falha ao buscar o lead na Graph API')

    const formName = await fetchFormName(detail.form_id, Deno.env.get('META_PAGE_ACCESS_TOKEN') || token)
    const { data: formLeadId, error: ingestError } = await admin.rpc('meta_ingest_form_lead', {
      p_data: {
        meta_lead_id: detail.id, page_id: pageId, form_id: detail.form_id,
        campaign_id: detail.campaign_id || '', campaign_name: detail.campaign_name || '',
        ad_id: detail.ad_id || '', form_name: formName, created_time: detail.created_time,
        field_data: detail.field_data || [], custom_disclaimer_responses: detail.custom_disclaimer_responses || [],
        full_name: firstAnswer(detail.field_data, ['full_name', 'nome_completo', 'nome']),
        phone: firstAnswer(detail.field_data, ['phone_number', 'telefone', 'whatsapp']),
        email: firstAnswer(detail.field_data, ['email', 'email_address']),
      },
    })
    if (ingestError) throw ingestError
    await admin.rpc('meta_webhook_event_complete', { p_id: eventId, p_status: 'processed', p_meta_form_lead_id: formLeadId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida ao processar o lead'
    console.error('ingestLeadgenId failed', { leadgenId, message })
    await admin.rpc('meta_webhook_event_complete', { p_id: eventId, p_status: 'error', p_error: message })
  }
}
