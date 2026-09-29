import { normalizeHeader } from './meta-traffic.ts'

export type FieldAnswer = { name: string; values: string[] }

export type LeadImportRow = {
  meta_lead_id: string
  campaign_id: string
  campaign_name: string
  ad_id: string
  form_id: string
  form_name: string
  created_time: string
  full_name: string
  phone: string
  email: string
  athlete_name: string
  athlete_birth_date: string
  athlete_position: string
  athlete_age: string
  athlete_height_cm: string
  athlete_weight_kg: string
  city_state: string
  performance_report_url: string
  field_data: FieldAnswer[]
  raw_notes: string
  complete: boolean
}

export type LeadCsvField = keyof Omit<LeadImportRow, 'complete' | 'field_data' | 'raw_notes'>
export type LeadCsvMapping = Record<LeadCsvField, string>

export const athletePositions = ['Goleiro', 'Zagueiro', 'Lateral', 'Volante', 'Meia', 'Atacante']

export const leadCsvFields: { key: LeadCsvField; label: string; required: boolean }[] = [
  { key: 'created_time', label: 'Data/hora do lead', required: true },
  { key: 'full_name', label: 'Nome do responsável', required: true },
  { key: 'phone', label: 'WhatsApp', required: true },
  { key: 'email', label: 'E-mail', required: false },
  { key: 'meta_lead_id', label: 'ID do lead (opcional)', required: false },
  { key: 'campaign_id', label: 'ID da campanha', required: false },
  { key: 'campaign_name', label: 'Campanha', required: false },
  { key: 'form_id', label: 'ID do formulário', required: false },
  { key: 'form_name', label: 'Formulário', required: false },
  { key: 'ad_id', label: 'ID do anúncio', required: false },
  { key: 'athlete_name', label: 'Nome do atleta', required: false },
  { key: 'athlete_birth_date', label: 'Nascimento do atleta', required: false },
  { key: 'athlete_position', label: 'Posição do atleta', required: false },
  { key: 'athlete_age', label: 'Idade do atleta', required: false },
  { key: 'athlete_height_cm', label: 'Altura (cm)', required: false },
  { key: 'athlete_weight_kg', label: 'Peso (kg)', required: false },
  { key: 'city_state', label: 'Cidade/UF', required: false },
  { key: 'performance_report_url', label: 'Link do relatório de desempenho', required: false },
]

const aliases: Record<LeadCsvField, string[]> = {
  created_time: ['created time', 'data de criacao do lead', 'data do lead', 'data', 'criado em'],
  full_name: ['full name', 'nome completo', 'nome', 'responsavel', 'nome do responsavel'],
  phone: ['phone number', 'phone', 'telefone', 'whatsapp'],
  email: ['email', 'email address', 'e mail'],
  meta_lead_id: ['lead id', 'id do lead', 'id'],
  campaign_id: ['campaign id', 'id da campanha'],
  campaign_name: ['campaign name', 'nome da campanha', 'campanha'],
  form_id: ['form id', 'id do formulario'],
  form_name: ['form name', 'formulario', 'nome do formulario'],
  ad_id: ['ad id', 'id do anuncio'],
  athlete_name: ['athlete name', 'nome do atleta', 'nome atleta'],
  athlete_birth_date: ['athlete birth date', 'date of birth', 'data de nascimento', 'nascimento'],
  athlete_position: ['athlete position', 'posicao', 'posicao do atleta'],
  athlete_age: ['athlete age', 'idade'],
  athlete_height_cm: ['athlete height', 'altura', 'altura cm'],
  athlete_weight_kg: ['athlete weight', 'peso', 'peso kg'],
  city_state: ['city', 'state', 'estado', 'cidade', 'cidade estado'],
  performance_report_url: ['performance report', 'relatorio de desempenho', 'link do relatorio'],
}

