import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:8080'
const expect = baseExpect.configure({ timeout: 20_000 })
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce110000-0000-4000-8000-000000000099'
const now = new Date().toISOString()
const profile = { id: actor, user_id: actor, display_name: 'QA Relógio', avatar_url: null, suspended: false, created_at: now, updated_at: now, last_seen_at: now }
const role = { id: actor, user_id: actor, role: 'seller', crm_access: false, commission_rate: 10, can_view_sales: false, updated_at: now }
const errors = []

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', timezoneId: 'Asia/Tokyo' })
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
  else if (resource === 'get_team_ranking') data = []
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 }, fetched_at: now }
  else if (resource === 'daily_goal_tasks' || resource === 'vendas' || resource === 'abordagens') data = []
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'clock@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'QA Relógio' }, created_at: new Date().toISOString() },
  }
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
await page.clock.install()
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(origin)
  const clock = page.getByLabel('Horário de Brasília', { exact: true })
  await expect(clock).toBeVisible()
  await page.screenshot({ path: '.verification.local/live-sync-dashboard.png', fullPage: true })
  const first = await clock.textContent()
  await page.clock.runFor(1_100)
  await expect.poll(() => clock.textContent()).not.toBe(first)

  await page.evaluate(() => {
    window.__dashboardRefreshEvents = 0
    window.addEventListener('dashboard-data-changed', () => { window.__dashboardRefreshEvents++ })
    window.dispatchEvent(new Event('focus'))
  })
  await page.clock.runFor(200)
  await expect.poll(() => page.evaluate(() => window.__dashboardRefreshEvents)).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(clock).toBeVisible()
  await page.screenshot({ path: '.verification.local/live-sync-dashboard-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: the Brasília clock advances every second and returning to the app triggers one synchronized data refresh.')
} finally {
  await context.close()
  await browser.close()
}
