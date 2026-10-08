// Browser contract for the login staying put: shared by every tab and kept after closing them, carried over from the old
// tab-only storage, "Sair" ends only this browser's session, and a server hiccup never looks like a logout.
// Supabase traffic is mocked; no live records are changed.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 25000 })
const origin = process.env.AUTH_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Use a local frontend')
const project = 'mbzwchnxtskysqplqiyy'
const storageKey = `sb-${project}-auth-token`
const actor = randomUUID()
const now = new Date().toISOString()
const FAR = 4102444800
const PAST = Math.floor(Date.now() / 1000) - 7200
const profile = { id: actor, user_id: actor, display_name: 'Conta Sessao', suspended: false, created_at: now, updated_at: now }
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const sessionFor = (refreshToken, expiresAt) => ({
  access_token: `${enc({ alg: 'HS256' })}.${enc({ sub: actor, role: 'authenticated', exp: expiresAt })}.qa`,
  token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: refreshToken,
  user: { id: actor, email: 'sessao@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {},
    user_metadata: { display_name: 'Conta Sessao' }, created_at: now },
})

// How the mocked auth server answers the next token renewals: the listed statuses first, then success.
let refreshPlan = []
const refreshCalls = []
const logoutCalls = []
const authError = (status, code) => ({ status, body: { code: status, error_code: code, msg: code, message: code } })

const browser = await chromium.launch({ headless: true })
const errors = []
async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      refreshCalls.push(route.request().postDataJSON()?.refresh_token)
      const planned = refreshPlan.length ? refreshPlan.shift() : 200
      if (planned === 200) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionFor('refresh-renovado', FAR)) })
      }
      const failure = planned === 400 ? authError(400, 'refresh_token_not_found') : authError(planned, 'unexpected_failure')
      return route.fulfill({ status: failure.status, contentType: 'application/json', body: JSON.stringify(failure.body) })
    }
    if (url.pathname === '/auth/v1/logout') {
      logoutCalls.push(url.search)
      return route.fulfill({ status: 204, body: '' })
    }
    const resource = url.pathname.split('/').at(-1)
    let data = []
    if (resource === 'get_my_registration_status') data = { status: 'approved' }
    else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
    else if (resource === 'user_roles') data = [{ id: actor, user_id: actor, role: 'executive', crm_access: true, commission_rate: 10 }]
    else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  return context
}
const open = async context => {
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  return page
}
const signedIn = page => expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible()
const loginScreen = page => expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible()
const storedSession = (page, where = 'localStorage') => page.evaluate(([area, key]) => window[area].getItem(key), [where, storageKey])
const seed = (page, session, where = 'localStorage') => page.evaluate(([area, key, value]) => window[area].setItem(key, value), [where, storageKey, JSON.stringify(session)])

try {
  // 1. A login made before this change (tab-only storage) is carried over instead of asking for the password again.
  const context = await newContext()
  let first = await open(context)
  await first.goto(`${origin}/auth`)
  await loginScreen(first)
  await seed(first, sessionFor('refresh-antigo', FAR), 'sessionStorage')
  await first.goto(`${origin}/crm`)
  await signedIn(first)
  assert.notEqual(await storedSession(first), null, 'o login passou para o armazenamento compartilhado')
  assert.equal(await storedSession(first, 'sessionStorage'), null, 'nenhuma cópia do refresh token fica na aba')

  // 2. Every other tab of the same browser is already signed in, and the login survives closing all of them.
  const second = await open(context)
  await second.goto(`${origin}/crm`)
  await signedIn(second)
  await first.close()
  await second.close()
  const third = await open(context)
  await third.goto(`${origin}/crm`)
  await signedIn(third)

  // 3. "Sair" ends only this browser's session (not the account's sessions on other devices) and signs out the other tabs here.
  const fourth = await open(context)
  await fourth.goto(`${origin}/crm`)
  await signedIn(fourth)
  logoutCalls.length = 0
  await third.getByRole('button', { name: 'SE', exact: true }).click()
  await third.getByRole('menuitem', { name: 'Sair' }).click()
  await loginScreen(third)
  await loginScreen(fourth)
  assert.equal(logoutCalls.length, 1)
  assert.match(logoutCalls[0], /scope=local/, 'o logout não pode encerrar a conta em todos os aparelhos')
  assert.equal(await storedSession(third), null)
  await context.close()

  // 4. A server error (HTTP 500) while renewing the login is retried instead of deleting the stored login.
  const renewing = await newContext()
  const page = await open(renewing)
  await page.goto(`${origin}/auth`)
  await seed(page, sessionFor('refresh-vencido', PAST))
  refreshCalls.length = 0
  refreshPlan = [500, 500]
  await page.goto(`${origin}/crm`)
  await signedIn(page)
  assert.equal(refreshCalls.length, 3, 'duas falhas do servidor e uma renovação bem-sucedida')
  assert.match(String(await storedSession(page)), /refresh-renovado/, 'o login renovado foi guardado')

  // 5. A server that keeps failing with HTTP 500 beyond the app's own retries still does not delete the login: the page waits
  //    and keeps renewing instead of showing the login screen.
  await page.addInitScript(() => {
    window.__sawLogin = false
    new MutationObserver(() => { if (document.body?.innerText.includes('Acesse sua conta')) window.__sawLogin = true })
      .observe(document, { subtree: true, childList: true, characterData: true })
  })
  await seed(page, sessionFor('refresh-vencido-2', PAST))
  refreshCalls.length = 0
  refreshPlan = [500, 500, 500, 500, 500, 500]
  await page.goto(`${origin}/crm`)
  await signedIn(page)
  assert.ok(refreshCalls.length >= 7, 'a renovação continuou tentando até o servidor se recuperar')
  assert.equal(await page.evaluate(() => window.__sawLogin), false, 'a tela de login nunca apareceu durante a instabilidade')
  assert.match(String(await storedSession(page)), /refresh-renovado/)

  // 6. A session the server really revoked does end at the login screen, promptly, and the dead login is removed.
  await seed(page, sessionFor('refresh-revogado', PAST))
  refreshPlan = [400]
  refreshCalls.length = 0
  await page.goto(`${origin}/crm`)
  await loginScreen(page)
  assert.equal(refreshCalls.length, 1, 'resposta definitiva não é repetida')
  assert.equal(await storedSession(page), null)
  await renewing.close()

  assert.deepEqual(errors, [])
  console.log('PASS: login shared by every tab and kept after closing them, old tab-only logins carried over, Sair ends only this browser, server errors while renewing never delete the login (even when they persist), revoked sessions still reach the login screen. Browser network mocked; no live data changed.')
} finally {
  await browser.close()
}
