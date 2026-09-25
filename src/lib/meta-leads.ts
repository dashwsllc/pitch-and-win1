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
  return {
    name: lead.full_name || firstAnswer(answers, ['full_name', 'nome_completo', 'nome']),
    phone: lead.phone || firstAnswer(answers, ['phone_number', 'telefone', 'whatsapp']),
    email: lead.email || firstAnswer(answers, ['email', 'email_address']),
    city_state: firstAnswer(answers, ['city', 'cidade', 'cidade_estado']),
    athlete_name: firstAnswer(answers, ['athlete_name', 'nome_do_atleta', 'nome_atleta']),
    athlete_birth_date: '',
    athlete_age: '',
    athlete_position: '',
    athlete_height_cm: '',
    athlete_weight_kg: '',
    performance_report_url: '',
  }
}
