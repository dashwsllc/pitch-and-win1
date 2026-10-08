// Browser contract for the Follow-up area: a queue shared by every SDR and Closer (Executive included), closed to Seller.
// Supabase traffic is mocked; no live records are changed.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Use a local frontend')
const actor = randomUUID(), ownerSdr = randomUUID(), ownerCloser = randomUUID()
const now = new Date().toISOString()
const soon = new Date(Date.now() + 86400000).toISOString()
const project = 'mbzwchnxtskysqplqiyy'
const profile = { id: actor, user_id: actor, display_name: 'Operador QA', suspended: false, created_at: now, updated_at: now }
const base = { phone: '11999999999', email: null, approach_stage: 'abordado', temperature: 'morno', created_by: ownerSdr,
  created_at: now, updated_at: now, closed_at: now, version: 3, followup_attempt_count: 0, followup_last_contact_at: null }
// Both leads belong to other people: the SDR lost one in qualification, the Closer lost the other at the closing call.
const leads = [
  { ...base, id: randomUUID(), name: 'Responsável SDR', athlete_name: 'Atleta SDR', pipeline_stage: 'lead_perdido',
    sdr_id: ownerSdr, closer_id: null, negative_reason: 'Sem orçamento', followup_status: 'scheduled',
    followup_next_at: soon, next_followup_at: soon, last_result_outcome: 'lead_perdido', last_result_at: now },
  { ...base, id: randomUUID(), name: 'Responsável Closer', athlete_name: 'Atleta Closer', pipeline_stage: 'fechado_perdido',
    sdr_id: ownerSdr, closer_id: ownerCloser, negative_reason: 'Pediu os planos', followup_status: 'pending',
    followup_next_at: null, next_followup_at: null, last_result_outcome: 'venda_perdida', last_result_at: now },
]
const directoryUser = (name, roles, suspended = false) => ({
  id: randomUUID(), user_id: randomUUID(), display_name: name, avatar_url: null, suspended,
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.invalid`, phone: null, email_confirmed_at: now, phone_confirmed_at: null,
  created_at: now, updated_at: now, last_sign_in_at: now, account_revision: '1',
  user_roles: roles.map(role => ({ id: randomUUID(), role, crm_access: true, crm_closer_access: false, commission_rate: 10 })),
})
const directory = [
  directoryUser('Pessoa SDR', ['sdr']), directoryUser('Pessoa Closer', ['closer']), directoryUser('Pessoa Executive', ['executive']),
  directoryUser('Pessoa Super Admin', ['super_admin']), directoryUser('Pessoa Seller', ['seller']),
  directoryUser('Pessoa Suspensa', ['closer'], true),
]
let actorRole = 'sdr'
const requests = [], errors = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const payload = route.request().postDataJSON() ?? {}
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [{ id: actor, user_id: actor, role: actorRole, crm_access: true, commission_rate: 10 }]
  else if (resource === 'crm_leads') data = leads
  else if (resource === 'crm_call_assignees') data = [
    { user_id: ownerSdr, display_name: 'SDR Dono', role: 'sdr' },
    { user_id: ownerCloser, display_name: 'Closer Dono', role: 'closer' },
  ]
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
  else if (resource === 'executive_list_users') data = { users: directory, fetched_at: now }
  else if (resource === 'crm_update_followup') {
    requests.push({ resource, payload })
    data = { ...leads.find(l => l.id === payload.p_lead_id), followup_status: 'nurturing', version: 4 }
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
    access_token: `${enc({ alg: 'HS256' })}.${enc({ sub: actor, role: 'authenticated', exp: 4102444800 })}.qa`,
    refresh_token: 'qa', expires_at: 4102444800,
    user: { id: actor, email: 'followup@example.invalid', aud: 'authenticated', role: 'authenticated',
      app_metadata: {}, user_metadata: { display_name: 'Operador QA' }, created_at: new Date().toISOString() },
  }))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
try {
  for (const role of ['sdr', 'closer', 'executive']) {
    actorRole = role
    requests.length = 0
    await page.goto(`${origin}/crm`)
    // Follow-up is its own area now, next to the SDR and Closer areas, and never again a sub-queue named Remarketing.
    await expect(page.getByRole('tab', { name: 'Follow-up', exact: true })).toHaveCount(1)
    await expect(page.getByRole('tab', { name: /Remarketing/i })).toHaveCount(0)
    await page.getByRole('tab', { name: 'SDR', exact: true }).click()
    await expect(page.getByRole('tab', { name: /^Em atendimento \d/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Remarketing|Follow-up \d/i })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Follow-up', exact: true }).click()
    const board = page.getByRole('region', { name: 'Fila de follow-up' })
    await expect(board.getByRole('article')).toHaveCount(2)
    // Every lead in the queue can be worked by the person on screen, even though it belongs to someone else.
    for (const name of ['Responsável SDR', 'Responsável Closer']) {
      const card = board.getByRole('article', { name: `Follow-up de ${name}` })
      await expect(card.getByRole('button', { name: 'Acompanhar lead' })).toBeEnabled()
      await expect(card.getByRole('button', { name: 'Importar .txt' })).toBeEnabled()
    }
    await expect(board.getByRole('article', { name: 'Follow-up de Responsável Closer' })).toContainText('Closer: Closer Dono')
    await board.locator('select').filter({ hasText: 'Todos os responsáveis' }).selectOption(ownerCloser)
    await expect(board.getByRole('article')).toHaveCount(1)
    await board.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(board.getByRole('article')).toHaveCount(2)

    await board.getByRole('article', { name: 'Follow-up de Responsável SDR' }).getByRole('button', { name: 'Acompanhar lead' }).click()
    const dialog = page.getByRole('dialog', { name: 'Registrar follow-up' })
    await dialog.getByLabel('Ação *').selectOption('contacted')
    await dialog.getByLabel('Próximo follow-up · Brasília *').fill(`${future}T10:00`)
    await dialog.getByLabel('Registro *').fill(`Contato registrado por ${role}`)
    await dialog.getByRole('button', { name: 'Salvar follow-up' }).click()
    await expect(dialog).toHaveCount(0)
    const sent = requests.find(request => request.resource === 'crm_update_followup')
    assert.ok(sent, `${role} chamou o follow-up`)
    assert.equal(sent.payload.p_lead_id, leads[0].id)
    assert.equal(sent.payload.p_expected_version, 3)
    assert.equal(sent.payload.p_action, 'contacted')
    assert.equal(sent.payload.p_note, `Contato registrado por ${role}`)
    assert.ok(Date.parse(sent.payload.p_next_at) > Date.now())
  }

  // Bookmarks and shared links from the old tab name land on the Follow-up area.
  actorRole = 'sdr'
  await page.goto(`${origin}/crm?tab=remarketing`)
  await expect(page.getByRole('region', { name: 'Fila de follow-up' })).toBeVisible()
  await expect(page).toHaveURL(/tab=followup/)

  // Seller has no SDR or Closer area, so the Follow-up area stays closed.
  actorRole = 'seller'
  await page.goto(`${origin}/crm`)
  await expect(page.getByRole('tab', { name: 'Leads', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Follow-up', exact: true })).toHaveCount(0)
  await page.goto(`${origin}/crm?tab=followup`)
  await expect(page.getByRole('alert')).toContainText('Sua função não permite acessar esta área.')
  await expect(page.getByRole('region', { name: 'Fila de follow-up' })).toHaveCount(0)

  // The Super Admin audits who has the permission: it is listed for SDR, Closer, Executive and Super Admin only.
  actorRole = 'super_admin'
  await page.goto(`${origin}/crm?tab=permissions`)
  await expect(page.getByText('Pessoa SDR', { exact: true })).toBeVisible()
  const permissionBadge = name => page.locator('article').filter({ hasText: name }).getByText('Follow-up', { exact: true })
  for (const name of ['Pessoa SDR', 'Pessoa Closer', 'Pessoa Executive', 'Pessoa Super Admin']) await expect(permissionBadge(name)).toHaveCount(1)
  for (const name of ['Pessoa Seller', 'Pessoa Suspensa']) await expect(permissionBadge(name)).toHaveCount(0)

  assert.deepEqual(errors, [])
  console.log('PASS: Follow-up is its own CRM area; every SDR and Closer (and Executive) opens it and works any lead in it, old Remarketing links still land there, Seller stays out, and the permissions report lists the Follow-up permission for exactly those roles. Browser network mocked; no live data changed.')
} finally {
  await browser.close()
}
