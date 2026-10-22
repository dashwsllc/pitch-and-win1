// Acesso aberto do Meet das calls (quem tem o link entra sem pedir para entrar): cliente da API do Meet, worker, OAuth, callback e ligações.
// Reaproveita o harness de verify-google-calendar-sync.mjs (módulos TypeScript reais em vm, sem rede, sem banco).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadModule, workerFixture } from './verify-google-calendar-sync.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = 'supabase/functions/_shared/google-calendar-client.ts'
const workerPath = 'supabase/functions/_shared/google-calendar-worker.ts'
const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings'
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
const credential = (scopes = CALENDAR_SCOPES) => ({ accountId: 'admin@example.invalid', accessToken: 'TOKEN_SENTINELA', refreshToken: 'REFRESH_SENTINELA', expiresAt: '2030-01-01T00:00:00Z', scopes: [...scopes], revision: '1' })
const meetCredential = () => credential([...CALENDAR_SCOPES, MEET_SCOPE])
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })
const MEET_URL = 'https://meet.google.com/abc-defg-hij'
const BEFORE_CALL = () => Date.parse('2026-10-12T01:00:00Z')   // a call do harness começa às 02:50Z de 12/10
const withMeetScope = f => { f.tokenScopes = [...CALENDAR_SCOPES, MEET_SCOPE] }
const meetClient = async (fetchImpl, tokenProvider = async () => meetCredential()) => {
  const { exports: { GoogleCalendarClient } } = await loadModule(clientPath)
  return new GoogleCalendarClient({ tokenProvider, fetchImpl })
}
const space = (access, name = 'spaces/S1') => response({ name, config: { accessType: access } })

test('cliente: lê pelo código (apelido), altera pelo ID do espaço e não escreve quando já está aberto', async () => {
  const calls = []; let access = 'RESTRICTED'
  const client = await meetClient(async (url, options) => {
    const u = new URL(url), method = options.method ?? 'GET'
    calls.push({ url: u, method, auth: new Headers(options.headers).get('Authorization'), body: options.body && JSON.parse(options.body) })
    if (method === 'GET') return response({ name: 'spaces/ID-REAL-123', meetingCode: 'abc-defg-hij', config: { accessType: access } })
    access = JSON.parse(options.body).config.accessType; return response({ name: 'spaces/ID-REAL-123', config: { accessType: access } })
  })
  assert.equal(await client.openMeetAccess(MEET_URL), 'opened'); assert.equal(calls.length, 2)
  assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].url.origin + calls[0].url.pathname, 'https://meet.googleapis.com/v2/spaces/abc-defg-hij')
  assert.equal(calls[1].method, 'PATCH'); assert.equal(calls[1].url.origin + calls[1].url.pathname, 'https://meet.googleapis.com/v2/spaces/ID-REAL-123')
  assert.equal(calls[1].url.searchParams.get('updateMask'), 'config.accessType'); assert.deepEqual(calls[1].body, { config: { accessType: 'OPEN' } })
  assert.ok(calls.every(c => c.auth === 'Bearer TOKEN_SENTINELA'))
  calls.length = 0
  assert.equal(await client.openMeetAccess(MEET_URL), 'already_open'); assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET', 'já aberta: só lê, não escreve')
})

test('cliente: sem o escopo ou com link inválido nem chama a API; resposta estranha nunca vira sucesso', async () => {
  let requests = 0
  const noScope = await meetClient(async () => { requests++; return response({}) }, async () => credential())
  await assert.rejects(noScope.openMeetAccess(MEET_URL), e => e.code === 'meet_scope_missing' && e.retryable === false)
  const withScope = await meetClient(async () => { requests++; return response({}) })
  for (const bad of ['https://meet.google.com/abc-defg-hi', 'https://meet.google.com/abc-defg-hij/x', 'http://meet.google.com/abc-defg-hij', 'https://evil.example/abc-defg-hij', 'abc-defg-hij', '', 'https://meet.google.com/ABC-defg-hij'])
    await assert.rejects(withScope.openMeetAccess(bad), e => e.code === 'meet_error', bad)
  assert.equal(requests, 0)
  for (const name of [undefined, '', 'spaces/', 'spaces/a/b', 'outro/ID', 42]) {
    const odd = await meetClient(async () => response({ name, config: { accessType: 'RESTRICTED' } }))
    await assert.rejects(odd.openMeetAccess(MEET_URL), e => e.code === 'google_unavailable' && e.retryable === true, String(name))
  }
  const ignored = await meetClient(async () => space('RESTRICTED', 'spaces/S'))
  await assert.rejects(ignored.openMeetAccess(MEET_URL), e => e.code === 'meet_not_applied', 'o Google respondeu 200 mas não abriu: não conta como aberto')
})

