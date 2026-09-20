import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:8080'
const expect = baseExpect.configure({ timeout: 20_000 })
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce110000-0000-4000-8000-000000000099'
const now = new Date().toISOString()
const profile = { id: actor, user_id: actor, display_name: 'QA Períodos', avatar_url: null, suspended: false, created_at: now, updated_at: now, last_seen_at: now }
const role = { id: actor, user_id: actor, role: 'seller', crm_access: false, commission_rate: 10, can_view_sales: false, updated_at: now }
const dashboardSalesRequests = []
const errors = []

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const selectedFields = url.searchParams.get('select') || ''
  if (resource === 'vendas' && selectedFields.includes('nome_produto') && selectedFields.includes('valor_venda')) {
    dashboardSalesRequests.push(url)
  }

  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [role]
  else if (resource === 'get_team_ranking') data = []
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 }, fetched_at: now }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'periods@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'QA Períodos' }, created_at: new Date().toISOString() },
  }
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(origin)
  await expect(page.getByRole('tab', { name: 'Tempo personalizado', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Todo o período', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Tempo personalizado', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Selecionar tempo personalizado' })).toBeVisible()
  await page.getByLabel('Data inicial').fill('2026-08-01')
  await page.getByLabel('Data final').fill('2026-08-15')

  dashboardSalesRequests.length = 0
  await page.getByRole('button', { name: 'Aplicar período', exact: true }).click()
  await expect(page.getByText(/Período aplicado: 01\/08\/2026 a 15\/08\/2026/)).toBeVisible()
  await expect.poll(() => dashboardSalesRequests.some(url => {
    const filters = url.searchParams.getAll('created_at')
    return filters.includes('gte.2026-08-01T03:00:00.000Z') && filters.includes('lt.2026-08-16T03:00:00.000Z')
  })).toBe(true)

  dashboardSalesRequests.length = 0
  await page.getByRole('tab', { name: 'Todo o período', exact: true }).click()
  await expect.poll(() => dashboardSalesRequests.some(url => !url.searchParams.has('created_at'))).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('tab', { name: 'Tempo personalizado', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Tempo personalizado', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Selecionar tempo personalizado' })).toBeVisible()
  await page.screenshot({ path: '.verification.local/dashboard-periods-mobile.png', fullPage: true })

  assert.deepEqual(errors, [])
  console.log('PASS: custom inclusive dates and all-time commercial indicators work in desktop and mobile layouts.')
} finally {
  await context.close()
  await browser.close()
}
