import { CALENDAR_SCOPES, type CalendarChoice, type GoogleEvent, type ManagedEvent } from './google-calendar-contract.ts'
import type { Credential } from './google-calendar-store.ts'

export class GoogleError extends Error {
  constructor(public status: number, public code: string, public retryAfterMs: number | null = null, public retryable = false) { super(code); this.name = 'GoogleError' }
}
type Json = Record<string, unknown>
type TokenProvider = (forceRefresh?: boolean) => Promise<Credential>
export type OAuthTokenResult = { accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] }
const API = 'https://www.googleapis.com/calendar/v3'
const segment = encodeURIComponent
function retryAfter(value: string | null, now: number): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}
async function http(fetchImpl: typeof fetch, url: string, options: RequestInit): Promise<{ response: Response; body: Json }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal })
    // Read inside the timeout as a provider can stall the body after sending headers.
    const text = response.status === 204 ? '' : await response.text()
    let body: Json = {}
    try { body = text ? JSON.parse(text) : {} } catch { if (response.ok) throw new GoogleError(502, 'google_unavailable', null, true) }
    return { response, body }
  } catch (error) {
    if (error instanceof GoogleError) throw error
    throw new GoogleError(0, 'network', null, true)
  } finally { clearTimeout(timer) }
}
function providerError(response: Response, body: Json, now: number): GoogleError {
  const error = body.error as { errors?: { reason?: string }[] } | undefined
  const reasons = typeof error === 'object' ? error?.errors?.map(e => e.reason) ?? [] : []
  const retry = retryAfter(response.headers.get('Retry-After'), now)
  const status = response.status
  const rate = status === 429 || (status === 403 && reasons.some(r => ['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','dailyLimitExceeded'].includes(r ?? '')))
  const code = rate ? 'rate_limit' : status === 401 ? 'reconnect_required' : status === 403 || status === 404 ? 'calendar_access'
    : status === 409 ? 'conflict' : status === 410 ? 'event_deleted' : status === 412 ? 'precondition_failed'
    : status >= 500 ? 'google_unavailable' : 'invalid_payload'
  return new GoogleError(status, code, retry, rate || status >= 500)
}
function choice(body: Json): CalendarChoice {
  if (typeof body.id !== 'string' || !['writer','owner'].includes(String(body.accessRole))) throw new GoogleError(403, 'calendar_access')
  return { id: body.id, name: typeof body.summary === 'string' ? body.summary : body.id, accessRole: body.accessRole as 'writer' | 'owner', timeZone: typeof body.timeZone === 'string' ? body.timeZone : null }
}
function eventResult(body: Json): GoogleEvent {
  if (typeof body.id !== 'string' || typeof body.etag !== 'string') throw new GoogleError(502,'google_unavailable',null,true)
  return body as GoogleEvent
}
export class GoogleCalendarClient {
  private tokenProvider: TokenProvider
  private fetchImpl: typeof fetch
  private now: () => number
  constructor(options: { tokenProvider: TokenProvider; fetchImpl?: typeof fetch; now?: () => number }) {
    this.tokenProvider = options.tokenProvider; this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? Date.now
  }
  private async request(path: string, options: RequestInit = {}): Promise<Json> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.tokenProvider(attempt === 1)
      if (!token.accessToken) throw new GoogleError(401,'reconnect_required')
      const headers = new Headers(options.headers); headers.set('Authorization', 'Bearer ' + token.accessToken)
      if (options.body) headers.set('Content-Type','application/json')
      const { response, body } = await http(this.fetchImpl, API + path, { ...options, headers })
      if (response.ok) return body
      if (response.status === 401 && attempt === 0) continue
      throw providerError(response, body, this.now())
    }
    throw new GoogleError(401,'reconnect_required')
  }
  async listWritableCalendars(): Promise<CalendarChoice[]> {
    const calendars = new Map<string, CalendarChoice>(); let page: string | undefined
    const visited = new Set<string>()
    do {
      const query = new URLSearchParams({ maxResults:'250', minAccessRole:'writer' })
      if (page) query.set('pageToken', page)
      const body = await this.request('/users/me/calendarList?' + query)
      if (!Array.isArray(body.items)) throw new GoogleError(502,'google_unavailable',null,true)
      for (const row of body.items as Json[]) if (['writer','owner'].includes(String(row.accessRole))) { const item=choice(row); calendars.set(item.id,item) }
      page = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined
      if (page && visited.has(page)) throw new GoogleError(502,'google_unavailable',null,true)
      if (page) visited.add(page)
    } while (page)
    return [...calendars.values()]
  }
  async getCalendar(id: string): Promise<CalendarChoice> { return choice(await this.request('/users/me/calendarList/' + segment(id))) }
  async getAccountId(): Promise<string> { return (await this.getCalendar('primary')).id }
  async getEvent(calendarId: string, eventId: string): Promise<GoogleEvent | null> {
    try { return eventResult(await this.request('/calendars/' + segment(calendarId) + '/events/' + segment(eventId))) }
    catch (error) {
      if (error instanceof GoogleError && [404,410].includes(error.status)) {
        await this.getCalendar(calendarId)
        if (error.status === 404) return null
        throw new GoogleError(410,'event_deleted')
      }
      throw error
    }
  }
  async insertEvent(calendarId: string, eventId: string, event: ManagedEvent): Promise<GoogleEvent> {
    return eventResult(await this.request('/calendars/' + segment(calendarId) + '/events?sendUpdates=none', {
      method:'POST', body:JSON.stringify({ ...event, id:eventId, reminders:{useDefault:true} }),
    }))
  }
  async patchEvent(calendarId: string, eventId: string, event: ManagedEvent, etag: string, current?: GoogleEvent): Promise<GoogleEvent> {
    if (!etag) throw new GoogleError(412,'precondition_failed')
    const body = { ...event, extendedProperties:{private:{ ...current?.extendedProperties?.private, ...event.extendedProperties.private }} }
    return eventResult(await this.request('/calendars/' + segment(calendarId) + '/events/' + segment(eventId) + '?sendUpdates=none', {
      method:'PATCH', headers:{'If-Match':etag}, body:JSON.stringify(body),
    }))
  }
  async deleteEvent(calendarId: string, eventId: string, etag: string): Promise<void> {
    if (!etag) throw new GoogleError(412,'precondition_failed')
    try {
      await this.request('/calendars/' + segment(calendarId) + '/events/' + segment(eventId) + '?sendUpdates=none', {method:'DELETE',headers:{'If-Match':etag}})
    } catch (error) {
      if (error instanceof GoogleError && [404,410].includes(error.status)) { await this.getCalendar(calendarId); return }
      throw error
    }
  }
}
async function tokenRequest(parameters: URLSearchParams): Promise<OAuthTokenResult> {
  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')
  if (!clientId || !secret) throw new GoogleError(503,'configuration_required')
  parameters.set('client_id', clientId); parameters.set('client_secret',secret)
  const {response,body} = await http(fetch,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:parameters.toString()})
  if (!response.ok) {
    if (body.error === 'invalid_grant' || [400,401].includes(response.status)) throw new GoogleError(401,'reconnect_required')
    throw providerError(response,body,Date.now())
  }
  if (typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86400) throw new GoogleError(401,'reconnect_required')
  return {accessToken:body.access_token,refreshToken:typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    expiresAt:new Date(Date.now()+body.expires_in*1000).toISOString(),scopes:typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : []}
}
export async function exchangeOAuthCode(code: string): Promise<OAuthTokenResult> {
  const redirect = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')
  if (!redirect) throw new GoogleError(503,'configuration_required')
  const result = await tokenRequest(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect}))
  if (!result.refreshToken || !CALENDAR_SCOPES.every(scope=>result.scopes.includes(scope))) throw new GoogleError(401,'reconnect_required')
  return result
}
export function refreshOAuthToken(refreshToken: string): Promise<OAuthTokenResult> {
  return tokenRequest(new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}))
}
export async function revokeOAuthToken(token: string): Promise<void> {
  const { response,body } = await http(fetch,'https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString()})
  if (!response.ok) throw providerError(response,body,Date.now())
}
