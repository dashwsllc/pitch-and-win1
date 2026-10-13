import { brasiliaParts } from './brasilia-time'

// Levas de leads: 20 leads por leva, sempre da mais recente para a mais antiga.
export const WAVE_SIZE = 20
export const FRESH_MINUTES = 15
export const WARM_MINUTES = 60

export type WaveStatus = 'pendente' | 'aprovada' | 'rejeitada'
export type WaveSyncStatus = 'enviado' | 'falhou'

export interface WaveSummary {
  id: string
  number: number
  status: WaveStatus
  is_open: boolean
  version: number
  created_at: string
  closed_at: string | null
  reviewed_at: string | null
  review_note: string | null
  reviewed_by_name: string | null
  lead_count: number
  pending: number
  approved: number
  rejected: number
  sent: number
  failed: number
  first_lead_at: string | null
  last_lead_at: string | null
  first_received_at?: string | null
  last_received_at?: string | null
}

export interface WaveLead {
  id: string
  meta_lead_id: string
  page_id: string
  form_id: string
  form_name: string
  campaign_id: string
  campaign_name: string
  ad_id: string
  created_time: string
  received_at: string
  first_received_at?: string | null
  entry_channel?: 'form' | 'website'
  updated_at: string
  full_name: string
  phone: string
  email: string
  field_data: unknown
  custom_disclaimer_responses: unknown
  approval_status: 'pendente' | 'aprovado' | 'rejeitado'
  status: 'novo' | 'importado' | 'ignorado'
  review_note: string | null
  reviewed_at: string | null
  import_warning: string | null
  crm_lead_id: string | null
  crm_sync_status: WaveSyncStatus | null
  crm_sync_error: string | null
  crm_sync_attempts: number
  crm_sync_last_at: string | null
  traffic_edited_at: string | null
  source: 'api' | 'planilha'
  batch_filename: string | null
  time_known: boolean
}

export interface WaveList {
  count: number
  pending_waves: number
  pending_leads: number
  failed_leads: number
  newest_pending_lead_at: string | null
  needs_rebuild: boolean
  waves: WaveSummary[]
}
export interface WaveDetail { wave: WaveSummary; leads: WaveLead[] }
export type WaveDecision = WaveSummary & { already: boolean }
export type WaveRetry = WaveSummary & { retried: number; recovered: number }
export type WaveExclusion = { id: string; reason: string }

const pad = (value: number) => String(value).padStart(2, '0')
function parts(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return brasiliaParts(date)
}