export function defaultLeadCsvMapping(headers: string[]): LeadCsvMapping {
  return Object.fromEntries(leadCsvFields.map(({ key }) => [key,
    headers.find(header => aliases[key].includes(normalizeHeader(header))) ?? '',
  ])) as LeadCsvMapping
}

// Nunca lança: um valor de data/hora que não dá pra entender vira "agora" (só usado pra
// ordenar a fila), sem bloquear a linha. O texto original, se houver, sobrevive como coluna
// não mapeada (buildFieldData) quando a coluna de data também tiver outro uso — aqui não tem.
function parseDateTime(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return new Date().toISOString()
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed)
  const source = br ? `${br[3]}-${br[2]}-${br[1]}T${br[4] ?? '12'}:${br[5] ?? '00'}:${br[6] ?? '00'}`
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed.replace(' ', 'T')
  const date = new Date(source)
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString()
}

// Nunca lança: nascimento que não dá pra entender fica vazio (não vira crm_leads sozinho,
// completa na fila /leads), em vez de travar a linha inteira.
function parseBirthDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
}

// Colunas da planilha que não foram mapeadas pra nenhum campo estruturado (ex.: motivação,
// dificuldade, autoavaliação, histórico de clube) viram respostas de formulário — mesmo
// formato que a fila /leads já sabe mostrar (aba "Ver respostas") pra leads do webhook.
function buildFieldData(line: string[], headers: string[], usedHeaders: Set<string>): FieldAnswer[] {
  const entries: FieldAnswer[] = []
  headers.forEach((header, index) => {
    if (usedHeaders.has(header)) return
    const value = (line[index] || '').trim()
    if (value) entries.push({ name: header, values: [value] })
  })
  return entries
}

export function buildLeadImportRows(values: string[][], headers: string[], mapping: LeadCsvMapping, filename: string): LeadImportRow[] {
  for (const field of leadCsvFields.filter(item => item.required))
    if (!mapping[field.key]) throw new Error(`Selecione a coluna “${field.label}”.`)
  if (values.length > 2000) throw new Error('Importe até 2.000 linhas por arquivo.')
  const usedHeaders = new Set(Object.values(mapping).filter(Boolean))
  const seen = new Set<string>()
  return values.map((line, index) => {
    const get = (field: LeadCsvField) => (mapping[field] ? (line[headers.indexOf(mapping[field])] ?? '') : '')
    const full_name = get('full_name').trim()
    const phone = get('phone').trim()
    const created_time = parseDateTime(get('created_time'))
    let meta_lead_id = get('meta_lead_id').trim() || `csv:${filename}:${index}`
    if (seen.has(meta_lead_id)) meta_lead_id = `${meta_lead_id}:dup${index}`
    seen.add(meta_lead_id)
    const athlete_position = get('athlete_position').trim()
    const email = get('email').trim()
    const athlete_name = get('athlete_name').trim()
    const athlete_birth_date = parseBirthDate(get('athlete_birth_date'))
    const field_data = buildFieldData(line, headers, usedHeaders)
    return {
      meta_lead_id, campaign_id: get('campaign_id').trim(), campaign_name: get('campaign_name').trim(),
      ad_id: get('ad_id').trim(), form_id: get('form_id').trim(), form_name: get('form_name').trim(),
      created_time, full_name, phone, email, athlete_name, athlete_birth_date, athlete_position,
      athlete_age: get('athlete_age').trim(), athlete_height_cm: get('athlete_height_cm').trim(),
      athlete_weight_kg: get('athlete_weight_kg').trim(), city_state: get('city_state').trim(),
      performance_report_url: get('performance_report_url').trim(),
      field_data, raw_notes: field_data.map(item => `${item.name}: ${item.values[0]}`).join('\n'),
      complete: !!email && athlete_name.length >= 2 && !!athlete_birth_date && athletePositions.includes(athlete_position),
    }
  })
}

export function summarizeLeadImport(rows: LeadImportRow[]) {
  const complete = rows.filter(row => row.complete).length
  return { total: rows.length, complete, manual: rows.length - complete }
}
