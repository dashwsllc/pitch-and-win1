// Mocked-network UI check for two additions: the CRM "Importados" tab
// (scoped to crm_leads.lead_source === 'meta_ads_form') and the "Aprovar
// todas" bulk-approve button on /trafego. No real Supabase writes; every
// request is intercepted and fulfilled with fixture data.
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15_000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce220000-0000-4000-8000-000000000098'
const now = new Date()
const iso = (n) => new Date(now.getTime() - n * 60_000).toISOString()

const profile = { id: actor, user_id: actor, display_name: 'Executive de teste', avatar_url: null, suspended: false, created_at: iso(1000), updated_at: iso(1000) }
const role = { id: actor, user_id: actor, role: 'executive', crm_access: true, commission_rate: 0, can_view_sales: true, updated_at: iso(1000) }

const importedLead = {
  id: '30000000-0000-4000-8000-000000000001', name: 'Responsavel Importado', athlete_name: 'Atleta Importado',
  phone: '11999990000', email: 'importado@example.invalid', city_state: 'Sao Paulo/SP',
  pipeline_stage: 'novo', temperature: 'frio', approach_stage: 'nao_abordado', lead_source: 'meta_ads_form',
  sdr_id: null, closer_id: null, created_by: actor, created_at: iso(5), updated_at: iso(5), version: 1,
  observations: null, athlete_birth_date: null, athlete_position: null, meta_form_lead_id: null, arena_hidden: false,
}
const organicLead = {
  id: '30000000-0000-4000-8000-000000000002', name: 'Responsavel Organico', athlete_name: 'Atleta Organico',
  phone: '11988880000', email: 'organico@example.invalid', city_state: 'Rio de Janeiro/RJ',
  pipeline_stage: 'novo', temperature: 'frio', approach_stage: 'nao_abordado', lead_source: 'instagram',
  sdr_id: null, closer_id: null, created_by: actor, created_at: iso(6), updated_at: iso(6), version: 1,
  observations: null, athlete_birth_date: null, athlete_position: null, meta_form_lead_id: null, arena_hidden: false,
}
const crmLeads = [importedLead, organicLead]

const metricsBatch = {
  id: '40000000-0000-4000-8000-000000000001', filename: 'metricas-qa.csv', row_count: 1, status: 'pendente',
  rows: [{ date: '2026-09-29', account_id: 'act_qa', account_name: 'Conta QA', campaign_id: 'camp_qa', campaign_name: 'Campanha QA', spend: 100, leads: 5, purchases: 0 }],
  created_at: iso(10), updated_at: iso(10), reviewed_by: null, reviewed_at: null, review_note: null,
}
const leadBatch = {
  id: '40000000-0000-4000-8000-000000000002', filename: 'leads-qa.csv', row_count: 1, status: 'pendente',
  rows: [{ meta_lead_id: 'qa-1', full_name: 'Lead QA', phone: '11977770000', athlete_position: 'Meia' }],
  created_at: iso(9), updated_at: iso(9), reviewed_by: null, reviewed_at: null, review_note: null,
}
let metricsBatches = [metricsBatch]
let leadBatches = [leadBatch]
const approvedCalls = []

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('https://**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const method = route.request().method()
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [role]
  else if (resource === 'crm_leads') data = crmLeads
  else if (resource === 'meta_import_batches') data = metricsBatches
  else if (resource === 'meta_lead_import_batches') data = leadBatches
  else if (resource === 'meta_review_traffic_import' && method === 'POST') {
    const body = route.request().postDataJSON()
    approvedCalls.push({ kind: 'metrics', id: body.p_batch_id })
    metricsBatches = metricsBatches.map((b) => (b.id === body.p_batch_id ? { ...b, status: 'aprovado' } : b))
    data = { status: 'aprovado' }
  } else if (resource === 'meta_review_lead_import' && method === 'POST') {
    const body = route.request().postDataJSON()
    approvedCalls.push({ kind: 'leads', id: body.p_batch_id })
    leadBatches = leadBatches.map((b) => (b.id === body.p_batch_id ? { ...b, status: 'aprovado' } : b))
    data = { status: 'aprovado' }
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'exec@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Executive de teste' }, created_at: new Date().toISOString() },
  }
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

try {
  // --- CRM: aba "Importados" so mostra leads com lead_source = meta_ads_form ---
  await page.goto(`${origin}/crm`)
  await expect(page.getByRole('tab', { name: 'Importados', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lead Atleta Organico' })).toBeVisible()
  await page.getByRole('tab', { name: 'Importados', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Lead Atleta Importado' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lead Atleta Organico' })).toHaveCount(0)
  if (process.env.LEVEL_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.LEVEL_UI_SCREENSHOT_DIR}/crm-importados.png`, fullPage: true })

  // --- Trafego: "Aprovar todas" aprova os 2 lotes pendentes num clique ---
  await page.goto(`${origin}/trafego`)
  await page.getByRole('tab', { name: 'Importar', exact: true }).click()
  await expect(page.getByText('Métricas · metricas-qa.csv', { exact: true })).toBeVisible()
  const approveAllButton = page.getByRole('button', { name: /Aprovar todas \(2\)/ })
  await expect(approveAllButton).toBeVisible()
  if (process.env.LEVEL_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.LEVEL_UI_SCREENSHOT_DIR}/trafego-aprovar-todas.png`, fullPage: true })
  await approveAllButton.click()
  await expect(page.getByText('Nenhuma importação aguardando aprovação.')).toBeVisible()
  assert.equal(approvedCalls.length, 2, `esperava 2 chamadas de aprovacao, veio ${approvedCalls.length}`)
  assert.ok(approvedCalls.some((c) => c.kind === 'metrics' && c.id === metricsBatch.id))
  assert.ok(approvedCalls.some((c) => c.kind === 'leads' && c.id === leadBatch.id))

  assert.deepEqual(errors, [])
  console.log('PASS: CRM "Importados" tab shows only meta_ads_form leads; Trafego "Aprovar todas" approves every pending batch in one click.')
} finally {
  await context.close()
  await browser.close()
}
