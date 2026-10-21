import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createHmac } from 'node:crypto'
import {
  backoffSeconds, BACKOFF_SECONDS, CRM_RECEIVER_URL, deliverContextEvents, handleDeliveryRequest, signContextBody,
} from './crm-context-delivery.ts'

const SECRET = 'segredo-somente-de-teste'
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const KNOWN = {
  timestamp: '1760000000',
  body: '{"schema_version":1,"kind":"athlete_context","answers":[{"question":"Posição","answer":"Atacante é ágil"}]}',
  signature: 'sha256=f2626600bdc7686f40dd8eb2a17d29f702f821fc9b30a68632a1b6728b9df2de',
}

type Row = { event_id: string; source_lead_id: string; source_revision: number; payload: unknown; claim_token: string; attempts: number }
const row = (n: number, attempts = 1, payload: unknown = { schema_version: 1, kind: 'athlete_context', event_id: ID(n) }): Row =>
  ({ event_id: ID(n), source_lead_id: ID(500 + n), source_revision: 1, payload, claim_token: ID(900 + n), attempts })

function fakeAdmin(rows: Row[], ackError = false) {
  const calls: Array<[string, Record<string, unknown>]> = []
  return {
    calls,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push([name, args])
      if (name === 'crm_context_claim') return Promise.resolve({ data: rows, error: null })
      if (name === 'crm_context_ack' && ackError) return Promise.resolve({ data: null, error: { message: 'x' } })
      return Promise.resolve({ data: null, error: null })
    },
  }
}
const named = (admin: ReturnType<typeof fakeAdmin>, name: string) => admin.calls.filter(([n]) => n === name).map(([, a]) => a)

// Receptor de mentira que aplica as regras do contrato A.1 com HMAC calculado de forma independente (node:crypto).
function receiver(secret: string, respond: (event: Record<string, unknown>) => Response, nowSeconds = () => Date.now() / 1000) {
  const seen: Array<{ headers: Headers; raw: string; verified: boolean }> = []
  const handler = async (_url: string | URL | Request, init?: RequestInit) => {
    const raw = String(init?.body ?? '')
    const headers = new Headers(init?.headers)
    const ts = headers.get('x-crm-timestamp') ?? '', sig = headers.get('x-crm-signature') ?? ''
    const expected = 'sha256=' + createHmac('sha256', secret).update(ts + '.' + raw, 'utf8').digest('hex')
    const verified = /^\d{10,12}$/.test(ts) && /^sha256=[0-9a-f]{64}$/.test(sig) && Math.abs(nowSeconds() - Number(ts)) <= 300 && sig === expected
    seen.push({ headers, raw, verified })
    if (!verified) return new Response('Forbidden', { status: 403 })
    return respond(JSON.parse(raw))
  }
  return { handler: handler as typeof fetch, seen }
}
const okReceipt = (status = 'applied') => (event: Record<string, unknown>) =>
  Response.json({ ok: true, receipt_id: ID(7000), event_id: event.event_id, status })
const base = { receiverUrl: CRM_RECEIVER_URL, sharedSecret: SECRET, deadlineMs: 45000 }

Deno.test('assinatura confere com o vetor conhecido (HMAC-SHA256 de "timestamp.corpo")', async () => {
  assertEquals(await signContextBody(KNOWN.body, KNOWN.timestamp, SECRET), KNOWN.signature)
  assertEquals(await signContextBody(KNOWN.body + ' ', KNOWN.timestamp, SECRET) === KNOWN.signature, false)
  assertEquals(await signContextBody(KNOWN.body, '1760000001', SECRET) === KNOWN.signature, false)
})

Deno.test('assinatura usa os bytes UTF-8 exatos do corpo (acentos, emoji)', async () => {
  const body = '{"a":"ação ⚽ 日本"}'
  const expected = 'sha256=' + createHmac('sha256', SECRET).update('1760000000.' + body, 'utf8').digest('hex')
  assertEquals(await signContextBody(body, '1760000000', SECRET), expected)
})

