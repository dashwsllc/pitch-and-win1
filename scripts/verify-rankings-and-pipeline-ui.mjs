import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 20_000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce220000-0000-4000-8000-000000000099'
const now = new Date()
const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const dated = daysAgo => {
  const [year, month, day] = todayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - daysAgo, 12)).toISOString()
}
const today = dated(0)
const yesterday = dated(1)
const profile = { id: actor, user_id: actor, display_name: 'QA Admin', avatar_url: null, suspended: false, created_at: today, updated_at: today, last_seen_at: today }
const role = { id: actor, user_id: actor, role: 'super_admin', crm_access: true, commission_rate: 0, can_view_sales: true, updated_at: today }
const errors = []

const lead = (id, name, approach_stage, date, context = false) => ({
  id, name, athlete_name: name, phone: '11999999999', email: null,
  approach_stage, pipeline_stage: approach_stage === 'nao_abordado' ? 'novo' : 'em_qualificacao',
  temperature: 'morno', priority: 'media', sdr_id: actor, closer_id: null,
  created_by: actor, assigned_to: actor, created_at: date, updated_at: date,
  first_contact_at: approach_stage === 'em_abordagem' ? date : null,
  last_contact_at: approach_stage === 'nao_abordado' ? null : date,
  approached_at: ['abordado', 'reabordado'].includes(approach_stage) ? date : null,
  approach_count: approach_stage === 'reabordado' ? 2 : approach_stage === 'abordado' ? 1 : 0,
  approached: ['abordado', 'reabordado'].includes(approach_stage), version: 1,
  next_followup_at: null, handed_off_at: null, closed_at: null, closed_by: null,
  last_result_outcome: null, last_result_at: null, last_result_closer_id: null,
  last_result_closer_name: null, remarketing_status: null, remarketing_attempt_count: 0,
  _context: context,
})

const leads = [
  lead('10000000-0000-4000-8000-000000000001', 'Lead Não Abordado', 'nao_abordado', today, true),
  lead('10000000-0000-4000-8000-000000000002', 'Lead Em Abordagem', 'em_abordagem', today),
  lead('10000000-0000-4000-8000-000000000003', 'Lead Abordado', 'abordado', today),
  lead('10000000-0000-4000-8000-000000000004', 'Lead Reabordado', 'reabordado', today),
  lead('10000000-0000-4000-8000-000000000005', 'Lead de Ontem', 'nao_abordado', yesterday),
  lead('10000000-0000-4000-8000-000000000006', 'Lead de Quinze Dias', 'nao_abordado', dated(15)),
  lead('10000000-0000-4000-8000-000000000007', 'Lead Antigo', 'nao_abordado', dated(40)),
]

const closerRanking = [
  { user_id: 'closer-1', name: 'Closer Colaborador', avatarUrl: null, totalVendas: 50000, quantidadeVendas: 5, abordagens: 20, conversao: 25 },
]
const sdrRanking = [
  { user_id: 'sdr-1', name: 'SDR Colaborador', avatarUrl: null, totalLeads: 30, leadsAbordados: 20, abordagens: 28, repasses: 8, vendasOriginadas: 3, receitaOriginada: 30000, conversao: 40 },
]

const migration = await readFile(new URL('../supabase/migrations/20260922130000_role_scoped_rankings.sql', import.meta.url), 'utf8')
assert.match(migration, /r\.role::text = 'closer'/)
assert.match(migration, /r\.role::text = 'sdr'/)
assert.equal((migration.match(/r\.role::text = 'super_admin'/g) || []).length, 2)

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
  else if (resource === 'get_team_ranking') data = closerRanking
  else if (resource === 'get_sdr_ranking') data = sdrRanking
  else if (resource === 'crm_leads') data = leads.map(({ _context, ...item }) => item)
  else if (resource === 'crm_lead_contexts') data = leads.filter(item => item._context).map(item => ({ lead_id: item.id }))
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 }, fetched_at: today }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'rankings@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'QA Admin' }, created_at: new Date().toISOString() },
  }
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(`${origin}/ranking`)
  await expect(page.getByRole('heading', { name: 'Ranking de Closers', exact: true })).toBeVisible()
  await expect(page.getByText('Closer Colaborador', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ranking de SDRs', exact: true })).toBeVisible()
  await expect(page.getByText('SDR Colaborador', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prêmios e Bônus de Comissão', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Premiação SDR', exact: true })).toBeVisible()
  await expect(page.getByText('QA Admin', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '.verification.local/rankings-desktop.png', fullPage: true })

  await page.goto(`${origin}/crm`)
  await page.getByRole('tab', { name: 'Esteira do LEAD', exact: true }).click()
  for (const label of ['Hoje', 'Ontem', '7 dias', '30 dias', 'Todo o período', 'Período personalizado']) {
    await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible()
  }
  for (const name of ['Lead Não Abordado', 'Lead Em Abordagem', 'Lead Abordado', 'Lead Reabordado']) {
    await expect(page.getByRole('article', { name: `Lead ${name}`, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('article', { name: 'Lead Lead de Ontem', exact: true })).toHaveCount(0)
  await expect(page.getByText('Contexto disponível', { exact: true })).toBeVisible()
  await expect(page.getByText('Sem contexto', { exact: true }).first()).toBeVisible()

  await page.getByRole('tab', { name: 'Ontem', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Lead Lead de Ontem', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lead Lead Não Abordado', exact: true })).toHaveCount(0)

  await page.getByRole('tab', { name: '7 dias', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Lead Lead de Ontem', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lead Lead de Quinze Dias', exact: true })).toHaveCount(0)

  await page.getByRole('tab', { name: '30 dias', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Lead Lead de Quinze Dias', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lead Lead Antigo', exact: true })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Todo o período', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Lead Lead Antigo', exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('tab', { name: 'Período personalizado', exact: true }).click()
  const customForm = page.getByRole('form', { name: 'Filtrar Esteira do LEAD por período personalizado' })
  await expect(customForm).toBeVisible()
  const customKey = dated(15).slice(0, 10)
  await customForm.getByLabel('Data inicial').fill(customKey)
  await customForm.getByLabel('Data final').fill(customKey)
  await customForm.getByRole('button', { name: 'Aplicar período' }).click()
  await expect(page.getByRole('article', { name: 'Lead Lead de Quinze Dias', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lead Lead de Ontem', exact: true })).toHaveCount(0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: '.verification.local/rankings-pipeline-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: role-scoped rankings, synchronized metrics, SDR awards, four-stage lead conveyor, date presets, context status and mobile layout.')
} finally {
  await context.close()
  await browser.close()
}
