// Browser contract test for editing an already scheduled call (responsible and time). Supabase traffic and WebSockets are mocked.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { addDaysToDateKey, brasiliaDateKey, brasiliaLocalInputToIso } from '../src/lib/brasilia-time.ts'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Unexpected frontend test origin')
const project = 'mbzwchnxtskysqplqiyy'
const viewer = randomUUID(), joao = randomUUID(), ismael = randomUUID(), maria = randomUUID(), pedro = randomUUID(), exec = randomUUID()
const now = new Date().toISOString()
const day = offset => addDaysToDateKey(brasiliaDateKey(), offset)
const at = (offset, time) => brasiliaLocalInputToIso(`${day(offset)}T${time}`)
// The viewer is a plain SDR: no Closer role and no executive access.
const profile = { id: viewer, user_id: viewer, display_name: 'Ana SDR', suspended: false, avatar_url: null, created_at: now, updated_at: now }
const lead = (name, extra = {}) => ({
  id: randomUUID(), name, athlete_name: `Atleta ${name}`, phone: '11999999999', email: null,
  pipeline_stage: 'em_qualificacao', approach_stage: 'abordado', temperature: 'morno', sdr_id: joao, closer_id: null, created_by: viewer,
  created_at: now, updated_at: now, next_followup_at: null, version: 1, followup_status: null, followup_next_at: null,
  followup_attempt_count: 0, ...extra,
})
const leads = [
  lead('Alfa', { pipeline_stage: 'repassado_closer', closer_id: maria, handed_off_at: now, next_followup_at: at(2, '15:00') }),
  lead('Beta', { next_followup_at: at(1, '10:00') }),
]
const byName = name => leads.find(l => l.name === name)
// Alfa's closing call was scheduled by the executive, who is also eligible as Closer: the list must show but disable that person.
const calls = [
  { id: randomUUID(), lead_id: byName('Alfa').id, call_type: 'fechamento_closer', activity_type: 'reuniao', scheduled_at: at(2, '15:00'),
    is_completed: false, assigned_to: maria, user_id: exec, updated_at: now },
  { id: randomUUID(), lead_id: byName('Beta').id, call_type: 'qualificacao', activity_type: 'reuniao', scheduled_at: at(1, '10:00'),
    is_completed: false, assigned_to: joao, user_id: viewer, updated_at: now },
]
const alfaCall = calls[0], betaCall = calls[1]
const assignees = [
  { user_id: viewer, display_name: 'Ana SDR', role: 'sdr' },
  { user_id: joao, display_name: 'João SDR', role: 'sdr' },
  { user_id: ismael, display_name: 'Ismael SDR', role: 'sdr' },
  { user_id: maria, display_name: 'Maria Closer', role: 'closer' },
  { user_id: pedro, display_name: 'Pedro Iago', role: 'closer' },
  { user_id: pedro, display_name: 'Pedro Iago', role: 'sdr' },
  { user_id: exec, display_name: 'Gestor QA', role: 'executive' },
]
const requests = [], errors = [], sockets = []
let failNextUpdate = false
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
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const payload = route.request().postDataJSON() ?? {}
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [{ id: viewer, user_id: viewer, role: 'sdr', crm_access: true, commission_rate: 10 }]
  else if (resource === 'crm_can_schedule_qualification_call') data = true
  else if (resource === 'crm_leads') data = leads
  else if (resource === 'crm_lead_contexts' || resource === 'crm_result_sale_links') data = []
  else if (resource === 'crm_activities') data = calls.filter(c => !url.searchParams.has('lead_id') || c.lead_id === url.searchParams.get('lead_id').slice(3))
  else if (resource === 'crm_call_assignees') data = assignees
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
  else if (resource === 'update_crm_call') {
    requests.push({ resource, payload })
    if (failNextUpdate) {
      failNextUpdate = false
      return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ code: 'PT409', message: 'Call alterada. Atualize e tente novamente.', details: null, hint: null }) })
    }
    const call = calls.find(c => c.id === payload.p_activity_id)
    const owner = leads.find(l => l.id === call.lead_id)
    if (payload.p_assigned_to) {
      call.assigned_to = payload.p_assigned_to
      if (call.call_type === 'fechamento_closer') owner.closer_id = payload.p_assigned_to
    }
    if (payload.p_scheduled_at) { call.scheduled_at = payload.p_scheduled_at; owner.next_followup_at = payload.p_scheduled_at }
    call.updated_at = new Date(Date.now() + requests.length).toISOString()
    owner.version += 1
    data = call
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ viewer, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({ alg: 'HS256' })}.${enc({ sub: viewer, role: 'authenticated', exp: 4102444800 })}.qa`, refresh_token: 'qa', expires_at: 4102444800,
    user: { id: viewer, email: 'sdr@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Ana SDR' }, created_at: new Date().toISOString() } }))
}, { viewer, project })
const page = await context.newPage()
page.on('pageerror', e => errors.push(e.message))
const options = dialog => dialog.locator('#call-assignee option').evaluateAll(list =>
  list.map(option => ({ text: option.textContent.trim(), value: option.value, disabled: option.disabled })))
const selectable = async dialog => (await options(dialog)).filter(o => o.value && !o.disabled).map(o => o.text)
const editDialog = () => page.getByRole('dialog', { name: 'Editar call', exact: true })
try {
  await page.goto(`${origin}/crm`)
  const alfa = page.getByRole('article', { name: 'Lead Atleta Alfa' })
  const beta = page.getByRole('article', { name: 'Lead Atleta Beta' })

  // 1. A plain SDR edits the closing call: the primary button and the menu item are both there.
  await expect(alfa.getByRole('button', { name: 'Editar call Closer', exact: true })).toBeVisible()
  await alfa.getByRole('button', { name: 'Ações de Alfa', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Editar call agendada', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await alfa.getByRole('button', { name: 'Editar call Closer', exact: true }).click()
  let dialog = editDialog()
  const closerSelect = dialog.getByLabel('Responsável pela call (Closer)')
  await expect(closerSelect).toHaveValue(maria)
  // Quem agendou a call (Gestor QA) também pode ser o Closer: está na lista e nada fica desabilitado.
  await expect.poll(() => selectable(dialog)).toEqual(['Gestor QA', 'Maria Closer', 'Pedro Iago'])
  const closing = await options(dialog)
  assert.equal(closing.some(o => o.disabled), false, 'the scheduler of the closing call can receive it: nobody is disabled')
  assert.equal(closing.find(o => o.text.startsWith('Gestor QA')).text, 'Gestor QA')
  assert.equal(closing.some(o => o.text.includes('João SDR')), false, 'SDRs are not offered as Closer')
  await expect(dialog.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled()
  await page.screenshot({ path: '.verification.local/crm-edit-call-closer-desktop.png', fullPage: true })
  await closerSelect.selectOption(pedro)
  await expect(dialog.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(dialog).toHaveCount(0)
  let sent = requests.at(-1).payload
  assert.deepEqual(sent, { p_activity_id: alfaCall.id, p_assigned_to: pedro, p_scheduled_at: null, p_expected_revision: now })
  await expect(alfa).toContainText('Closer: Pedro Iago')

  // 2. Time only: the responsible is not sent.
  await alfa.getByRole('button', { name: 'Editar call Closer', exact: true }).click()
  dialog = editDialog()
  await expect(dialog.getByLabel('Responsável pela call (Closer)')).toHaveValue(pedro)
  await dialog.getByLabel('Data e hora (horário de Brasília)').fill(`${day(3)}T11:00`)
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(dialog).toHaveCount(0)
  sent = requests.at(-1).payload
  assert.equal(sent.p_assigned_to, null)
  assert.equal(sent.p_scheduled_at, at(3, '11:00'))
  assert.equal(sent.p_activity_id, alfaCall.id)

  // 3. The qualification call: the SDR list, the viewer included, through the menu.
  await expect(beta.getByRole('button', { name: 'Editar call SDR', exact: true })).toBeVisible()
  await beta.getByRole('button', { name: 'Ações de Beta', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Editar call agendada', exact: true }).click()
  dialog = editDialog()
  const sdrSelect = dialog.getByLabel('Responsável pela call (SDR)')
  await expect(sdrSelect).toHaveValue(joao)
  await expect.poll(() => selectable(dialog)).toEqual(['Ana SDR', 'Gestor QA', 'Ismael SDR', 'João SDR', 'Pedro Iago'])
  assert.equal((await options(dialog)).some(o => o.disabled), false, 'nobody is blocked on a qualification call')
  await sdrSelect.selectOption(ismael)
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(dialog).toHaveCount(0)
  sent = requests.at(-1).payload
  assert.deepEqual(sent, { p_activity_id: betaCall.id, p_assigned_to: ismael, p_scheduled_at: null, p_expected_revision: now })
  assert.equal(byName('Beta').closer_id, null, 'a qualification call never touches the lead closer')

  // 4. A stale revision keeps the dialog open with the database message.
  failNextUpdate = true
  await beta.getByRole('button', { name: 'Editar call SDR', exact: true }).click()
  dialog = editDialog()
  await expect(dialog.getByLabel('Responsável pela call (SDR)')).toHaveValue(ismael)
  await dialog.getByLabel('Responsável pela call (SDR)').selectOption(viewer)
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Call alterada. Atualize e tente novamente.')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(requests.length, 4)
  assert.deepEqual(errors, [])
  console.log('PASS: any SDR edits an already scheduled call: Closer list (scheduler included), SDR list, responsible-only and time-only payloads, lead follows the closing call, stale revision message. Browser network mocked; no live data changed.')
} finally { await browser.close() }
