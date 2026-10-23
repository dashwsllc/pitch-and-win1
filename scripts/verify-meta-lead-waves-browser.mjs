// Navegador real (Chromium) sobre o front React, com a fronteira HTTP do Supabase substituída por dados sintéticos.
// Requer o Vite local: npx vite --host 127.0.0.1 --port 5199 --strictPort
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures } from './perf/mock.mjs'

const expect = baseExpect.configure({ timeout: 20000 }), origin = process.env.TRAFFIC_TEST_ORIGIN || 'http://127.0.0.1:5199'
const actor = 'ce110000-0000-4000-8000-000000000001', project = 'mbzwchnxtskysqplqiyy'
const fixtures = buildFixtures({ role: 'super_admin', now: new Date() }).rpc, calls = [], errors = []
const started = Date.now(), ago = minutes => new Date(started - minutes * 60000).toISOString()
const clock = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))
const wave = (number, extra) => ({ id: `ce110000-0000-4000-8000-0000000000${number}`, number, status: 'pendente', is_open: false, version: 1, created_at: ago(300), closed_at: null,
  reviewed_at: null, review_note: null, reviewed_by_name: null, lead_count: 20, pending: 20, approved: 0, rejected: 0, sent: 0, failed: 0, first_lead_at: ago(240), last_lead_at: ago(60), ...extra })
const lead = (id, name, minutes, extra = {}) => ({ id, meta_lead_id: `meta-${id}`, page_id: 'page', form_id: 'form', form_name: 'Formulário QA', campaign_id: 'c1', campaign_name: 'Campanha QA', ad_id: '',
  created_time: ago(minutes), received_at: ago(minutes - 1), updated_at: ago(1), full_name: name, phone: '+5511999990000', email: '', field_data: [{ name: 'quem_está_preenchendo_este_formulário?', values: ['sou_o_atleta'] }],
  custom_disclaimer_responses: [], approval_status: 'pendente', status: 'novo', review_note: null, reviewed_at: null, import_warning: null, crm_lead_id: null, crm_sync_status: null,
  crm_sync_error: null, crm_sync_attempts: 0, crm_sync_last_at: null, traffic_edited_at: null, source: 'api', batch_filename: null, time_known: true, ...extra })
const state = {
  waves: [wave(22, { is_open: true, lead_count: 3, pending: 3, first_lead_at: ago(25), last_lead_at: ago(4) }), wave(21), wave(19, { status: 'rejeitada', pending: 0, rejected: 20, reviewed_at: ago(500), review_note: 'Campanha de teste' })],
  leads: { 22: [lead('l1', 'Ana Recente', 4), lead('l2', 'Bruno Meio', 12), lead('l3', 'Carla Planilha', 25, { source: 'planilha', batch_filename: 'export.csv', time_known: false, import_warning: 'Planilha sem horário; usamos 12:00 só como referência para ordenar.' })],
    21: Array.from({ length: 20 }, (_, index) => lead(`m${index}`, `Lead ${index}`, 60 + index * 9)), 19: Array.from({ length: 20 }, (_, index) => lead(`r${index}`, `Rejeitado ${index}`, 600 + index, { approval_status: 'rejeitado', status: 'ignorado', review_note: 'Campanha de teste' })) },
  staleOnce: true,
}
const numberOf = id => state.waves.find(item => item.id === id)?.number
function list(args) {
  const filtered = state.waves.filter(item => !args.p_status || item.status === args.p_status).sort((a, b) => b.number - a.number)
  const pending = state.waves.filter(item => item.status === 'pendente')
  return { count: filtered.length, pending_waves: pending.length, pending_leads: pending.reduce((sum, item) => sum + item.pending, 0),
    failed_leads: state.waves.reduce((sum, item) => sum + item.failed, 0), newest_pending_lead_at: pending.length ? ago(4) : null, needs_rebuild: false,
    waves: filtered.slice(args.p_offset, args.p_offset + args.p_limit) }
}

