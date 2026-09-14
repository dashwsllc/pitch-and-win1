import { brasiliaDateKey } from '@/lib/brasilia-time'

// Fonte unica do estado temporal de uma call. CRM, badges, filtros, ordenacao e
// notificacoes leem daqui para nao divergirem sobre a mesma reuniao.

export const MINUTE_MS = 60_000

// Escalonamento pedido pela operacao: sinaliza a partir de 60 minutos, aumenta
// o destaque em 30 e trata como urgente em 10.
export const SOON_THRESHOLD_MS = 60 * MINUTE_MS
export const APPROACHING_THRESHOLD_MS = 30 * MINUTE_MS
export const URGENT_THRESHOLD_MS = 10 * MINUTE_MS

// crm_activities nao guarda duracao. Durante esta janela apos o horario a call
// e tratada como acontecendo; depois dela, como nao efetuada.
export const IN_PROGRESS_WINDOW_MS = 30 * MINUTE_MS

export type CallTimingState =
  | 'none'
  | 'completed'
  | 'overdue'
  | 'now'
  | 'urgent'
  | 'approaching'
  | 'soon'
  | 'upcoming'

export type TimedCall = {
  scheduled_at?: string | null
  is_completed?: boolean | null
  outcome?: string | null
}

const CLOSED_STAGES = ['fechado_ganho', 'fechado_perdido', 'lead_perdido']

export function isClosedStage(pipelineStage: string | null | undefined) {
  return !!pipelineStage && CLOSED_STAGES.includes(pipelineStage)
}

export function callTimestamp(call: TimedCall | null | undefined) {
  if (!call?.scheduled_at) return null
  const time = Date.parse(call.scheduled_at)
  return Number.isFinite(time) ? time : null
}

// Uma call concluida, cancelada ou pertencente a um lead encerrado nunca gera
// alerta de atraso. Reagendar altera scheduled_at, entao o estado se recalcula
// sozinho a partir do novo horario.
export function callTimingState(
  call: TimedCall | null | undefined,
  now: Date | number = new Date(),
  pipelineStage?: string | null,
): CallTimingState {
  if (!call) return 'none'
  if (call.is_completed || call.outcome) return 'completed'
  if (isClosedStage(pipelineStage)) return 'completed'
  const scheduled = callTimestamp(call)
  if (scheduled === null) return 'none'
  const current = now instanceof Date ? now.getTime() : now
  const remaining = scheduled - current
  if (remaining <= -IN_PROGRESS_WINDOW_MS) return 'overdue'
  if (remaining <= 0) return 'now'
  if (remaining <= URGENT_THRESHOLD_MS) return 'urgent'
  if (remaining <= APPROACHING_THRESHOLD_MS) return 'approaching'
  if (remaining <= SOON_THRESHOLD_MS) return 'soon'
  return 'upcoming'
}

// Mantem a semantica historica do CRM: horario ja passou e a call segue aberta.
// Usado pelos contadores e pelo filtro "somente atrasados" que ja existiam.
export function isCallPastDue(
  call: TimedCall | null | undefined,
  now: Date | number = new Date(),
  pipelineStage?: string | null,
) {
  const state = callTimingState(call, now, pipelineStage)
  return state === 'now' || state === 'overdue'
}

export function callNeedsAttention(state: CallTimingState) {
  return state === 'overdue' || state === 'now' || state === 'urgent' || state === 'approaching'
}

export function minutesUntilCall(
  call: TimedCall | null | undefined,
  now: Date | number = new Date(),
) {
  const scheduled = callTimestamp(call)
  if (scheduled === null) return null
  const current = now instanceof Date ? now.getTime() : now
  return Math.round((scheduled - current) / MINUTE_MS)
}

// Rotulos textuais para que a urgencia nunca dependa so de cor.
export function callStateLabel(
  state: CallTimingState,
  minutes: number | null,
): string | null {
  switch (state) {
    case 'overdue':
      return 'Call não efetuada'
    case 'now':
      return 'Call agora'
    case 'urgent':
      return minutes !== null && minutes > 0 ? `Call em ${minutes} min` : 'Call agora'
    case 'approaching':
      return minutes !== null ? `Call em ${minutes} min` : 'Call próxima'
    case 'soon':
      return 'Call na próxima hora'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Filtro por data da call. A comparacao usa o dia civil de Brasilia, o mesmo
// fuso adotado no restante do sistema.
// ---------------------------------------------------------------------------

export type CallDateFilter = 'all' | 'today' | 'tomorrow' | 'specific'

export function callMatchesDateKey(
  call: TimedCall | null | undefined,
  dateKey: string | null,
) {
  if (!dateKey) return false
  const scheduled = callTimestamp(call)
  if (scheduled === null) return false
  return brasiliaDateKey(scheduled) === dateKey
}

// Marcos de lembrete para o closer responsavel, em minutos antes da call.
export const CALL_REMINDER_MILESTONES = [30, 10, 0] as const
export type CallReminderMilestone = (typeof CALL_REMINDER_MILESTONES)[number]
