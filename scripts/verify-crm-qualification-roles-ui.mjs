// Browser contract for the qualification action in the shared LEAD pipeline.
// Supabase traffic is mocked; no live records are changed.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Use a local frontend')
const actor = randomUUID(), assignedSdr = randomUUID(), leadId = randomUUID(), callId = randomUUID()
const now = new Date().toISOString()
const project = 'mbzwchnxtskysqplqiyy'
const profile = { id: actor, user_id: actor, display_name: 'Operador QA', suspended: false, created_at: now, updated_at: now }
const lead = { id: leadId, name: 'Responsável QA', athlete_name: 'Atleta QA', phone: '11999999999',
  pipeline_stage: 'em_qualificacao', approach_stage: 'abordado', temperature: 'morno',
  sdr_id: assignedSdr, closer_id: null, created_by: assignedSdr, created_at: now, updated_at: now,
  next_followup_at: null, version: 1 }
const call = { id: callId, lead_id: leadId, call_type: 'qualificacao',
  scheduled_at: new Date(Date.now() + 86400000).toISOString(), is_completed: false,
  assigned_to: assignedSdr, updated_at: now, created_at: now }
let actorRole = 'sdr'
const errors = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [{ id: actor, user_id: actor, role: actorRole, crm_access: true, commission_rate: 10 }]
  else if (resource === 'crm_leads') data = [lead]
  else if (resource === 'crm_activities') data = [call]
  else if (resource === 'crm_call_assignees') data = [{ user_id: assignedSdr, display_name: 'SDR QA', role: 'sdr' }]
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
    access_token: `${enc({ alg: 'HS256' })}.${enc({ sub: actor, role: 'authenticated', exp: 4102444800 })}.qa`,
    refresh_token: 'qa', expires_at: 4102444800,
    user: { id: actor, email: 'qualification@example.invalid', aud: 'authenticated', role: 'authenticated',
      app_metadata: {}, user_metadata: { display_name: 'Operador QA' }, created_at: new Date().toISOString() },
  }))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
try {
  for (const role of ['sdr', 'closer', 'seller']) {
    actorRole = role
    await page.goto(`${origin}/crm`)
    await page.getByRole('tab', { name: 'Esteira do LEAD', exact: true }).click()
    const card = page.getByRole('article', { name: 'Lead Atleta QA' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Ações de Responsável QA' }).click()
    const action = page.getByRole('menuitem', { name: 'Registrar resultado da qualificação' })
    if (role === 'seller') {
      await expect(action).toHaveCount(0)
    } else {
      await expect(action).toBeVisible()
      await action.click()
      await expect(page.getByRole('dialog', { name: 'Resultado da call de qualificação' })).toBeVisible()
      await page.keyboard.press('Escape')
    }
    await expect(page.getByRole('tab', { name: 'SDR', exact: true })).toHaveCount(role === 'seller' ? 0 : 1)
    await expect(page.getByRole('tab', { name: 'Closer', exact: true })).toHaveCount(role === 'closer' ? 1 : 0)
  }
  assert.deepEqual(errors, [])
  console.log('PASS: SDR and Closer can open qualification results for another SDR call; Seller cannot, and SDR has no Closer area.')
} finally {
  await browser.close()
}