Deno.test('entrega: cabecalhos, corpo exato assinado, ack com o recibo e sem reserializar', async () => {
  const payload = { schema_version: 1, kind: 'athlete_context', event_id: ID(1), answers: [{ question: 'Posição', answer: 'Atacante é ágil' }] }
  const r = receiver(SECRET, okReceipt('applied'))
  const admin = fakeAdmin([row(1, 1, payload)])
  const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: r.handler })
  assertEquals(result, { claimed: 1, delivered: 1, retryable: 0, blocked: 0 })
  assertEquals(r.seen.length, 1)
  assertEquals(r.seen[0].verified, true)
  assertEquals(r.seen[0].raw, JSON.stringify(payload))
  assertEquals(r.seen[0].headers.get('content-type'), 'application/json')
  assertEquals(named(admin, 'crm_context_claim')[0], { p_limit: 20, p_lease_seconds: 60, p_event_id: null })
  const ack = named(admin, 'crm_context_ack')[0]
  assertEquals([ack.p_event, ack.p_claim], [ID(1), ID(901)])
  assertEquals((ack.p_receipt as Record<string, unknown>).status, 'applied')
  assertEquals(named(admin, 'crm_context_fail').length, 0)
})

Deno.test('os cinco estados de recibo do contrato sao aceitos', async () => {
  for (const status of ['applied', 'waiting_member', 'superseded', 'duplicate', 'quarantined']) {
    const admin = fakeAdmin([row(2)])
    const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: receiver(SECRET, okReceipt(status)).handler })
    assertEquals(result.delivered, 1, status)
    assertEquals((named(admin, 'crm_context_ack')[0].p_receipt as Record<string, unknown>).status, status)
  }
})

Deno.test('replay fora da janela de 300 s e recusado pelo receptor e bloqueia (nao ha repeticao automatica)', async () => {
  const stale = receiver(SECRET, okReceipt(), () => Date.now() / 1000 + 400)
  const admin = fakeAdmin([row(3)])
  const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: stale.handler })
  assertEquals(result, { claimed: 1, delivered: 0, retryable: 0, blocked: 1 })
  const fail = named(admin, 'crm_context_fail')[0]
  assertEquals([fail.p_code, fail.p_permanent], ['http_403', true])
  assertEquals(named(admin, 'crm_context_ack').length, 0)
})

Deno.test('corpo adulterado no caminho invalida a assinatura (403, bloqueia)', async () => {
  const inner = receiver(SECRET, okReceipt())
  const tamper = ((url: string | URL | Request, init?: RequestInit) =>
    inner.handler(url, { ...init, body: String(init?.body).replace('athlete_context', 'athlete_contexT') })) as typeof fetch
  const admin = fakeAdmin([row(4)])
  const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: tamper })
  assertEquals(result.blocked, 1)
  assertEquals(named(admin, 'crm_context_fail')[0].p_code, 'http_403')
})

Deno.test('segredo errado no emissor e recusado (403)', async () => {
  const admin = fakeAdmin([row(5)])
  const result = await deliverContextEvents(admin as never, { ...base, sharedSecret: 'outro-segredo', fetchImpl: receiver(SECRET, okReceipt()).handler })
  assertEquals(result.blocked, 1)
})

Deno.test('classificacao de status: 400/413/409 bloqueiam; 429/5xx/rede repetem com o mesmo corpo', async () => {
  const cases: Array<[number, string, boolean]> = [
    [400, 'http_400', true], [413, 'body_limit', true], [409, 'identity_conflict', true], [403, 'http_403', true],
    [429, 'http_429', false], [500, 'http_500', false], [502, 'http_502', false], [503, 'http_503', false],
  ]
  for (const [status, code, permanent] of cases) {
    const admin = fakeAdmin([row(6, 1)])
    const result = await deliverContextEvents(admin as never, {
      ...base, fetchImpl: receiver(SECRET, () => new Response('x', { status })).handler })
    const fail = named(admin, 'crm_context_fail')[0]
    assertEquals([fail.p_code, fail.p_permanent], [code, permanent], String(status))
    assertEquals(result.blocked, permanent ? 1 : 0)
    assertEquals(result.retryable, permanent ? 0 : 1)
    assertEquals(named(admin, 'crm_context_ack').length, 0)
  }
})

