// Tráfego: a linha do registro do SITE traz as respostas do formulário Meta ligado a ele (e avisa quando o WhatsApp difere).
// Navegador real (Chromium) sobre o front React; a fronteira HTTP do Supabase é sintética e nada é gravado.
// Requer o Vite local: npx vite --host 127.0.0.1 --port 5198 --strictPort   (TRAFFIC_TEST_ORIGIN=http://127.0.0.1:5198)
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures } from './perf/mock.mjs'

const expect = baseExpect.configure({ timeout: 20000 }), origin = process.env.TRAFFIC_TEST_ORIGIN || 'http://127.0.0.1:5199'
assert(new URL(origin).hostname === '127.0.0.1')
const actor = 'ce110000-0000-4000-8000-000000000001', project = 'mbzwchnxtskysqplqiyy'
const fixtures = buildFixtures({ role: 'super_admin', now: new Date() }).rpc, calls = [], errors = []
const started = Date.now(), ago = minutes => new Date(started - minutes * 60000).toISOString()
const answers = (phone, commitment = '9') => [
  ['quem_está_preenchendo_este_formulário?', 'sou_o_atleta'], ['atualmente,_o_atleta_está_vinculado_a_algum_clube?', 'não'],
  ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', 'tornar-se_jogador_profissional'],
  ['de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10', commitment],
  ['full_name', 'Perfil Do Instagram'], ['phone_number', phone], ['date_of_birth', '2008-09-06'], ['state', 'SP'],
].map(([name, value]) => ({ name, values: [value] }))
const wave = { id: 'ce110000-0000-4000-8000-000000000030', number: 30, status: 'pendente', is_open: false, version: 1, created_at: ago(300), closed_at: null, reviewed_at: null, review_note: null,
  reviewed_by_name: null, lead_count: 4, pending: 4, approved: 0, rejected: 0, sent: 0, failed: 0, first_lead_at: ago(60), last_lead_at: ago(5) }
const lead = (id, name, minutes, extra = {}) => ({ id, meta_lead_id: `meta-${id}`, page_id: 'page', form_id: 'form', form_name: 'Formulário QA', campaign_id: 'c1', campaign_name: 'Campanha QA', ad_id: '',
  created_time: ago(minutes), received_at: ago(minutes - 1), first_received_at: ago(minutes - 1), updated_at: ago(1), full_name: name, phone: '+5511999990000', email: '', field_data: [],
  custom_disclaimer_responses: [], approval_status: 'pendente', status: 'novo', review_note: null, reviewed_at: null, import_warning: null, crm_lead_id: null, crm_sync_status: null,
  crm_sync_error: null, crm_sync_attempts: 0, crm_sync_last_at: null, traffic_edited_at: null, source: 'api', batch_filename: null, time_known: true, date_known: true, linked_form: null, ...extra })
