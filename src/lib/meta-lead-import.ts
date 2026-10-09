import { normalizeHeader } from './meta-traffic.ts'
import { brasiliaDateKey, isValidDateKey } from './brasilia-time.ts'

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
  source_row?: number
  warnings?: string[]
}

export type LeadImportResult = {
  crm: number; queued: number; duplicates: number; failed: number
  issues: { row: number; kind: 'queued' | 'failed'; reason: string }[]
}
export type LeadImportResponse = { batch_id: string; rows: number; status: 'pendente' | 'aprovado'; result: LeadImportResult | null }
export type LeadCsvField = keyof Omit<LeadImportRow, 'complete' | 'field_data' | 'raw_notes' | 'source_row' | 'warnings'>
export type LeadCsvMapping = Record<LeadCsvField, string>

export const athletePositions = ['Goleiro', 'Zagueiro', 'Lateral', 'Volante', 'Meia', 'Atacante']

export const leadCsvFields: { key: LeadCsvField; label: string; required: boolean }[] = [
  { key: 'created_time', label: 'Data/hora do lead', required: false },
  { key: 'full_name', label: 'Nome do responsável', required: false },
  { key: 'phone', label: 'WhatsApp', required: false },
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

function parseDateTime(value: string) {
  const trimmed = value.trim()
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed)
  const dateKey = br ? `${br[3]}-${br[2]}-${br[1]}` : trimmed.slice(0, 10)
  const invalidCalendar = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && !isValidDateKey(dateKey)
  const invalidClock = !!br && (Number(br[4] ?? 12) > 23 || Number(br[5] ?? 0) > 59 || Number(br[6] ?? 0) > 59)
  let source = br ? `${dateKey}T${br[4] ?? '12'}:${br[5] ?? '00'}:${br[6] ?? '00'}-03:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00-03:00` : trimmed.replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source)) source += '-03:00'
  const date = new Date(source)
  const fallback = !trimmed || invalidCalendar || invalidClock || Number.isNaN(date.valueOf())
  return { value: fallback ? new Date().toISOString() : date.toISOString(), fallback }
}

function parseBirthDate(value: string) {
  const trimmed = value.trim()
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  const dateKey = match ? `${match[3]}-${match[2]}-${match[1]}` : trimmed
  return isValidDateKey(dateKey) && dateKey >= '1900-01-01' && dateKey <= brasiliaDateKey() ? dateKey : ''
}

// Keep the original answers even when their normalized value cannot enter the CRM.
function buildFieldData(line: string[], headers: string[]): FieldAnswer[] {
  const entries: FieldAnswer[] = []
  headers.forEach((header, index) => {
    const value = (line[index] || '').trim()
    if (value) entries.push({ name: header, values: [value] })
  })
  return entries
}

function readyForCRM(row: LeadImportRow) {
  const numberInRange = (value: string, min: number, max: number, integer = false) => !value ||
    (Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max && (!integer || Number.isInteger(Number(value))))
  return row.full_name.length >= 2 && row.full_name.length <= 160 && row.phone.length >= 8 && row.phone.length <= 32 &&
    row.email.length <= 254 && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(row.email) &&
    row.athlete_name.length >= 2 && row.athlete_name.length <= 160 && !!row.athlete_birth_date &&
    athletePositions.includes(row.athlete_position) && numberInRange(row.athlete_age, 1, 80, true) &&
    numberInRange(row.athlete_height_cm, 30, 250) && numberInRange(row.athlete_weight_kg, 1, 300) &&
    row.city_state.length <= 160 && (!row.performance_report_url ||
      (row.performance_report_url.length <= 2048 && /^https:\/\/[^/\s]+/.test(row.performance_report_url)))
}

export async function buildLeadImportRows(values: string[][], headers: string[], mapping: LeadCsvMapping): Promise<LeadImportRow[]> {
  if (values.length > 2000) throw new Error('Importe até 2.000 linhas por arquivo.')
  const numbered = values.map((line, index) => ({ line, index })).filter(({ line }) => line.some(value => value.trim()))
  return Promise.all(numbered.map(async ({ line, index }) => {
    const get = (field: LeadCsvField) => (mapping[field] ? (line[headers.indexOf(mapping[field])] ?? '') : '')
    const full_name = get('full_name').trim()
    const phone = get('phone').trim()
    const created = parseDateTime(get('created_time'))
    const field_data = buildFieldData(line, headers)
    let meta_lead_id = get('meta_lead_id').trim().replace(/^l:(\d+)$/, '$1')
    if (!meta_lead_id) {
      const identity = JSON.stringify(field_data.map(answer => [answer.name, answer.values]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
      meta_lead_id = 'csv:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    }
    const athlete_position = get('athlete_position').trim()
    const email = get('email').trim()
    const athlete_name = get('athlete_name').trim()
    const athlete_birth_date = parseBirthDate(get('athlete_birth_date'))
    const row: LeadImportRow = {
      meta_lead_id, campaign_id: get('campaign_id').trim(), campaign_name: get('campaign_name').trim(),
      ad_id: get('ad_id').trim(), form_id: get('form_id').trim(), form_name: get('form_name').trim(),
      created_time: created.value, full_name, phone, email, athlete_name, athlete_birth_date, athlete_position,
      athlete_age: get('athlete_age').trim(), athlete_height_cm: get('athlete_height_cm').trim(),
      athlete_weight_kg: get('athlete_weight_kg').trim(), city_state: get('city_state').trim(),
      performance_report_url: get('performance_report_url').trim(),
      field_data, raw_notes: field_data.map(item => `${item.name}: ${item.values[0]}`).join('\n'),
      complete: false, source_row: index + 2,
      warnings: created.fallback ? ['Data do lead ausente ou inválida; o recebimento será usado para ordenar a fila.'] : [],
    }
    row.complete = readyForCRM(row)
    return row
  }))
}

export function summarizeLeadImport(rows: LeadImportRow[]) {
  const seen = new Set<string>()
  const unique = rows.filter(row => {
    if (seen.has(row.meta_lead_id)) return false
    seen.add(row.meta_lead_id)
    return true
  })
  const complete = unique.filter(row => row.complete).length
  return { total: rows.length, complete, manual: unique.length - complete, duplicates: rows.length - unique.length }
}
