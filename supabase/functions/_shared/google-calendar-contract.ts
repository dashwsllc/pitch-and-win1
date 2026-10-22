// Public, platform-independent contract. Never put credentials in this module.
export const CALENDAR_TIME_ZONE = 'America/Sao_Paulo'
export const CALL_DURATION_MS = 1_800_000
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const
// Permissão extra, só para abrir o acesso do Meet das calls (API do Meet, config.accessType = OPEN). Não sensível. Fica FORA de CALENDAR_SCOPES de propósito:
// CALENDAR_SCOPES é o que a agenda exige para existir; sem o escopo do Meet a agenda sincroniza normalmente e só o acesso aberto fica de fora.
export const MEET_SETTINGS_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings'
export const AUTHORIZATION_SCOPES = [...CALENDAR_SCOPES, MEET_SETTINGS_SCOPE] as const
// unknown: ainda não tentou · open: o Google confirmou o acesso aberto · scope_missing: falta reconectar e aceitar a permissão nova · api_disabled: API do Meet desligada no Google Cloud
// not_permitted: o Google recusou mudar o acesso desta conta ou reunião · error: falha momentânea (tenta de novo sozinho)
export type MeetAccessState = 'unknown' | 'open' | 'scope_missing' | 'api_disabled' | 'not_permitted' | 'error'
export type SyncStatus = 'disabled' | 'awaiting_connection' | 'pending' | 'syncing' | 'synced' | 'removal_pending' | 'removed' | 'error'
export type ConnectionStatus = 'not_connected' | 'connected' | 'reconnect_required' | 'permission_denied' | 'disconnected'
export type CalendarChoice = { id: string; name: string; accessRole: 'writer' | 'owner'; timeZone: string | null }
export type AdminStatus = {
  configured: boolean; connection: ConnectionStatus; calendar: CalendarChoice | null; destinationLocked: boolean
  activatedAt: string | null; lastRunAt: string | null; pendingCount: number; errorCount: number
  backfillPending: boolean; errorCode: string | null
  // Ausente enquanto a migration 20261022190000 não está no banco.
  meetAccess?: { state: MeetAccessState; checkedAt: string | null }
}
export type ManageRequest = { action: 'status' } | { action: 'start_oauth' } | { action: 'list_calendars' }
  | { action: 'disconnect' } | { action: 'activate'; calendarId: string } | { action: 'retry'; callId?: string } | {action:'sync'}
export type ManageResultByAction = {
  status: AdminStatus; activate: AdminStatus; disconnect: AdminStatus; retry: AdminStatus
  start_oauth: { authorizationUrl: string }; list_calendars: { calendars: CalendarChoice[] }; sync:{processed:number;pending:boolean}
}
export type CallSyncStatus = {
  callId: string; desiredRevision: string; confirmedRevision: string | null; status: SyncStatus
  errorCode: string | null; lastSyncedAt: string | null; meetingUrl?:string|null
}
export type CallSource = { id: string; leadId: string; callType: string | null; scheduledAt: string | null;
  assignedTo: string | null; isCompleted: boolean; cancelledAt: string | null; outcome: string | null; durationMinutes?:number; context?:string|null }
export type LeadSource = { id: string; name: string; pipelineStage: string; athleteName?:string|null; qualificationSummary?:string|null; observations?:string|null; temperature?:string|null }
export type Binding = { id: string; callId: string; leadId: string; calendarId: string; eventId: string;
  generation: number; revision: string; confirmedRevision: string | null; confirmedHash: string | null; etag: string | null }
export type ProjectionInput = { call: CallSource | null; lead: LeadSource | null; closerName: string | null; closerEmail?: string | null;
  binding: Binding; projectId: string; dashboardOrigin: string; contexts?:{type:string;content:string}[] }
export type ManagedEvent = { summary: string; description: string; start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string }; attendees?: { email: string }[]; extendedProperties: { private: Record<string, string> } }
export type DesiredEvent = { kind: 'upsert' | 'completed'; event: ManagedEvent } | { kind: 'remove' } | { kind: 'blocked'; code: 'incomplete_call' }
export type GoogleEvent = Partial<ManagedEvent> & { id: string; status?: string; etag?: string; htmlLink?: string; [key: string]: unknown }
