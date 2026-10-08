// Real CRM components; only Supabase network/auth are simulated. No production data changes.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Unexpected frontend test origin')
const project = 'mbzwchnxtskysqplqiyy', viewer = randomUUID(), other = randomUUID()
const now = new Date().toISOString()
const profile = { id: viewer, user_id: viewer, display_name: 'Ana Closer', suspended: false, avatar_url: null, created_at: now, updated_at: now }
const leads = ['Alfa', 'Beta', 'Gama', 'Delta'].map(name => ({
  id: randomUUID(), name, athlete_name: `Atleta ${name}`, phone: '11999999999', email: null,
  pipeline_stage: 'em_qualificacao', approach_stage: 'abordado', temperature: 'morno', sdr_id: other, closer_id: null, created_by: viewer,
  created_at: now, updated_at: now, next_followup_at: null, version: 1, followup_status: null, followup_next_at: null, followup_attempt_count: 0,
}))
const id = name => leads.find(l => l.name === name).id
const statuses = ['pendente', 'nao_pago', 'pago'].map((status, i) => ({ lead_id: leads[i].id, status, updated_by: other, updated_at: now }))
const requests = [], errors = [], sockets = []
let failNext = false, failReads = false, releaseSave
const launch = async (browser, role, viewport, closerAccess = false) => {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  await context.routeWebSocket(/supabase\.co/, socket => {
    const channels = new Map()
    sockets.push({ socket, channels })
    socket.onMessage(raw => {
      const m = JSON.parse(String(raw))
      if (m.event === 'phx_join') {
        const bindings = (m.payload.config?.postgres_changes || []).map((b, i) => ({ ...b, id: i + 1 }))
        channels.set(m.topic, bindings)
        socket.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', ref: m.ref, join_ref: m.join_ref, payload: { status: 'ok', response: { postgres_changes: bindings } } }))
      } else if (m.event === 'heartbeat' || m.event === 'phx_leave') {
        if (m.event === 'phx_leave') channels.delete(m.topic)
        socket.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } }))
      }
    })
  })
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url())
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const resource = url.pathname.split('/').at(-1), payload = route.request().postDataJSON() ?? {}
    let data = []
    if (resource === 'get_my_registration_status') data = { status: 'approved' }
    else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
    else if (resource === 'user_roles') data = [{ id: viewer, user_id: viewer, role, crm_access: true, crm_closer_access: closerAccess, commission_rate: 10 }]
    else if (resource === 'crm_can_schedule_qualification_call') data = true
    else if (resource === 'crm_leads') data = leads
    else if (resource === 'crm_call_assignees') data = [{ user_id: viewer, display_name: 'Ana Closer', role: 'closer' }]
    else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
    // Legacy reads allow the RED test to reach the old icon and prove that it opens a sheet instead of a dropdown.
    else if (resource === 'crm_lead_payment_summaries') data = statuses.map(s => ({ ...s, total_count: 1, paid_count: s.status === 'pago' ? 1 : 0, unpaid_count: s.status === 'nao_pago' ? 1 : 0, pending_count: s.status === 'pendente' ? 1 : 0, total_amount: 100, paid_amount: s.status === 'pago' ? 100 : 0, next_due_date: null }))
    else if (resource === 'crm_lead_payment_status') {
      if (failReads) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Falha de leitura' }) })
      data = statuses
    } else if (resource === 'crm_set_payment_status') {
      requests.push({ resource, payload })
      if (releaseSave === true) await new Promise(resolve => { releaseSave = resolve })
      if (failNext) {
        failNext = false
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'Sem permissão para alterar o pagamento.' }) })
      }
      data = statuses.find(s => s.lead_id === payload.p_lead_id)
      if (!data) { data = { lead_id: payload.p_lead_id }; statuses.push(data) }
      Object.assign(data, { status: payload.p_status, updated_by: viewer, updated_at: new Date().toISOString() })
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
  const { context, page } = await launch(browser, 'closer', { width: 1440, height: 1050 })
  // Radix makes the rest of the page aria-hidden while its modal menu is open.
  const card = name => page.getByRole('article', { name: `Lead Atleta ${name}`, includeHidden: true })
  const button = name => card(name).getByRole('button', { name: `Pagamento de ${name}`, exact: true, includeHidden: true })
  const menu = page.getByRole('menu', { name: 'Pagamento de Alfa' })
  await page.goto(`${origin}/crm`)
  await button('Alfa').click()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Pago', 'Pendente', 'Não pago'])
  await expect(menu.getByRole('menuitemradio', { name: 'Pago', exact: true })).toHaveClass(/text-green-400/)
  await expect(menu.getByRole('menuitemradio', { name: 'Pendente', exact: true })).toHaveClass(/text-yellow-400/)
  await expect(menu.getByRole('menuitemradio', { name: 'Não pago', exact: true })).toHaveClass(/text-red-400/)
  await expect(menu.getByRole('menuitemradio', { name: 'Pendente', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: '.verification.local/crm-payment-dropdown-desktop.png', fullPage: true })
  await page.keyboard.press('Escape')
  for (const [name, tone] of [['Alfa', 'yellow'], ['Beta', 'red'], ['Gama', 'green']]) {
    await expect(button(name)).toHaveClass(new RegExp(`text-${tone}-400`))
    assert.equal(await card(name).getByRole('button').first().getAttribute('aria-label'), `Pagamento de ${name}`)
    assert.equal(await card(name).getByRole('button').nth(1).getAttribute('aria-label'), `Contexto de ${name}`)
    await expect(card(name)).not.toContainText('R$')
  }
  await expect(button('Delta')).toHaveClass(/text-muted-foreground/)
  await expect(card('Delta').getByLabel(/^Pagamento:/)).toHaveCount(0)
  // Selecting any status saves immediately with only the lead and status; no reason/date/value form.
  for (const [label, status, tone] of [['Pago', 'pago', 'green'], ['Não pago', 'nao_pago', 'red'], ['Pendente', 'pendente', 'yellow']]) {
    await button('Alfa').click()
    await menu.getByRole('menuitemradio', { name: label, exact: true }).click()
    await expect(menu).toHaveCount(0)
    assert.deepEqual(requests.at(-1), { resource: 'crm_set_payment_status', payload: { p_lead_id: id('Alfa'), p_status: status } })
    await expect(card('Alfa').getByLabel(`Pagamento: ${label}`, { exact: true })).toHaveClass(new RegExp(`text-${tone}-400`))
    await expect(button('Alfa')).toHaveClass(new RegExp(`text-${tone}-400`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  const previous = requests.length
  await button('Alfa').click()
  await menu.getByRole('menuitemradio', { name: 'Pendente', exact: true }).click()
  await expect(menu).toHaveCount(0)
  assert.equal(requests.length, previous, 'same selection must not send another write')
  // Failed writes leave the saved value intact and expose a retryable error.
  failNext = true
  await button('Alfa').click()
  await menu.getByRole('menuitemradio', { name: 'Pago', exact: true }).click()
  await expect(menu.getByRole('alert')).toContainText('Sem permissão')
  await expect(menu.getByRole('menuitemradio', { name: 'Pendente', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(button('Alfa')).toHaveClass(/text-yellow-400/)
  // An in-flight save disables all choices; it does not optimistically paint an unconfirmed status.
  releaseSave = true
  await menu.getByRole('menuitemradio', { name: 'Pago', exact: true }).click()
  await expect.poll(() => typeof releaseSave).toBe('function')
  for (const item of await menu.getByRole('menuitemradio').all()) await expect(item).toHaveAttribute('aria-disabled', 'true')
  await expect(button('Alfa')).toHaveClass(/text-yellow-400/)
  releaseSave(); releaseSave = undefined
  await expect(menu).toHaveCount(0)
  await expect(button('Alfa')).toHaveClass(/text-green-400/)
  // First selection for an untouched lead persists through reload.
  await button('Delta').click()
  await page.getByRole('menu', { name: 'Pagamento de Delta' }).getByRole('menuitemradio', { name: 'Pendente', exact: true }).click()
  await expect(button('Delta')).toHaveClass(/text-yellow-400/)
  const oldSocketCount = sockets.length
  await page.reload()
  await expect(button('Delta')).toHaveClass(/text-yellow-400/)
  // Another user's realtime update repaints both the badge and the action.
  const updated = statuses.find(s => s.lead_id === id('Alfa'))
  updated.status = 'nao_pago'
  await expect.poll(() => sockets.slice(oldSocketCount).some(s => [...s.channels.values()].some(bs => bs.some(b => b.table === 'crm_lead_payment_status')))).toBe(true)
  for (const { socket, channels } of sockets.slice(oldSocketCount)) for (const [topic, bindings] of channels) {
    const ids = bindings.filter(b => b.table === 'crm_lead_payment_status').map(b => b.id)
    if (ids.length) socket.send(JSON.stringify({ topic, event: 'postgres_changes', payload: { ids, data: {
      schema: 'public', table: 'crm_lead_payment_status', type: 'UPDATE', commit_timestamp: new Date().toISOString(),
      columns: [{ name: 'lead_id', type: 'uuid' }, { name: 'status', type: 'text' }, { name: 'updated_by', type: 'uuid' }, { name: 'updated_at', type: 'timestamptz' }],
      record: updated, old_record: {}, errors: null,
    } } }))
  }
  await expect(button('Alfa')).toHaveClass(/text-red-400/)
  await button('Alfa').focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await card('Alfa').getByRole('button', { name: 'Contexto de Alfa', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Ficha de Atleta Alfa' })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('menuitemradio')).toHaveCount(0)
  await context.close()

  const phone = await launch(browser, 'closer', { width: 390, height: 844 })
  await phone.page.goto(`${origin}/crm`)
  await phone.page.getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
  const phoneMenu = phone.page.getByRole('menu', { name: 'Pagamento de Alfa' })
  await expect(phoneMenu).toBeVisible()
  const box = await phoneMenu.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'dropdown fits phone viewport')
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await phone.page.screenshot({ path: '.verification.local/crm-payment-dropdown-mobile.png', fullPage: true })
  await phone.context.close()

  for (const role of ['sdr', 'seller']) {
    const readonly = await launch(browser, role, { width: 1440, height: 1050 })
    await readonly.page.goto(`${origin}/crm`)
    await readonly.page.getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
    const readMenu = readonly.page.getByRole('menu', { name: 'Pagamento de Alfa' })
    await expect(readMenu).toContainText('Somente leitura')
    for (const item of await readMenu.getByRole('menuitemradio').all()) await expect(item).toHaveAttribute('aria-disabled', 'true')
    await readonly.context.close()
  }
  for (const [role, access] of [['executive', false], ['sdr', true]]) {
    const editor = await launch(browser, role, { width: 1440, height: 1050 }, access)
    await editor.page.goto(`${origin}/crm`)
    await editor.page.getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
    await expect(editor.page.getByRole('menuitemradio', { name: 'Pago', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
    await editor.context.close()
  }
  // A read failure must not masquerade as an unset status that can be overwritten.
  failReads = true
  const broken = await launch(browser, 'closer', { width: 1440, height: 1050 })
  await broken.page.goto(`${origin}/crm`)
  await broken.page.getByRole('button', { name: 'Pagamento de Alfa', exact: true }).click()
  await expect(broken.page.getByRole('menu').getByRole('alert')).toContainText('carregar')
  await expect(broken.page.getByRole('menuitemradio')).toHaveCount(0)
  failReads = false
  await broken.page.getByRole('menuitem', { name: 'Tentar novamente' }).click()
  await expect(broken.page.getByRole('menuitemradio')).toHaveCount(3)
  await broken.context.close()
  assert.deepEqual(errors, [])
  console.log('PASS: payment dropdown, 3 colors, 2-click saves, no forms, first status/reload, idempotency, failure/busy handling, realtime, keyboard, phone and role permissions.')
} finally { await browser.close() }
