import { leadDateTime } from '@/lib/meta-waves'

// Estado do envio do contexto do atleta do CRM para a VOXEN (RPCs crm_context_health e crm_context_alignment, migration 20261020120000).
// Só números e códigos: nenhuma delas devolve payload nem dado pessoal.
export interface VoxenBridgeHealth {
  enabled: boolean
  pending_count: number
  processing_count: number
  blocked_count: number
  delivered_count: number
  oldest_pending_at: string | null
  last_delivered_at: string | null
  error_codes: Record<string, number>
  quarantined_receipts: number
  trigger_error_count: number
  last_trigger_error_at: string | null
  last_reconcile_at: string | null
  last_reconcile_summary: { examined: number; changed: number; errors: number; cycle_complete: boolean } | null
}

export interface VoxenBridgeAlignment {
  linked_sites: number
  in_sync: number
  to_enqueue: number
  skipped: number
  crm_leads_with_context: number
  with_answers: number
  with_answers_addressable: number
  with_answers_without_voxen_id: number
  context_without_answers: number
  unmapped_questions: string[]
}

export type VoxenBridgeLevel = 'ok' | 'attention' | 'problem' | 'off'
export interface VoxenBridgeVerdict { level: VoxenBridgeLevel; title: string; reasons: string[] }

const MINUTE = 60_000
/** A varredura de segurança é agendada de 15 em 15 minutos; três ciclos sem rodar é sinal de problema. */
export const SWEEP_STALE_MINUTES = 45
/** Evento na fila há mais que isso não é a espera normal (juntada de 45 s + cron de 1 min). */
export const QUEUE_STUCK_MINUTES = 15
const RECENT_TRIGGER_ERROR_MINUTES = 24 * 60

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isTimeOrNull = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && Number.isFinite(Date.parse(value)))

export function isVoxenBridgeHealth(value: unknown): value is VoxenBridgeHealth {
  const h = value as Partial<VoxenBridgeHealth> | null
  if (!h || typeof h !== 'object' || typeof h.enabled !== 'boolean') return false
  if (![h.pending_count, h.processing_count, h.blocked_count, h.delivered_count, h.quarantined_receipts, h.trigger_error_count].every(isCount)) return false
  if (![h.oldest_pending_at, h.last_delivered_at, h.last_reconcile_at, h.last_trigger_error_at].every(isTimeOrNull)) return false
  return !!h.error_codes && typeof h.error_codes === 'object' && !Array.isArray(h.error_codes)
}

export function isVoxenBridgeAlignment(value: unknown): value is VoxenBridgeAlignment {
  const a = value as Partial<VoxenBridgeAlignment> | null
  if (!a || typeof a !== 'object') return false
  return [a.linked_sites, a.in_sync, a.to_enqueue, a.skipped, a.crm_leads_with_context, a.with_answers, a.with_answers_addressable,
    a.with_answers_without_voxen_id, a.context_without_answers].every(isCount) && Array.isArray(a.unmapped_questions)
}

function minutesSince(at: string | null | undefined, now: number): number | null {
  if (!at) return null
  const time = Date.parse(at)
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / MINUTE)) : null
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Resume a saúde do envio em uma frase e uma lista de motivos. Nunca diz "em dia" quando a entrega está desligada, há envio bloqueado,
 * a fila está parada ou a varredura de segurança não roda.
 */
export function voxenBridgeVerdict(h: VoxenBridgeHealth, now = Date.now()): VoxenBridgeVerdict {
  if (!h.enabled) {
    return { level: 'off', title: 'Envio à VOXEN desligado', reasons: ['As mudanças do CRM continuam entrando na fila, mas nada é enviado até a entrega ser ligada.'] }
  }
  // `as`: o TypeScript nao enxerga a mutacao feita dentro de raise() e estreitaria o tipo para 'ok'.
  let level = 'ok' as 'ok' | 'attention' | 'problem'
  const raise = (to: 'attention' | 'problem') => { if (to === 'problem' || level === 'ok') level = to }
  const reasons: string[] = []
  const codes = Object.keys(h.error_codes ?? {}).join(', ')
  const waiting = h.pending_count + h.processing_count

  if (h.blocked_count > 0) {
    raise('problem')
    reasons.push(`${plural(h.blocked_count, 'envio bloqueado', 'envios bloqueados')} por erro que repetir não resolve${codes ? ` (${codes})` : ''}. É preciso corrigir a causa e reenfileirar.`)
  } else if (codes) {
    raise('attention')
    reasons.push(`Tentativas com erro (${codes}); o sistema repete sozinho com intervalo crescente.`)
  }
  const stuck = minutesSince(h.oldest_pending_at, now)
  if (h.blocked_count === 0 && waiting > 0 && stuck !== null && stuck > QUEUE_STUCK_MINUTES) {
    raise('attention')
    reasons.push(`${plural(waiting, 'evento está', 'eventos estão')} na fila há ${stuck} min; o normal é sair em poucos minutos.`)
  }
  if (h.trigger_error_count > 0) {
    const last = minutesSince(h.last_trigger_error_at, now)
    const when = h.last_trigger_error_at ? ` (última em ${leadDateTime(h.last_trigger_error_at)})` : ''
    if (last !== null && last <= RECENT_TRIGGER_ERROR_MINUTES) {
      raise('attention')
      reasons.push(`O gatilho do CRM falhou ${plural(h.trigger_error_count, 'vez', 'vezes')}${when}. O CRM salvou normalmente e a varredura recupera o que o gatilho perdeu.`)
    } else {
      reasons.push(`Houve ${plural(h.trigger_error_count, 'falha antiga', 'falhas antigas')} do gatilho${when}, cobertas pela varredura.`)
    }
  }
  const sweep = minutesSince(h.last_reconcile_at, now)
  if (sweep === null) { raise('attention'); reasons.push('A varredura de segurança ainda não rodou.') }
  else if (sweep > SWEEP_STALE_MINUTES) { raise('attention'); reasons.push(`A varredura de segurança não roda há ${sweep} min (deveria rodar a cada 15 min).`) }
  const sweepErrors = h.last_reconcile_summary?.errors ?? 0
  if (sweepErrors > 0) { raise('attention'); reasons.push(`A última varredura teve ${plural(sweepErrors, 'erro', 'erros')} em atletas.`) }
  if (h.quarantined_receipts > 0) {
    reasons.push(`${plural(h.quarantined_receipts, 'atleta que a VOXEN não conhece', 'atletas que a VOXEN não conhece')} (quarentena na VOXEN). Não é erro: nada a fazer aqui.`)
  }
  const title = level === 'problem' ? 'Há envios bloqueados' : level === 'attention' ? 'Funcionando, com pontos de atenção' : waiting > 0 ? 'Enviando: fila normal' : 'Em dia'
  return { level, title, reasons }
}
