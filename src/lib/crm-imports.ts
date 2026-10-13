import { leadDateTime, leadDay } from './meta-waves'

export type ImportChannel = 'form' | 'website'
export type ImportMethod = 'automatic' | 'manual'
export type ImportSection = ImportChannel | 'all'
export type ImportMethodFilter = ImportMethod | 'all'
export interface CRMImportMetadata {
  import_channel?: ImportChannel | null
  import_method?: ImportMethod | null
  import_snapshot?: unknown
  lead_received_at?: string | null
}
type ImportedLead = CRMImportMetadata & {
  id?: string; meta_form_lead_id?: string | null; lead_source?: string | null
  lead_generated_at?: string | null; created_at?: string | null
}
export const importChannelLabels: Record<ImportChannel, string> = { form: 'Formulários', website: 'Site / conversão direta' }
export const importMethodLabels: Record<ImportMethod, string> = { automatic: 'Automática', manual: 'Manual' }
// Full editable CRM fields and small import metadata. The source snapshot is fetched on opening the ficha.
export const CRM_LEAD_LIST_COLUMNS: string = 'id,name,age,email,phone,company,job_title,linkedin_url,profile_photo_url,temperature,priority,conversion_probability,estimated_deal_value,pipeline_stage,lead_source,approached,approached_at,approach_count,first_contact_at,last_contact_at,next_followup_at,expected_close_at,assigned_to,observations,observations_updated_at,observations_updated_by,tags,created_by,created_at,updated_at,city_state,athlete_name,athlete_birth_date,athlete_position,athlete_height_cm,athlete_weight_kg,performance_report_url,approach_stage,sdr_id,closer_id,handed_off_at,closed_at,closed_by,version,athlete_age,qualification_income_range,qualification_goal,qualification_decision_maker,qualification_timeline,qualification_summary,qualification_completed_at,qualification_completed_by,negative_reason,followup_status,followup_next_at,followup_last_contact_at,followup_attempt_count,last_result_outcome,last_result_at,last_result_closer_id,last_result_closer_name,meta_form_lead_id,lead_generated_at,lead_received_at,import_channel,import_method'
export function importChannel(lead: ImportedLead): ImportChannel | null {
  if (lead.import_channel === 'form' || lead.import_channel === 'website') return lead.import_channel
  if (lead.lead_source === 'site_conversion') return 'website'
  return lead.meta_form_lead_id || lead.lead_source === 'meta_ads_form' ? 'form' : null
}
export function matchesCRMImport(lead: ImportedLead, channel: ImportSection, method: ImportMethodFilter) {
  const origin = importChannel(lead)
  return origin !== null && (channel === 'all' || origin === channel) && (method === 'all' || lead.import_method === method)
}
export function importSnapshot(lead: CRMImportMetadata): Record<string, unknown> {
  const value = lead.import_snapshot
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function importReceivedAt(lead: CRMImportMetadata) {
  const saved = importSnapshot(lead).first_received_at
  const value = lead.lead_received_at || (typeof saved === 'string' ? saved : null)
  return value && Number.isFinite(Date.parse(value)) ? value : null
}
/** Never label fallback processing dates or synthetic noon as an actual submission. */
export function importGenerationLabel(at: string | null | undefined, timeKnown: boolean, dateKnown?: boolean) {
  if (!at || !Number.isFinite(Date.parse(at)) || dateKnown === false || (!timeKnown && dateKnown !== true)) return 'Data e horário não informados na origem'
  return timeKnown ? leadDateTime(at) : `${leadDay(at)} · horário não informado na origem`
}
const timestamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
export function compareCRMImportRecency(a: ImportedLead, b: ImportedLead) {
  return timestamp(importReceivedAt(b) || b.created_at) - timestamp(importReceivedAt(a) || a.created_at) ||
    timestamp(b.lead_generated_at) - timestamp(a.lead_generated_at) || (a.id || '').localeCompare(b.id || '')
}