/** Hora do lead em Brasília, com segundos: 10:43:52. */
export function leadClock(value: string | null | undefined) {
  const p = parts(value)
  return p ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` : '—'
}
/** Hora e minuto, sem segundos: 10:43. */
export function leadClockShort(value: string | null | undefined) {
  const p = parts(value)
  return p ? `${pad(p.hour)}:${pad(p.minute)}` : '—'
}
/** Data completa em Brasília: 11/10/2026. */
export function leadDay(value: string | null | undefined) {
  const p = parts(value)
  return p ? `${pad(p.day)}/${pad(p.month)}/${p.year}` : '—'
}
/** Dia e mês: 11/10. */
export function leadDayShort(value: string | null | undefined) {
  const p = parts(value)
  return p ? `${pad(p.day)}/${pad(p.month)}` : '—'
}
/** Data e hora completas: 11/10/2026 10:43:52. */
export function leadDateTime(value: string | null | undefined) {
  const p = parts(value)
  return p ? `${leadDay(value)} ${leadClock(value)}` : '—'
}
/** Data e hora curtas para listas: 11/10 10:43. */
export function leadDateTimeShort(value: string | null | undefined) {
  const p = parts(value)
  return p ? `${leadDayShort(value)} ${leadClockShort(value)}` : '—'
}

/** "11/10 08:14 → 11/10 10:43" ou, no mesmo dia, "11/10 · 08:14 → 10:43". */
export function waveRangeLabel(wave: Pick<WaveSummary, 'first_lead_at' | 'last_lead_at'>) {
  if (!wave.first_lead_at || !wave.last_lead_at) return 'Sem leads'
  const same = leadDay(wave.first_lead_at) === leadDay(wave.last_lead_at)
  return same
    ? `${leadDayShort(wave.first_lead_at)} · ${leadClockShort(wave.first_lead_at)} → ${leadClockShort(wave.last_lead_at)}`
    : `${leadDateTimeShort(wave.first_lead_at)} → ${leadDateTimeShort(wave.last_lead_at)}`
}

/** Tempo desde o lead: "agora", "há 8 min", "há 2 h 15 min", "há 3 dias". */
export function elapsedLabel(from: string | null | undefined, now: number) {
  const start = from ? Date.parse(from) : NaN
  if (!Number.isFinite(start)) return ''
  const minutes = Math.max(0, Math.floor((now - start) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 6) return minutes % 60 ? `há ${hours} h ${minutes % 60} min` : `há ${hours} h`
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

export type LeadUrgency = 'fresh' | 'warm' | 'late'
/** Quanto mais antigo o lead sem abordagem, mais urgente: verde até 15 min, amarelo até 1 h, vermelho depois. */
export function leadUrgency(from: string | null | undefined, now: number): LeadUrgency {
  const start = from ? Date.parse(from) : NaN
  const minutes = Number.isFinite(start) ? (now - start) / 60_000 : Infinity
  return minutes <= FRESH_MINUTES ? 'fresh' : minutes <= WARM_MINUTES ? 'warm' : 'late'
}
export const urgencyClass: Record<LeadUrgency, string> = {
  fresh: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  warm: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  late: 'border-rose-500/50 bg-rose-500/10 text-rose-300',
}

export const waveStatusLabel: Record<WaveStatus, string> = { pendente: 'Pendente', aprovada: 'Aprovada', rejeitada: 'Rejeitada' }

export type LeadSyncView = { key: 'aguardando' | 'enviado' | 'falhou' | 'rejeitado' | 'sem_envio'; label: string; detail: string | null }
/** Situação do lead na leva: aguardando aprovação, enviado ao CRM, com falha ou rejeitado. */
export function leadSyncView(lead: Pick<WaveLead, 'approval_status' | 'crm_sync_status' | 'crm_sync_error' | 'crm_lead_id' | 'review_note'>): LeadSyncView {
  if (lead.approval_status === 'pendente') return { key: 'aguardando', label: 'Aguardando aprovação', detail: null }
  if (lead.approval_status === 'rejeitado') return { key: 'rejeitado', label: 'Rejeitado', detail: lead.review_note }
  if (lead.crm_sync_status === 'falhou') return { key: 'falhou', label: 'Falha ao enviar ao CRM', detail: lead.crm_sync_error }
  if (lead.crm_lead_id || lead.crm_sync_status === 'enviado') return { key: 'enviado', label: 'Enviado ao CRM', detail: null }
  return { key: 'sem_envio', label: 'Aprovado, ainda não enviado', detail: null }
}

/** Resumo de uma leva decidida: "18 enviados · 2 com falha · 2 rejeitados". */
export function waveOutcomeLabel(wave: Pick<WaveSummary, 'status' | 'sent' | 'failed' | 'rejected' | 'pending' | 'lead_count'>) {
  if (wave.status === 'pendente') return `${wave.pending} aguardando aprovação${wave.rejected ? ` · ${wave.rejected} rejeitados` : ''}`
  const items = [`${wave.sent} enviados ao CRM`]
  if (wave.failed) items.push(`${wave.failed} com falha`)
  if (wave.rejected) items.push(`${wave.rejected} rejeitados`)
  return items.join(' · ')
}

/** Mensagem do aviso depois de decidir uma leva. */
export function decisionMessage(decision: WaveDecision, action: 'aprovar' | 'rejeitar') {
  if (action === 'rejeitar') return `Leva #${decision.number} rejeitada (${decision.rejected} leads guardados; podem ser reabertos).`
  if (decision.already) return `Leva #${decision.number} já estava aprovada: ${waveOutcomeLabel(decision)}.`
  return `Leva #${decision.number} aprovada: ${waveOutcomeLabel(decision)}.`
}

/** Horário em que o lead caiu, exibido só para leads de formulário da Meta (nos demais é o cadastro). */
export function leadArrivedAt(lead: { lead_source?: string | null; lead_generated_at?: string | null }) {
  return lead.lead_source === 'meta_ads_form' && lead.lead_generated_at ? lead.lead_generated_at : null
}

/** Tamanho dos blocos enviados na importação manual, para ficar abaixo do limite de tempo da API. */
export const IMPORT_CHUNK_SIZE = 200
export function chunkRows<T>(rows: T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}
