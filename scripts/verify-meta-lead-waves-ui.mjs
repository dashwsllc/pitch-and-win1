import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader, loadComponent } from './helpers/meta-component-harness.mjs'

const waves = loadComponent('src/lib/meta-waves.ts')
const conference = loadComponent('src/lib/meta-lead-conference.ts')

test('lead times are shown in Brasília with seconds, whatever the computer timezone', () => {
  const original = process.env.TZ; process.env.TZ = 'Asia/Tokyo'
  try {
    assert.equal(waves.leadClock('2026-10-11T13:43:52Z'), '10:43:52')
    assert.equal(waves.leadDay('2026-10-11T13:43:52Z'), '11/10/2026')
    assert.equal(waves.leadDateTime('2026-10-12T02:59:59Z'), '11/10/2026 23:59:59')
    assert.equal(waves.leadDateTimeShort('2026-10-11T13:43:52Z'), '11/10 10:43')
    assert.equal(waves.leadClock(null), '—')
    assert.equal(waves.leadClock('não é data'), '—')
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
})

test('a wave shows the time of its first and last lead', () => {
  assert.equal(waves.waveRangeLabel({ first_lead_at: '2026-10-11T11:14:00Z', last_lead_at: '2026-10-11T13:43:00Z' }), '11/10 · 08:14 → 10:43')
  assert.equal(waves.waveRangeLabel({ first_lead_at: '2026-10-10T23:50:00Z', last_lead_at: '2026-10-11T13:43:00Z' }), '10/10 20:50 → 11/10 10:43')
  assert.equal(waves.waveRangeLabel({ first_lead_at: null, last_lead_at: null }), 'Sem leads')
})

test('elapsed time and urgency follow the quick-approach thresholds', () => {
  const now = Date.parse('2026-10-11T14:00:00Z')
  assert.equal(waves.elapsedLabel('2026-10-11T13:59:40Z', now), 'agora')
  assert.equal(waves.elapsedLabel('2026-10-11T13:52:00Z', now), 'há 8 min')
  assert.equal(waves.elapsedLabel('2026-10-11T11:45:00Z', now), 'há 2 h 15 min')
  assert.equal(waves.elapsedLabel('2026-10-11T02:00:00Z', now), 'há 12 h')
  assert.equal(waves.elapsedLabel('2026-10-09T14:00:00Z', now), 'há 2 dias')
  assert.equal(waves.leadUrgency('2026-10-11T13:46:00Z', now), 'fresh')
  assert.equal(waves.leadUrgency('2026-10-11T13:10:00Z', now), 'warm')
  assert.equal(waves.leadUrgency('2026-10-11T12:30:00Z', now), 'late')
})

test('each lead says plainly where it is: waiting, sent, failed or rejected', () => {
  const base = { approval_status: 'aprovado', crm_sync_status: null, crm_sync_error: null, crm_lead_id: null, review_note: null }
  assert.equal(waves.leadSyncView({ ...base, approval_status: 'pendente' }).key, 'aguardando')
  assert.equal(waves.leadSyncView({ ...base, crm_sync_status: 'enviado', crm_lead_id: 'x' }).label, 'Enviado ao CRM')
  const failed = waves.leadSyncView({ ...base, crm_sync_status: 'falhou', crm_sync_error: 'Corrija o WhatsApp' })
  assert.equal(failed.key, 'falhou'); assert.equal(failed.detail, 'Corrija o WhatsApp')
  assert.equal(waves.leadSyncView({ ...base, approval_status: 'rejeitado', review_note: 'Teste' }).detail, 'Teste')
  const decided = { number: 22, status: 'aprovada', sent: 18, failed: 1, rejected: 1, pending: 0, lead_count: 20, already: false }
  assert.equal(waves.decisionMessage(decided, 'aprovar'), 'Leva #22 aprovada: 18 enviados ao CRM · 1 com falha · 1 rejeitados.')
  assert.match(waves.decisionMessage({ ...decided, already: true }, 'aprovar'), /já estava aprovada/)
  assert.match(waves.decisionMessage({ ...decided, status: 'rejeitada', rejected: 20 }, 'rejeitar'), /podem ser reabertos/)
})

test('manual import is sent in blocks that fit the API time limit, without losing a row', () => {
  const rows = Array.from({ length: 450 }, (_, index) => index)
  const chunks = waves.chunkRows(rows)
  assert.deepEqual(chunks.map(chunk => chunk.length), [200, 200, 50])
  assert.deepEqual(chunks.flat(), rows)
  assert.deepEqual(waves.chunkRows([]), [])
})

test('the conference counts missing leads per day and campaign', () => {
  const rows = [
    { stat_day: '2026-10-11', campaign_id: 'A', campaign_name: 'A', meta_leads: 26, received: 26, pending: 26, approved: 0, rejected: 0, in_crm: 0, failed: 0 },
    { stat_day: '2026-10-08', campaign_id: 'A', campaign_name: 'A', meta_leads: 123, received: 0, pending: 0, approved: 0, rejected: 0, in_crm: 0, failed: 0 },
    { stat_day: '2026-10-07', campaign_id: 'B', campaign_name: 'B', meta_leads: 1, received: 3, pending: 0, approved: 3, rejected: 0, in_crm: 2, failed: 1 },
  ]
  assert.equal(conference.conferenceGap(rows[1]), 123)
  assert.deepEqual(conference.summarizeConference(rows), { meta: 150, received: 29, pending: 26, inCrm: 2, failed: 1, missing: 123, daysMissing: 1 })
})

test('the CRM shows exactly when a form lead arrived, only for form leads', () => {
  const load = createComponentLoader({ '@/hooks/useCRM': {} })
  const { CRMLeadArrival } = load('src/components/crm/CRMLeadArrival.tsx')
  const form = { lead_source: 'meta_ads_form', lead_generated_at: '2026-10-11T13:43:52Z', approach_stage: 'nao_abordado' }
  const html = renderToStaticMarkup(React.createElement(CRMLeadArrival, { lead: form }))
  assert.match(html, /Caiu em 11\/10 às 10:43/)
  assert.match(html, /há \d+ (min|h|dias?)|agora/)
  const approached = renderToStaticMarkup(React.createElement(CRMLeadArrival, { lead: { ...form, approach_stage: 'abordado' } }))
  assert.match(approached, /Caiu em 11\/10 às 10:43/); assert.doesNotMatch(approached, /há /)
  assert.equal(renderToStaticMarkup(React.createElement(CRMLeadArrival, { lead: { ...form, lead_source: null } })), '')
  assert.equal(waves.leadArrivedAt({ lead_source: 'manual', lead_generated_at: '2026-10-11T13:43:52Z' }), null)
})

test('form answers are readable: identifiers from Meta become text, spreadsheet headers stay as they are', () => {
  const leads = loadComponent('src/lib/meta-leads.ts')
  assert.equal(leads.prettyQuestion('quem_está_preenchendo_este_formulário?'), 'Quem está preenchendo este formulário?')
  assert.equal(leads.prettyQuestion('Motivação'), 'Motivação')
  assert.equal(leads.prettyQuestion('Phone_Number'), 'Phone_Number')
  assert.equal(leads.prettyAnswer('sou_pai/mãe_ou_responsável'), 'sou pai/mãe ou responsável')
  assert.equal(leads.prettyAnswer('@joao_silva com espaço'), '@joao_silva com espaço')
  const { FormAnswers } = createComponentLoader()('src/components/traffic/FormAnswers.tsx')
  const html = renderToStaticMarkup(React.createElement(FormAnswers, { fields: [{ name: 'qual_é_a_posição_e_a_categoria_atual_do_atleta?', values: ['atacante, sub-17'] }, { name: 'quem_está_preenchendo_este_formulário?', values: ['sou_o_atleta'] }] }))
  assert.match(html, /Qual é a posição e a categoria atual do atleta\?/)
  assert.match(html, /sou o atleta/)
})
