import { leadCsvFields } from './meta-lead-import.ts'
import { csvFields } from './meta-traffic.ts'

export type MetaEditKind = 'leads' | 'metrics'
export type MetaEditValues = Record<string, unknown>
export type MetaEditField = { key: string; label: string; type?: 'number' | 'date' | 'textarea' | 'answers'; options?: string[] }
const metrics = ['spend', 'leads', 'purchases', 'purchase_value', 'impressions', 'reach', 'link_clicks', 'messaging_conversations_started']
export const metaEditFields: Record<MetaEditKind, MetaEditField[]> = {
  leads: [...leadCsvFields.filter(field => field.key !== 'meta_lead_id').map(field => ({ key: field.key, label: field.label,
    ...(field.key === 'athlete_birth_date' ? { type: 'date' as const } : {}) })),
    { key: 'page_id', label: 'ID da página' },
    { key: 'raw_notes', label: 'Observações (inclui as observações atuais do CRM)', type: 'textarea' },
    { key: 'field_data', label: 'Respostas do formulário', type: 'answers' }],
  metrics: [...csvFields.map(field => ({ key: field.key, label: field.label,
    ...(metrics.includes(field.key) ? { type: 'number' as const } : field.key === 'date' ? { type: 'date' as const } : {}) })),
    { key: 'level', label: 'Nível', options: ['campaign', 'adset', 'ad'] },
    { key: 'attribution_window', label: 'Janela de atribuição' }],
}
export const metaEditLabels = Object.fromEntries(Object.values(metaEditFields).flat().map(field => [field.key, field.label]))
export function metaEditDraft(kind: MetaEditKind, values: MetaEditValues) {
  return Object.fromEntries(metaEditFields[kind].map(field => [field.key, field.type === 'answers'
    ? JSON.stringify(values[field.key] ?? [], null, 2) : String(values[field.key] ?? '')]))
}
export function buildMetaEditPatch(kind: MetaEditKind, before: MetaEditValues, draft: Record<string, string>): MetaEditValues {
  const patch: MetaEditValues = {}
  for (const field of metaEditFields[kind]) {
    if (!(field.key in draft)) continue
    let value: unknown = draft[field.key]
    if (field.type === 'number') {
      const number = Number(draft[field.key])
      if (!draft[field.key].trim() || !Number.isFinite(number) || number < 0 || number > 100_000_000 ||
        (!['spend', 'purchase_value'].includes(field.key) && !Number.isInteger(number))) throw new Error(`${field.label}: informe um número válido e não negativo.`)
      value = number
    } else if (field.type === 'answers') {
      try { value = JSON.parse(draft[field.key]) } catch { throw new Error('Respostas do formulário: JSON inválido.') }
      if (!Array.isArray(value) || value.some(answer => !answer || typeof answer.name !== 'string' || !Array.isArray(answer.values) ||
        answer.values.some((item: unknown) => typeof item !== 'string'))) throw new Error('Respostas: use uma lista com nome e valores em texto.')
    }
    if (JSON.stringify(value) !== JSON.stringify(before[field.key] ?? (field.type === 'answers' ? [] : ''))) patch[field.key] = value
  }
  return patch
}
