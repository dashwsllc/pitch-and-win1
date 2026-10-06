// Browser contract test for the Closer list in "Agendar Call c/ Closer". Supabase traffic and WebSockets are mocked.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { brasiliaDateKey, addDaysToDateKey } from '../src/lib/brasilia-time.ts'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Unexpected frontend test origin')
const project = 'mbzwchnxtskysqplqiyy'
const actor = randomUUID(), maria = randomUUID(), joao = randomUUID(), pedro = randomUUID(), nova = randomUUID()
const now = new Date().toISOString()
const tomorrow = addDaysToDateKey(brasiliaDateKey(), 1)
const profile = { id: actor, user_id: actor, display_name: 'Gestor QA', suspended: false, avatar_url: null, created_at: now, updated_at: now }
const lead = {
  id: randomUUID(), name: 'Alfa', athlete_name: 'Atleta Alfa', phone: '11999999999', email: null,
  pipeline_stage: 'em_qualificacao', approach_stage: 'abordado', temperature: 'quente', sdr_id: joao, closer_id: null, created_by: actor,
  created_at: now, updated_at: now, next_followup_at: null, version: 1, remarketing_status: null, remarketing_next_at: null,
  remarketing_attempt_count: 0,
}
const closedLead = {
  ...lead, id: randomUUID(), name: 'Beta', athlete_name: 'Atleta Beta', pipeline_stage: 'fechado_ganho', closer_id: maria,
  last_result_closer_id: maria, last_result_closer_name: 'Maria Closer', last_result_outcome: 'venda_concluida', last_result_at: now, closed_at: now,
}
const saleLink = { lead_id: closedLead.id, sale_id: randomUUID(), can_open: true, approval_status: 'aprovada', seller_id: maria, seller_name: 'Maria Closer' }
// Pedro starts as a plain SDR; the test promotes him to Closer while the dialog is open.
let assignees = [
  { user_id: actor, display_name: 'Gestor QA', role: 'executive' },
  { user_id: maria, display_name: 'Maria Closer', role: 'closer' },
  { user_id: joao, display_name: 'João SDR', role: 'sdr' },
  { user_id: pedro, display_name: 'Pedro Iago', role: 'sdr' },
]
let assigneeReads = 0
const requests = [], errors = [], sockets = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, socket => {
  const channels = new Map()
  sockets.push({ socket, channels })
  socket.onMessage(raw => {
    const message = JSON.parse(String(raw))
    if (message.event === 'phx_join') {
      const bindings = (message.payload.config?.postgres_changes || []).map((binding, i) => ({ ...binding, id: i + 1 }))
      channels.set(message.topic, bindings)
      socket.send(JSON.stringify({ topic: message.topic, event: 'phx_reply', ref: message.ref, join_ref: message.join_ref,
        payload: { status: 'ok', response: { postgres_changes: bindings } } }))
    } else if (message.event === 'heartbeat' || message.event === 'phx_leave') {
      if (message.event === 'phx_leave') channels.delete(message.topic)
      socket.send(JSON.stringify({ topic: message.topic, event: 'phx_reply', ref: message.ref, payload: { status: 'ok', response: {} } }))
    }
  })
})
let revision = 1
const signalChange = topic => {
  revision += 1
  for (const { socket, channels } of sockets) for (const [channelTopic, bindings] of channels) {
    const binding = bindings.find(b => b.table === 'dashboard_events')
    if (binding) socket.send(JSON.stringify({ topic: channelTopic, event: 'postgres_changes', ref: null,
      payload: { ids: [binding.id], data: { schema: 'public', table: 'dashboard_events', type: 'UPDATE',
        commit_timestamp: new Date().toISOString(), record: { topic, revision }, old_record: {}, columns: [], errors: null } } }))
  }
}
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const payload = route.request().postDataJSON() ?? {}
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [{ id: actor, user_id: actor, role: 'executive', crm_access: true, commission_rate: 10 }]
  else if (resource === 'crm_leads') data = [lead, closedLead]
  else if (resource === 'crm_result_sale_links') data = [saleLink]
  else if (resource === 'crm_lead_contexts' || resource === 'crm_activities') data = []
  else if (resource === 'crm_call_assignees') { assigneeReads += 1; data = assignees }
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
  else if (resource === 'handoff_and_schedule_closer_call') { requests.push({ resource, payload }); data = { id: randomUUID() } }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({ alg: 'HS256' })}.${enc({ sub: actor, role: 'authenticated', exp: 4102444800 })}.qa`, refresh_token: 'qa', expires_at: 4102444800,
    user: { id: actor, email: 'closers@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Gestor QA' }, created_at: new Date().toISOString() } }))
}, { actor, project })
const page = await context.newPage()
page.on('pageerror', e => errors.push(e.message))
const dialogOptions = dialog => dialog.locator('#call-assignee option').evaluateAll(list =>
  list.map(option => ({ text: option.textContent.trim(), value: option.value, disabled: option.disabled })))
const selectableNames = async dialog => (await dialogOptions(dialog)).filter(o => o.value && !o.disabled).map(o => o.text)
const openScheduler = async () => {
  await page.getByRole('article', { name: 'Lead Atleta Alfa' }).getByRole('button', { name: 'Agendar Call c/ Closer', exact: true }).click()
  return page.getByRole('dialog', { name: 'Agendar Call c/ Closer', exact: true })
}
try {
  await page.goto(`${origin}/crm`)
  let dialog = await openScheduler()
  await expect.poll(() => selectableNames(dialog)).toEqual(['Maria Closer'])
  const initial = await dialogOptions(dialog)
  const self = initial.find(o => o.disabled)
  assert.ok(self, 'the person who schedules stays on the list, disabled')
  assert.match(self.text, /^Gestor QA \(você\)/)
  assert.equal(initial.some(o => o.text.includes('Pedro Iago')), false, 'a plain SDR is not offered as Closer')
  assert.equal(initial.some(o => o.text.includes('João SDR')), false)
  await expect(dialog.getByRole('button', { name: 'Agendar e enviar' })).toBeDisabled()

  // Promoting Pedro changes user_roles; the revision signal must reach the open dialog without any reload.
  assignees = [...assignees.filter(a => a.user_id !== pedro),
    { user_id: pedro, display_name: 'Pedro Iago', role: 'closer' }, { user_id: pedro, display_name: 'Pedro Iago', role: 'sdr' }]
  signalChange('users')
  await expect.poll(() => selectableNames(dialog)).toEqual(['Maria Closer', 'Pedro Iago'])
  await page.screenshot({ path: '.verification.local/crm-closer-list-desktop.png', fullPage: true })

  // Closing and reopening reads the list again even when no revision signal arrived in between.
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).toHaveCount(0)
  assignees = [...assignees, { user_id: nova, display_name: 'Ana Nova', role: 'closer' }]
  const readsBefore = assigneeReads
  dialog = await openScheduler()
  await expect.poll(() => selectableNames(dialog)).toEqual(['Ana Nova', 'Maria Closer', 'Pedro Iago'])
  assert.ok(assigneeReads > readsBefore, 'opening the dialog reads the assignees again')

  await dialog.getByLabel('Responsável').selectOption(pedro)
  await dialog.getByLabel('Data e hora (horário de Brasília)').fill(`${tomorrow}T15:00`)
  await expect(dialog.getByRole('button', { name: 'Agendar e enviar' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Agendar e enviar' }).click()
  await expect(dialog).toHaveCount(0)
  const handoff = requests.find(r => r.resource === 'handoff_and_schedule_closer_call')
  assert.ok(handoff, 'the handoff RPC was sent')
  assert.equal(handoff.payload.p_assigned_to, pedro)
  assert.equal(handoff.payload.p_lead_id, lead.id)

  // "Devolver ao Closer" lê a mesma lista (aqui quem devolve também pode ser escolhido).
  await page.getByRole('tab', { name: 'Closer', exact: true }).click()
  await page.getByRole('tab', { name: /^Resultados \d/ }).click()
  const results = page.getByRole('region', { name: 'Resultados do Closer' })
  await results.getByRole('article', { name: 'Resultado de Beta', exact: true }).getByRole('button', { name: 'Devolver ao Closer', exact: true }).click()
  const returnDialog = page.getByRole('dialog', { name: 'Devolver ao Closer', exact: true })
  await expect.poll(() => returnDialog.locator('#return-assignee option').evaluateAll(list =>
    list.filter(option => option.value).map(option => option.textContent.trim()))).toEqual(['Ana Nova', 'Gestor QA', 'Maria Closer', 'Pedro Iago'])
  assert.deepEqual(errors, [])
  console.log('PASS: Closer list is complete and alphabetical, keeps the scheduler visible but disabled, picks up a promotion live while the dialog is open, re-reads on open, the promoted Closer receives the handoff and the return dialog lists the same Closers. Browser network mocked; no live data changed.')
} finally { await browser.close() }
