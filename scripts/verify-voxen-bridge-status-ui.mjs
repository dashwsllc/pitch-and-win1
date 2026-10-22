import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'

const load = createComponentLoader({ '@/hooks/useAuth': { useAuth: () => ({ user: { id: 'synthetic' } }) }, '@/lib/arena-api': {} })
const NOW = Date.parse('2026-10-21T23:40:00Z')
const minutesAgo = m => new Date(NOW - m * 60_000).toISOString()
const healthy = (over = {}) => ({
  enabled: true, pending_count: 0, processing_count: 0, blocked_count: 0, delivered_count: 211, oldest_pending_at: null, last_delivered_at: '2026-10-21T21:23:05.499068+00:00',
  error_codes: {}, quarantined_receipts: 0, trigger_error_count: 0, last_trigger_error_at: null, last_reconcile_at: minutesAgo(10),
  last_reconcile_summary: { examined: 60, changed: 0, errors: 0, cycle_complete: true }, ...over,
})
// Resposta real de producao lida em 21/10/2026 (so contagens).
const PROD_ALIGNMENT = { in_sync: 210, skipped: 0, to_enqueue: 0, linked_sites: 210, with_answers: 175, unmapped_questions: [], crm_leads_with_context: 193, context_without_answers: 18, with_answers_addressable: 66, with_answers_without_voxen_id: 109 }

test('verdict: em dia so quando esta mesmo em dia; cada problema muda o nivel e o titulo', () => {
  const { voxenBridgeVerdict: verdict } = load('src/lib/voxen-bridge.ts')
  let v = verdict(healthy(), NOW)
  assert.equal(v.level, 'ok'); assert.equal(v.title, 'Em dia'); assert.deepEqual(v.reasons, [])
  v = verdict(healthy({ pending_count: 3, processing_count: 2, oldest_pending_at: minutesAgo(1) }), NOW)
  assert.equal(v.level, 'ok'); assert.equal(v.title, 'Enviando: fila normal')
  v = verdict(healthy({ enabled: false }), NOW)
  assert.equal(v.level, 'off'); assert.match(v.title, /desligado/); assert.notEqual(v.title, 'Em dia')
  v = verdict(healthy({ blocked_count: 2, error_codes: { http_400: 2 } }), NOW)
  assert.equal(v.level, 'problem'); assert.equal(v.title, 'Há envios bloqueados'); assert.match(v.reasons[0], /2 envios bloqueados.*http_400.*reenfileirar/)
  v = verdict(healthy({ blocked_count: 1, error_codes: { http_400: 1 }, pending_count: 1, oldest_pending_at: minutesAgo(90) }), NOW)
  assert.equal(v.reasons.length, 1, 'com envio bloqueado nao acusa tambem "fila parada" pelo mesmo evento')
  v = verdict(healthy({ pending_count: 1, error_codes: { network_timeout: 1 }, oldest_pending_at: minutesAgo(2) }), NOW)
  assert.equal(v.level, 'attention'); assert.match(v.reasons[0], /Tentativas com erro.*network_timeout/)
  v = verdict(healthy({ pending_count: 3, oldest_pending_at: minutesAgo(20) }), NOW)
  assert.equal(v.level, 'attention'); assert.match(v.reasons[0], /3 eventos estão na fila há 20 min/)
  v = verdict(healthy({ pending_count: 1, oldest_pending_at: minutesAgo(15) }), NOW); assert.equal(v.level, 'ok', '15 min ainda e o limite, nao passou')
  v = verdict(healthy({ trigger_error_count: 2, last_trigger_error_at: minutesAgo(60) }), NOW)
  assert.equal(v.level, 'attention'); assert.match(v.reasons[0], /gatilho do CRM falhou 2 vezes.*varredura recupera/)
  v = verdict(healthy({ trigger_error_count: 1, last_trigger_error_at: minutesAgo(3 * 24 * 60) }), NOW)
  assert.equal(v.level, 'ok', 'falha antiga de gatilho nao deixa o painel em alerta para sempre'); assert.match(v.reasons[0], /1 falha antiga/)
  v = verdict(healthy({ last_reconcile_at: null, last_reconcile_summary: null }), NOW); assert.equal(v.level, 'attention'); assert.match(v.reasons[0], /ainda não rodou/)
  v = verdict(healthy({ last_reconcile_at: minutesAgo(46) }), NOW); assert.equal(v.level, 'attention'); assert.match(v.reasons[0], /não roda há 46 min/)
  v = verdict(healthy({ last_reconcile_at: minutesAgo(45) }), NOW); assert.equal(v.level, 'ok')
  v = verdict(healthy({ last_reconcile_summary: { examined: 60, changed: 1, errors: 3, cycle_complete: true } }), NOW)
  assert.equal(v.level, 'attention'); assert.match(v.reasons[0], /3 erros em atletas/)
  v = verdict(healthy({ quarantined_receipts: 2 }), NOW); assert.equal(v.level, 'ok'); assert.match(v.reasons[0], /2 atletas que a VOXEN não conhece.*Não é erro/)
  // propriedade: "ok" so existe com entrega ligada, sem bloqueio e com varredura recente
  for (const enabled of [true, false]) for (const blocked of [0, 1]) for (const sweep of [null, 10, 100]) {
    const r = verdict(healthy({ enabled, blocked_count: blocked, last_reconcile_at: sweep === null ? null : minutesAgo(sweep) }), NOW)
    assert.equal(r.level === 'ok', enabled && blocked === 0 && sweep === 10, `enabled=${enabled} blocked=${blocked} sweep=${sweep} -> ${r.level}`)
  }
})

