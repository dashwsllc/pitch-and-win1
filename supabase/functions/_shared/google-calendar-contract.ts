// Public, platform-independent contract. Never put credentials in this module.
export const CALENDAR_TIME_ZONE = 'America/Sao_Paulo'
export const CALL_DURATION_MS = 1_800_000
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const
export type SyncStatus = 'disabled' | 'awaiting_connection' | 'pending' | 'syncing' | 'synced' | 'removal_pending' | 'removed' | 'error'
export type ConnectionStatus = 'not_connected' | 'connected' | 'reconnect_required' | 'permission_denied' | 'disconnected'
export type CalendarChoice = { id: string; name: string; accessRole: 'writer' | 'owner'; timeZone: string | null }
export type AdminStatus = {
  configured: boolean; connection: ConnectionStatus; calendar: CalendarChoice | null; destinationLocked: boolean
  activatedAt: string | null; lastRunAt: string | null; pendingCount: number; errorCount: number
  backfillPending: boolean; errorCode: string | null
}
export type ManageRequest = { action: 'status' } | { action: 'start_oauth' } | { action: 'list_calendars' }
  | { action: 'disconnect' } | { action: 'activate'; calendarId: string } | { action: 'retry'; callId?: string }
export type ManageResultByAction = {
  status: AdminStatus; activate: AdminStatus; disconnect: AdminStatus; retry: AdminStatus
  start_oauth: { authorizationUrl: string }; list_calendars: { calendars: CalendarChoice[] }
}
export type CallSyncStatus = {
  callId: string; desiredRevision: string; confirmedRevision: string | null; status: SyncStatus
  errorCode: string | null; lastSyncedAt: string | null
}
export type CallSource = { id: string; leadId: string; callType: string | null; scheduledAt: string | null;
  assignedTo: string | null; isCompleted: boolean; cancelledAt: string | null; outcome: string | null }
export type LeadSource = { id: string; name: string; pipelineStage: string }
export type Binding = { id: string; callId: string; leadId: string; calendarId: string; eventId: string;
  generation: number; revision: string; confirmedRevision: string | null; confirmedHash: string | null; etag: string | null }
export type ProjectionInput = { call: CallSource | null; lead: LeadSource | null; closerName: string | null;
  binding: Binding; projectId: string; dashboardOrigin: string }
export type ManagedEvent = { summary: string; description: string; start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string }; extendedProperties: { private: Record<string, string> } }
export type DesiredEvent = { kind: 'upsert' | 'completed'; event: ManagedEvent } | { kind: 'remove' } | { kind: 'blocked'; code: 'incomplete_call' }
export type GoogleEvent = Partial<ManagedEvent> & { id: string; status?: string; etag?: string; htmlLink?: string; [key: string]: unknown }
