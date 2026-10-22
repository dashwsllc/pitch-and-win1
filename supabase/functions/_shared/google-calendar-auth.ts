import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { AUTHORIZATION_SCOPES } from './google-calendar-contract.ts'
import { CalendarStore, CalendarStoreError } from './google-calendar-store.ts'
import { isTrustedOrigin, RequestError } from './http.ts'
export function dashboardOrigin(): string {
  const url = new URL(Deno.env.get('GOOGLE_CALENDAR_DASHBOARD_ORIGIN') ?? 'https://www.wsltda.com')
  if (url.href !== url.origin + '/' || url.username || url.password || !isTrustedOrigin(new Request(url.origin,{headers:{Origin:url.origin}}))) throw new RequestError(503,'configuration_required')
  return url.origin
}
export function calendarRuntime() {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new RequestError(503,'configuration_required')
  const db = createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}})
  return {db,store:new CalendarStore(db,new URL(url).hostname.split('.')[0],dashboardOrigin())}
}
/**
 * E-mail Google do closer (o mesmo do login no CRM), para convidá-lo ao evento. null = sem convite; erro = o job tenta de novo (não apaga um convite por falha momentânea).
 * Todo caminho que roda o worker precisa passar isto: sem ele o evento é projetado sem convidado e o convite do closer sairia.
 */
export function closerEmailOf(db: ReturnType<typeof calendarRuntime>['db']): (userId: string) => Promise<string | null> {
  return async userId => {
    const { data, error } = await db.auth.admin.getUserById(userId)
    if (error) { if (error.status === 404) return null; throw error }
    return data.user?.email ?? null
  }
}
export async function assertCalendarAdmin(userId: string): Promise<void> {
  try { await calendarRuntime().store.adminStatus(userId) }
  catch (error) {
    if (error instanceof CalendarStoreError && error.code === 'forbidden') throw new RequestError(403,'calendar_admin_required')
    throw error
  }
}
export async function requireCalendarAdmin(req: Request): Promise<{userId:string}> {
  const result=await requireCalendarUser(req)
  await assertCalendarAdmin(result.userId)
  return result
}
export async function requireCalendarUser(req:Request):Promise<{userId:string}>{
  const auth = req.headers.get('authorization')
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) throw new RequestError(401,'authentication_required')
  const {data,error} = await calendarRuntime().db.auth.getUser(auth.replace(/^Bearer\s+/i,''))
  if (error || !data.user) throw new RequestError(401,'authentication_required')
  return {userId:data.user.id}
}
export async function hashOAuthState(raw: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('')
}
export async function createOAuthState(): Promise<{raw:string;hash:string}> {
  const raw = [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')
  return {raw,hash:await hashOAuthState(raw)}
}
export function buildAuthorizationUrl(state: string): string {
  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID'), redirect = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')
  if (!clientId || !redirect) throw new RequestError(503,'configuration_required')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:AUTHORIZATION_SCOPES.join(' '),
    state,access_type:'offline',prompt:'consent',login_hint:'admvoxenai@gmail.com'}).toString()
  return url.href
}
export async function requireCalendarCron(req: Request): Promise<void> {
  const expected = Deno.env.get('GOOGLE_CALENDAR_CRON_SECRET'), received = req.headers.get('x-cron-secret')
  if (!expected || !received || received.length > 512) throw new RequestError(401,'cron_authentication_required')
  const a = await hashOAuthState(expected), b = await hashOAuthState(received)
  let difference = 0
  for (let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i)
  if (difference !== 0) throw new RequestError(401,'cron_authentication_required')
}
