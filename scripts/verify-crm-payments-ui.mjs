// Browser contract test for the CRM lead payments (Pago verde / Não pago vermelho / Pendente amarelo). Supabase traffic and WebSockets are mocked.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { addDaysToDateKey, brasiliaDateKey } from '../src/lib/brasilia-time.ts'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Unexpected frontend test origin')
const project = 'mbzwchnxtskysqplqiyy'
const viewer = randomUUID(), other = randomUUID()
const now = new Date().toISOString()
const day = offset => addDaysToDateKey(brasiliaDateKey(), offset)
const profile = { id: viewer, user_id: viewer, display_name: 'Ana Closer', suspended: false, avatar_url: null, created_at: now, updated_at: now }
const lead = name => ({
  id: randomUUID(), name, athlete_name: `Atleta ${name}`, phone: '11999999999', email: null,
  pipeline_stage: 'em_qualificacao', approach_stage: 'abordado', temperature: 'morno', sdr_id: other, closer_id: null, created_by: viewer,
  created_at: now, updated_at: now, next_followup_at: null, version: 1, remarketing_status: null, remarketing_next_at: null, remarketing_attempt_count: 0,
})
const leads = ['Alfa', 'Beta', 'Gama', 'Delta'].map(lead)
const id = name => leads.find(l => l.name === name).id
let tick = 0
const stamp = () => new Date(Date.now() + ++tick * 1000).toISOString()
const entry = (leadName, description, amount, method, status, extra = {}) => ({
  id: randomUUID(), lead_id: id(leadName), description, amount, method, due_date: null, status, paid_at: null, status_reason: null, proof_url: null,
  notes: null, created_by: other, updated_by: other, created_at: now, updated_at: now, ...extra,
})
const payments = [
  entry('Alfa', 'Entrada', 500, 'pix', 'pendente', { due_date: day(3) }),
  entry('Alfa', 'Parcela 2/2', 700, 'boleto', 'pendente', { due_date: day(30) }),
  entry('Beta', 'Pagamento único', 3000, 'pix', 'nao_pago', { status_reason: 'Cartão recusado' }),
  entry('Gama', 'Pagamento único', 1500, 'cartao_credito', 'pago', { paid_at: now }),
]
const summaries = () => [...Map.groupBy(payments, p => p.lead_id)].map(([lead_id, rows]) => {
  const count = status => rows.filter(p => p.status === status).length
  const sum = list => list.reduce((total, p) => total + p.amount, 0)
  const pendingDue = rows.filter(p => p.status === 'pendente' && p.due_date).map(p => p.due_date).sort()
  return { lead_id, total_count: rows.length, paid_count: count('pago'), unpaid_count: count('nao_pago'), pending_count: count('pendente'),
    total_amount: sum(rows), paid_amount: sum(rows.filter(p => p.status === 'pago')),
    status: count('nao_pago') ? 'nao_pago' : count('pago') === rows.length ? 'pago' : 'pendente', next_due_date: pendingDue[0] ?? null }
})
const requests = [], errors = [], sockets = []
let failNext = false