const browser = await chromium.launch({ headless: true })
async function makeContext(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce' })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url()); if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const name = url.pathname.split('/').at(-1), args = route.request().postDataJSON() ?? {}; calls.push({ name, args })
    let data = []
    if (name === 'get_my_registration_status') data = { status: 'approved' }
    else if (name === 'profiles') data = { id: actor, user_id: actor, display_name: 'QA Tráfego', suspended: false }
    else if (name === 'user_roles') data = [{ id: actor, user_id: actor, role }]
    else if (name === 'meta_wave_list') data = list(args)
    else if (name === 'meta_wave_leads' || name === 'meta_wave_begin_review') {
      const number = numberOf(args.p_wave), target = state.waves.find(item => item.id === args.p_wave)
      if (name === 'meta_wave_begin_review' && target.is_open) Object.assign(target, { is_open: false, version: target.version + 1 })
      data = { wave: target, leads: state.leads[number] }
    }
    else if (name === 'meta_wave_decide_versioned') {
      if (state.staleOnce) { state.staleOnce = false; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PT409', message: 'A leva mudou; recarregue antes de decidir' }) }) }
      const target = state.waves.find(item => item.id === args.p_wave), excluded = new Map(args.p_excluded.map(item => [item.id, item.reason]))
      for (const item of state.leads[target.number]) {
        if (excluded.has(item.id)) Object.assign(item, { approval_status: 'rejeitado', status: 'ignorado', review_note: excluded.get(item.id) })
        else if (item.id === 'l3') Object.assign(item, { approval_status: 'aprovado', crm_sync_status: 'falhou', crm_sync_error: 'Corrija o WhatsApp: ele precisa ter de 8 a 32 caracteres', crm_sync_attempts: 1 })
        else Object.assign(item, { approval_status: 'aprovado', status: 'importado', crm_sync_status: 'enviado', crm_lead_id: 'crm-' + item.id })
      }
      Object.assign(target, { status: 'aprovada', is_open: false, pending: 0, approved: 2, rejected: 1, sent: 1, failed: 1, reviewed_at: new Date().toISOString(), reviewed_by_name: 'QA Tráfego' })
      data = { ...target, already: false }
    } else if (name === 'meta_wave_retry') { const target = state.waves.find(item => item.id === args.p_wave); data = { ...target, retried: 1, recovered: 0 } }
    else if (name === 'meta_wave_reopen') data = { reopened: args.p_lead ? 1 : 20, pending_waves: 2 }
    else if (name === 'meta_import_leads') data = { batch_id: 'batch-' + calls.length, rows: args.p_rows.length, status: 'recebido', result: { received: args.p_rows.length, duplicates: 0, failed: 0, issues: [] } }
    else if (name === 'meta_traffic_operation') data = { runs: [], published: [], pending: {}, webhook: [{ page_id: 'page', leadgen_subscribed: true, checked_at: ago(10) }], alerts: [] }
    else if (name === 'meta_traffic_review_list') data = { rows: [], count: 0 }
    else if (name === 'meta_traffic_cohort') data = { state: 'insufficient', campaigns: [], reasons: [], unattributed_contacts: 0 }
    else if (name === 'meta_traffic_conference') data = [{ stat_day: '2026-10-11', campaign_id: 'c1', campaign_name: 'Campanha QA', meta_leads: 26, received: 23, pending: 23, approved: 0, rejected: 0, in_crm: 0, failed: 0 }]
    else if (name === 'dashboard_events') data = [{ topic: 'arena', revision: 1 }]
    else if (fixtures[name]) data = fixtures[name](args)
    else if (name.startsWith('get_')) data = 0
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(data) })
  })
  await context.addInitScript(({ actor, project }) => { const enc = v => btoa(JSON.stringify(v)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`, refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: actor, email: 'qa@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })) }, { actor, project })
  return context
}

const context = await makeContext('traffic_manager'), page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(origin + '/trafego')
  await expect(page.getByRole('heading', { name: 'Tráfego', exact: true })).toBeVisible()
  // Prioridade aos leads: aviso com o mais recente em qualquer aba, contador no menu e na aba.
  await expect(page.getByText('23 leads aguardando', { exact: false }).first()).toBeVisible()
  await expect(page.getByLabel('23 leads aguardando aprovação').first()).toBeVisible()
  await expect(page.getByText('Conferência de leads · Meta × recebidos × CRM')).toBeVisible()
  await expect(page.getByText('faltam 3')).toBeVisible()
  await page.getByRole('button', { name: 'Abrir levas' }).first().click()
  const newest = page.getByRole('article', { name: 'Leva 22' })
  await expect(newest.getByText('Mais recente')).toBeVisible()
  await expect(newest.getByText('Recebendo leads')).toBeVisible()
  // A leva mais recente abre sozinha, com o lead mais novo no topo e o horário exato de cada um.
  const leads = newest.getByRole('article', { name: /recebido em/ })
  await expect(leads).toHaveCount(3)
  assert.deepEqual(await leads.evaluateAll(items => items.map(item => item.getAttribute('aria-label').split(',')[0])), ['Ana Recente', 'Bruno Meio', 'Carla Planilha'])
  await expect(leads.nth(0).locator('time')).toHaveText(clock(ago(3)))
  await expect(leads.nth(2).getByText('Horário aproximado (planilha)')).toBeVisible()
  await expect(leads.nth(2).getByText('Manual · export.csv')).toBeVisible()
  await expect(leads.nth(0).getByText('há 3 min')).toBeVisible()
  // TRAFFIC_SCREENSHOTS=<pasta> grava a tela das levas em desktop e celular para revisão visual.
  if (process.env.TRAFFIC_SCREENSHOTS) {
    await page.screenshot({ path: process.env.TRAFFIC_SCREENSHOTS + '/levas-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: process.env.TRAFFIC_SCREENSHOTS + '/levas-celular.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1200 })
  }
  // Tirar um lead da leva exige motivo e não manda ao CRM.
  await leads.nth(1).getByRole('button', { name: 'Tirar da leva' }).click()
  await leads.nth(1).getByLabel('Motivo para tirar Bruno Meio da leva').fill('Lead de teste')
  await leads.nth(1).getByRole('button', { name: 'Confirmar' }).click()
  await expect(newest.getByText('2 leads serão enviados', { exact: false })).toBeVisible()
  // Aprovação em dois passos; leva alterada no meio do caminho é recarregada sem decidir nada.
  await newest.getByRole('button', { name: 'Aprovar leva #22' }).click()
  await expect(newest.getByRole('button', { name: 'Confirmar envio de 2 leads ao CRM' })).toBeEnabled()
  await expect(leads.nth(0).getByRole('button', { name: /Editar/ })).toBeDisabled()
  await newest.getByRole('button', { name: 'Confirmar envio de 2 leads ao CRM' }).click()
  await expect(page.getByText('A leva mudou enquanto você conferia', { exact: false })).toBeVisible()
  await newest.getByRole('button', { name: 'Aprovar leva #22' }).click()
  await newest.getByRole('button', { name: 'Confirmar envio de 2 leads ao CRM' }).click()
  await expect(page.getByText('Leva #22 aprovada: 1 enviados ao CRM · 1 com falha · 1 rejeitados.')).toBeVisible()
  const decision = calls.filter(call => call.name === 'meta_wave_decide_versioned').at(-1).args
  assert.equal(decision.p_wave, state.waves[0].id)
  assert.equal(decision.p_expected_version, 2)
  assert.deepEqual(decision.p_members.map(item => item.id), ['l1','l2','l3'])
  assert.deepEqual(decision.p_excluded, [{ id: 'l2', reason: 'Lead de teste' }])
  assert(decision.p_members.every(item => item.updated_at === ago(1)))
  assert.match(decision.p_request_id,/^[0-9a-f-]{36}$/)
  // A próxima pendente vira a mais recente.
  await expect(page.getByRole('article', { name: 'Leva 21' }).getByText('Mais recente')).toBeVisible()
  // Falha visível e reenvio; lead rejeitado pode ser reaberto.
  await page.getByRole('tab', { name: 'Aprovadas' }).click()
  const approved = page.getByRole('article', { name: 'Leva 22' })
  await approved.getByRole('button', { name: 'Abrir leva 22' }).click()
  await expect(approved.getByText('Corrija o WhatsApp', { exact: false })).toBeVisible()
  await approved.getByRole('button', { name: 'Tentar de novo (1)' }).click()
  await expect(page.getByText('0 de 1 enviados', { exact: false })).toBeVisible()
  assert.deepEqual(calls.filter(call => call.name === 'meta_wave_retry').at(-1).args, { p_wave: state.waves[0].id, p_lead: null })
  await approved.getByRole('article', { name: /Bruno Meio/ }).getByRole('button', { name: 'Reabrir lead' }).click()
  await expect(page.getByText('1 lead voltou para aprovação', { exact: false })).toBeVisible()
  assert.deepEqual(calls.filter(call => call.name === 'meta_wave_reopen').at(-1).args, { p_wave: null, p_lead: 'l2' })
  await page.getByRole('tab', { name: 'Rejeitadas' }).click()
  const rejected = page.getByRole('article', { name: 'Leva 19' })
  await rejected.getByRole('button', { name: 'Abrir leva 19' }).click()
  await rejected.getByRole('button', { name: 'Reabrir leva' }).click()
  await expect(page.getByText('20 leads voltaram para aprovação', { exact: false })).toBeVisible()
  assert.deepEqual(calls.filter(call => call.name === 'meta_wave_reopen').at(-1).args, { p_wave: state.waves[2].id, p_lead: null })
  // Importação manual em blocos de 200 linhas, sem perder nenhuma.
  await page.getByRole('tab', { name: /Importar/ }).click()
  const csv = ['Created time,Full name,Phone number,Contexto', ...Array.from({ length: 450 }, (_, index) => `11/10/2026 ${String(8 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00,Lead ${index},1199${String(index).padStart(7, '0')},"  resposta ${index}  "`)].join('\n')
  await page.locator('#lead-file').setInputFiles({ name: 'export-meta.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText('450 linhas para envio.')).toBeVisible()
  await page.getByRole('button', { name: 'Enviar para as levas de aprovação' }).click()
  await expect(page.getByText('Importação recebida · export-meta.csv')).toBeVisible()
  const imports = calls.filter(call => call.name === 'meta_import_leads')
  assert.deepEqual(imports.map(call => [call.args.p_filename, call.args.p_rows.length]), [['export-meta.csv (parte 1 de 3)', 200], ['export-meta.csv (parte 2 de 3)', 200], ['export-meta.csv (parte 3 de 3)', 50]])
  assert.equal(new Set(imports.flatMap(call => call.args.p_rows.map(row => row.meta_lead_id))).size, 450)
  assert(imports.every(call => call.args.p_rows.every(row => row.time_known === true)))
  assert.equal(imports[0].args.p_rows[0].raw_cells[3].value,'  resposta 0  ')
  assert.deepEqual(errors, [])
  console.log('PASS: newest wave first and auto-opened, exact lead times, approximate-time marker, exclusion with reason, two-step approval, stale reload, visible failure and retry, lead and wave reopening, chunked manual import without losing rows')
} finally { await browser.close() }
