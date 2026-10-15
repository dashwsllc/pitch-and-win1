import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { metaGraphGet, MetaGraphError, isAuthError, isPermissionError, isRateLimitError, type GraphBudget } from './meta-graph.ts'

// Nada que a Meta devolve pode se perder: pedimos todos os campos conhecidos do lead e guardamos o retorno COMPLETO.
// Um campo que a conta ou a versão da API não aceita (erro 100) nunca pode impedir a captura: cai para a lista anterior.
const LEAD_BASE = 'id,created_time,form_id,ad_id,campaign_id,campaign_name,field_data,custom_disclaimer_responses'
export const LEAD_FIELD_TIERS = [
  `${LEAD_BASE},ad_name,adset_id,adset_name,is_organic,platform,partner_name`,
  `${LEAD_BASE},ad_name,adset_id,adset_name,is_organic,platform`,
  LEAD_BASE,
] as const
export const FORM_FIELD_TIERS = [
  'id,name,status,locale,created_time,follow_up_action_url,privacy_policy,context_card,thank_you_page,questions{id,key,label,type,options{key,value}}',
  'id,name,status,locale,questions',
  'id,name',
] as const

export type RawGraphObject = Record<string, unknown>

async function firstAccepted(path: string, tiers: readonly string[], token: string, budget: GraphBudget): Promise<{ raw: RawGraphObject; fields: string }> {
  let last: unknown
  for (const fields of tiers) {
    try { return { raw: await metaGraphGet<RawGraphObject>(path, { fields }, token, budget), fields } }
    catch (error) { last = error; if (!(error instanceof MetaGraphError) || error.code !== 100) throw error }
  }
  throw last
}
export const fetchLeadRaw = (leadId: string, token: string, budget: GraphBudget) => firstAccepted(`/${leadId}`, LEAD_FIELD_TIERS, token, budget)
export const fetchFormRaw = (formId: string, token: string, budget: GraphBudget) => firstAccepted(`/${formId}`, FORM_FIELD_TIERS, token, budget)

async function rpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}
export const storeLeadRaw = (admin: SupabaseClient, lead: { id: string; pageId: string; formId: string }, raw: RawGraphObject, fields: string) =>
  rpc<void>(admin, 'meta_lead_raw_store', { p_meta_lead_id: lead.id, p_page_id: lead.pageId, p_form_id: lead.formId, p_raw: raw, p_fields: fields })

export interface EnrichResult { leads: number; forms: number; unavailable: number; attention: string[] }
const needsAttention = (error: unknown) => error instanceof MetaGraphError && (isAuthError(error) || isPermissionError(error))
const mustStop = (error: unknown) => error instanceof MetaGraphError && (isAuthError(error) || isPermissionError(error) || isRateLimitError(error))

// Recupera, em pequenos lotes a cada ciclo do worker, o retorno bruto dos leads já recebidos e a definição dos formulários.
// Para ao esgotar o tempo, em limite de requisições ou em erro de credencial; o resto fica para o próximo ciclo.
export async function enrichMetaCapture(admin: SupabaseClient, resolveToken: (pageId: string) => Promise<string>, deadlineMs: number,
  limits: { leads?: number; forms?: number } = {}): Promise<EnrichResult> {
  const result: EnrichResult = { leads: 0, forms: 0, unavailable: 0, attention: [] }
  const budget = () => ({ deadlineMs: Math.min(deadlineMs, Date.now() + 8000) })
  const leads = await rpc<{ meta_lead_id: string; page_id: string; form_id: string }[]>(admin, 'meta_lead_raw_missing', { p_limit: limits.leads ?? 25 })
  for (const row of leads ?? []) {
    if (Date.now() + 3000 >= deadlineMs) return result
    try {
      const token = await resolveToken(row.page_id)
      const { raw, fields } = await fetchLeadRaw(row.meta_lead_id, token, budget())
      await storeLeadRaw(admin, { id: row.meta_lead_id, pageId: row.page_id, formId: row.form_id }, raw, fields)
      result.leads++
    } catch (error) {
      if (error instanceof MetaGraphError && error.code === 100) {
        // A Meta não devolve este lead (apagado ou fora da retenção): fica marcado e é tentado de novo em 7 dias.
        try { await storeLeadRaw(admin, { id: row.meta_lead_id, pageId: row.page_id, formId: row.form_id }, { id: row.meta_lead_id, _unavailable: error.message.slice(0, 300) }, 'unavailable'); result.unavailable++ } catch { /* tenta no próximo ciclo */ }
        continue
      }
      if (needsAttention(error)) result.attention.push((error as Error).message.slice(0, 300))
      if (mustStop(error)) return result
    }
  }
  const forms = await rpc<{ form_id: string; page_id: string }[]>(admin, 'meta_form_definition_missing', { p_limit: limits.forms ?? 5 })
  for (const row of forms ?? []) {
    if (Date.now() + 3000 >= deadlineMs) return result
    try {
      const token = await resolveToken(row.page_id)
      const { raw } = await fetchFormRaw(row.form_id, token, budget())
      await rpc<void>(admin, 'meta_form_definition_store', { p_form_id: row.form_id, p_page_id: row.page_id, p_name: typeof raw.name === 'string' ? raw.name : null, p_raw: raw })
      result.forms++
    } catch (error) {
      if (error instanceof MetaGraphError && error.code === 100) {
        // Formulário que a Meta não devolve: marca e tenta de novo em 7 dias (não trava os demais).
        try { await rpc<void>(admin, 'meta_form_definition_store', { p_form_id: row.form_id, p_page_id: row.page_id, p_name: null, p_raw: { id: row.form_id, _unavailable: error.message.slice(0, 300) } }) } catch { /* próximo ciclo */ }
        continue
      }
      if (needsAttention(error)) result.attention.push((error as Error).message.slice(0, 300))
      if (mustStop(error)) return result
    }
  }
  return result
}