test('validadores aceitam a resposta real de producao e recusam formatos quebrados', () => {
  const { isVoxenBridgeHealth, isVoxenBridgeAlignment } = load('src/lib/voxen-bridge.ts')
  assert(isVoxenBridgeHealth(healthy())); assert(isVoxenBridgeAlignment(PROD_ALIGNMENT))
  for (const bad of [null, undefined, 'x', [], {}, healthy({ enabled: 'true' }), healthy({ blocked_count: -1 }), healthy({ delivered_count: '211' }), healthy({ error_codes: null }),
    healthy({ error_codes: [] }), healthy({ last_reconcile_at: 'ontem' }), healthy({ pending_count: Number.NaN })]) assert.equal(isVoxenBridgeHealth(bad), false, JSON.stringify(bad))
  assert(isVoxenBridgeHealth(healthy({ oldest_pending_at: null, last_delivered_at: null, last_reconcile_at: null, last_reconcile_summary: null })))
  for (const bad of [null, {}, { ...PROD_ALIGNMENT, unmapped_questions: null }, { ...PROD_ALIGNMENT, in_sync: '210' }]) assert.equal(isVoxenBridgeAlignment(bad), false)
})

test('card de saude: mostra numeros e horario de Brasilia, e nunca "em dia" quando nao esta', () => {
  const { VoxenBridgeHealthView } = load('src/components/traffic/VoxenContextBridgeStatus.tsx')
  const view = data => renderToStaticMarkup(React.createElement(VoxenBridgeHealthView, { data, now: NOW }))
  let html = view(healthy())
  assert.match(html, /Em dia/); assert.match(html, /211 entregues · 0 na fila · 0 bloqueados/); assert.match(html, /21\/10\/2026.*18:23:05/)
  assert.match(html, /60 atletas conferidos, 0 alterados/); assert.match(html, /a cada 15 minutos/); assert.match(html, /role="status"/)
  html = view(healthy({ blocked_count: 3, error_codes: { http_403: 3 } }))
  assert.match(html, /role="alert"/); assert.match(html, /Há envios bloqueados/); assert.match(html, /3 envios bloqueados/); assert.doesNotMatch(html, />Em dia</)
  html = view(healthy({ enabled: false }))
  assert.match(html, /desligado/); assert.doesNotMatch(html, />Em dia</)
  html = view(healthy({ blocked_count: 1, error_codes: { '<script>x</script>': 1 } }))
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(view(healthy()), /payload|notes|answers|phone|telefone|e-mail/i, 'o painel nao mostra conteudo de atleta')
})

test('card de cobertura: explica que quem nao esta na VOXEN nao e erro, e avisa pergunta nova', () => {
  const { VoxenCoverageView } = load('src/components/traffic/VoxenContextBridgeStatus.tsx')
  const view = data => renderToStaticMarkup(React.createElement(VoxenCoverageView, { data }))
  let html = view(PROD_ALIGNMENT)
  assert.match(html, /193 leads do CRM com contexto/); assert.match(html, /210 atletas já cadastrados na VOXEN têm contexto: 210 em dia\./)
  assert.match(html, /Dos 175 leads com respostas do formulário, 66 já têm cadastro na VOXEN e 109 ainda não se cadastraram lá\. 18 leads têm só notas/)
  assert.match(html, /Não é erro/); assert.doesNotMatch(html, /a enviar|ignorados|role="alert"/)
  html = view({ ...PROD_ALIGNMENT, to_enqueue: 4, skipped: 1, with_answers_without_voxen_id: 0, context_without_answers: 0, unmapped_questions: ['qual_o_time_do_coracao?'] })
  assert.match(html, /210 em dia, 4 a enviar, 1 ignorados/); assert.doesNotMatch(html, /Não é erro/); assert.match(html, /Perguntas novas do formulário \(vão sozinhas, como resposta, sem mapeamento\): qual_o_time_do_coracao\?/); assert.doesNotMatch(html, /role="alert"/)
})

