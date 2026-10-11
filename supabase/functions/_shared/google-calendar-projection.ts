import { CALL_DURATION_MS, CALENDAR_TIME_ZONE, type DesiredEvent, type GoogleEvent, type ManagedEvent, type ProjectionInput } from './google-calendar-contract.ts'

const outcomes: Record<string, string> = {
  venda_concluida: 'Venda concluída', venda_perdida: 'Venda recusada', lead_perdido: 'Lead perdido',
  avancou: 'Avançou', followup: 'Follow-up necessário', followup_sdr: 'Follow-up do SDR',
  repassado_closer: 'Enviado ao Closer', devolvido_sdr: 'Devolvido ao SDR',
}
export function googleEventId(uuid: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw new Error('invalid_event_uuid')
  return uuid.replaceAll('-', '').toLowerCase()
}
export function projectCall(input: ProjectionInput): DesiredEvent {
  const { call, lead, binding } = input
  if (!call || !lead || call.cancelledAt || ['devolvido_sdr', 'followup_sdr'].includes(call.outcome ?? '')) return { kind: 'remove' }
  if (call.callType !== 'fechamento_closer') return { kind: 'remove' }
  const completed = call.isCompleted || !!call.outcome
  if (!completed && lead.pipelineStage !== 'repassado_closer') return { kind: 'remove' }
  const start = call.scheduledAt && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(call.scheduledAt) ? Date.parse(call.scheduledAt) : NaN
  if (!call.assignedTo || !Number.isFinite(start) || !Number.isFinite(start + CALL_DURATION_MS)) return { kind: 'blocked', code: 'incomplete_call' }
  const closer = input.closerName?.trim() || 'Closer responsável'
  const link = new URL('/crm', input.dashboardOrigin)
  link.searchParams.set('tab', 'closer'); link.searchParams.set('lead', call.leadId)
  return { kind: completed ? 'completed' : 'upsert', event: {
    summary: `Call de fechamento — ${lead.name} | ${closer}`,
    description: [`Responsável: ${closer}`, `Status: ${completed ? 'Concluída' : 'Agendada'}`,
      ...(completed && call.outcome ? [`Resultado: ${outcomes[call.outcome] ?? 'Concluída'}`] : []), `CRM: ${link.href}`].join('\n'),
    start: { dateTime: new Date(start).toISOString(), timeZone: CALENDAR_TIME_ZONE },
    end: { dateTime: new Date(start + CALL_DURATION_MS).toISOString(), timeZone: CALENDAR_TIME_ZONE },
    extendedProperties: { private: { project_id: input.projectId, call_id: binding.callId, binding_id: binding.id, revision: binding.revision } },
  } }
}
export function ownsEvent(actual: GoogleEvent, expected: ManagedEvent): boolean {
  return ['project_id', 'call_id', 'binding_id'].every(key => actual.extendedProperties?.private?.[key] === expected.extendedProperties.private[key])
}
function normalized(event: Partial<ManagedEvent>): string {
  const props = event.extendedProperties?.private ?? {}
  return JSON.stringify({ summary: event.summary, description: event.description,
    start: { dateTime: event.start?.dateTime ? new Date(event.start.dateTime).toISOString() : null, timeZone: event.start?.timeZone },
    end: { dateTime: event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null, timeZone: event.end?.timeZone },
    ownership: [props.project_id, props.call_id, props.binding_id] })
}
export function eventMatches(actual: GoogleEvent, expected: ManagedEvent): boolean {
  try { return actual.status !== 'cancelled' && ownsEvent(actual, expected) && normalized(actual) === normalized(expected) } catch { return false }
}
export async function managedEventHash(event: ManagedEvent): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized(event)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
