// UI contract tests with intercepted API responses. No remote mutations or real login.
// Database permissions are tested separately by check-crm-db.mjs.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import {
  chromium,
  expect as baseExpect
} from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 12000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw Error('UI contract tests require a local origin.')
const project = 'mbzwchnxtskysqplqiyy'
const sdr = randomUUID(),
  closer = randomUUID(),
  product = randomUUID(),
  ticket = randomUUID()
const leads = [],
  activities = [],
  sales = [],
  requests = [],
  errors = []
const now = () => new Date().toISOString()
const browser = await chromium.launch({ channel: 'chromium', headless: true })
mkdirSync('.verification.local', { recursive: true })
let page
async function session(actor, role, viewport = { width: 1440, height: 1080 }) {
  const context = await browser.newContext({ viewport })
  await context.routeWebSocket('**/realtime/**', (socket) => socket.close())
  const user = {
    id: actor,
    email: `${role}@example.invalid`,
    aud: 'authenticated',
    role: 'authenticated',
    created_at: now(),
    user_metadata: { display_name: `QA ${role}` },
    app_metadata: { provider: 'email' }
  }
  const token = [
    { alg: 'HS256', typ: 'JWT' },
    { sub: actor, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
    'test'
  ]
    .map((x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url'))
    .join('.')
  await context.addInitScript(
    ({ project, token, user }) =>
      sessionStorage.setItem(
        `sb-${project}-auth-token`,
        JSON.stringify({
          access_token: token,
          refresh_token: 'test-only',
          token_type: 'bearer',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user
        })
      ),
    { project, token, user }
  )
  await context.route('https://*.supabase.co/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.split('/').at(-1),
      method = req.method()
    const body = req.postDataJSON()
    const json = (data) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname.startsWith('/auth/')) return json(user)
    if (!url.pathname.startsWith('/rest/')) return route.abort()
    const single = req.headers().accept?.includes('vnd.pgrst.object')
    const filter = (rows) =>
      rows.filter((r) =>
        ['id', 'lead_id'].every(
          (k) => !url.searchParams.has(k) || r[k] === url.searchParams.get(k).replace('eq.', '')
        )
      )
    const result = (rows) => json(single ? rows[0] : rows)
    if (method !== 'GET') requests.push({ name, body })
    if (name === 'profiles')
      return json({
        id: actor,
        user_id: actor,
        display_name: `QA ${role}`,
        suspended: false,
        avatar_url: null,
        created_at: now(),
        updated_at: now()
      })
    if (name === 'user_roles')
      return json([{ role, crm_access: true, can_view_sales: true, commission_rate: 10 }])
    if (name === 'crm_call_assignees')
      return json([
        { user_id: sdr, display_name: 'Ismael QA', role: 'sdr' },
        { user_id: closer, display_name: 'David QA', role: 'closer' }
      ])
    if (name === 'crm_leads') {
      if (method === 'POST')
        leads.unshift({
          ...body,
          id: randomUUID(),
          temperature: body.temperature || 'frio',
          priority: 'normal',
          pipeline_stage: 'novo',
          approach_count: 0,
          created_at: now(),
          updated_at: now()
        })
      if (method === 'PATCH') filter(leads).forEach((l) => Object.assign(l, body))
      return result(method === 'POST' ? [leads[0]] : filter(leads))
    }
    if (name === 'crm_activities') {
      if (method === 'POST')
        activities.unshift({
          ...body,
          id: randomUUID(),
          author_name: `QA ${role}`,
          created_at: now(),
          updated_at: now(),
          call_type: null
        })
      return result(filter(activities).filter((a) => !url.searchParams.has('call_type') || a.call_type))
    }
    if (name === 'schedule_closer_call') {
      const call = {
        id: randomUUID(),
        lead_id: body.p_lead_id,
        user_id: actor,
        activity_type: 'reuniao',
        title: body.p_call_type === 'qualificacao' ? 'Qualificação' : 'Fechamento com Closer',
        call_type: body.p_call_type,
        assigned_to: body.p_assigned_to,
        scheduled_at: body.p_scheduled_at,
        description: body.p_context,
        is_completed: false,
        outcome: null,
        completed_at: null,
        created_at: now(),
        updated_at: now()
      }
      activities.unshift(call)
      leads.find((l) => l.id === call.lead_id).pipeline_stage =
        call.call_type === 'qualificacao' ? 'em_qualificacao' : 'repassado_closer'
      return json(call)
    }
    if (name === 'reschedule_crm_call') {
      const call = activities.find((a) => a.id === body.p_activity_id)
      assert.equal(body.p_expected_revision, call.updated_at)
      Object.assign(call, { scheduled_at: body.p_scheduled_at, updated_at: now() })
      return json(call)
    }
    if (name === 'resolve_closer_call') {
      const call = activities.find((a) => a.id === body.p_activity_id)
      assert.equal(body.p_expected_revision, call.updated_at)
      Object.assign(call, {
        is_completed: true,
        outcome: body.p_outcome,
        completed_at: now(),
        updated_at: now()
      })
      leads.find((l) => l.id === call.lead_id).pipeline_stage =
        body.p_outcome === 'venda_concluida'
          ? 'fechado_ganho'
          : body.p_outcome === 'venda_perdida'
            ? 'fechado_perdido'
            : 'em_qualificacao'
      return json(call)
    }
    if (name === 'products')
      return json([
        {
          id: product,
          name: 'Avaliação de performance',
          description: null,
          active: true,
          updated_at: now(),
          product_tickets: [
            {
              id: ticket,
              product_id: product,
              name: 'Completo',
              price: 1497,
              active: true,
              updated_at: now()
            }
          ]
        }
      ])
    if (name === 'vendas' && method === 'POST') {
      sales.push(...(Array.isArray(body) ? body : [body]))
      return json(null)
    }
    return json([])
  })
  const tab = await context.newPage()
  tab.on('pageerror', (error) => errors.push(error.message))
  await tab.goto(`${origin}/crm`)
  return tab
}
const localFuture = (days) => {
  const date = new Date(Date.now() + days * 86400000)
  return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
try {
  page = await session(sdr, 'sdr')
  await expect(page.getByRole('tab', { name: 'SDR', exact: true })).toBeVisible()
  assert.equal(await page.getByRole('tab', { name: "Closer's", exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Novo Lead', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Novo Lead', exact: true })
  await expect(form.getByText('Cargo', { exact: true })).toHaveCount(0)
  await form.getByRole('button', { name: 'Criar Lead', exact: true }).click()
  assert.equal(leads.length, 0)
  await form.getByLabel('Nome do responsável *', { exact: true }).fill('Mariana Silva')
  await form.getByLabel('WhatsApp *', { exact: true }).fill('11999999999')
  await form.getByLabel('E-mail *', { exact: true }).fill('mariana@example.invalid')
  await form.getByLabel('Nome do atleta *', { exact: true }).fill('Lucas Silva')
  await form.getByLabel('Data de nascimento *', { exact: true }).fill('2012-06-15')
  await form.getByLabel('Posição em campo *', { exact: true }).selectOption('Meia')
  await form.getByRole('button', { name: 'Criar Lead', exact: true }).click()
  await expect(form).toHaveCount(0)
  assert.equal(leads[0].athlete_height_cm, null)
  assert.equal(leads[0].athlete_weight_kg, null)
  await page.getByRole('tab', { name: 'SDR', exact: true }).click()
  await page.getByLabel('Temperatura de Mariana Silva').selectOption('quente')
  await page.getByRole('button', { name: 'Abrir ficha / agendar', exact: true }).click()
  await page
    .getByLabel('Nova anotação', { exact: true })
    .fill('Família busca avaliação técnica; pai participará da call.')
  await page.getByRole('button', { name: 'Adicionar contexto', exact: true }).click()
  await expect(
    page.getByText('Família busca avaliação técnica; pai participará da call.', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Agendar call', exact: true }).click()
  let scheduler = page.getByRole('dialog', { name: 'Agendar call', exact: true })
  await scheduler.getByLabel('Data e hora (horário local)', { exact: true }).fill(localFuture(1))
  await scheduler.getByRole('button', { name: 'Agendar', exact: true }).click()
  await expect(scheduler).toHaveCount(0)
  await page.getByRole('button', { name: 'Avançou', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar resultado', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Confirmar resultado', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Agendar call', exact: true }).click()
  scheduler = page.getByRole('dialog', { name: 'Agendar call', exact: true })
  await scheduler.getByLabel('Tipo da call', { exact: true }).selectOption('fechamento_closer')
  await scheduler.getByLabel('Responsável', { exact: true }).selectOption(closer)
  await scheduler.getByLabel('Data e hora (horário local)', { exact: true }).fill(localFuture(2))
  await scheduler
    .getByLabel('Contexto da reunião', { exact: true })
    .fill('Participantes: Mariana e pai do Lucas')
  await scheduler.getByRole('button', { name: 'Agendar', exact: true }).click()
  await expect(scheduler).toHaveCount(0)
  const closing = activities.find((a) => a.call_type === 'fechamento_closer'),
    closingId = closing.id
  await page.getByRole('button', { name: 'Reagendar', exact: true }).click()
  scheduler = page.getByRole('dialog', { name: 'Reagendar call', exact: true })
  await scheduler.getByLabel('Data e hora (horário local)', { exact: true }).fill(localFuture(3))
  await scheduler.getByRole('button', { name: 'Salvar horário', exact: true }).click()
  await expect(scheduler).toHaveCount(0)
  assert.equal(closing.id, closingId)
  assert.equal(activities.filter((a) => a.call_type === 'fechamento_closer').length, 1)
  assert.equal(await page.getByRole('button', { name: 'Venda concluída', exact: true }).count(), 0)
  await page.screenshot({ path: '.verification.local/crm-sdr-detail.png', animations: 'disabled' })

  page = await session(closer, 'closer')
  assert.equal(await page.getByRole('tab', { name: 'SDR', exact: true }).count(), 0)
  await page.getByRole('tab', { name: "Closer's", exact: true }).click()
  await expect(page.getByText('Participantes: Mariana e pai do Lucas', { exact: true })).toBeVisible()
  await page.screenshot({ path: '.verification.local/crm-closer-desktop.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: '.verification.local/crm-closer-mobile.png',
    animations: 'disabled',
    fullPage: true
  })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    'Mobile overflow'
  )
  await page.getByRole('button', { name: 'Venda concluída', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar resultado', exact: true }).click()
  await expect(
    page.getByText('Fechou. Bola pra frente, a próxima venda é sempre a melhor.', { exact: true })
  ).toBeVisible()
  assert.equal(sales.length, 0, 'CRM must not create revenue automatically')
  await page.getByRole('button', { name: 'Registrar venda de Mariana Silva', exact: true }).click()
  await expect(page.getByLabel('Nome Do Comprador *', { exact: true })).toHaveValue('Mariana Silva')
  await expect(page.getByLabel('WhatsApp Do Comprador *', { exact: true })).toHaveValue('11999999999')
  await page.getByRole('combobox', { name: 'Nome Do Produto Vendido *', exact: true }).click()
  await page.getByRole('option', { name: 'Avaliação de performance', exact: true }).click()
  await page.getByRole('combobox', { name: 'Ticket e valor da venda *', exact: true }).click()
  await page.getByRole('option', { name: /Completo/ }).click()
  await page.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
  await expect.poll(() => sales.length).toBe(1)
  assert.equal(sales[0].crm_lead_id, leads[0].id)
  assert.equal(sales[0].valor_venda, 1497)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(
    'PASS: desktop/mobile UI, role tabs, validation, context log, qualification, handoff, reschedule, closing and manual sale linkage. API responses mocked; no remote mutations.'
  )
} catch (error) {
  if (page) await page.screenshot({ path: '.verification.local/crm-ui-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
}
