import type { AdminStatus, ManageRequest } from '../_shared/google-calendar-contract.ts'
import { calendarRuntime, requireCalendarAdmin, requireCalendarUser, createOAuthState, buildAuthorizationUrl, dashboardOrigin } from '../_shared/google-calendar-auth.ts'
import { runCalendarSync } from '../_shared/google-calendar-worker.ts'
import { GoogleCalendarClient, GoogleError, revokeOAuthToken } from '../_shared/google-calendar-client.ts'
import { CalendarStoreError, getCredential } from '../_shared/google-calendar-store.ts'
import { jsonResponse, preflightResponse, isTrustedOrigin, readJsonBody, RequestError } from '../_shared/http.ts'
function adminResponse(req: Request, status: AdminStatus): Response {
  const configured = ['GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_CLIENT_SECRET','GOOGLE_CALENDAR_REDIRECT_URI','GOOGLE_CALENDAR_DASHBOARD_ORIGIN','GOOGLE_CALENDAR_CRON_SECRET']
    .every(name => Boolean(Deno.env.get(name)?.trim()))
  return jsonResponse(req,{...status,configured})
}
function parseRequest(value: unknown): ManageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400,'invalid_request')
  const v = value as Record<string,unknown>, action = v.action
  if (typeof action !== 'string' || !['status','start_oauth','list_calendars','activate','disconnect','retry','sync'].includes(action)) throw new RequestError(400,'invalid_request')
  const allowed = action === 'activate' ? ['action','calendarId'] : action === 'retry' ? ['action','callId'] : ['action']
  if (Object.keys(v).some(key=>!allowed.includes(key))) throw new RequestError(400,'invalid_request')
  if (action === 'activate' && (typeof v.calendarId !== 'string' || !v.calendarId.trim() || v.calendarId.length>1024 || v.calendarId==='primary')) throw new RequestError(400,'select_calendar_id')
  if (action === 'retry' && v.callId !== undefined && (typeof v.callId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.callId))) throw new RequestError(400,'invalid_request')
  return v as ManageRequest
}
export async function handleManage(req: Request): Promise<Response> {
  const preflight = preflightResponse(req); if (preflight) return preflight
  if (!isTrustedOrigin(req)) return jsonResponse(req,{error:'untrusted_origin'},403)
  if (req.method !== 'POST') return jsonResponse(req,{error:'method_not_allowed'},405)
  try {
    const request = parseRequest(await readJsonBody(req))
    const {userId} = await (request.action==='sync'?requireCalendarUser(req):requireCalendarAdmin(req))
    const {store} = calendarRuntime()
    switch(request.action) {
      case 'sync': {
        if(!await store.requestRefresh(userId))return jsonResponse(req,{processed:0,pending:true})
        const client=new GoogleCalendarClient({deadlineAt:Date.now()+45_000,tokenProvider:force=>getCredential(store,force)})
        return jsonResponse(req,await runCalendarSync('reconcile',{store,client,now:Date.now,random:Math.random}))
      }
      case 'status': return adminResponse(req,await store.adminStatus(userId))
      case 'retry': return adminResponse(req,await store.retry(userId,request.callId))
      case 'start_oauth': {
        const state = await createOAuthState(), authorizationUrl = buildAuthorizationUrl(state.raw)
        await store.startOAuth(userId,state.hash,dashboardOrigin())
        return jsonResponse(req,{authorizationUrl})
      }
      case 'disconnect': {
        const lease = await store.claimCredential()
        if (!lease) throw new CalendarStoreError('conflict')
        try {
          const credential = await store.readCredential(lease.token)
          const result = await store.disconnect(userId,lease.token)
          try { if (credential.refreshToken || credential.accessToken) await revokeOAuthToken(credential.refreshToken ?? credential.accessToken!) } catch { /* DB pause is already durable; revoked/expired tokens can fail here. */ }
          return adminResponse(req,result)
        } finally { await store.releaseCredential(lease.token) }
      }
      case 'list_calendars': {
        const client = new GoogleCalendarClient({tokenProvider:force=>getCredential(store,force)})
        return jsonResponse(req,{calendars:await client.listWritableCalendars()})
      }
      case 'activate': {
        const credential = await getCredential(store)
        const client = new GoogleCalendarClient({tokenProvider:force=>getCredential(store,force)})
        const calendar = await client.getCalendar(request.calendarId)
        return adminResponse(req,await store.activate(userId,calendar,credential.revision))
      }
    }
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse(req,{error:error.message},error.status)
    if (error instanceof CalendarStoreError) return jsonResponse(req,{error:error.code},error.code==='forbidden'?403:error.code==='conflict'?409:error.code==='invalid_request'?400:503)
    if (error instanceof GoogleError) return jsonResponse(req,{error:error.code},error.code==='reconnect_required'?409:error.code==='calendar_access'?403:error.retryable?503:400)
    return jsonResponse(req,{error:'calendar_unavailable'},503)
  }
}
Deno.serve(handleManage)