test('guardas de codigo: cobertura pesada nunca dispara sozinha e o card e so do Executivo', () => {
  const component = readFileSync('src/components/traffic/VoxenContextBridgeStatus.tsx', 'utf8').replace(/\r\n/g, '\n')
  const coverageQuery = component.slice(component.indexOf("queryKey: ['voxen-bridge', 'alignment'"), component.indexOf("return <section"))
  assert.match(coverageQuery, /enabled: false/, 'a invalidacao global do dashboard dispararia o calculo pesado a cada mudanca de revisao')
  assert.doesNotMatch(coverageQuery, /refetchInterval/)
  const healthQuery = component.slice(component.indexOf("queryKey: ['voxen-bridge', 'health'"), component.indexOf("// enabled: false"))
  assert.match(healthQuery, /refetchInterval: active \? 30_000 : false/)
  const traffic = readFileSync('src/components/traffic/MetaTrafficConnection.tsx', 'utf8').replace(/\r\n/g, '\n')
  assert.match(traffic, /\{isExecutive && <VoxenContextBridgeStatus active=\{active\} \/>\}/, 'as RPCs recusam quem nao e Executivo')
  const api = readFileSync('src/lib/arena-api.ts', 'utf8')
  assert.match(api, /crm_context_health: FunctionDef/); assert.match(api, /crm_context_alignment: FunctionDef/)
})

const ACCEPTED = { accepted: true, state: 'delivered', receipt_status: 'applied' }
const prospects = (over = {}) => ({ ready: false, enabled: 0, stopped: 0, waiting: 0, pending: 0, delivered: 0, blocked: 0, quarantined: 0, available: 127, rehearsal: { accepted: false, state: null, receipt_status: null }, ...over })
const READY = { ready: true, rehearsal: ACCEPTED }

test('leads sem cadastro: validador aceita o formato da RPC e recusa o quebrado', () => {
  const { isVoxenProspectsStatus } = load('src/lib/voxen-bridge.ts')
  assert(isVoxenProspectsStatus(prospects())); assert(isVoxenProspectsStatus(prospects({ ...READY, enabled: 5, delivered: 5 })))
  for (const bad of [null, undefined, 'x', [], {}, prospects({ ready: 'sim' }), prospects({ enabled: '5' }), prospects({ blocked: -1 }), prospects({ available: Number.NaN }),
    prospects({ rehearsal: null }), prospects({ rehearsal: { accepted: 'sim', state: null, receipt_status: null } }), prospects({ rehearsal: { accepted: true, state: 1, receipt_status: null } }),
    { ...prospects(), quarantined: undefined }, { ...prospects(), closed_at: null, ready: undefined }]) assert.equal(isVoxenProspectsStatus(bad), false, JSON.stringify(bad))
})

