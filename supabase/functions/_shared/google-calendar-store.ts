import { CALENDAR_SCOPES } from './google-calendar-contract.ts'
import { GoogleError, refreshOAuthToken } from './google-calendar-client.ts'
import type { AdminStatus, Binding, ProjectionInput } from './google-calendar-contract.ts'

export type CredentialLease = { token: string; revision: string; expiresAt: string }
export type Credential = { accountId: string | null; accessToken: string | null; refreshToken: string | null; expiresAt: string | null; scopes: string[]; revision: string }
export type Job = { binding: Binding; leaseToken: string; leaseExpiresAt: string; attempt: number }
export type Snapshot = ProjectionInput & { connectionRevision: string }
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> }
export class CalendarStoreError extends Error {
  constructor(public code: 'conflict' | 'forbidden' | 'invalid_request' | 'storage_unavailable') { super(code); this.name = 'CalendarStoreError' }
}
export class CalendarStore {
  constructor(private db: RpcClient, private projectId: string, private dashboardOrigin: string) {}
  private async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(`google_calendar_${name}`, args)
    if (error) throw new CalendarStoreError(error.code === 'PT409' ? 'conflict' : error.code === '42501' ? 'forbidden' : error.code === '22023' ? 'invalid_request' : 'storage_unavailable')
    return data as T
  }
  adminStatus(actor: string) { return this.rpc<AdminStatus>('admin_status', { p_actor: actor }) }
  startOAuth(actor: string, stateHash: string, origin: string) {
    return this.rpc<{stateId: string; expiresAt: string}>('oauth_start', {p_actor: actor, p_state_hash: stateHash, p_origin: origin})
  }
  consumeOAuth(stateHash: string) { return this.rpc<{stateId: string; actorId: string; origin: string}>('oauth_consume', {p_state_hash: stateHash}) }
  claimCredential(seconds = 45) { return this.rpc<CredentialLease | null>('credential_claim', {p_lease_seconds: seconds}) }
  readCredential(token: string) { return this.rpc<Credential>('credential_read', {p_token: token}) }
  saveCredential(token: string, revision: string, credential: Credential, actor: string | null = null, stateId: string | null = null) {
    return this.rpc<boolean>('credential_save', {p_token: token, p_expected_revision: revision, p_actor: actor, p_state_id: stateId,
      p_account_id: credential.accountId, p_access_token: credential.accessToken, p_refresh_token: credential.refreshToken,
      p_expires_at: credential.expiresAt, p_scopes: credential.scopes})
  }
  releaseCredential(token: string) { return this.rpc<void>('credential_release', {p_token: token}) }
  activate(actor: string, calendar: {id: string; name: string; timeZone: string | null}, revision: string) {
    return this.rpc<AdminStatus>('activate', {p_actor: actor, p_calendar_id: calendar.id, p_calendar_name: calendar.name, p_time_zone: calendar.timeZone, p_credential_revision: revision})
  }
  disconnect(actor: string, token: string) { return this.rpc<AdminStatus>('disconnect', {p_actor: actor, p_token: token}) }
  setConnectionError(revision: string, code: string) { return this.rpc<void>('set_connection_error', {p_credential_revision: revision, p_code: code}) }
  retry(actor: string, callId?: string) { return this.rpc<AdminStatus>('retry', {p_actor: actor, p_call_id: callId ?? null}) }
  claim(limit = 1, seconds = 60) { return this.rpc<Job[]>('claim', {p_limit: limit, p_lease_seconds: seconds}) }
  async snapshot(bindingId: string, token: string): Promise<Snapshot | null> {
    const value = await this.rpc<Snapshot | null>('snapshot', {p_binding_id: bindingId, p_token: token})
    return value ? {...value, projectId: this.projectId, dashboardOrigin: this.dashboardOrigin} : null
  }
  renew(bindingId: string, token: string, seconds = 60) { return this.rpc<boolean>('renew', {p_binding_id: bindingId, p_token: token, p_lease_seconds: seconds}) }
  ack(bindingId: string, token: string, revision: string, hash: string | null, etag: string | null, removed: boolean, meetingUrl:string|null=null) {
    return this.rpc<boolean>('ack_details', {p_binding_id: bindingId, p_token: token, p_revision: revision, p_hash: hash, p_etag: etag, p_removed: removed,p_meeting_url:meetingUrl})
  }
  fail(bindingId: string, token: string, revision: string, code: string, retryAt: string | null) {
    return this.rpc<void>('fail', {p_binding_id: bindingId, p_token: token, p_revision: revision, p_code: code, p_retry_at: retryAt})
  }
  rotateEventId(bindingId: string, token: string, revision: string, oldEventId: string) {
    return this.rpc<Binding | null>('rotate_event_id', {p_binding_id: bindingId, p_token: token, p_revision: revision, p_old_event_id: oldEventId})
  }
  scanPage(mode: 'backfill' | 'reconcile', limit = 500) { return this.rpc<{processed: number; done: boolean}>('scan_page', {p_mode: mode, p_limit: limit}) }
  recordRun(startedAt: string) { return this.rpc<void>('record_run', {p_started_at: startedAt}) }
  requestRefresh(actor:string){return this.rpc<boolean>('request_refresh',{p_actor:actor})}
  hasPending(){return this.rpc<boolean>('pending')}
}

// All refreshes, OAuth replacements and disconnects share the same database lease.
export async function getCredential(store: CalendarStore, forceRefresh = false, options: {
  refresh?: (token: string) => Promise<import('./google-calendar-client.ts').OAuthTokenResult>; now?: () => number;
} = {}): Promise<Credential> {
  const now = options.now ?? Date.now
  let lease: CredentialLease | null = null
  for (let i = 0; i < 40 && !lease; i++) {
    lease = await store.claimCredential()
    if (!lease) await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (!lease) throw new CalendarStoreError('conflict')
  try {
    const credential = await store.readCredential(lease.token)
    if (!credential.refreshToken || !credential.accessToken) throw new GoogleError(401,'reconnect_required')
    if (!forceRefresh && credential.expiresAt && Date.parse(credential.expiresAt) > now() + 60000) return credential
    let refreshed
    try { refreshed = await (options.refresh ?? refreshOAuthToken)(credential.refreshToken) }
    catch (error) {
      if (error instanceof GoogleError && error.code === 'reconnect_required' || (error as {code?:string})?.code === 'reconnect_required') await store.setConnectionError(credential.revision,'reconnect_required')
      throw error
    }
    const next: Credential = {...credential,...refreshed,refreshToken:refreshed.refreshToken ?? credential.refreshToken,
      scopes:refreshed.scopes.length ? refreshed.scopes : credential.scopes}
    if (!CALENDAR_SCOPES.every(scope=>next.scopes.includes(scope))) {
      await store.setConnectionError(credential.revision,'reconnect_required')
      throw new GoogleError(401,'reconnect_required')
    }
    if (!await store.saveCredential(lease.token,lease.revision,next)) throw new CalendarStoreError('conflict')
    return {...next,revision:(BigInt(lease.revision)+1n).toString()}
  } finally { await store.releaseCredential(lease.token) }
}
