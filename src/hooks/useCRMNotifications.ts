import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { CRMActivity, CRMLead } from '@/hooks/useCRM'
import type { TeamSale } from '@/lib/sales'
import { BRASILIA_TIME_ZONE } from '@/lib/brasilia-time'
import { callTimestamp, isClosedStage } from '@/lib/crm-call-status'
import {
  CALL_START_GRACE_MS,
  PROACTIVE_NOTIFICATION_COOLDOWN_MS,
  callReminderKey,
  callReminderMilestone,
  followupNotificationKey,
  followupNotificationState,
  leadNotificationOwner,
  passedCallMilestones,
  saleNotificationKey,
  saleNotificationState,
} from '@/lib/crm-notifications'
import { readProactiveNotificationsPreference } from '@/lib/notification-preferences'

const TICK_MS = 30_000
const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STORAGE_PREFIX = 'crm-notifications-v2'
const TOAST_ID = 'crm-proactive-notification'

type Delivered = Record<string, number>

function readDelivered(storageKey: string): Delivered {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Delivered
    if (!parsed || typeof parsed !== 'object') return {}
    const cutoff = Date.now() - MEMORY_TTL_MS
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, at]) => typeof at === 'number' && at >= cutoff,
      ),
    )
  } catch {
    return {}
  }
}

function writeDelivered(storageKey: string, value: Delivered) {
  try {
    const recent = Object.entries(value)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 500)
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(recent)))
  } catch {
    // A deduplicação continua em memória quando o armazenamento não está disponível.
  }
}

const callClock = (value: string) =>
  new Date(value).toLocaleTimeString('pt-BR', {
    timeZone: BRASILIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  })

const athleteLabel = (lead: CRMLead | undefined, fallback = 'Lead sem nome') =>
  lead?.athlete_name?.trim() || lead?.name?.trim() || fallback

type CallCandidate = {
  call: CRMActivity
  key: string
  milestone: 30 | 10 | 0
  label: string
  scheduledAt: string
}

type FollowupCandidate = {
  lead: CRMLead
  key: string
}

type SaleCandidate = {
  sale: TeamSale
  key: string
}

export type CRMNotificationsInput = {
  userId: string | null | undefined
  enabled: boolean
  leads: CRMLead[]
  calls: CRMActivity[]
  approvedSales: TeamSale[]
  onOpenLead?: (leadId: string) => void
}