test('leads sem cadastro: cada estado diz a verdade e nunca "liberado" com problema', () => {
  const { voxenProspectsVerdict: verdict } = load('src/lib/voxen-bridge.ts')
  let r = verdict(prospects()); assert.equal(r.level, 'attention'); assert.equal(r.title, 'Envio de leads sem cadastro ainda não liberado'); assert.match(r.reasons[0], /127 leads disponíveis para enviar\. Falta o ensaio/)
  r = verdict(prospects({ rehearsal: { accepted: false, state: 'pending', receipt_status: null } })); assert.equal(r.title, 'Ensaio enviado, aguardando a VOXEN'); assert.equal(r.level, 'attention')
  r = verdict(prospects({ rehearsal: { accepted: false, state: 'processing', receipt_status: null } })); assert.equal(r.title, 'Ensaio enviado, aguardando a VOXEN')
  r = verdict(prospects({ rehearsal: { accepted: false, state: 'blocked', receipt_status: null } })); assert.equal(r.level, 'problem'); assert.match(r.title, /Ensaio recusado/)
  r = verdict(prospects({ rehearsal: { accepted: false, state: 'delivered', receipt_status: 'quarantined' } })); assert.equal(r.level, 'problem'); assert.match(r.reasons[0], /"quarantined".*"applied" ou "waiting_member"/)
  r = verdict(prospects({ ...READY, available: 127 })); assert.equal(r.level, 'ok'); assert.equal(r.title, 'Envio de leads sem cadastro liberado'); assert.match(r.reasons.join(' '), /0 leads escolhidos|127 leads disponíveis para enviar na aba VOXEN do CRM/)
  r = verdict(prospects({ ...READY, enabled: 40, delivered: 30, pending: 8, waiting: 2, available: 87 })); assert.equal(r.level, 'ok'); assert.match(r.reasons[0], /40 leads escolhidos para sincronizar: 30 entregues, 8 na fila, 2 aguardando conteúdo/); assert.match(r.reasons.join(' '), /87 leads disponíveis/)
  r = verdict(prospects({ ...READY, enabled: 1, delivered: 1, available: 0 })); assert.match(r.reasons[0], /1 lead escolhido para sincronizar: 1 entregues/)
  r = verdict(prospects({ ...READY, enabled: 40, delivered: 38, blocked: 2 })); assert.equal(r.level, 'problem'); assert.doesNotMatch(r.title, /liberado/); assert.match(r.reasons.join(' '), /2 leads com envio bloqueado.*reenfileirar/)
  r = verdict(prospects({ ...READY, enabled: 40, delivered: 39, quarantined: 1 })); assert.equal(r.level, 'problem'); assert.doesNotMatch(r.title, /liberado/); assert.match(r.reasons.join(' '), /1 lead ficou em quarentena.*Avise a Zyron/)
  // propriedade: "liberado" so existe com o ensaio aceito, sem bloqueio e sem quarentena
  for (const ready of [false, true]) for (const blocked of [0, 1]) for (const quarantined of [0, 1]) {
    const t = verdict(prospects({ ready, rehearsal: ready ? ACCEPTED : prospects().rehearsal, blocked, quarantined })).title
    assert.equal(/liberado/.test(t) && !/ainda não liberado/.test(t), ready && blocked === 0 && quarantined === 0, `ready=${ready} blocked=${blocked} quarantined=${quarantined} -> ${t}`)
  }
})

test('painel e cobertura contam a historia certa em cada estado', () => {
  const { VoxenProspectsView, VoxenCoverageView } = load('src/components/traffic/VoxenContextBridgeStatus.tsx')
  const card = data => renderToStaticMarkup(React.createElement(VoxenProspectsView, { data }))
  const coverage = (data, extra) => renderToStaticMarkup(React.createElement(VoxenCoverageView, { data, prospects: extra }))
  let html = card(prospects()); assert.match(html, /Leads sem cadastro na VOXEN \(envio por escolha do time\)/); assert.match(html, /role="status"/); assert.doesNotMatch(html, /role="alert"/)
  html = card(prospects({ rehearsal: { accepted: false, state: 'delivered', receipt_status: '<script>x</script>' } }))
  assert.match(html, /role="alert"/); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/)
  html = card(prospects({ ...READY, enabled: 3, delivered: 3 })); assert.match(html, /Envio de leads sem cadastro liberado/); assert.doesNotMatch(html, /payload|notes|answers|phone|telefone|e-mail/i, 'o painel nao mostra conteudo de lead')
  html = coverage(PROD_ALIGNMENT); assert.match(html, /o envio acontece sozinho quando o cadastro aparecer/); assert.doesNotMatch(html, /Leads sem cadastro na VOXEN/, 'sem a RPC a cobertura continua igual')
  html = coverage(PROD_ALIGNMENT, prospects()); assert.match(html, /o envio acontece sozinho quando o cadastro aparecer/, 'antes de liberar a explicacao antiga ainda e a verdadeira'); assert.match(html, /ainda não liberado/)
  html = coverage(PROD_ALIGNMENT, prospects(READY))
  assert.match(html, /O time escolhe quais enviar na aba VOXEN do CRM/); assert.match(html, /quem for enviado fica em sincronia/); assert.doesNotMatch(html, /o envio acontece sozinho quando o cadastro aparecer/)
})

test('guardas de codigo: a cobertura aceita a RPC ausente e as RPCs estao registradas', () => {
  const component = readFileSync('src/components/traffic/VoxenContextBridgeStatus.tsx', 'utf8').replace(/\r\n/g, '\n')
  const coverageQuery = component.slice(component.indexOf("queryKey: ['voxen-bridge', 'alignment'"), component.indexOf('return <section'))
  assert.match(coverageQuery, /crm_context_prospects_status/); assert.match(coverageQuery, /\(\) => null/, 'sem a migration a cobertura nao pode falhar')
  assert.match(coverageQuery, /enabled: false/)
  const api = readFileSync('src/lib/arena-api.ts', 'utf8')
  for (const name of ['crm_context_prospects_status', 'crm_voxen_send', 'crm_voxen_stop', 'crm_voxen_sync_states']) assert.match(api, new RegExp(name + ': FunctionDef'))
})
