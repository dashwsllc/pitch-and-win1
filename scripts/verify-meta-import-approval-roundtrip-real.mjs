// Real production smoke test for the pending-approval workflow added on top of
// meta_import_daily (métricas) and the new meta_import_leads (planilha de leads).
// Creates one isolated traffic_manager+executive account and disposable batches/rows,
// always removes everything. Complements verify-meta-import-roundtrip-real.mjs (which
// covers present_metrics upsert) and verify-meta-lead-import.mjs (pure CSV parsing).
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--run-disposable-check')) throw Error('Use --run-disposable-check to create and remove one temporary traffic_manager+executive account and disposable import batches/leads.')
const project = 'mbzwchnxtskysqplqiyy'
const url = `https://${project}.supabase.co`
const keyCommand = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project, '--output', 'json'], {
  shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 1024 * 1024,
})
if (keyCommand.status !== 0) throw Error('Could not read authorized project credentials')
const keys = JSON.parse(keyCommand.stdout)
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
const publicKey = keys.find(key => key.name === 'anon')?.api_key
assert(serviceKey && publicKey)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const collaborator = createClient(url, publicKey, options)
const suffix = randomUUID().slice(0, 8)
const email = `qa-import-approval-${suffix}@example.invalid`
const password = `Import-Approval-${randomUUID()}!Aa1`
const accountId = `qa-act-${suffix}`
const campaignId = `qa-camp-${suffix}`
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const must = response => { if (response.error) throw Error(`${response.error.code || response.status || 'API'}: ${response.error.message}`); return response.data }

