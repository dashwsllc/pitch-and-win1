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
  return answers.find(answer => names.includes(answer.label.toLowerCase()))?.value || ''
}

export function metaContactDefaults(lead: MetaFormLead) {
  const answers = metaAnswers(lead.field_data)
  const imported = (key: string) => typeof lead.import_contact?.[key] === 'string' ? lead.import_contact[key] as string : ''
  return {
    name: lead.full_name || firstAnswer(answers, ['full_name', 'nome_completo', 'nome']),
    phone: lead.phone || firstAnswer(answers, ['phone_number', 'telefone', 'whatsapp']),
    email: lead.email || firstAnswer(answers, ['email', 'email_address']),
    city_state: imported('city_state') || firstAnswer(answers, ['city', 'cidade', 'cidade_estado']),
    athlete_name: imported('athlete_name') || firstAnswer(answers, ['athlete_name', 'nome_do_atleta', 'nome_atleta']),
    athlete_birth_date: imported('athlete_birth_date'),
    athlete_age: imported('athlete_age'),
    athlete_position: imported('athlete_position'),
    athlete_height_cm: imported('athlete_height_cm'),
    athlete_weight_kg: imported('athlete_weight_kg'),
    performance_report_url: imported('performance_report_url'),
  }
}
