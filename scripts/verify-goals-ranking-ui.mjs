import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15_000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce220000-0000-4000-8000-000000000098'
const now = new Date()
const earlier = new Date(now.getTime() - 60_000).toISOString()
const later = new Date(now.getTime() + 3_600_000).toISOString()
const profile = { id: actor, user_id: actor, display_name: 'Closer de teste', avatar_url: null, suspended: false, created_at: earlier, updated_at: earlier }
const role = { id: actor, user_id: actor, role: 'closer', crm_access: true, commission_rate: 0, can_view_sales: true, updated_at: earlier }
const member = { user_id: actor, display_name: profile.display_name, avatar_url: null, suspended: false, actual: 50, target: 100, state: 'on_track' }
const result = { actual: 50, target: 100, state: 'on_track', members: [member] }
const goals = [
  { id: '10000000-0000-4000-8000-000000000001', goal_id: '10000000-0000-4000-8000-000000000011', title: 'Meta coletiva de teste', period: 'daily', scope: 'role', role: 'closer', metric: 'score', starts_at: earlier, ends_at: later, show_countdown: true, result },
  { id: '10000000-0000-4000-8000-000000000002', goal_id: '10000000-0000-4000-8000-000000000012', title: 'Meta individual de teste', period: 'daily', scope: 'user', role: 'closer', metric: 'score', starts_at: earlier, ends_at: later, show_countdown: true, result },
]
const metrics = { revenue: 0, sales: 0, ticket: null, conversion: null, cpl: null, appointments: 0, approaches: 0, spend: null, leads: null }
const dashboard = { server_time: now.toISOString(), revision: 1, metrics, previous: metrics, series: [], cycles: goals, feed: [], sdrs: [], closers: [], ticket_reference: 2997 }
const errors = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
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
  else if (resource === 'arena_visible_goals') data = goals
  else if (resource === 'arena_dashboard') data = dashboard
  else if (resource === 'arena_revision') data = 1
  else if (resource === 'arena_live_cursor') data = now.toISOString()
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'goals@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Closer de teste' }, created_at: new Date().toISOString() },
  }
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`${origin}/metas?tab=atribuicoes`)
  await expect(page.getByRole('heading', { name: 'Metas em andamento' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta coletiva de teste' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta individual de teste' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tarefas operacionais' })).toBeVisible()
  await expect(page.getByText('Atribuir tarefa')).toHaveCount(0)
  await page.goto(`${origin}/arena`)
  await expect(page.getByRole('heading', { name: 'Meta coletiva de teste' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta individual de teste · Closer de teste' })).toBeVisible()
  assert.deepEqual(errors, [])
  console.log('PASS: collective and assigned goals render in Minhas tarefas and Arena without executive assignment controls.')
} finally {
  await context.close()
  await browser.close()
}
