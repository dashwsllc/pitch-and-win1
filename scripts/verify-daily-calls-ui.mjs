import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 20_000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce220000-0000-4000-8000-000000000099'
const today = new Date().toISOString()
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const profile = { id: actor, user_id: actor, display_name: 'QA SDR', avatar_url: null, suspended: false, created_at: today, updated_at: today, last_seen_at: today }
const role = { id: actor, user_id: actor, role: 'sdr', crm_access: true, commission_rate: 0, can_view_sales: true, updated_at: today }
const errors = []

const callRanking = {
  day: todayKey,
  sdrCalls: 7,
  closerCalls: 4,
  ranking: [
    { user_id: 'sdr-1', name: 'SDR Colaborador', avatarUrl: null, sdrCalls: 4, closerCalls: 2, total: 6 },
    { user_id: actor, name: 'QA SDR', avatarUrl: null, sdrCalls: 3, closerCalls: 1, total: 4 },
  ],
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [role]
  else if (resource === 'get_daily_call_ranking') data = callRanking
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'calls@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'QA SDR' }, created_at: new Date().toISOString() },
  }
  localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(`${origin}/ranking`)
  const section = page.locator('section[aria-labelledby="daily-calls-title"]')
  await expect(section.getByRole('heading', { name: 'Calls marcadas hoje', exact: true })).toBeVisible()
  await expect(section.getByText('SDR Colaborador', { exact: true })).toBeVisible()
  await expect(section.getByText('Você', { exact: true })).toBeVisible()
  await expect(section.getByText('Calls de SDR (qualificação)', { exact: true })).toBeVisible()
  await expect(section.getByText('Calls para Closer (fechamento)', { exact: true })).toBeVisible()
  await expect(section.getByText('1 call marcada por contas administrativas fora do ranking.', { exact: true })).toBeVisible()
  const articles = section.locator('article')
  await expect(articles).toHaveCount(2)
  await expect(articles.first()).toContainText('SDR Colaborador')
  await section.scrollIntoViewIfNeeded()
  await section.screenshot({ path: '.verification.local/daily-calls-desktop.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(section.getByRole('heading', { name: 'Calls marcadas hoje', exact: true })).toBeVisible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await section.screenshot({ path: '.verification.local/daily-calls-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: daily call ranking, SDR/Closer totals, current-user highlight, outside-ranking note and mobile layout.')
} finally {
  await context.close()
  await browser.close()
}
