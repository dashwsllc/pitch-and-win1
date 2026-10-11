import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function loadModule(path, { fetch = () => { throw Error('Unexpected HTTP') }, admin, env = {}, imports = {} } = {}) {
  let handler
  const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder,
    crypto, fetch, AbortController, setTimeout, clearTimeout, btoa, atob,
    console: { error() {}, log() {} }, __admin: admin, __imports: imports,
    Deno: { env: { get: key => env[key] }, serve: value => { handler = value } } })
  const cache = new Map()
  async function moduleFor(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const source = filename.startsWith('https:')
      ? 'export function createClient() { return globalThis.__admin }'
      : ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      } }).outputText
    const module = new vm.SourceTextModule(source, { context, identifier: filename })
    cache.set(filename, module)
    await module.link((specifier, parent) => moduleFor(specifier.startsWith('https:') ? specifier : resolve(dirname(parent.identifier), specifier)))
    return module
  }
  const module = await moduleFor(resolve(root, path))
  await module.evaluate()
  return { exports: module.namespace, handler }
}

const projectionPath = 'supabase/functions/_shared/google-calendar-projection.ts'
export const input = () => ({
  call: { id: '10000000-0000-4000-8000-000000000001', leadId: '20000000-0000-4000-8000-000000000001',
    callType: 'fechamento_closer', scheduledAt: '2026-10-12T02:50:00Z', assignedTo: 'closer1',
    isCompleted: false, cancelledAt: null, outcome: null, description: 'NOTA_INTERNA' },
  lead: { id: '20000000-0000-4000-8000-000000000001', name: 'Lead Teste', pipelineStage: 'repassado_closer' },
  closerName: 'Maria', projectId: 'test-project', dashboardOrigin: 'https://crm.example',
  binding: { id: '30000000-0000-4000-8000-000000000001', callId: '10000000-0000-4000-8000-000000000001',
    leadId: '20000000-0000-4000-8000-000000000001', calendarId: 'shared@example',
    eventId: '6e90a88cc9174071b2bf7fd789600cff', generation: 0, revision: '1', confirmedRevision: null, confirmedHash: null, etag: null },
})

test('projection: explicit lifecycle priority keeps completed results after the lead moves', async () => {
  const { exports: p } = await loadModule(projectionPath)
  const x = input()
  assert.equal(p.projectCall(x).kind, 'upsert')
  x.call.isCompleted = true; x.lead.pipelineStage = 'fechado_ganho'; x.call.outcome = 'venda_concluida'
  assert.equal(p.projectCall(x).kind, 'completed')
  assert.match(p.projectCall(x).event.description, /Venda concluída/)
  for (const outcome of ['devolvido_sdr', 'followup_sdr']) { x.call.outcome = outcome; assert.equal(p.projectCall(x).kind, 'remove') }
  x.call.outcome = 'venda_concluida'; x.call.cancelledAt = '2026-10-11T12:00:00Z'
  assert.equal(p.projectCall(x).kind, 'remove')
  x.call = null; assert.equal(p.projectCall(x).kind, 'remove')
  const y = input(); y.lead = null; assert.equal(p.projectCall(y).kind, 'remove')
  const z = input(); z.lead.pipelineStage = 'pronto_closer'; assert.equal(p.projectCall(z).kind, 'remove')
})

test('projection: absolute timestamps cross midnight identically in any host timezone and omit private notes', async () => {
  const { exports: p } = await loadModule(projectionPath)
  const x = input(), e = p.projectCall(x).event
  assert.equal(e.start.dateTime, '2026-10-12T02:50:00.000Z')
  assert.equal(e.end.dateTime, '2026-10-12T03:20:00.000Z')
  assert.equal(e.start.timeZone, 'America/Sao_Paulo')
  assert.equal(e.summary, 'Call de fechamento — Lead Teste | Maria')
  assert.match(e.description, /\/crm\?tab=closer&lead=20000000-0000-4000-8000-000000000001/)
  assert.ok(!JSON.stringify(e).includes('NOTA_INTERNA'))
  x.call.assignedTo = null; assert.equal(p.projectCall(x).kind, 'blocked')
  x.call.assignedTo = 'closer1'
  for (const date of ['2026-10-12T02:50:00', 'bad-date', '2026-99-01T00:00:00Z']) {
    x.call.scheduledAt = date; assert.equal(p.projectCall(x).kind, 'blocked')
  }
})

