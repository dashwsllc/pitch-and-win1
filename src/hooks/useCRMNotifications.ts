import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { CRMActivity, CRMLead } from '@/hooks/useCRM'
import {
  CALL_REMINDER_MILESTONES,
  IN_PROGRESS_WINDOW_MS,
  MINUTE_MS,
  callTimestamp,
  isClosedStage,
} from '@/lib/crm-call-status'
import { BRASILIA_TIME_ZONE } from '@/lib/brasilia-time'

// Verificacao local a cada 30s. Nao faz requisicao: le apenas os dados que o
// CRM ja carregou no seu proprio ciclo de atualizacao.
const TICK_MS = 30_000
const MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const STORAGE_PREFIX = 'crm-notifications'

type Delivered = Record<string, number>

// Persistido para que recarregar a pagina nao reenvie avisos ja mostrados.
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
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Armazenamento indisponivel (aba anonima, cota). A deduplicacao continua
    // valendo em memoria durante a sessao.
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

export type CRMNotificationsInput = {
  userId: string | null | undefined
  enabled: boolean
  leads: CRMLead[]
  calls: CRMActivity[]
  names: Record<string, string>
  onOpenLead?: (leadId: string) => void
}

export function useCRMNotifications({
  userId,
  enabled,
  leads,
  calls,
  names,
  onOpenLead,
}: CRMNotificationsInput) {
  // Refs mantem os dados frescos sem reiniciar o timer a cada render.
  const latest = useRef({ leads, calls, names, onOpenLead })
  latest.current = { leads, calls, names, onOpenLead }

  const delivered = useRef<Delivered>({})
  const storageKey = userId ? `${STORAGE_PREFIX}:${userId}` : null
  const salesBaseline = useRef<Set<string> | null>(null)

  useEffect(() => {
    // Troca de usuario recarrega a memoria de avisos e descarta a linha de base
    // de vendas do usuario anterior.
    delivered.current = storageKey ? readDelivered(storageKey) : {}
    salesBaseline.current = null
  }, [storageKey])

  useEffect(() => {
    if (!enabled || !userId || !storageKey) return

    const remember = (key: string) => {
      delivered.current[key] = Date.now()
      writeDelivered(storageKey, delivered.current)
    }
    const alreadySent = (key: string) => key in delivered.current

    const check = () => {
      const now = Date.now()
      const { leads: currentLeads, calls: currentCalls, names: currentNames } = latest.current
      const leadById = new Map(currentLeads.map((lead) => [lead.id, lead]))

      // ----- Lembretes pessoais do closer responsavel pela call -----
      for (const call of currentCalls) {
        if (call.assigned_to !== userId) continue
        if (call.is_completed || call.outcome) continue
        const scheduled = callTimestamp(call)
        if (scheduled === null) continue
        const lead = leadById.get(call.lead_id)
        if (isClosedStage(lead?.pipeline_stage)) continue

        const remaining = scheduled - now
        if (remaining <= -IN_PROGRESS_WINDOW_MS) continue

        // Do marco mais urgente para o menos urgente: dispara no maximo um
        // aviso por call a cada verificacao.
        const milestone = [...CALL_REMINDER_MILESTONES]
          .sort((a, b) => a - b)
          .find(
            (minutes) =>
              remaining <= minutes * MINUTE_MS && !alreadySent(`call:${call.id}:${minutes}`),
          )
        if (milestone === undefined) continue

        const key = `call:${call.id}:${milestone}`
        remember(key)
        const name = athleteLabel(lead)
        const clock = call.scheduled_at ? callClock(call.scheduled_at) : null
        const starting = remaining <= 0
        toast(starting ? 'Sua call começa agora' : `Call em ${milestone} minutos`, {
          id: key,
          icon: starting ? '🔔' : '📅',
          description: clock ? `${name} · ${clock}` : name,
          duration: starting ? 15_000 : 10_000,
          closeButton: true,
          action: latest.current.onOpenLead
            ? {
                label: 'Abrir lead',
                onClick: () => latest.current.onOpenLead?.(call.lead_id),
              }
            : undefined,
        })
      }

      // ----- Vendas concluidas, avisadas para a equipe -----
      const soldNow = new Set(
        currentLeads
          .filter((lead) => lead.pipeline_stage === 'fechado_ganho')
          .map((lead) => lead.id),
      )
      if (salesBaseline.current === null) {
        // Primeira leitura apenas fotografa o estado atual. Vendas que ja
        // estavam fechadas nao geram aviso ao abrir ou recarregar a pagina.
        salesBaseline.current = soldNow
      } else {
        for (const leadId of soldNow) {
          if (salesBaseline.current.has(leadId)) continue
          const key = `sale:${leadId}`
          if (alreadySent(key)) continue
          remember(key)
          const lead = leadById.get(leadId)
          const closer = lead?.closed_by || lead?.closer_id
          const closerName = closer ? currentNames[closer] : null
          toast('🎉 Nova venda realizada!', {
            id: key,
            description: closerName
              ? `${athleteLabel(lead)} · Venda realizada por: ${closerName}`
              : athleteLabel(lead),
            duration: 12_000,
            closeButton: true,
            action: latest.current.onOpenLead
              ? {
                  label: 'Ver lead',
                  onClick: () => latest.current.onOpenLead?.(leadId),
                }
              : undefined,
          })
        }
        salesBaseline.current = soldNow
      }
    }

    check()
    const timer = window.setInterval(check, TICK_MS)
    return () => window.clearInterval(timer)
  }, [enabled, userId, storageKey])
}
