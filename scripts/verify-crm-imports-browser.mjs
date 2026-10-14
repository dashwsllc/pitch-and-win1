// Real React + Chromium in two isolated SDR sessions; synthetic HTTP only.
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, USER_ID } from './perf/mock.mjs'

const expect = baseExpect.configure({ timeout: 20000 })
const origin = process.env.TRAFFIC_TEST_ORIGIN || 'http://127.0.0.1:5199'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const fixture = buildFixtures({ sales: 0, approaches: 0, role: 'sdr' }), calls = [], errors = []
const now = Date.now(), ago = seconds => new Date(now - seconds * 1000).toISOString()
const longAnswer = 'Contexto integral do responsável: ' + 'resposta extensa '.repeat(350) + 'FIM DA RESPOSTA'
function lead(index, name, channel, method, received, generated) {
  return { id: `ce120000-0000-4000-8000-${String(index).padStart(12,'0')}`, name, phone: '+5511999990000', email: 'qa@example.invalid',
    athlete_name: null, age: null, athlete_age: null, temperature: 'frio', priority: 0, estimated_deal_value: null,
    pipeline_stage: 'novo', approach_stage: 'nao_abordado', lead_source: channel === 'website' ? 'site_conversion' : 'meta_ads_form',
    meta_form_lead_id: `ce130000-0000-4000-8000-${String(index).padStart(12,'0')}`, lead_generated_at: generated,
    lead_received_at: received, import_channel: channel, import_method: method, created_at: ago(index * 500), updated_at: ago(1),
    sdr_id: null, closer_id: null, approached: false, approach_count: 0, tags: [], followup_attempt_count: 0, version: 1,
    import_snapshot: { created_time: generated, first_received_at: received, campaign_name: 'Campanha sintética QA', form_name: 'Formulário QA',
      batch_filename: method === 'manual' ? 'captura-manual.csv' : null, field_data: [{ name: 'Contexto da família', values: [longAnswer] }],
      custom_disclaimer_responses: [{ consent: 'CONSENTIMENTO INTEGRAL QA' }], import_contact: { time_known: true },
      source_snapshot: { utm_source: 'campaign-qa', raw_cells: { 'Resposta adicional': 'DADO NÃO MAPEADO PRESERVADO' } } } }
}
const state = { revision: 1, leads: [
  lead(1, 'Site Manual', 'website', 'manual', ago(52), ago(60)),
  lead(2, 'Formulário Automático', 'form', 'automatic', ago(31), ago(35)),
  // Newly recovered older generation has priority by receipt, not CRM creation or generation.
  lead(3, 'Formulário Recuperado', 'form', 'manual', ago(17), ago(86400 * 7)),
] }
state.leads[2].import_snapshot.import_contact = { time_known: false, source_has_date: false }
const clock = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))
const browser = await chromium.launch({ headless: true })
async function session(index) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce' })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('https://**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const name = url.pathname.split('/').at(-1), args = request.postDataJSON() ?? {}
    calls.push({ session: index, name, select: url.searchParams.get('select'), method: request.method() })
    let data = []
    if (name === 'profiles') data = { user_id: USER_ID, display_name: 'SDR QA', suspended: false }
    else if (name === 'user_roles') data = [{ user_id: USER_ID, role: 'sdr', crm_access: true }]
    else if (name === 'get_my_registration_status') data = { status: 'approved' }
    else if (name === 'dashboard_events') data = [{ topic: 'crm', revision: state.revision }]
    else if (name === 'crm_context_summary') data = state.leads.map(row => ({ lead_id: row.id }))
    else if (name === 'crm_leads') {
      if (url.searchParams.get('select') === 'id,import_snapshot') {
        const match = state.leads.find(row => 'eq.' + row.id === url.searchParams.get('id'))
        data = { id: match.id, import_snapshot: match.import_snapshot }
      } else {
        assert(!url.searchParams.get('select').includes('import_snapshot'))
        data = state.leads.map(({ import_snapshot, ...row }) => row)
      }
    } else if (name === 'crm_lead_contexts') data = url.searchParams.get('select') === 'lead_id' ? state.leads.map(row => ({ lead_id: row.id })) : []
    else if (name === 'crm_call_assignees' || name === 'crm_result_sale_links') data = []
    else if (fixture.rpc[name]) data = fixture.rpc[name](args)
    else if (name.startsWith('get_')) data = 0
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await context.addInitScript(session => localStorage.setItem('sb-mbzwchnxtskysqplqiyy-auth-token', JSON.stringify(session)), fakeSession())
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/crm?tab=importacoes')
  await expect(page.getByRole('region', { name: 'Importações do SDR' })).toBeVisible()
  return page
}
try {
  const first = await session(1), second = await session(2)
  const cards = page => page.getByRole('article', { name: /^Lead / })
  for (const page of [first, second]) {
    await expect(cards(page)).toHaveCount(3)
    assert.deepEqual(await cards(page).evaluateAll(rows => rows.map(row => row.getAttribute('aria-label'))),
      ['Lead Formulário Recuperado','Lead Formulário Automático','Lead Site Manual'])
    await expect(cards(page).first().getByText(new RegExp(clock(state.leads[2].lead_received_at)))).toBeVisible()
  }
  const section = first.getByRole('region', { name: 'Importações do SDR' })
  await section.getByRole('button', { name: 'Formulários · 2', exact: true }).click()
  await section.getByRole('button', { name: 'Manuais', exact: true }).click()
  await expect(cards(first)).toHaveCount(1)
  await first.getByRole('button', { name: 'Contexto de Formulário Recuperado', exact: true }).click()
  const detail = first.getByRole('region', { name: 'Dados completos da importação' })
  await expect(detail.getByText(longAnswer, { exact: true })).toBeVisible()
  await expect(detail.getByText('Data e horário não informados na origem',{exact:true})).toBeVisible()
  await expect(first.getByText('Caiu em (horário de Brasília)',{exact:true})).toHaveCount(0)
  await expect(detail.getByRole('heading',{name:'Consentimentos',exact:true})).toBeVisible()
  await expect(detail.getByText('CONSENTIMENTO INTEGRAL QA',{exact:true})).toBeVisible()
  await expect(detail.getByText('DADO NÃO MAPEADO PRESERVADO',{exact:true})).toBeVisible()
  await expect(detail.locator('pre')).toHaveCount(0)
  await first.keyboard.press('Escape')
  await section.getByRole('button', { name: 'Todas · 3', exact: true }).click()
  await section.getByRole('button', { name: 'Automáticas e manuais', exact: true }).click()
  await expect(cards(first)).toHaveCount(3)
  await section.getByRole('button', { name: 'Site / conversão direta · 1', exact: true }).click()
  await expect(cards(first)).toHaveCount(1)
  await section.getByRole('button', { name: 'Todas · 3', exact: true }).click()
  // Realtime is deliberately unavailable. The real dashboard revision fallback catches both sessions up.
  state.leads.push(lead(4, 'Novo Recebimento', 'website', 'automatic', ago(1), ago(3)))
  state.revision++
  for (const page of [first, second]) {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(cards(page)).toHaveCount(4)
    await expect(cards(page).first()).toHaveAttribute('aria-label', 'Lead Novo Recebimento')
    await expect(cards(page).first().getByText(new RegExp(clock(state.leads[3].lead_received_at)))).toBeVisible()
  }
  for (const index of [1,2]) assert(calls.filter(call => call.session === index && call.name === 'dashboard_events').length >= 2)
  assert.equal(calls.filter(call => call.name === 'crm_leads' && call.select === 'id,import_snapshot').length, 1)
  assert(calls.filter(call => call.method !== 'GET').every(call => !['crm_leads','crm_lead_contexts'].includes(call.name)))
  assert.deepEqual(errors, [])
  console.log('PASS: two SDR sessions synchronize new arrivals; receipt priority, exact seconds, origin/method filters and complete lazy-loaded source context')
} finally { await browser.close() }