test('projection: stable distinct event identities and normalized hashes preserve external fields', async () => {
  const { exports: p } = await loadModule(projectionPath)
  assert.equal(p.googleEventId('6e90a88c-c917-4071-b2bf-7fd789600cff'), '6e90a88cc9174071b2bf7fd789600cff')
  assert.notEqual(p.googleEventId(input().call.id), p.googleEventId(input().lead.id))
  const e = p.projectCall(input()).event, copy = JSON.parse(JSON.stringify(e))
  copy.extendedProperties.private.revision = '99'; copy.attendees = [{ email: 'manual@example' }]
  assert.equal(await p.managedEventHash(e), await p.managedEventHash(copy))
  assert.equal(p.eventMatches({ ...copy, id: 'event', etag: 'v2' }, e), true)
  copy.extendedProperties.private.project_id = 'other-project'
  assert.equal(p.eventMatches(copy, e), false)
  assert.notEqual(await p.managedEventHash(copy), await p.managedEventHash(e))
})

test('store: decimal revisions survive RPC translation and failures never expose token-bearing SQL messages', async () => {
  let request
  const admin = { rpc: async (name, args) => { request = {name,args}; return {data: input(),error:null} } }
  const { exports: { CalendarStore } } = await loadModule('supabase/functions/_shared/google-calendar-store.ts', {admin})
  const store = new CalendarStore(admin, 'project', 'https://crm.example')
  await store.ack(input().binding.id,'lease','9007199254740993','hash','etag',false)
  assert.equal(request.args.p_revision,'9007199254740993')
  const snapshot = await store.snapshot(input().binding.id,'lease')
  assert.equal(snapshot.projectId,'project')
  admin.rpc = async () => ({data:null,error:{code:'PT409',message:'SECRET_ACCESS_TOKEN'}})
  await assert.rejects(store.adminStatus('actor'), e => e.code==='conflict' && !String(e).includes('SECRET_ACCESS_TOKEN'))
})