const linked = (phone, basis) => ({ id: 'ce110000-0000-4000-8000-0000000000f1', created_time: ago(30), form_name: 'FORMULÁRIO ZYRON', campaign_name: 'FORMULARIO ZYRON TST 04', field_data: answers(phone), basis })
wave.lead_list = [
  lead('s1', 'Site Com Telefone Diferente', 5, { entry_channel: 'website', phone: '11918173104', linked_form: linked('+5511948173104', 'mesmo anúncio, nome completo igual, 61 s depois do formulário') }),
  lead('s2', 'Site Com Telefone Igual', 8, { entry_channel: 'website', phone: '(11) 94817-3104', linked_form: linked('+5511948173104', 'mesmo WhatsApp e mesmo anúncio, nome diferente, 120 s depois do formulário') }),
  lead('s3', 'Site Sem Formulario', 12, { entry_channel: 'website', phone: '11900000000' }),
  lead('f1', 'Formulario Direto', 20, { entry_channel: 'form', field_data: answers('+5511911112222') }),
]
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 }, reducedMotion: 'reduce' })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('https://**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const name = url.pathname.split('/').at(-1), args = request.postDataJSON() ?? {}; calls.push({ name, method: request.method() })
    let data = []
    if (name === 'get_my_registration_status') data = { status: 'approved' }
    else if (name === 'profiles') data = { id: actor, user_id: actor, display_name: 'QA Tráfego', suspended: false }
    else if (name === 'user_roles') data = [{ id: actor, user_id: actor, role: 'traffic_manager' }]
    else if (name === 'meta_wave_list') data = { count: 1, pending_waves: 1, pending_leads: 4, failed_leads: 0, newest_pending_lead_at: ago(5), needs_rebuild: false, waves: [wave] }
    else if (name === 'meta_wave_leads') data = { wave, leads: wave.lead_list }
    else if (name === 'meta_traffic_operation') data = { runs: [], published: [], pending: {}, webhook: [{ page_id: 'page', leadgen_subscribed: true, checked_at: ago(10) }], alerts: [] }
    else if (name === 'meta_traffic_review_list') data = { rows: [], count: 0 }
    else if (name === 'meta_traffic_cohort') data = { state: 'insufficient', campaigns: [], reasons: [], unattributed_contacts: 0 }
    else if (name === 'meta_traffic_conference') data = []
    else if (name === 'dashboard_events') data = [{ topic: 'arena', revision: 1 }]
    else if (fixtures[name]) data = fixtures[name](args)
    else if (name.startsWith('get_')) data = 0
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(data) })
  })
  await context.addInitScript(({ actor, project }) => { const enc = v => btoa(JSON.stringify(v)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: actor, email: 'qa@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })) }, { actor, project })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/trafego')
  await expect(page.getByRole('heading', { name: 'Tráfego', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir levas' }).first().click()
  const newest = page.getByRole('article', { name: 'Leva 30' })
  const rows = newest.getByRole('article', { name: /recebido em/ })
  await expect(rows).toHaveCount(4)
  const row = name => newest.getByRole('article', { name: new RegExp(name) })

  // Site com formulário ligado: as respostas vêm do formulário, recolhidas como nas linhas de formulário.
  const s1 = row('Site Com Telefone Diferente')
  const summary = s1.locator('summary', { hasText: 'Respostas do formulário Meta (ligado a este envio do site)' })
  await expect(summary).toBeVisible()
  await expect(s1.getByText('Quem está preenchendo este formulário?')).toBeHidden()
  await summary.click()
  await expect(s1.getByText('Quem está preenchendo este formulário?')).toBeVisible()
  await expect(s1.getByText('sou o atleta', { exact: true })).toBeVisible()
  await expect(s1.getByText('tornar-se jogador profissional', { exact: true })).toBeVisible()
  await expect(s1.getByText('Formulário preenchido em', { exact: false })).toContainText('FORMULÁRIO ZYRON')
  await expect(s1.getByText('vínculo: mesmo anúncio, nome completo igual, 61 s depois do formulário', { exact: false })).toBeVisible()
  // WhatsApp do site diferente do informado no formulário: aviso com os dois números.
  const warning = s1.getByRole('alert').filter({ hasText: 'Confira o WhatsApp' })
  await expect(warning).toBeVisible(); await expect(warning).toContainText('11918173104'); await expect(warning).toContainText('+5511948173104')
  // Mesmo número em outro formato: sem aviso.
  const s2 = row('Site Com Telefone Igual')
  await s2.locator('summary', { hasText: 'ligado a este envio do site' }).click()
  await expect(s2.getByText('Quem está preenchendo este formulário?')).toBeVisible()
  await expect(s2.getByRole('alert').filter({ hasText: 'Confira o WhatsApp' })).toHaveCount(0)
  await expect(s2.getByText('vínculo: mesmo WhatsApp e mesmo anúncio, nome diferente', { exact: false })).toBeVisible()
  // Site sem formulário: diz isso, sem bloco de respostas.
  const s3 = row('Site Sem Formulario')
  await expect(s3.getByText('Nenhum formulário da Meta ligado a este envio do site.')).toBeVisible()
  await expect(s3.locator('summary', { hasText: 'ligado a este envio do site' })).toHaveCount(0)
  // Linha de formulário continua como antes.
  const f1 = row('Formulario Direto')
  await expect(f1.locator('summary', { hasText: /^Respostas do formulário$/ })).toBeVisible()
  await expect(f1.getByText('ligado a este envio do site')).toHaveCount(0)
  await expect(f1.getByText('Nenhum formulário da Meta ligado')).toHaveCount(0)
  if (process.env.TRAFFIC_SCREENSHOTS) await page.screenshot({ path: process.env.TRAFFIC_SCREENSHOTS + '/trafego-site-respostas.png', fullPage: true })
  assert.deepEqual(calls.filter(call => call.method !== 'GET' && !['meta_wave_list', 'meta_wave_leads', 'dashboard_events'].includes(call.name) && !/^(meta_traffic|get_|crm_|arena)/.test(call.name)), [], 'somente leitura')
  assert(!calls.some(call => /meta_wave_(decide|begin_review|retry|reopen)/.test(call.name)), 'nenhuma decisão é tomada')
  assert.deepEqual(errors, [])
  console.log('PASS: a linha do registro do site em Tráfego mostra as respostas do formulário ligado (recolhidas, com o vínculo), avisa quando o WhatsApp difere, diz quando não há formulário ligado e não altera as linhas de formulário; somente leitura')
} finally { await browser.close() }
