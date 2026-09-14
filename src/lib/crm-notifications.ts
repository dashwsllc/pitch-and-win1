import type { CRMLead } from '@/hooks/useCRM'
import type { TeamSale } from '@/lib/sales'
import {
  CALL_REMINDER_MILESTONES,
  MINUTE_MS,
  callTimestamp,
  type CallReminderMilestone,
  type TimedCall,
} from '@/lib/crm-call-status'

export const SALE_APPROVAL_DELAY_MS = 60 * MINUTE_MS
export const SALE_NOTIFICATION_GRACE_MS = 10 * MINUTE_MS
export const FOLLOWUP_NOTIFICATION_GRACE_MS = 15 * MINUTE_MS
export const CALL_START_GRACE_MS = 5 * MINUTE_MS
export const PROACTIVE_NOTIFICATION_COOLDOWN_MS = 2 * MINUTE_MS

export type NotificationWindowState =
  | 'invalid'
  | 'waiting'
  | 'eligible'
  | 'expired'

export function notificationWindowState(
  timestamp: string | null | undefined,
  now: number,
  delayMs: number,
  graceMs: number,
): NotificationWindowState {
  if (!timestamp) return 'invalid'
  const eventAt = Date.parse(timestamp)
  if (!Number.isFinite(eventAt)) return 'invalid'
  const elapsed = now - eventAt
  if (elapsed < delayMs) return 'waiting'
  if (elapsed <= delayMs + graceMs) return 'eligible'
  return 'expired'
}

export function saleNotificationState(
  sale: Pick<TeamSale, 'approval_status' | 'reviewed_at'>,
  now: number,
) {
  if (sale.approval_status !== 'aprovada') return 'invalid' as const
  return notificationWindowState(
    sale.reviewed_at,
    now,
    SALE_APPROVAL_DELAY_MS,
    SALE_NOTIFICATION_GRACE_MS,
  )
}

export function saleNotificationKey(
  sale: Pick<TeamSale, 'id' | 'reviewed_at'>,
) {
  return `sale:${sale.id}:${sale.reviewed_at || 'sem-revisao'}`
}

export function callReminderMilestone(
  call: TimedCall,
  now: number,
): CallReminderMilestone | null {
  const scheduled = callTimestamp(call)
  if (scheduled === null || call.is_completed || call.outcome) return null
  const remaining = scheduled - now
  if (remaining > 30 * MINUTE_MS || remaining < -CALL_START_GRACE_MS) return null
  if (remaining > 10 * MINUTE_MS) return 30
  if (remaining > 0) return 10
  return 0
}

export function callReminderKey(
  callId: string,
  scheduledAt: string,
  milestone: CallReminderMilestone,
) {
  return `call:${callId}:${scheduledAt}:${milestone}`
}

// Ao abrir a tela perto do horário da call, marcos anteriores são descartados.
// O sistema mostra apenas o lembrete atual e nunca recompõe alertas antigos.
export function passedCallMilestones(current: CallReminderMilestone) {
  return CALL_REMINDER_MILESTONES.filter(
    (milestone) => milestone > current,
  )
}

export function followupNotificationState(
  lead: Pick<CRMLead, 'next_followup_at' | 'pipeline_stage'>,
  now: number,
) {
  if (
    lead.pipeline_stage === 'fechado_ganho' ||
    lead.pipeline_stage === 'fechado_perdido' ||
    lead.pipeline_stage === 'lead_perdido'
  ) {
    return 'invalid' as const
  }
  return notificationWindowState(
    lead.next_followup_at,
    now,
    0,
    FOLLOWUP_NOTIFICATION_GRACE_MS,
  )
}

export function followupNotificationKey(
  lead: Pick<CRMLead, 'id' | 'next_followup_at'>,
) {
  return `followup:${lead.id}:${lead.next_followup_at || 'sem-agenda'}`
}

export function leadNotificationOwner(
  lead: Pick<
    CRMLead,
    'pipeline_stage' | 'closer_id' | 'sdr_id' | 'assigned_to' | 'created_by'
  >,
) {
  if (lead.pipeline_stage === 'repassado_closer') {
    return lead.closer_id
  }
  return lead.sdr_id || lead.assigned_to || lead.created_by
}
