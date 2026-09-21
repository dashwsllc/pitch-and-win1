// Browser contract tests. Supabase traffic is mocked, including on the published frontend.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { brasiliaDateKey, addDaysToDateKey, brasiliaLocalToDate } from '../src/lib/brasilia-time.ts'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost', 'wsltda.com', 'www.wsltda.com'].includes(new URL(origin).hostname)) throw Error('Unexpected frontend test origin')
const actor = randomUUID(), closer = randomUUID(), sdr = randomUUID()
const project = 'mbzwchnxtskysqplqiyy'
const now = new Date().toISOString(), today = brasiliaDateKey(), tomorrow = addDaysToDateKey(today, 1)
const at = (day, hour = '14:00:00') => brasiliaLocalToDate(day, hour).toISOString()
const profile = { id: actor, user_id: actor, display_name: 'Gestor QA', suspended: false, avatar_url: null, created_at: now, updated_at: now }
const lead = (name, extra = {}) => ({ id: randomUUID(), name, athlete_name: `Atleta ${name}`, phone: '11999999999', email: null,
  pipeline_stage: 'novo', approach_stage: 'nao_abordado', temperature: 'morno', sdr_id: sdr, closer_id: null, created_by: actor,
  created_at: now, updated_at: now, next_followup_at: null, version: 1, remarketing_status: null, remarketing_next_at: null,
  remarketing_attempt_count: 0, ...extra })