test('cliente: erros do Meet nunca viram calendar_access (que pausaria a conexão) e não vazam o corpo do provedor', async () => {
  const cases = [
    [403, { error: { message: 'Google Meet API has not been used in project 1 before or it is disabled. TOKEN_SENTINELA', details: [{ reason: 'SERVICE_DISABLED' }] } }, 'meet_api_disabled', false],
    [403, { error: { message: 'Meet API has not been used in project 1 before or it is disabled.' } }, 'meet_api_disabled', false],
    [403, { error: { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 'meet_scope_missing', false],
    [403, { error: { message: 'The caller does not have permission TOKEN_SENTINELA' } }, 'meet_not_permitted', false],
    [404, { error: { message: 'Requested entity was not found.' } }, 'meet_not_found', false],
    [429, { error: {} }, 'rate_limit', true], [403, { error: { details: [{ reason: 'RATE_LIMIT_EXCEEDED' }] } }, 'rate_limit', true],
    [500, {}, 'google_unavailable', true], [503, {}, 'google_unavailable', true],
    [400, { error: { message: 'TOKEN_SENTINELA' } }, 'meet_not_allowed', false], [401, {}, 'meet_error', false],
  ]
  for (const [status, body, code, retryable] of cases) {
    const client = await meetClient(async () => response(body, status, { 'Retry-After': '120' }))
    await assert.rejects(client.openMeetAccess(MEET_URL), e => e.code === code && e.retryable === retryable && !String(e).includes('TOKEN_SENTINELA') && e.code !== 'calendar_access' && e.code !== 'reconnect_required' && (!retryable || e.retryAfterMs === 120000), `${status} ${code}`)
  }
  const onPatch = await meetClient(async (_u, o) => (o.method ?? 'GET') === 'GET' ? space('RESTRICTED', 'spaces/S') : response({ error: { message: 'x' } }, 403))
  await assert.rejects(onPatch.openMeetAccess(MEET_URL), e => e.code === 'meet_not_permitted', 'mesmo erro na escrita')
  let refreshes = 0, first = true
  const retry = await meetClient(async (_u, o) => { if (first) { first = false; return response({}, 401) } return (o.method ?? 'GET') === 'GET' ? space('OPEN', 'spaces/S') : response({}) },
    async force => { if (force) refreshes++; return meetCredential() })
  assert.equal(await retry.openMeetAccess(MEET_URL), 'already_open'); assert.equal(refreshes, 1, '401 renova o token uma vez, como o resto da integração')
})

test('cliente: o código da reunião só sai de um link do Meet válido', async () => {
  const { exports: c } = await loadModule(clientPath)
  assert.equal(c.meetingCodeOf('https://meet.google.com/abc-defg-hij'), 'abc-defg-hij')
  for (const bad of ['https://meet.google.com/abc-defg-hij?authuser=1', 'https://meet.google.com/lookup/abc', 'meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij ', null]) assert.equal(c.meetingCodeOf(bad), null, String(bad))
})

test('worker: abre o acesso da call futura, só lê quando já está aberto, reabre se alguém fechar, e o evento fica sincronizado', async () => {
  const f = await workerFixture(); f.deps.now = BEFORE_CALL; withMeetScope(f)
  const seen = []; let access = 'TRUSTED'
  f.meetHandler = (url, method, o) => { seen.push(method + ' ' + url.pathname); if (method === 'PATCH') access = JSON.parse(o.body).config.accessType; return space(access) }
  f.deps.meet = f.worker.meetAccessDeps(f.deps.client, f.deps.store)
  await f.deliver(); assert.ok(f.synced); assert.equal(f.events.size, 1); assert.equal(f.writes.filter(w => w.method === 'POST').length, 1)
  assert.deepEqual(seen, ['GET /v2/spaces/abc-defg-hij', 'PATCH /v2/spaces/S1']); assert.deepEqual(f.meetStates, ['open'])
  seen.length = 0; f.edit(x => { x.closerName = 'Ana' }); await f.deliver()
  assert.ok(f.synced); assert.deepEqual(seen, ['GET /v2/spaces/abc-defg-hij'], 'a varredura reenvia a call: já aberta, só lê')
  access = 'RESTRICTED'; seen.length = 0; f.edit(() => {}); await f.deliver()
  assert.deepEqual(seen, ['GET /v2/spaces/abc-defg-hij', 'PATCH /v2/spaces/S1']); assert.ok(f.synced)
})

test('worker: call que já passou, call concluída e worker sem Meet não chamam a API', async () => {
  let calls = 0
  const past = await workerFixture(); withMeetScope(past); past.meetHandler = () => { calls++; return response({}) }
  past.deps.meet = past.worker.meetAccessDeps(past.deps.client, past.deps.store)
  await past.deliver(); assert.ok(past.synced); assert.equal(calls, 0, 'reunião de ontem não precisa mais disso'); assert.deepEqual(past.meetStates, [])
  const near = await workerFixture(); near.deps.now = () => Date.parse('2026-10-12T03:30:00Z'); withMeetScope(near)
  near.meetHandler = () => { calls++; return space('OPEN') }; near.deps.meet = near.worker.meetAccessDeps(near.deps.client, near.deps.store)
  await near.deliver(); assert.equal(calls, 1, 'até uma hora depois do início ainda vale (call que atrasou)')
  const done = await workerFixture(); done.deps.now = BEFORE_CALL; withMeetScope(done)
  done.edit(x => { x.call.isCompleted = true; x.call.outcome = 'venda_concluida'; x.lead.pipelineStage = 'fechado_ganho' })
  done.meetHandler = () => { calls++; return response({}) }; done.deps.meet = done.worker.meetAccessDeps(done.deps.client, done.deps.store)
  const before = calls; await done.deliver(); assert.ok(done.synced); assert.equal(calls, before, 'call concluída não reabre o acesso (1º envio: passa pelo patch do evento)')
  done.edit(() => {}); await done.deliver(); assert.ok(done.synced); assert.equal(calls, before, 'nem na reentrega (evento já igual ao desejado)')
  const plain = await workerFixture(); plain.deps.now = BEFORE_CALL; plain.meetHandler = () => { calls++; return response({}) }
  await plain.deliver(); assert.ok(plain.synced); assert.equal(calls, before, 'sem as dependências do Meet o worker só sincroniza o evento')
})

test('worker: erro de configuração nunca impede o evento de sincronizar nem pausa a conexão; só vira aviso na tela', async () => {
  const granted = [...CALENDAR_SCOPES, MEET_SCOPE]
  for (const [name, scopes, reply, expected] of [
    ['sem o escopo', null, null, 'scope_missing'],
    ['API desligada', granted, [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }], 'api_disabled'],
    ['Google recusou', granted, [403, { error: { message: 'permission' } }], 'not_permitted'],
    ['pedido recusado', granted, [400, {}], 'not_permitted'],
  ]) {
    const f = await workerFixture(); f.deps.now = BEFORE_CALL; if (scopes) f.tokenScopes = scopes
    let meetCalls = 0; f.meetHandler = () => { meetCalls++; return response(reply[1], reply[0]) }
    f.deps.meet = f.worker.meetAccessDeps(f.deps.client, f.deps.store)
    await f.deliver(); assert.ok(f.synced, name); assert.equal(f.paused, false, name + ': a conexão do Google Agenda não pausa'); assert.equal(f.errors.length, 0, name)
    assert.deepEqual(f.meetStates, [expected], name); assert.equal(meetCalls, scopes ? 1 : 0, name)
  }
})

test('worker: falha momentânea repete o job sem duplicar o evento e, depois de 4 tentativas, confirma mesmo assim', async () => {
  const f = await workerFixture(); f.deps.now = BEFORE_CALL; withMeetScope(f)
  let mode = 'down'; f.meetHandler = (_u, method, o) => mode === 'down' ? response({ error: {} }, 503) : space(method === 'PATCH' ? JSON.parse(o.body).config.accessType : 'RESTRICTED')
  f.deps.meet = f.worker.meetAccessDeps(f.deps.client, f.deps.store)
  await f.deliver(); assert.equal(f.synced, false); assert.equal(f.errors.at(-1).code, 'meet_unavailable'); assert.ok(f.errors.at(-1).retryAt, 'tenta de novo depois')
  assert.equal(f.events.size, 1); assert.equal(f.writes.filter(w => w.method === 'POST').length, 1)
  mode = 'up'; await f.deliver(); assert.ok(f.synced); assert.equal(f.events.size, 1); assert.equal(f.writes.filter(w => w.method === 'POST').length, 1, 'o evento não é criado de novo'); assert.deepEqual(f.meetStates, ['open'])
  const g = await workerFixture(); g.deps.now = BEFORE_CALL; withMeetScope(g)
  g.meetHandler = () => response({ error: {} }, 503); g.deps.meet = g.worker.meetAccessDeps(g.deps.client, g.deps.store)
  for (const n of [1, 2, 3]) { await g.deliver(); assert.equal(g.synced, false, 'tentativa ' + n); assert.equal(g.errors.at(-1).code, 'meet_unavailable') }
  await g.deliver(); assert.ok(g.synced, 'a 4ª tentativa confirma o evento'); assert.deepEqual(g.meetStates, ['error']); assert.equal(g.errors.length, 3)
  const h = await workerFixture(); h.deps.now = BEFORE_CALL; withMeetScope(h); let found = false
  h.meetHandler = () => found ? space('OPEN') : response({ error: {} }, 404); h.deps.meet = h.worker.meetAccessDeps(h.deps.client, h.deps.store)
  await h.deliver(); assert.equal(h.synced, false, 'o espaço do Meet pode demorar a existir'); assert.equal(h.errors.at(-1).code, 'meet_unavailable')
  found = true; await h.deliver(); assert.ok(h.synced); assert.deepEqual(h.meetStates, ['open'])
  const i = await workerFixture(); i.deps.now = BEFORE_CALL; withMeetScope(i)
  i.meetHandler = () => { throw Error('connection reset') }; i.deps.meet = i.worker.meetAccessDeps(i.deps.client, i.deps.store)
  await i.deliver(); assert.equal(i.synced, false, 'erro de rede também é momentâneo'); assert.equal(i.errors.at(-1).code, 'meet_unavailable')
})

test('worker: falha ao gravar o resultado é só informativa; erro inesperado do Meet não é engolido', async () => {
  const f = await workerFixture(); f.deps.now = BEFORE_CALL; withMeetScope(f)
  f.meetHandler = () => space('OPEN'); f.deps.store.setMeetAccess = async () => { throw Error('banco fora') }
  f.deps.meet = f.worker.meetAccessDeps(f.deps.client, f.deps.store); await f.deliver(); assert.ok(f.synced)
  const g = await workerFixture(); g.deps.now = BEFORE_CALL
  g.deps.meet = { open: async () => { throw new TypeError('bug inesperado') }, record: async () => {} }
  await g.deliver(); assert.equal(g.synced, false, 'um bug não passa por sucesso'); assert.equal(g.errors.at(-1).code, 'storage_unavailable'); assert.ok(g.errors.at(-1).retryAt)
})

test('worker: o resultado só é gravado quando muda dentro da mesma execução', async () => {
  const { exports: w } = await loadModule(workerPath), states = []
  const deps = w.meetAccessDeps({ openMeetAccess: async () => 'opened' }, { setMeetAccess: async s => { states.push(s) } })
  for (const state of ['open', 'open', 'error', 'error', 'open']) await deps.record(state)
  assert.deepEqual(states, ['open', 'error', 'open'])
  let fail = true; const again = w.meetAccessDeps({}, { setMeetAccess: async s => { if (fail) throw Error('x'); states.push('again-' + s) } })
  await assert.rejects(again.record('open')); fail = false; await again.record('open'); assert.equal(states.at(-1), 'again-open', 'se não gravou, tenta de novo')
})

test('banco: o resultado vai por uma função própria, sem tocar em credenciais', async () => {
  const requests = [], admin = { rpc: async (name, args) => { requests.push({ name, args }); return { data: null, error: null } } }
  const { exports: { CalendarStore } } = await loadModule('supabase/functions/_shared/google-calendar-store.ts', { admin })
  await new CalendarStore(admin, 'project', 'https://crm.example').setMeetAccess('scope_missing')
  assert.equal(JSON.stringify(requests), JSON.stringify([{ name: 'google_calendar_set_meet_access', args: { p_state: 'scope_missing' } }]))   // JSON: o argumento nasce em outro contexto do vm
})

const runtimeEnv = { SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_SENTINELA', GOOGLE_CALENDAR_DASHBOARD_ORIGIN: 'https://www.wsltda.com', GOOGLE_CALENDAR_CLIENT_ID: 'client', GOOGLE_CALENDAR_CLIENT_SECRET: 'SECRET_SENTINELA', GOOGLE_CALENDAR_REDIRECT_URI: 'https://edge.example/callback', GOOGLE_CALENDAR_CRON_SECRET: 'cron-secret-test' }
function fakeAdmin() {
  const states = new Map(); let writes = 0
  const status = { configured: true, connection: 'connected', calendar: { id: 'shared', name: 'agenda - closers', accessRole: 'writer', timeZone: 'America/Sao_Paulo' }, destinationLocked: true, activatedAt: null, lastRunAt: null, pendingCount: 0, errorCount: 0, backfillPending: false, errorCode: null }
  return { states, get writes() { return writes },
    auth: { getUser: async token => token === 'user' ? { data: { user: { id: 'actor' } }, error: null } : { data: { user: null }, error: {} } },
    rpc: async (name, args) => {
      if (name === 'google_calendar_admin_status') return { data: status, error: null }
      if (name === 'google_calendar_oauth_start') { states.set(args.p_state_hash, { stateId: 'state-id', actorId: 'actor', origin: 'https://www.wsltda.com' }); return { data: { stateId: 'state-id' }, error: null } }
      if (name === 'google_calendar_oauth_consume') { const s = states.get(args.p_state_hash); states.delete(args.p_state_hash); return s ? { data: s, error: null } : { data: null, error: { code: '22023' } } }
      if (name === 'google_calendar_credential_claim') return { data: { token: 'lease', revision: '1' }, error: null }
      if (name === 'google_calendar_credential_read') return { data: credential(), error: null }
      if (name === 'google_calendar_credential_release') return { data: null, error: null }
      if (name === 'google_calendar_credential_save') { writes++; return { data: true, error: null } }
      throw Error('Unexpected RPC ' + name)
    } }
}

test('OAuth: o pedido de autorização inclui a permissão do Meet; a conexão continua valendo sem ela', async () => {
  const admin = fakeAdmin(), { handler } = await loadModule('supabase/functions/google-calendar-manage/index.ts', { admin, env: runtimeEnv })
  const r = await handler(new Request('https://edge.example/manage', { method: 'POST', headers: { authorization: 'Bearer user', origin: 'https://www.wsltda.com', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start_oauth' }) }))
  assert.equal(r.status, 200)
  assert.deepEqual(new URL((await r.json()).authorizationUrl).searchParams.get('scope').split(' '), [...CALENDAR_SCOPES, MEET_SCOPE])
  const { exports: c } = await loadModule('supabase/functions/_shared/google-calendar-contract.ts')
  assert.ok(!c.CALENDAR_SCOPES.includes(MEET_SCOPE), 'a agenda não exige o Meet para existir'); assert.equal(c.MEET_SETTINGS_SCOPE, MEET_SCOPE)
  const env = { GOOGLE_CALENDAR_CLIENT_ID: 'client', GOOGLE_CALENDAR_CLIENT_SECRET: 'secret', GOOGLE_CALENDAR_REDIRECT_URI: 'https://edge.example/callback' }
  for (const granted of [CALENDAR_SCOPES, [...CALENDAR_SCOPES, MEET_SCOPE]]) {
    const { exports: { exchangeOAuthCode } } = await loadModule(clientPath, { env, fetch: async () => response({ access_token: 'T', refresh_token: 'R', expires_in: 3600, scope: granted.join(' ') }) })
    assert.deepEqual([...(await exchangeOAuthCode('code')).scopes], granted)
  }
  const { exports: { getCredential } } = await loadModule('supabase/functions/_shared/google-calendar-store.ts')
  let saved = credential(); saved.expiresAt = '2000-01-01T00:00:00Z'
  const store = { claimCredential: async () => ({ token: 'lease', revision: '1' }), readCredential: async () => ({ ...saved }), saveCredential: async (_t, _r, cr) => { saved = cr; return true }, releaseCredential: async () => {}, setConnectionError: async () => { throw Error('não deve pausar') } }
  const refreshed = await getCredential(store, false, { refresh: async () => ({ accessToken: 'n', refreshToken: null, expiresAt: '2030-01-01T00:00:00Z', scopes: CALENDAR_SCOPES }) })
  assert.equal(refreshed.accessToken, 'n', 'credencial sem a permissão do Meet continua válida para a agenda')
})

test('callback: depois de reconectar o estado parte do que o Google concedeu de verdade, e falha ao gravar não derruba a conexão', async () => {
  for (const [granted, expected, rpcFails] of [[true, 'unknown', false], [false, 'scope_missing', false], [true, 'unknown', true]]) {
    const admin = fakeAdmin(), recorded = [], base = admin.rpc
    admin.rpc = async (name, args) => name === 'google_calendar_set_meet_access' ? (recorded.push(args.p_state), rpcFails ? { data: null, error: { code: 'XX000', message: 'TOKEN_SENTINELA' } } : { data: null, error: null }) : base(name, args)
    const { exports: a } = await loadModule('supabase/functions/_shared/google-calendar-auth.ts', { admin, env: runtimeEnv })
    const s = await a.createOAuthState(); admin.states.set(s.hash, { stateId: 'state', actorId: 'actor', origin: 'https://www.wsltda.com' })
    const scopes = [...CALENDAR_SCOPES, ...(granted ? [MEET_SCOPE] : [])]
    const { handler } = await loadModule('supabase/functions/google-calendar-oauth-callback/index.ts', { admin, env: runtimeEnv, fetch: async u => {
      if (String(u).includes('/token')) return response({ access_token: 'TOKEN_SENTINELA', refresh_token: 'FRESH_SENTINELA', expires_in: 3600, scope: scopes.join(' ') })
      if (String(u).endsWith('/primary')) return response({ id: 'admin@example.invalid', accessRole: 'owner' })
      return response({ id: 'shared', accessRole: 'writer' })
    } })
    const r = await handler(new Request('https://edge.example/callback?state=' + s.raw + '&code=CODE_SENTINELA'))
    assert.match(r.headers.get('Location'), /google_calendar=connected/); assert.equal(admin.writes, 1); assert.deepEqual(recorded, [expected]); assert.ok(!r.headers.get('Location').includes('SENTINELA'))
  }
})

test('ligações: o cron e a atualização manual passam o e-mail do closer E o acesso aberto; o e-mail do closer vem do login', async () => {
  const read = file => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n')
  for (const file of ['supabase/functions/google-calendar-sync/index.ts', 'supabase/functions/google-calendar-manage/index.ts']) {
    const code = read(file)
    assert.match(code, /closerEmail:closerEmailOf\(db\)/, file + ': sem o e-mail o convite do closer sairia do evento'); assert.match(code, /meet:meetAccessDeps\(client,store\)/, file)
  }
  const users = { ok: { data: { user: { email: 'ana@gmail.com' } }, error: null }, none: { data: { user: {} }, error: null }, gone: { data: null, error: { status: 404 } }, down: { data: null, error: { status: 500, message: 'x' } } }
  const { exports: a } = await loadModule('supabase/functions/_shared/google-calendar-auth.ts', { admin: {}, env: runtimeEnv })
  const email = a.closerEmailOf({ auth: { admin: { getUserById: async id => users[id] } } })
  assert.equal(await email('ok'), 'ana@gmail.com'); assert.equal(await email('none'), null); assert.equal(await email('gone'), null)
  await assert.rejects(email('down'), 'falha momentânea tenta de novo em vez de apagar o convite')
})
