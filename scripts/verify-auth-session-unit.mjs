// Regras que mantêm o login de pé: onde ele é guardado e como a renovação resiste a erro do servidor. Sem rede e sem navegador.
import assert from 'node:assert/strict'
import { adoptTabSession, pickAuthStorage } from '../src/lib/auth-storage.ts'
import { TOKEN_REFRESH_RETRY_DELAYS_MS, isTokenRefreshRequest, withTokenRefreshRetry } from '../src/lib/auth-resilient-fetch.ts'

const makeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: key => void data.delete(key),
    size: () => data.size,
  }
}
const blocked = {
  getItem() { throw new DOMException('blocked', 'SecurityError') },
  setItem() { throw new DOMException('blocked', 'SecurityError') },
  removeItem() { throw new DOMException('blocked', 'SecurityError') },
}
const KEY = 'sb-test-auth-token'

// ---- Onde o login fica: localStorage, e a aba só quando o navegador não deixa gravar.
{
  const local = makeStorage(), tab = makeStorage()
  assert.equal(pickAuthStorage({ localStorage: local, sessionStorage: tab }), local, 'o login vive no localStorage')
  assert.equal(local.size(), 0, 'a sondagem não deixa lixo')
  assert.equal(pickAuthStorage({ localStorage: blocked, sessionStorage: tab }), tab, 'sem localStorage, vale a aba')
}

// ---- Quem já estava logado na aba antes da mudança continua logado.
{
  const local = makeStorage(), tab = makeStorage({ [KEY]: 'sessao-da-aba' })
  adoptTabSession(KEY, local, tab)
  assert.equal(local.getItem(KEY), 'sessao-da-aba', 'o login da aba é levado para o armazenamento compartilhado')
  assert.equal(tab.getItem(KEY), null, 'nenhuma segunda cópia do refresh token fica na aba')
}
{
  const local = makeStorage({ [KEY]: 'sessao-em-uso' }), tab = makeStorage({ [KEY]: 'copia-velha' })
  adoptTabSession(KEY, local, tab)
  assert.equal(local.getItem(KEY), 'sessao-em-uso', 'o login já compartilhado (em uso) vence a cópia da aba')
  assert.equal(tab.getItem(KEY), null)
}
{
  const local = makeStorage(), tab = makeStorage()
  adoptTabSession(KEY, local, tab)
  assert.equal(local.size() + tab.size(), 0, 'sem login na aba, nada acontece')
  const same = makeStorage({ [KEY]: 'x' })
  adoptTabSession(KEY, same, same)
  assert.equal(same.getItem(KEY), 'x', 'no modo de contingência (mesmo armazenamento) nada é apagado')
  assert.doesNotThrow(() => adoptTabSession(KEY, local, blocked), 'armazenamento bloqueado não derruba o app')
}

// ---- Só a renovação do login é reconhecida.
const base = 'https://projeto.supabase.co/auth/v1'
assert.equal(isTokenRefreshRequest(`${base}/token?grant_type=refresh_token`), true)
assert.equal(isTokenRefreshRequest(new URL(`${base}/token?grant_type=refresh_token`)), true)
assert.equal(isTokenRefreshRequest(new Request(`${base}/token?grant_type=refresh_token`)), true)
assert.equal(isTokenRefreshRequest(`${base}/token?foo=1&grant_type=refresh_token`), true)
assert.equal(isTokenRefreshRequest(`${base}/token?grant_type=password`), false, 'o login com senha não é repetido sozinho')
assert.equal(isTokenRefreshRequest(`${base}/user`), false)
assert.equal(isTokenRefreshRequest('https://projeto.supabase.co/rest/v1/crm_leads?select=*'), false)

// ---- Erro do servidor na renovação é tentado de novo antes da biblioteca apagar o login.
const respond = status => new Response(status === 204 ? null : '{}', { status })
const scripted = outcomes => {
  const calls = [], sleeps = []
  const fetchImpl = async (input, init) => {
    calls.push(input)
    const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)]
    if (outcome instanceof Error) throw outcome
    return respond(outcome)
  }
  return { calls, sleeps, wrapped: withTokenRefreshRetry(fetchImpl, async ms => { sleeps.push(ms) }) }
}
const refreshUrl = `${base}/token?grant_type=refresh_token`
{
  const t = scripted([500, 500, 200])
  assert.equal((await t.wrapped(refreshUrl, { method: 'POST' })).status, 200, '500 duas vezes e depois 200: o login é renovado')
  assert.equal(t.calls.length, 3)
  assert.deepEqual(t.sleeps, TOKEN_REFRESH_RETRY_DELAYS_MS.slice(0, 2), 'espera crescente entre as tentativas')
}
{
  const t = scripted([500])
  assert.equal((await t.wrapped(refreshUrl)).status, 503, 'erro 500 persistente chega como "indisponível": a biblioteca mantém o login')
  assert.equal(t.calls.length, TOKEN_REFRESH_RETRY_DELAYS_MS.length + 1)
  assert.deepEqual(t.sleeps, TOKEN_REFRESH_RETRY_DELAYS_MS)
}
for (const status of [502, 503, 504]) {
  const t = scripted([status])
  assert.equal((await t.wrapped(refreshUrl)).status, status, `${status} já é tratado como temporário pela biblioteca e segue como veio`)
  assert.equal(t.calls.length, TOKEN_REFRESH_RETRY_DELAYS_MS.length + 1)
}
{
  const t = scripted([new TypeError('Failed to fetch'), 200])
  assert.equal((await t.wrapped(refreshUrl)).status, 200, 'queda de conexão também é tentada de novo')
  assert.equal(t.calls.length, 2)
}
{
  const failure = new TypeError('Failed to fetch')
  const t = scripted([failure])
  await assert.rejects(() => t.wrapped(refreshUrl), failure, 'sem rede de verdade, o erro chega à biblioteca (que preserva o login)')
  assert.equal(t.calls.length, TOKEN_REFRESH_RETRY_DELAYS_MS.length + 1)
}
for (const status of [400, 401, 403, 429]) {
  const t = scripted([status])
  assert.equal((await t.wrapped(refreshUrl)).status, status, `${status} é resposta definitiva (sessão revogada ou limite), sem repetir`)
  assert.equal(t.calls.length, 1)
  assert.deepEqual(t.sleeps, [])
}
{
  const t = scripted([500])
  assert.equal((await t.wrapped('https://projeto.supabase.co/rest/v1/crm_leads')).status, 500, 'outras chamadas passam direto')
  assert.equal(t.calls.length, 1)
  const aborted = new DOMException('aborted', 'AbortError')
  const t2 = scripted([aborted])
  await assert.rejects(() => t2.wrapped(refreshUrl, { signal: AbortSignal.abort() }), aborted)
  assert.equal(t2.calls.length, 1, 'chamada cancelada não é repetida')
}
assert.ok(TOKEN_REFRESH_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) < 10_000, 'todas as tentativas cabem na janela de reuso do refresh token (10 s)')

console.log('PASS: login guardado no armazenamento compartilhado (com contingência e migração da aba), renovação com novas tentativas só para erro do servidor ou da rede, respostas definitivas sem repetição.')