const leads = [
  lead('Retorno hoje', { next_followup_at: at(today) }),
  lead('Call amanhã'),
  lead('Sem agenda'),
  lead('Dia anterior', { next_followup_at: at(addDaysToDateKey(today, -1)) }),
  lead('Aprovado', { pipeline_stage: 'fechado_ganho', closer_id: closer, last_result_closer_id: closer, last_result_closer_name: 'Maria Closer', last_result_outcome: 'venda_concluida', last_result_at: at(today), closed_at: at(today) }),
  lead('Rejeitado', { pipeline_stage: 'fechado_ganho', closer_id: actor, last_result_closer_id: actor, last_result_closer_name: 'Gestor QA', last_result_outcome: 'venda_concluida', last_result_at: at(addDaysToDateKey(today, -1)), closed_at: at(addDaysToDateKey(today, -1)) }),
  lead('Recusado', { pipeline_stage: 'fechado_perdido', closer_id: closer, last_result_closer_id: closer, last_result_closer_name: 'Maria Closer', last_result_outcome: 'venda_perdida', last_result_at: at(today), closed_at: at(today), negative_reason: 'Sem orçamento agora', remarketing_status: 'scheduled', remarketing_next_at: at(tomorrow) }),
]
const byName = name => leads.find(l => l.name === name)
const calls = [{ id: randomUUID(), lead_id: byName('Call amanhã').id, call_type: 'qualificacao', scheduled_at: at(tomorrow), is_completed: false, assigned_to: sdr, updated_at: now }]
const sales = [
  { lead_id: byName('Aprovado').id, sale_id: randomUUID(), can_open: true, approval_status: 'aprovada', seller_id: closer, seller_name: 'Maria Closer' },
  { lead_id: byName('Rejeitado').id, sale_id: randomUUID(), can_open: true, approval_status: 'rejeitada', seller_id: actor, seller_name: 'Gestor QA' },
]
const requests = [], errors = []
const sockets = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce', timezoneId: 'Asia/Tokyo' })
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
const signalChange = () => {
  for (const { socket, channels } of sockets) for (const [topic, bindings] of channels) {
    const binding = bindings.find(b => b.table === 'dashboard_events')
    if (binding) socket.send(JSON.stringify({ topic, event: 'postgres_changes', ref: null,
      payload: { ids: [binding.id], data: { schema: 'public', table: 'dashboard_events', type: 'UPDATE',
        commit_timestamp: new Date().toISOString(), record: { topic: 'sales', revision: 2 }, old_record: {}, columns: [], errors: null } } }))
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
  else if (resource === 'crm_leads') data = leads
  else if (resource === 'crm_activities') data = calls.filter(c => !url.searchParams.has('lead_id') || c.lead_id === url.searchParams.get('lead_id').slice(3))
  else if (resource === 'crm_call_assignees') data = [
    { user_id: actor, display_name: 'Gestor QA', role: 'executive' },
    { user_id: closer, display_name: 'Maria Closer', role: 'closer' },
    { user_id: sdr, display_name: 'João SDR', role: 'sdr' },
  ]
  else if (resource === 'crm_result_sale_links') data = sales
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
  else if (resource === 'crm_transition') {
    requests.push({ resource, payload })
    data = leads.find(l => l.id === payload.p_lead_id)
    Object.assign(data, { approach_stage: payload.p_data.stage, pipeline_stage: 'em_qualificacao', version: data.version + 1 })
  } else if (resource === 'crm_mark_negative') {
    requests.push({ resource, payload })
    data = leads.find(l => l.id === payload.p_lead_id)
    Object.assign(data, { pipeline_stage: 'lead_perdido', negative_reason: payload.p_reason, remarketing_status: 'scheduled',
      remarketing_next_at: payload.p_next_at, next_followup_at: payload.p_next_at,
      last_result_outcome: 'lead_perdido', last_result_at: now, version: data.version + 1 })
  } else if (resource === 'crm_reopen_result') {
    requests.push({ resource, payload })
    data = leads.find(l => l.id === payload.p_lead_id)
    Object.assign(data, { pipeline_stage: payload.p_target === 'sdr' ? 'em_qualificacao' : 'repassado_closer',
      sdr_id: payload.p_target === 'sdr' ? payload.p_assigned_to : data.sdr_id,
      closer_id: payload.p_target === 'closer' ? payload.p_assigned_to : null,
      next_followup_at: payload.p_next_at, remarketing_status: 'reactivated', remarketing_next_at: null, closed_at: null, version: data.version + 1 })
    calls.push({ id: randomUUID(), lead_id: data.id, call_type: payload.p_target === 'sdr' ? 'qualificacao' : 'fechamento_closer',
      assigned_to: payload.p_assigned_to, scheduled_at: payload.p_next_at, is_completed: false, updated_at: now })
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({alg:'HS256'})}.${enc({sub:actor,role:'authenticated',exp:4102444800})}.qa`, refresh_token: 'qa', expires_at: 4102444800,
    user: { id: actor, email: 'results@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Gestor QA' }, created_at: new Date().toISOString() } }))
}, { actor, project })
const page = await context.newPage()
page.on('pageerror', e => errors.push(e.message))
const checkOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'horizontal overflow')
try {
  await page.goto(`${origin}/crm`)
  await expect(page.getByRole('article')).toHaveCount(4)
  await page.getByRole('tab', { name: 'Esteira do LEAD', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('article')).toHaveAttribute('aria-label', 'Lead Atleta Retorno hoje')
  await page.getByLabel('Abordagem de Retorno hoje', { exact: true }).selectOption('abordado')
  await expect(page.getByLabel('Abordagem de Retorno hoje', { exact: true })).toHaveValue('abordado')
  await page.getByLabel('Dia da Esteira do LEAD').fill(tomorrow)
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('article')).toHaveAttribute('aria-label', 'Lead Atleta Call amanhã')
  await page.screenshot({ path: '.verification.local/crm-daily-pipeline-desktop.png', fullPage: true })
  await page.getByLabel('Dia da Esteira do LEAD').fill(addDaysToDateKey(today, 2))
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Resultados', exact: true }).click()
  let results = page.getByRole('region', { name: 'Resultados comerciais' })
  await expect(results.getByRole('article')).toHaveCount(3)
  await results.getByLabel('Aprovação da venda').selectOption('aprovada')
  await expect(results.getByRole('article')).toHaveCount(1)
  await expect(results.getByRole('article')).toHaveAttribute('aria-label', 'Resultado de Aprovado')
  await results.getByLabel('Aprovação da venda').selectOption('rejeitada')
  await expect(results.getByRole('article')).toHaveAttribute('aria-label', 'Resultado de Rejeitado')
  await results.getByRole('button', { name: 'Limpar filtros' }).click()
  await results.getByLabel('Vendedor', { exact: true }).selectOption(closer)
  await expect(results.getByRole('article')).toHaveCount(2)
  await results.getByLabel('Resultado', { exact: true }).selectOption('lost')
  await expect(results.getByRole('article')).toHaveCount(1)
  await results.getByLabel('Resultado a partir de').fill(today)
  await results.getByLabel('Resultado até').fill(today)
  await expect(results.getByRole('article')).toHaveCount(1)
  await results.getByRole('button', { name: 'Limpar filtros' }).click()
  await page.screenshot({ path: '.verification.local/crm-results-desktop.png', fullPage: true })
  await page.getByRole('tab', { name: 'Closer', exact: true }).click()
  await page.getByRole('tab', { name: /^Resultados \d/ }).click()
  results = page.getByRole('region', { name: 'Resultados do Closer' })
  const refused = results.getByRole('article', { name: 'Resultado de Recusado', exact: true })
  await refused.getByRole('button', { name: 'Devolver ao SDR', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Devolver ao SDR', exact: true })
  await dialog.getByLabel('Próxima call · Brasília *').fill(`${tomorrow}T16:00`)
  await dialog.getByLabel('Motivo da devolução *').fill('Rever necessidade do lead')
  await dialog.getByRole('button', { name: 'Devolver e agendar' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(refused).toContainText('Em atendimento · SDR')
  await expect(refused).toContainText('Venda recusada')
  assert.equal(requests.find(r => r.resource === 'crm_reopen_result').payload.p_assigned_to, sdr)
  const approved = results.getByRole('article', { name: 'Resultado de Aprovado', exact: true })
  await approved.getByRole('button', { name: 'Devolver ao Closer', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Devolver ao Closer', exact: true })
  await dialog.getByLabel('Próxima call · Brasília *').fill(`${tomorrow}T17:00`)
  await dialog.getByLabel('Motivo da devolução *').fill('Retomar acompanhamento comercial')
  await dialog.getByRole('button', { name: 'Devolver e agendar' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(approved).toContainText('Em atendimento · Closer')
  await expect(approved).toContainText('Venda concluída')
  await expect(approved.getByText('Aprovada', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await checkOverflow()
  await page.screenshot({ path: '.verification.local/crm-results-mobile.png', fullPage: true })
  await page.getByRole('tab', { name: 'SDR', exact: true }).click()
  await page.getByRole('button', { name: 'Ações de Sem agenda', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Enviar para Remarketing', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Enviar para Remarketing', exact: true })
  await dialog.getByLabel('Motivo da negativa *').fill('Retomar em outro momento')
  await dialog.getByLabel('Primeiro follow-up de remarketing · Brasília *').fill(`${tomorrow}T18:00`)
  await dialog.getByLabel('Anotação', { exact: true }).fill('Aguardando disponibilidade')
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Lead Atleta Sem agenda' })).toHaveCount(0)
  await page.getByRole('tab', { name: /^Remarketing \d/ }).click()
  const board = page.getByRole('region', { name: 'Fila de remarketing' })
  await expect(board.getByRole('article')).toHaveCount(1)
  await expect(board.getByRole('article')).toContainText('Sem agenda')
  await board.getByLabel('Data do próximo contato').fill(today)
  await expect(board.getByRole('article')).toHaveCount(0)
  await board.getByLabel('Data do próximo contato').fill(tomorrow)
  await expect(board.getByRole('article')).toHaveCount(1)
  await checkOverflow()
  await page.screenshot({ path: '.verification.local/crm-remarketing-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.screenshot({ path: '.verification.local/crm-remarketing-desktop.png', fullPage: true })
  await page.getByRole('tab', { name: 'Leads', exact: true }).click()
  await page.getByRole('button', { name: 'Ações de Retorno hoje', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Enviar para Remarketing', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  // An external sales revision must update both mounted CRM clients without reloads.
  await page.getByRole('tab', { name: 'Resultados', exact: true }).click()
  const secondPage = await context.newPage()
  await secondPage.goto(`${origin}/crm?tab=results`)
  const firstApproval = page.getByRole('article', { name: 'Resultado de Aprovado', exact: true })
  const secondApproval = secondPage.getByRole('article', { name: 'Resultado de Aprovado', exact: true })
  await expect(firstApproval.getByText('Aprovada', { exact: true })).toBeVisible()
  await expect(secondApproval.getByText('Aprovada', { exact: true })).toBeVisible()
  sales[0].approval_status = 'rejeitada'
  signalChange()
  await expect(firstApproval.getByText('Rejeitada', { exact: true })).toBeVisible()
  await expect(secondApproval.getByText('Rejeitada', { exact: true })).toBeVisible()
  await secondPage.close()
  assert.deepEqual(errors, [])
  console.log('PASS: Daily scheduling, editable approach, approval/seller/date filters, both result layouts, SDR/Closer returns, linked sale preservation, remarketing actions, mobile layouts and automatic synchronization in two browser clients. Browser network mocked; no live data changed.')
} finally { await browser.close() }
