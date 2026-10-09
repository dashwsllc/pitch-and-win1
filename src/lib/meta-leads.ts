import type { LeadImportResult } from './meta-lead-import'

export interface MetaAuditEvent {
  id: string
  created_at: string
  entity_type: 'lead' | 'lead_batch' | 'metrics_batch' | 'metrics_row'
  entity_id: string
  action: string
  origin: 'api' | 'csv'
  actor_id: string | null
  actor_name: string | null
  actor_roles: string[]
  summary: { filename?: string; rows?: number; row?: number; status?: string; note?: string; warning?: string; reason?: string; crm_lead_id?: string; result?: LeadImportResult; changes?: { field: string; before: unknown; after: unknown }[] }
}

export interface MetaFormLead {
  id: string
  meta_lead_id: string
  page_id: string
  form_id: string
  campaign_id: string
  campaign_name: string
  ad_id: string
  form_name: string
  created_time: string
  field_data: unknown
  custom_disclaimer_responses: unknown
  full_name: string
  phone: string
  email: string
  status: 'novo' | 'importado' | 'ignorado'
  approval_status: 'pendente' | 'aprovado' | 'rejeitado'
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  crm_lead_id: string | null
  imported_by: string | null
  imported_at: string | null
  ignored_reason: string | null
  received_at: string
  updated_at: string
  lead_import_batch_id: string | null
  import_contact?: Record<string, unknown> | null
  import_warning?: string | null
}

export function metaAnswers(fieldData: unknown) {
  if (!Array.isArray(fieldData)) return []
  return fieldData.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const answer = item as { name?: unknown; values?: unknown }
    const label = typeof answer.name === 'string' ? answer.name : ''
    const values = Array.isArray(answer.values) ? answer.values.filter(value => typeof value === 'string') : []
    return label ? [{ label, value: values.join(', ') }] : []
  })
}

function firstAnswer(answers: ReturnType<typeof metaAnswers>, names: string[]) {
  const normalized = (label: string) => label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')
  return answers.find(answer => names.includes(normalized(answer.label)) && answer.value.trim())?.value.trim() || ''
}

export function metaContactDefaults(lead: MetaFormLead) {
  const answers = metaAnswers(lead.field_data)
  const imported = (key: string) => typeof lead.import_contact?.[key] === 'string' ? lead.import_contact[key] as string : ''
  const corrected = (key: string, fallback: string) => typeof lead.import_contact?.[key] === 'string' ? imported(key) : fallback
  const rawBirth = firstAnswer(answers, ['athlete_birth_date', 'nascimento', 'data_de_nascimento', 'data_de_nascimento_do_atleta', 'nascimento_do_atleta'])
  const birth = rawBirth.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1')
  const rawPosition = firstAnswer(answers, ['athlete_position', 'posicao', 'posicao_do_atleta', 'qual_a_posicao_do_atleta'])
  const positions = ['Goleiro', 'Zagueiro', 'Lateral', 'Volante', 'Meia', 'Atacante']
  return {
    name: corrected('name', lead.full_name || firstAnswer(answers, ['full_name', 'nome_completo', 'nome'])),
    phone: corrected('phone', lead.phone || firstAnswer(answers, ['phone_number', 'telefone', 'whatsapp'])),
    email: corrected('email', lead.email || firstAnswer(answers, ['email', 'email_address'])),
    city_state: corrected('city_state', firstAnswer(answers, ['city_state', 'city', 'cidade', 'cidade_estado'])),
    athlete_name: corrected('athlete_name', firstAnswer(answers, ['athlete_name', 'nome_do_atleta', 'nome_atleta'])),
    athlete_birth_date: corrected('athlete_birth_date', /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : ''),
    athlete_age: imported('athlete_age'),
    athlete_position: corrected('athlete_position', positions.find(position => position.toLowerCase() === rawPosition.toLowerCase()) || rawPosition),
    athlete_height_cm: imported('athlete_height_cm'),
    athlete_weight_kg: imported('athlete_weight_kg'),
    performance_report_url: imported('performance_report_url'),
  }
}