let userId
const crmLeadIds = []
try {
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `QA Import Approval ${suffix}` } }))
  userId = created.user.id
  must(await admin.from('registration_requests').update({ status: 'approved' }).eq('user_id', userId))
  must(await admin.from('user_roles').insert([{ user_id: userId, role: 'traffic_manager' }, { user_id: userId, role: 'executive' }]).select('id'))
  const session = must(await collaborator.auth.signInWithPassword({ email, password })).session
  assert(session, 'Disposable account must be able to sign in')

  // --- Métricas: pendente -> rejeitar nunca escreve em meta_traffic_daily ---
  const metricsRow = {
    date: today, account_id: accountId, account_name: 'Conta QA', campaign_id: campaignId, campaign_name: 'Campanha QA',
    adset_id: '', adset_name: '', ad_id: '', ad_name: '', level: 'campaign', currency: 'BRL',
    attribution_window: '7 dias clique', objective: 'Geração de cadastro',
    spend: 100, leads: 10, purchases: 0, purchase_value: 0, impressions: 1000, reach: 900, link_clicks: 50,
    messaging_conversations_started: 0,
    present_metrics: ['objective', 'leads', 'purchases', 'purchase_value', 'impressions', 'reach', 'link_clicks', 'messaging_conversations_started'],
  }
  const rejectedImport = must(await collaborator.rpc('meta_import_daily', { p_filename: `qa-pending-${suffix}-a.csv`, p_rows: [metricsRow] }))
  const pendingBatchA = must(await admin.from('meta_import_batches').select('*').eq('id', rejectedImport.batch_id).single())
  assert.equal(pendingBatchA.status, 'pendente')
  assert.equal(must(await admin.from('meta_traffic_daily').select('id').eq('account_id', accountId)).length, 0,
    'pending batch must not write to meta_traffic_daily yet')
  const rejected = must(await collaborator.rpc('meta_review_traffic_import', {
    p_batch_id: rejectedImport.batch_id, p_action: 'rejeitar', p_expected_updated_at: pendingBatchA.updated_at, p_note: 'QA: motivo de teste',
  }))
  assert.equal(rejected.status, 'rejeitado')
  assert.equal(must(await admin.from('meta_traffic_daily').select('id').eq('account_id', accountId)).length, 0,
    'rejected batch must never write to meta_traffic_daily')

  // --- Métricas: pendente -> aprovar grava em meta_traffic_daily (mesmo helper meta_upsert_traffic_row de sempre) ---
  const approvedImport = must(await collaborator.rpc('meta_import_daily', { p_filename: `qa-pending-${suffix}-b.csv`, p_rows: [metricsRow] }))
  const pendingBatchB = must(await admin.from('meta_import_batches').select('*').eq('id', approvedImport.batch_id).single())
  const approved = must(await collaborator.rpc('meta_review_traffic_import', {
    p_batch_id: approvedImport.batch_id, p_action: 'aprovar', p_expected_updated_at: pendingBatchB.updated_at,
  }))
  assert.equal(approved.status, 'aprovado')
  const afterApproval = must(await admin.from('meta_traffic_daily').select('spend,leads').eq('account_id', accountId).eq('campaign_id', campaignId).single())
  assert.equal(afterApproval.spend, 100)
  assert.equal(afterApproval.leads, 10)

  // Rejeitar de novo o mesmo lote (já revisado) deve falhar, não reabrir a decisão.
  const doubleReview = await collaborator.rpc('meta_review_traffic_import', {
    p_batch_id: approvedImport.batch_id, p_action: 'rejeitar', p_expected_updated_at: approved.updated_at, p_note: 'QA: nao deveria aplicar',
  })
  assert.ok(doubleReview.error, 'reviewing an already-decided batch must fail')

  // --- Leads: linha completa vira crm_leads automaticamente; linha sem e-mail/atleta (como o
  // formulário real, que nunca pergunta e-mail) e linha com posição em texto livre (fora do
  // enum do CRM) ficam 'novo' pro SDR, sem travar o lote e sem perder as respostas extras ---
  const completeLead = {
    meta_lead_id: `qa-lead-complete-${suffix}`, campaign_id: campaignId, campaign_name: 'Campanha QA',
    ad_id: '', form_id: `qa-form-${suffix}`, form_name: 'Formulário QA', created_time: new Date().toISOString(),
    full_name: 'QA Responsavel Completo', phone: '11999990000', email: `qa-athlete-${suffix}@example.invalid`,
    athlete_name: 'QA Atleta Completo', athlete_birth_date: '2010-03-15', athlete_position: 'Meia',
    athlete_age: '15', athlete_height_cm: '170', athlete_weight_kg: '60', city_state: 'São Paulo/SP', performance_report_url: '',
    field_data: [{ name: 'Motivação', values: ['Ser profissional'] }], raw_notes: 'Motivação: Ser profissional',
  }
  const noEmailLead = {
    meta_lead_id: `qa-lead-no-email-${suffix}`, campaign_id: campaignId, campaign_name: 'Campanha QA',
    ad_id: '', form_id: `qa-form-${suffix}`, form_name: 'Formulário QA', created_time: new Date().toISOString(),
    full_name: 'QA Responsavel Sem Email', phone: '11988880000', email: '',
    athlete_name: '', athlete_birth_date: '', athlete_position: '', athlete_age: '', athlete_height_cm: '', athlete_weight_kg: '', city_state: '', performance_report_url: '',
    field_data: [], raw_notes: '',
  }
  const messyPositionLead = {
    meta_lead_id: `qa-lead-messy-position-${suffix}`, campaign_id: campaignId, campaign_name: 'Campanha QA',
    ad_id: '', form_id: `qa-form-${suffix}`, form_name: 'Formulário QA', created_time: new Date().toISOString(),
    full_name: 'QA Responsavel Posicao Livre', phone: '11977770000', email: `qa-messy-${suffix}@example.invalid`,
    athlete_name: 'QA Atleta Posicao Livre', athlete_birth_date: '2011-05-10', athlete_position: 'volante/zagueiro/meio campo',
    athlete_age: '', athlete_height_cm: '', athlete_weight_kg: '', city_state: '', performance_report_url: '',
    field_data: [{ name: 'Dificuldade', values: ['Falta de oportunidades'] }], raw_notes: 'Dificuldade: Falta de oportunidades',
  }
  const leadImport = must(await collaborator.rpc('meta_import_leads', { p_filename: `qa-leads-${suffix}.csv`, p_rows: [completeLead, noEmailLead, messyPositionLead] }))
  const pendingLeadBatch = must(await admin.from('meta_lead_import_batches').select('*').eq('id', leadImport.batch_id).single())
  assert.equal(pendingLeadBatch.status, 'pendente')
  const approvedLeadBatch = must(await collaborator.rpc('meta_review_lead_import', {
    p_batch_id: leadImport.batch_id, p_action: 'aprovar', p_expected_updated_at: pendingLeadBatch.updated_at,
  }))
  assert.equal(approvedLeadBatch.status, 'aprovado')

  const completeFormLead = must(await admin.from('meta_form_leads').select('*').eq('meta_lead_id', completeLead.meta_lead_id).single())
  assert.equal(completeFormLead.status, 'importado')
  assert.ok(completeFormLead.crm_lead_id, 'a complete row must auto-create a crm_leads row on approval')
  crmLeadIds.push(completeFormLead.crm_lead_id)
  const crmLead = must(await admin.from('crm_leads').select('athlete_name,athlete_position,lead_source,meta_form_lead_id,observations').eq('id', completeFormLead.crm_lead_id).single())
  assert.equal(crmLead.athlete_position, 'Meia')
  assert.equal(crmLead.lead_source, 'meta_ads_form')
  assert.equal(crmLead.meta_form_lead_id, completeFormLead.id)
  assert.ok(crmLead.observations.includes('Motivação: Ser profissional'), 'extra form answers without a dedicated CRM field must be concatenated into observations')

  const noEmailFormLead = must(await admin.from('meta_form_leads').select('*').eq('meta_lead_id', noEmailLead.meta_lead_id).single())
  assert.equal(noEmailFormLead.status, 'novo', 'a row missing email (the real form never asks for it) must stay novo for manual SDR completion in /leads')
  assert.equal(noEmailFormLead.crm_lead_id, null)

  // Posição fora do enum do CRM: a linha entra na fila do mesmo jeito, com o texto original
  // preservado em field_data (visível em "Ver respostas" em /leads) - não vira crm_leads sozinha,
  // mas também não é bloqueada nem reescrita.
  const messyFormLead = must(await admin.from('meta_form_leads').select('*').eq('meta_lead_id', messyPositionLead.meta_lead_id).single())
  assert.equal(messyFormLead.status, 'novo', 'a free-text position outside the CRM enum must not auto-promote, but must not be rejected either')
  assert.equal(messyFormLead.crm_lead_id, null)
  assert.deepEqual(messyFormLead.field_data, messyPositionLead.field_data)

  console.log('PASS: importação de métricas e leads fica pendente até aprovação; rejeitar nunca grava; aprovar métricas publica em meta_traffic_daily; aprovar leads completa automaticamente o que dá e deixa o resto pendente em /leads')
} finally {
  // Quebra o par de FKs cruzadas crm_leads.meta_form_lead_id <-> meta_form_leads.crm_lead_id antes de apagar.
  await admin.from('meta_form_leads').update({ crm_lead_id: null }).eq('campaign_id', campaignId)
  if (crmLeadIds.length) await admin.from('crm_leads').update({ meta_form_lead_id: null }).in('id', crmLeadIds)
  if (crmLeadIds.length) await admin.from('crm_leads').delete().in('id', crmLeadIds)
  await admin.from('meta_form_leads').delete().eq('campaign_id', campaignId)
  await admin.from('meta_lead_import_batches').delete().ilike('filename', `qa-leads-${suffix}%`)
  await admin.from('meta_traffic_daily').delete().eq('account_id', accountId)
  await admin.from('meta_import_batches').delete().ilike('filename', `qa-pending-${suffix}%`)
  await collaborator.auth.signOut().catch(() => undefined)
  if (userId) {
    await admin.from('user_roles').delete().eq('user_id', userId)
    const removed = await admin.auth.admin.deleteUser(userId)
    if (removed.error) throw removed.error
  }
  await collaborator.removeAllChannels()
  await admin.removeAllChannels()
  console.log('Removed the disposable account and disposable import batches/leads.')
}