const launch = async (browser, role, viewport) => {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
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
    else if (resource === 'user_roles') data = [{ id: viewer, user_id: viewer, role, crm_access: true, commission_rate: 10 }]
    else if (resource === 'crm_can_schedule_qualification_call') data = true
    else if (resource === 'crm_leads') data = leads
    else if (resource === 'crm_call_assignees') data = [{ user_id: viewer, display_name: 'Ana Closer', role: 'closer' }, { user_id: other, display_name: 'Gestor QA', role: 'executive' }]
    else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
    else if (resource === 'crm_lead_payment_summaries') data = summaries()
    else if (resource === 'crm_lead_payments') data = payments.filter(p => p.lead_id === url.searchParams.get('lead_id')?.slice(3))
    else if (resource.startsWith('crm_payment_')) {
      requests.push({ resource, payload })
      if (failNext) {
        failNext = false
        return route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ code: 'PT409', message: 'Lançamento alterado. Atualize e tente novamente.', details: null, hint: null }) })
      }
      if (resource === 'crm_payment_set_status') {
        data = payments.find(p => p.id === payload.p_payment_id)
        Object.assign(data, { status: payload.p_status, paid_at: payload.p_status === 'pago' ? payload.p_paid_at ?? new Date().toISOString() : null,
          status_reason: payload.p_status === 'nao_pago' ? payload.p_reason : null, updated_by: viewer, updated_at: stamp() })
      } else if (resource === 'crm_payment_save') {
        data = payload.p_payment_id ? payments.find(p => p.id === payload.p_payment_id)
          : entry(leads.find(l => l.id === payload.p_lead_id).name, '', 1, 'pix', 'pendente')
        Object.assign(data, { description: payload.p_description, amount: payload.p_amount, method: payload.p_method, due_date: payload.p_due_date,
          notes: payload.p_notes, proof_url: payload.p_proof_url, lead_id: payload.p_lead_id, updated_by: viewer, updated_at: stamp() })
        if (!payload.p_payment_id) payments.push(data)
      } else if (resource === 'crm_payment_delete') {
        const at = payments.findIndex(p => p.id === payload.p_payment_id)
        data = { payment_id: payload.p_payment_id, lead_id: payments[at].lead_id }
        payments.splice(at, 1)
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await context.addInitScript(({ viewer, project }) => {
    const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({ alg: 'HS256' })}.${enc({ sub: viewer, role: 'authenticated', exp: 4102444800 })}.qa`, refresh_token: 'qa', expires_at: 4102444800,
      user: { id: viewer, email: 'closer@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Ana Closer' }, created_at: new Date().toISOString() } }))
  }, { viewer, project })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  return { context, page }
}

const browser = await chromium.launch({ headless: true })
try {
  // ---- Closer: badges on the cards, the sheet and every action. ----
  const { context, page } = await launch(browser, 'closer', { width: 1440, height: 1050 })
  await page.goto(`${origin}/crm`)
  const card = name => page.getByRole('article', { name: `Lead Atleta ${name}` })
  const badge = (scope, text) => scope.getByLabel(new RegExp(`^Pagamento: ${text}`))
  await expect(badge(card('Alfa'), 'Pendente')).toHaveClass(/text-yellow-400/)
  await expect(badge(card('Beta'), 'Não pago')).toHaveClass(/text-red-400/)
  await expect(badge(card('Gama'), 'Pago')).toHaveClass(/text-green-400/)
  await expect(card('Delta').getByLabel(/^Pagamento:/)).toHaveCount(0)
  await expect(card('Alfa')).toContainText('R$ 0,00 de R$ 1.200,00')
  await expect(card('Gama')).toContainText('R$ 1.500,00')
  await page.screenshot({ path: '.verification.local/crm-payments-cards.png', fullPage: true })

  // O pagamento tem o próprio ícone, logo à esquerda do de Contexto (nunca dentro dele), na cor do status.
  const iconNames = lead => card(lead).getByRole('button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')).filter(Boolean))
  for (const name of ['Alfa', 'Beta', 'Gama', 'Delta']) {
    const names = await iconNames(name)
    assert.equal(names.indexOf(`Pagamento de ${name}`), names.indexOf(`Contexto de ${name}`) - 1, `payment icon sits right before (left of) the context icon (${name})`)
    assert.equal(names.indexOf(`Pagamento de ${name}`), 0, `payment icon is the first card action (${name})`)
  }
  await expect(card('Alfa').getByRole('button', { name: 'Pagamento de Alfa', exact: true })).toHaveClass(/text-yellow-400/)
  await expect(card('Beta').getByRole('button', { name: 'Pagamento de Beta', exact: true })).toHaveClass(/text-red-400/)
  await expect(card('Gama').getByRole('button', { name: 'Pagamento de Gama', exact: true })).toHaveClass(/text-green-400/)
  await expect(card('Delta').getByRole('button', { name: 'Pagamento de Delta', exact: true })).toHaveClass(/text-muted-foreground/)
  await card('Alfa').getByRole('button', { name: 'Contexto de Alfa', exact: true }).click()
  const contextSheet = page.getByRole('dialog', { name: 'Ficha de Atleta Alfa' })
  await expect(contextSheet).toBeVisible()
  await expect(contextSheet.getByRole('region', { name: 'Pagamento' })).toHaveCount(0)
  await expect(contextSheet.getByRole('button', { name: 'Novo lançamento' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(contextSheet).toHaveCount(0)
  await card('Alfa').getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Pagamento de Atleta Alfa' })
  const panel = sheet.getByRole('region', { name: 'Pagamento' })
  await expect(badge(panel, 'Pendente').first()).toHaveClass(/text-yellow-400/)
  await expect(panel).toContainText('R$ 0,00 de R$ 1.200,00 recebidos')
  await expect(panel).toContainText('Próximo vencimento')
  const row = text => panel.getByRole('listitem').filter({ hasText: text })
  await page.screenshot({ path: '.verification.local/crm-payments-sheet-desktop.png', fullPage: true })

  // Pago: the date defaults to now (Brasília) and goes to the server as ISO with the revision the screen showed.
  const entrada = payments.find(p => p.description === 'Entrada'), revision = entrada.updated_at
  await panel.getByRole('button', { name: 'Marcar Entrada como Pago', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Marcar como Pago' })
  await dialog.getByRole('button', { name: 'Marcar como Pago', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  let sent = requests.at(-1)
  assert.equal(sent.resource, 'crm_payment_set_status')
  assert.deepEqual([sent.payload.p_payment_id, sent.payload.p_status, sent.payload.p_reason, sent.payload.p_expected_revision], [entrada.id, 'pago', null, revision])
  assert.ok(Math.abs(Date.parse(sent.payload.p_paid_at) - Date.now()) < 3 * 60_000, 'paid date defaults to now')
  await expect(badge(row('Entrada'), 'Pago')).toHaveClass(/text-green-400/)
  await expect(panel).toContainText('R$ 500,00 de R$ 1.200,00 recebidos')
  await expect(badge(panel, 'Pendente').first()).toBeVisible()

  // Não pago: needs a reason; nothing is sent until there is one.
  await panel.getByRole('button', { name: 'Marcar Parcela 2/2 como Não pago', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Marcar como Não pago' })
  const before = requests.length
  await dialog.getByRole('button', { name: 'Marcar como Não pago', exact: true }).click()
  assert.equal(requests.length, before, 'the browser blocks an empty reason')
  await dialog.getByLabel('Motivo *').fill('    ')
  await dialog.getByRole('button', { name: 'Marcar como Não pago', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('motivo')
  assert.equal(requests.length, before, 'a blank reason is refused by the app')
  await dialog.getByLabel('Motivo *').fill('Cartão recusado')
  await dialog.getByRole('button', { name: 'Marcar como Não pago', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  sent = requests.at(-1).payload
  assert.deepEqual([sent.p_status, sent.p_reason, sent.p_paid_at], ['nao_pago', 'Cartão recusado', null])
  await expect(badge(row('Parcela 2/2'), 'Não pago')).toHaveClass(/text-red-400/)
  await expect(row('Parcela 2/2')).toContainText('Motivo: Cartão recusado')
  await expect(badge(panel, 'Não pago').first()).toHaveClass(/text-red-400/)
  await page.screenshot({ path: '.verification.local/crm-payments-sheet-unpaid.png', fullPage: true })

  // A stale revision keeps the dialog open with the database message.
  failNext = true
  await panel.getByRole('button', { name: 'Marcar Parcela 2/2 como Pago', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Marcar como Pago' })
  await dialog.getByRole('button', { name: 'Marcar como Pago', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Lançamento alterado. Atualize e tente novamente.')
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // Everything Pago: the lead badge turns green.
  await panel.getByRole('button', { name: 'Marcar Parcela 2/2 como Pago', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Marcar como Pago' })
  await dialog.getByRole('button', { name: 'Marcar como Pago', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(badge(panel, 'Pago').first()).toHaveClass(/text-green-400/)
  await expect(panel).toContainText('R$ 1.200,00 de R$ 1.200,00 recebidos')
  await expect(row('Parcela 2/2')).not.toContainText('Motivo:')

  // Back to Pendente clears the paid date.
  await panel.getByRole('button', { name: 'Marcar Entrada como Pendente', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Voltar para Pendente' })
  await dialog.getByRole('button', { name: 'Voltar para Pendente', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(entrada.paid_at, null)
  await expect(badge(row('Entrada'), 'Pendente')).toHaveClass(/text-yellow-400/)

  // New entry: pt-BR money, method and due date reach the server in the right shape.
  await panel.getByRole('button', { name: 'Novo lançamento', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Novo lançamento de pagamento' })
  await dialog.getByLabel('Descrição *').fill('Taxa de matrícula')
  await dialog.getByLabel('Valor (R$) *').fill('1.500,50')
  await dialog.getByLabel('Forma de pagamento *').selectOption('boleto')
  await dialog.getByLabel('Vencimento').fill(day(5))
  await dialog.getByLabel('Comprovante (link do Google Drive)').fill('https://evil.test/x')
  await dialog.getByRole('button', { name: 'Registrar lançamento' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Google Drive')
  await dialog.getByLabel('Comprovante (link do Google Drive)').fill('https://drive.google.com/file/d/qa/view')
  await dialog.getByRole('button', { name: 'Registrar lançamento' }).click()
  await expect(dialog).toHaveCount(0)
  sent = requests.at(-1).payload
  assert.deepEqual(sent, { p_lead_id: id('Alfa'), p_payment_id: null, p_description: 'Taxa de matrícula', p_amount: 1500.5, p_method: 'boleto',
    p_due_date: day(5), p_notes: null, p_proof_url: 'https://drive.google.com/file/d/qa/view', p_expected_revision: null })
  await expect(row('Taxa de matrícula')).toContainText('R$ 1.500,50')
  await expect(row('Taxa de matrícula')).toContainText('Boleto')
  await expect(row('Taxa de matrícula').getByRole('link', { name: 'Abrir comprovante' })).toHaveAttribute('rel', 'noopener noreferrer')

  // Edit sends the revision; remove needs a reason.
  const taxa = payments.find(p => p.description === 'Taxa de matrícula')
  await panel.getByRole('button', { name: 'Editar Taxa de matrícula', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Editar lançamento' })
  await expect(dialog.getByLabel('Valor (R$) *')).toHaveValue('1500,50')
  await dialog.getByLabel('Valor (R$) *').fill('1600')
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(dialog).toHaveCount(0)
  assert.deepEqual([requests.at(-1).payload.p_payment_id, requests.at(-1).payload.p_amount], [taxa.id, 1600])
  await panel.getByRole('button', { name: 'Remover Taxa de matrícula', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Remover lançamento' })
  const beforeRemove = requests.length
  await dialog.getByRole('button', { name: 'Remover lançamento', exact: true }).click()
  assert.equal(requests.length, beforeRemove, 'the browser blocks an empty reason')
  await dialog.getByLabel('Motivo da remoção *').fill('   ')
  await dialog.getByRole('button', { name: 'Remover lançamento', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('motivo')
  assert.equal(requests.length, beforeRemove, 'a blank reason is refused by the app')
  await dialog.getByLabel('Motivo da remoção *').fill('Lançado por engano')
  await dialog.getByRole('button', { name: 'Remover lançamento', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.deepEqual([requests.at(-1).resource, requests.at(-1).payload.p_reason], ['crm_payment_delete', 'Lançado por engano'])
  await expect(row('Taxa de matrícula')).toHaveCount(0)
  await context.close()

  // ---- Phone width: the sheet and its actions stay inside the screen. ----
  const phone = await launch(browser, 'closer', { width: 390, height: 844 })
  await phone.page.goto(`${origin}/crm`)
  await phone.page.getByRole('article', { name: 'Lead Atleta Alfa' }).getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
  const phonePanel = phone.page.getByRole('dialog', { name: 'Pagamento de Atleta Alfa' }).getByRole('region', { name: 'Pagamento' })
  await expect(phonePanel).toBeVisible()
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal page scroll')
  await phone.page.screenshot({ path: '.verification.local/crm-payments-sheet-mobile.png', fullPage: true })
  await phone.context.close()

  // ---- SDR without Closer access: reads everything, changes nothing. ----
  const sdr = await launch(browser, 'sdr', { width: 1440, height: 1050 })
  await sdr.page.goto(`${origin}/crm`)
  await expect(badge(sdr.page.getByRole('article', { name: 'Lead Atleta Beta' }), 'Não pago')).toBeVisible()
  await sdr.page.getByRole('article', { name: 'Lead Atleta Alfa' }).getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
  const readOnly = sdr.page.getByRole('dialog', { name: 'Pagamento de Atleta Alfa' }).getByRole('region', { name: 'Pagamento' })
  await expect(readOnly).toContainText('Parcela 2/2')
  await expect(readOnly.getByRole('button')).toHaveCount(0)
  await sdr.context.close()

  assert.deepEqual(errors, [])
  console.log('PASS: CRM lead payments in the browser: green/red/yellow badges with icons on cards, own payment icon right to the left of the context icon (and nothing inside Contexto), payment sheet, mark Pago/Não pago/Pendente (reason, revision, default date), new/edit/remove entries, stale revision message, phone width, read-only for roles without Closer access. Browser network mocked; no live data changed.')
} finally { await browser.close() }
