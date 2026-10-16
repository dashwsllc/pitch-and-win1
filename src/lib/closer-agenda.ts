import type {CRMActivity, CRMLead} from '@/hooks/useCRM'
import {brasiliaDateKey, isValidDateKey} from '@/lib/brasilia-time'
import {outcomeLabel} from '@/lib/crm-stages'

export type AgendaView = 'scheduled' | 'history'

export function selectCloserAgendaCalls(
  calls: readonly CRMActivity[],
  leads: readonly CRMLead[],
  {view, dateKey}: {view: AgendaView; dateKey: string},
): CRMActivity[] {
  if (dateKey && !isValidDateKey(dateKey)) return []
  const accessible = new Map(leads.map(lead => [lead.id, lead]))
  return calls.filter(call => {
    const lead = accessible.get(call.lead_id)
    if (call.call_type !== 'fechamento_closer' || !lead || !call.scheduled_at || !Number.isFinite(Date.parse(call.scheduled_at))) return false
    const finished = call.is_completed || !!call.cancelled_at || !!call.outcome
    if (view === 'scheduled' && (finished || !call.assigned_to || lead.pipeline_stage !== 'repassado_closer')) return false
    if (view === 'history' && !finished) return false
    return !dateKey || brasiliaDateKey(call.scheduled_at) === dateKey
  }).sort((a, b) => {
    const difference = Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!)
    return (view === 'history' ? -difference : difference) || a.id.localeCompare(b.id)
  })
}

export function agendaCallLabel(call: CRMActivity) {
  if (call.cancelled_at) return 'Cancelada'
  if (call.outcome === 'devolvido_sdr') return 'Devolvida ao SDR'
  // Encerrada pela agenda ou pelo CRM: o resultado (Venda concluída, Venda recusada, Follow-up necessário, Sinal pago).
  if (call.outcome) return outcomeLabel(call.outcome) ?? 'Concluída'
  return call.is_completed ? 'Concluída' : 'Agendada'
}