Deno.test('rede e tempo esgotado repetem (network_error / network_timeout)', async () => {
  const boom = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch
  const slow = (() => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch
  for (const [impl, code] of [[boom, 'network_error'], [slow, 'network_timeout']] as const) {
    const admin = fakeAdmin([row(7)])
    const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: impl })
    assertEquals(result.retryable, 1)
    const fail = named(admin, 'crm_context_fail')[0]
    assertEquals([fail.p_code, fail.p_permanent], [code, false])
  }
})

Deno.test('recuo: 1 min, 5 min, 30 min, 2 h, 6 h (e fica em 6 h)', async () => {
  assertEquals(BACKOFF_SECONDS, [60, 300, 1800, 7200, 21600])
  assertEquals([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds), [60, 300, 1800, 7200, 21600, 21600, 21600])
  for (const attempts of [1, 2, 3, 4, 5, 8]) {
    const before = Date.now()
    const admin = fakeAdmin([row(8, attempts)])
    await deliverContextEvents(admin as never, { ...base, fetchImpl: receiver(SECRET, () => new Response('x', { status: 503 })).handler })
    const at = Date.parse(String(named(admin, 'crm_context_fail')[0].p_retry_at))
    const expected = backoffSeconds(attempts) * 1000
    assert(at - before >= expected - 50 && at - before <= expected + 5000, `tentativa ${attempts}`)
  }
})

Deno.test('recibo invalido (evento diferente, estado desconhecido, sem JSON, ok falso) bloqueia', async () => {
  const bad: Array<() => Response> = [
    () => Response.json({ ok: true, receipt_id: ID(7000), event_id: ID(999), status: 'applied' }),
    () => Response.json({ ok: true, receipt_id: ID(7000), event_id: ID(9), status: 'bogus' }),
    () => Response.json({ ok: true, receipt_id: 'nao-e-uuid', event_id: ID(9), status: 'applied' }),
    () => Response.json({ ok: false, receipt_id: ID(7000), event_id: ID(9), status: 'applied' }),
    () => new Response('<html>', { status: 200 }),
  ]
  for (const make of bad) {
    const admin = fakeAdmin([row(9)])
    const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: receiver(SECRET, make).handler })
    assertEquals(result.blocked, 1)
    assertEquals(named(admin, 'crm_context_fail')[0].p_code, 'invalid_receipt')
    assertEquals(named(admin, 'crm_context_ack').length, 0)
  }
})

Deno.test('segredo ausente ou URL diferente da combinada: nao envia e repete depois (configuration)', async () => {
  for (const options of [{ sharedSecret: '' }, { receiverUrl: 'https://example.invalid/x' }]) {
    let called = 0
    const admin = fakeAdmin([row(10)])
    const result = await deliverContextEvents(admin as never, { ...base, ...options, fetchImpl: (() => { called++; return Promise.resolve(new Response('')) }) as typeof fetch })
    assertEquals(called, 0)
    assertEquals(result.retryable, 1)
    const fail = named(admin, 'crm_context_fail')[0]
    assertEquals([fail.p_code, fail.p_permanent], ['configuration', false])
  }
})

Deno.test('corpo acima de 1 MiB nao e enviado (body_limit, bloqueia)', async () => {
  let called = 0
  const admin = fakeAdmin([row(11, 1, { blob: 'x'.repeat(1024 * 1024 + 10) })])
  const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: (() => { called++; return Promise.resolve(new Response('')) }) as typeof fetch })
  assertEquals(called, 0)
  assertEquals(result.blocked, 1)
  assertEquals(named(admin, 'crm_context_fail')[0].p_code, 'body_limit')
})

Deno.test('prazo: sem tempo suficiente deixa os claims duraveis (nada de fail nem envio)', async () => {
  let called = 0
  const admin = fakeAdmin([row(12), row(13)])
  const result = await deliverContextEvents(admin as never, { ...base, deadlineMs: 10000, fetchImpl: (() => { called++; return Promise.resolve(new Response('')) }) as typeof fetch })
  assertEquals(called, 0)
  assertEquals(result, { claimed: 2, delivered: 0, retryable: 0, blocked: 0 })
  assertEquals(named(admin, 'crm_context_fail').length, 0)
})