export function useCRMNotifications({
  userId,
  enabled,
  leads,
  calls,
  approvedSales,
  onOpenLead,
}: CRMNotificationsInput) {
  const latest = useRef({ leads, calls, approvedSales, onOpenLead })
  latest.current = { leads, calls, approvedSales, onOpenLead }

  const delivered = useRef<Delivered>({})
  const lastPopupAt = useRef(0)
  const storageKey = userId ? `${STORAGE_PREFIX}:${userId}` : null

  useEffect(() => {
    delivered.current = storageKey ? readDelivered(storageKey) : {}
    lastPopupAt.current = 0
  }, [storageKey])

  useEffect(() => {
    if (!enabled || !userId || !storageKey) return

    const check = () => {
      if (document.hidden || !readProactiveNotificationsPreference()) return

      const now = Date.now()
      const {
        leads: currentLeads,
        calls: currentCalls,
        approvedSales: currentSales,
      } = latest.current
      const leadById = new Map(currentLeads.map((lead) => [lead.id, lead]))
      let changed = false
      const remember = (key: string) => {
        if (key in delivered.current) return
        delivered.current[key] = now
        changed = true
      }
      const alreadySent = (key: string) => key in delivered.current
      const persist = () => {
        if (changed) writeDelivered(storageKey, delivered.current)
      }

      const callCandidates: CallCandidate[] = []
      const leadsWithOpenCall = new Set<string>()

      for (const call of currentCalls) {
        if (call.assigned_to !== userId || call.is_completed || call.outcome) continue
        const scheduled = callTimestamp(call)
        if (scheduled === null || !call.scheduled_at) continue
        const lead = leadById.get(call.lead_id)
        if (isClosedStage(lead?.pipeline_stage)) continue
        if (scheduled >= now - CALL_START_GRACE_MS) {
          leadsWithOpenCall.add(call.lead_id)
        }

        const milestone = callReminderMilestone(call, now)
        if (milestone === null) {
          if (scheduled < now - CALL_START_GRACE_MS) {
            for (const passed of [30, 10, 0] as const) {
              remember(callReminderKey(call.id, call.scheduled_at, passed))
            }
          }
          continue
        }

        for (const passed of passedCallMilestones(milestone)) {
          remember(callReminderKey(call.id, call.scheduled_at, passed))
        }
        const key = callReminderKey(call.id, call.scheduled_at, milestone)
        if (!alreadySent(key)) {
          callCandidates.push({
            call,
            key,
            milestone,
            label: athleteLabel(lead),
            scheduledAt: call.scheduled_at,
          })
        }
      }

      const followupCandidates: FollowupCandidate[] = []
      for (const lead of currentLeads) {
        if (leadNotificationOwner(lead) !== userId) continue
        // Calls abertas já têm lembretes próprios; um segundo popup de abordagem
        // para o mesmo lead só duplicaria a informação.
        if (leadsWithOpenCall.has(lead.id)) continue
        const state = followupNotificationState(lead, now)
        if (state === 'invalid' || state === 'waiting') continue
        const key = followupNotificationKey(lead)
        if (state === 'expired') {
          remember(key)
        } else if (!alreadySent(key)) {
          followupCandidates.push({ lead, key })
        }
      }

      const saleCandidates: SaleCandidate[] = []
      for (const sale of currentSales) {
        const state = saleNotificationState(sale, now)
        if (state === 'invalid' || state === 'waiting') continue
        const key = saleNotificationKey(sale)
        if (state === 'expired') {
          remember(key)
        } else if (!alreadySent(key)) {
          saleCandidates.push({ sale, key })
        }
      }

      const callStarting = callCandidates.some(({ milestone }) => milestone === 0)
      const coolingDown =
        now - lastPopupAt.current < PROACTIVE_NOTIFICATION_COOLDOWN_MS
      if (coolingDown && !callStarting) {
        persist()
        return
      }

      // Mostra no máximo um popup por verificação. Itens do mesmo tipo são
      // agrupados e a prioridade operacional é call, abordagem e venda.
      if (callCandidates.length > 0) {
        const sorted = [...callCandidates].sort(
          (left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt),
        )
        const first = sorted[0]
        const mostUrgent = Math.min(...sorted.map(({ milestone }) => milestone))
        const title =
          sorted.length > 1
            ? `${sorted.length} calls precisam de atenção`
            : mostUrgent === 0
              ? 'Sua call começa agora'
              : `Call em até ${mostUrgent} minutos`

        toast(title, {
          id: TOAST_ID,
          icon: mostUrgent === 0 ? '🔔' : '📅',
          description: `${
            sorted.length > 1 ? `Mais próxima: ${first.label}` : first.label
          } · ${callClock(first.scheduledAt)}`,
          duration: mostUrgent === 0 ? 15_000 : 10_000,
          closeButton: true,
          action: latest.current.onOpenLead
            ? {
                label: 'Abrir lead',
                onClick: () => latest.current.onOpenLead?.(first.call.lead_id),
              }
            : undefined,
        })
        callCandidates.forEach(({ key }) => remember(key))
        lastPopupAt.current = now
      } else if (followupCandidates.length > 0) {
        const first = followupCandidates[0]
        toast(
          followupCandidates.length === 1
            ? 'Retorno de abordagem pendente'
            : `${followupCandidates.length} abordagens precisam de retorno`,
          {
            id: TOAST_ID,
            icon: '📞',
            description:
              followupCandidates.length === 1
                ? athleteLabel(first.lead)
                : `Comece por ${athleteLabel(first.lead)}`,
            duration: 10_000,
            closeButton: true,
            action: latest.current.onOpenLead
              ? {
                  label: 'Abrir lead',
                  onClick: () => latest.current.onOpenLead?.(first.lead.id),
                }
              : undefined,
          },
        )
        followupCandidates.forEach(({ key }) => remember(key))
        lastPopupAt.current = now
      } else if (saleCandidates.length > 0) {
        const first = saleCandidates[0].sale
        toast(
          saleCandidates.length === 1
            ? 'Venda aprovada há 1 hora'
            : `${saleCandidates.length} vendas aprovadas há 1 hora`,
          {
            id: TOAST_ID,
            icon: '🎉',
            description:
              saleCandidates.length === 1
                ? `${first.seller_name} · ${first.nome_produto}`
                : 'As aprovações foram agrupadas para evitar vários avisos.',
            duration: 10_000,
            closeButton: true,
          },
        )
        saleCandidates.forEach(({ key }) => remember(key))
        lastPopupAt.current = now
      }

      persist()
    }

    check()
    const timer = window.setInterval(check, TICK_MS)
    return () => window.clearInterval(timer)
  }, [enabled, userId, storageKey])
}