const clientPath = 'supabase/functions/_shared/google-calendar-client.ts'
const credential = () => ({accountId:'admin@example.invalid',accessToken:'TOKEN_SENTINELA',refreshToken:'REFRESH_SENTINELA',expiresAt:'2030-01-01T00:00:00Z',scopes:['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],revision:'1'})
const response = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers})
test('client: pages writable calendars, refreshes once and preserves manual event fields with ETags', async () => {
  const calls=[]; let refresh=0
  const {exports:{GoogleCalendarClient}}=await loadModule(clientPath)
  const client=new GoogleCalendarClient({tokenProvider:async force=>{if(force)refresh++;return credential()},fetchImpl:async(url,options)=>{
    calls.push({url:new URL(url),headers:new Headers(options.headers),body:options.body&&JSON.parse(options.body),method:options.method})
    if(calls.length===1)return response({},401)
    const u=new URL(url)
    if(u.pathname.endsWith('/calendarList')) return response(u.searchParams.has('pageToken')?{items:[{id:'last',summary:'Last',accessRole:'owner'}]}:{items:Array.from({length:502},(_,i)=>({id:String(i),summary:String(i),accessRole:'writer'})).concat({id:'reader',accessRole:'reader'}),nextPageToken:'page2'})
    return options.method==='DELETE'?new Response(null,{status:204}):response({id:'event',etag:'v2'})
  }})
  assert.equal((await client.listWritableCalendars()).length,503);assert.equal(refresh,1)
  const e=(await loadModule(projectionPath)).exports.projectCall(input()).event
  await client.patchEvent('calendar/1','event',e,'v1',{extendedProperties:{private:{manual:'keep'},shared:{other:'keep'}}})
  const patch=calls.at(-1)
  assert.equal(patch.headers.get('If-Match'),'v1');assert.equal(patch.url.searchParams.get('sendUpdates'),'none')
  assert.equal(patch.body.extendedProperties.private.manual,'keep')
  assert.ok(!('attendees' in patch.body));assert.ok(!('reminders' in patch.body));assert.ok(!('shared' in patch.body.extendedProperties))
  await client.deleteEvent('calendar/1','event','v2');assert.equal(calls.at(-1).headers.get('If-Match'),'v2')
})
test('client: error classification sanitizes bodies; missing events require current writable-calendar proof', async () => {
  const {exports:{GoogleCalendarClient}}=await loadModule(clientPath)
  for(const [status,reason,code,retryable] of [[403,'rateLimitExceeded','rate_limit',true],[403,'forbidden','calendar_access',false],[409,'','conflict',false],[410,'','event_deleted',false],[412,'','precondition_failed',false],[500,'','google_unavailable',true],[400,'','invalid_payload',false]]) {
    const c=new GoogleCalendarClient({tokenProvider:async()=>credential(),fetchImpl:async()=>response({error:{message:'TOKEN_SENTINELA',errors:[{reason}]}},status,{'Retry-After':'120'})})
    await assert.rejects(c.insertEvent('calendar','event',{}),e=>e.code===code&&e.retryable===retryable&&e.retryAfterMs===120000&&!String(e).includes('TOKEN_SENTINELA'))
  }
  let proof=0
  const c=new GoogleCalendarClient({tokenProvider:async()=>credential(),fetchImpl:async u=>{if(new URL(u).pathname.includes('calendarList/')){proof++;return response({},404)}return response({},404)}})
  await assert.rejects(c.getEvent('calendar','event'),e=>e.code==='calendar_access');assert.equal(proof,1)
  const d=new GoogleCalendarClient({tokenProvider:async()=>credential(),fetchImpl:async u=>new URL(u).pathname.includes('calendarList/')?response({id:'calendar',summary:'QA',accessRole:'writer'}):response({},404)})
  assert.equal(await d.getEvent('calendar','event'),null)
})
test('credentials: concurrent refresh is serialized, old refresh survives omitted token; invalid grants pause by revision', async () => {
  const {exports:{getCredential}}=await loadModule('supabase/functions/_shared/google-calendar-store.ts')
  let held=false,saved=credential(),refreshes=0; saved.expiresAt='2000-01-01T00:00:00Z'
  const store={claimCredential:async()=>{if(held)return null;held=true;return{token:'lease',revision:saved.revision}},readCredential:async()=>({...saved}),saveCredential:async(_t,_r,c)=>{saved={...c,revision:'2'};return true},releaseCredential:async()=>{held=false},setConnectionError:async()=>{}}
  const refresh=async()=>{refreshes++;await new Promise(r=>setTimeout(r,15));return{accessToken:'new',refreshToken:null,expiresAt:'2030-01-01T00:00:00Z',scopes:saved.scopes}}
  const cs=await Promise.all([getCredential(store,false,{refresh}),getCredential(store,false,{refresh})])
  assert.equal(refreshes,1);assert.equal(cs[1].refreshToken,'REFRESH_SENTINELA')
  let paused
  store.setConnectionError=async(r,code)=>{paused={r,code}}
  await assert.rejects(getCredential(store,true,{refresh:async()=>{throw Object.assign(Error('reconnect_required'),{code:'reconnect_required'})}}))
  assert.equal(paused.r,'2');assert.equal(paused.code,'reconnect_required')
})
test('credentials: OAuth rejects missing refresh and incomplete scope grants without raw provider errors', async()=>{
  const env={GOOGLE_CALENDAR_CLIENT_ID:'client',GOOGLE_CALENDAR_CLIENT_SECRET:'secret',GOOGLE_CALENDAR_REDIRECT_URI:'https://edge.example/callback'}
  const {exports:{exchangeOAuthCode}}=await loadModule(clientPath,{env,fetch:async()=>response({access_token:'TOKEN_SENTINELA',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.events'})})
  await assert.rejects(exchangeOAuthCode('code'),e=>e.code==='reconnect_required'&&!String(e).includes('TOKEN_SENTINELA'))
})
