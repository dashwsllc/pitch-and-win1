import { calendarRuntime, dashboardOrigin, hashOAuthState, assertCalendarAdmin } from '../_shared/google-calendar-auth.ts'
import { GoogleCalendarClient, exchangeOAuthCode } from '../_shared/google-calendar-client.ts'
import { MEET_SETTINGS_SCOPE } from '../_shared/google-calendar-contract.ts'
import type { Credential } from '../_shared/google-calendar-store.ts'
import { CalendarStoreError } from '../_shared/google-calendar-store.ts'
import { RequestError } from '../_shared/http.ts'
function redirect(status: 'connected'|'denied'|'error'): Response {
  return new Response(null,{status:303,headers:{Location:dashboardOrigin()+'/configuracoes?google_calendar='+status,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
}
function failure(status: number): Response {
  return new Response('Não foi possível autorizar a agenda. Volte às configurações e tente novamente.',{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','Referrer-Policy':'no-referrer'}})
}
export async function handleOAuthCallback(req: Request): Promise<Response> {
  if (req.method !== 'GET') return failure(405)
  let state
  try {
    const url = new URL(req.url), raw = url.searchParams.get('state')
    if (!raw || !/^[a-f0-9]{64}$/.test(raw) || url.searchParams.getAll('state').length!==1) return failure(400)
    state = await calendarRuntime().store.consumeOAuth(await hashOAuthState(raw))
    if (state.origin !== dashboardOrigin()) return failure(400)
    await assertCalendarAdmin(state.actorId)
  } catch (error) { return failure(error instanceof RequestError && error.status===403 || error instanceof CalendarStoreError && error.code==='forbidden' ? 403 : 400) }
  const url = new URL(req.url)
  if (url.searchParams.has('error')) return redirect('denied')
  const code = url.searchParams.get('code')
  if (!code || code.length>4096 || url.searchParams.getAll('code').length!==1) return redirect('error')
  const {store} = calendarRuntime()
  let lease
  try {
    lease = await store.claimCredential()
    if (!lease) return redirect('error')
    const tokens = await exchangeOAuthCode(code)
    const credential: Credential = {...tokens,accountId:null,revision:lease.revision}
    const client = new GoogleCalendarClient({tokenProvider:async()=>credential})
    credential.accountId = await client.getAccountId()
    const current = await store.adminStatus(state.actorId)
    if (current.calendar) await client.getCalendar(current.calendar.id)
    if (!await store.saveCredential(lease.token,lease.revision,credential,state.actorId,state.stateId)) return redirect('error')
    // A permissão do Meet é opcional (o Google deixa desmarcar): o que ele concedeu de verdade define o ponto de partida do acesso aberto. Só informativo.
    try { await store.setMeetAccess(credential.scopes.includes(MEET_SETTINGS_SCOPE) ? 'unknown' : 'scope_missing') } catch { /* a conexão já foi salva */ }
    return redirect('connected')
  } catch { return redirect('error') }
  finally { if (lease) { try { await store.releaseCredential(lease.token) } catch { /* Lease expiry recovers a failed release. */ } } }
}
Deno.serve(handleOAuthCallback)