Deno.test('envio com redirect bloqueado e limite de 5 s por chamada', async () => {
  let init: RequestInit | undefined
  const admin = fakeAdmin([row(14)])
  await deliverContextEvents(admin as never, { ...base, fetchImpl: ((_u: unknown, i?: RequestInit) => { init = i; return Promise.resolve(okReceipt()({ event_id: ID(14) })) }) as typeof fetch })
  assertEquals(init?.redirect, 'error')
  assertEquals(init?.method, 'POST')
  assert(init?.signal instanceof AbortSignal)
})

Deno.test('so um evento: repassa event_id ao claim (ensaio sintetico)', async () => {
  const admin = fakeAdmin([row(15)])
  await deliverContextEvents(admin as never, { ...base, eventId: ID(15), fetchImpl: receiver(SECRET, okReceipt()).handler })
  assertEquals(named(admin, 'crm_context_claim')[0].p_event_id, ID(15))
})

Deno.test('falha do ack (banco) vira repeticao, nunca entrega marcada sem recibo gravado', async () => {
  const admin = fakeAdmin([row(16)], true)
  const result = await deliverContextEvents(admin as never, { ...base, fetchImpl: receiver(SECRET, okReceipt()).handler })
  assertEquals(result.delivered, 0)
  assertEquals(named(admin, 'crm_context_fail')[0].p_code, 'ack_unavailable')
})

Deno.test('claim indisponivel derruba a execucao (o cron tenta de novo)', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { message: 'x' } }) }
  let thrown = ''
  try { await deliverContextEvents(admin as never, { ...base }) } catch (e) { thrown = (e as Error).message }
  assertEquals(thrown, 'claim_unavailable')
})

Deno.test('endpoint: metodo, segredo do cron, configuracao e corpo', async () => {
  const mk = (cron: string | undefined, headers: Record<string, string> = {}, method = 'POST', body = '{}') => handleDeliveryRequest(
    new Request('https://x.invalid/', { method, headers, body: method === 'GET' ? undefined : body }),
    { cronSecret: cron, sharedSecret: SECRET, receiverUrl: CRM_RECEIVER_URL, createAdmin: () => fakeAdmin([]) as never })
  assertEquals((await mk('c'.repeat(32), {}, 'GET')).status, 405)
  assertEquals((await mk(undefined, { 'x-crm-cron-secret': 'a' })).status, 503)
  assertEquals((await mk('c'.repeat(32), { 'x-crm-cron-secret': 'errado' })).status, 403)
  assertEquals((await mk('c'.repeat(32), {})).status, 403)
  assertEquals((await mk('c'.repeat(32), { 'x-crm-cron-secret': 'c'.repeat(32) }, 'POST', '{"event_id":"nao-uuid"}')).status, 400)
  assertEquals((await mk('c'.repeat(32), { 'x-crm-cron-secret': 'c'.repeat(32) }, 'POST', 'lixo')).status, 400)
  const ok = await mk('c'.repeat(32), { 'x-crm-cron-secret': 'c'.repeat(32) })
  assertEquals([ok.status, await ok.json()], [200, { claimed: 0, delivered: 0, retryable: 0, blocked: 0 }])
})

Deno.test('endpoint: nunca devolve segredo nem corpo do evento na resposta de erro', async () => {
  const res = await handleDeliveryRequest(
    new Request('https://x.invalid/', { method: 'POST', headers: { 'x-crm-cron-secret': 'c'.repeat(32) }, body: '{}' }),
    { cronSecret: 'c'.repeat(32), sharedSecret: SECRET, receiverUrl: CRM_RECEIVER_URL,
      createAdmin: () => ({ rpc: () => Promise.resolve({ data: null, error: { message: SECRET } }) }) as never })
  const text = await res.text()
  assertEquals(res.status, 503)
  assert(!text.includes(SECRET))
})
