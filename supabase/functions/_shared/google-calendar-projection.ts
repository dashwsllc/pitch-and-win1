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
  const minutes=call.durationMinutes ?? CALL_DURATION_MS/60000
  if (!call.assignedTo || !Number.isInteger(minutes) || minutes<1 || minutes>480 || !Number.isFinite(start) || !Number.isFinite(start + minutes*60000)) return { kind: 'blocked', code: 'incomplete_call' }
  const closer = input.closerName?.trim() || 'Closer responsável'
  const link = new URL('/crm', input.dashboardOrigin)
  link.searchParams.set('tab', 'closer'); link.searchParams.set('lead', call.leadId)
  return { kind: completed ? 'completed' : 'upsert', event: {
    summary: `Call de fechamento — ${lead.athleteName?.trim() || lead.name} | ${closer}`,
    description: [`Responsável: ${closer}`, `Status: ${completed ? 'Concluída' : 'Agendada'}`,
      `Lead / responsável pelo atleta: ${lead.name}`,`Duração: ${minutes} minutos`,
      ...(completed && call.outcome ? [`Resultado: ${outcomes[call.outcome] ?? 'Concluída'}`] : []), `CRM (contexto completo): ${link.href}`,
      callContext(input)].filter(Boolean).map(escapeCalendarText).join('\n'),
    start: { dateTime: new Date(start).toISOString(), timeZone: CALENDAR_TIME_ZONE },
    end: { dateTime: new Date(start + minutes*60000).toISOString(), timeZone: CALENDAR_TIME_ZONE },
    extendedProperties: { private: { project_id: input.projectId, call_id: binding.callId, binding_id: binding.id, revision: binding.revision } },
  } }
}
function escapeCalendarText(value:string):string{return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
function callContext(input:ProjectionInput):string {
  const parts=[input.call?.context&&`Pauta da call:\n${input.call.context}`,input.lead?.qualificationSummary&&`Qualificação:\n${input.lead.qualificationSummary}`,
    input.lead?.observations&&`Observações:\n${input.lead.observations}`,...(input.contexts??[]).map(row=>`${row.type==='whatsapp_summary'?'Resumo WhatsApp':row.type==='call_transcript'?'Transcrição da call':'Contexto do lead'}:\n${row.content}`)].filter(Boolean).join('\n\n')
  return parts.length>6000?parts.slice(0,6000)+'\n[Contexto continua no CRM]':parts
}
export function googleMeetingUrl(event:GoogleEvent):string|null {
  const conference=event.conferenceData as {entryPoints?:{entryPointType?:string;uri?:unknown}[]}|undefined
  const candidate=event.hangoutLink??conference?.entryPoints?.find(point=>point.entryPointType==='video')?.uri
  return typeof candidate==='string'&&/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(candidate)?candidate:null
}
export function withMeeting(event:ManagedEvent,url:string|null):ManagedEvent {
  return url?{...event,description:event.description+`\nMeet: ${url}`}:event
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
