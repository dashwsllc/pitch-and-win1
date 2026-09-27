// Real production smoke test. Creates one isolated account/role and disposable
// meta_traffic_daily/meta_import_batches rows, always removes all of them.
// Proves meta_import_daily's present_metrics upsert on the real RPC (not just
// the pure client-side row-building already covered by verify-meta-traffic.mjs).
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--run-disposable-check')) throw Error('Use --run-disposable-check to create and remove one temporary traffic_manager account and Meta import rows.')
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
const email = `qa-meta-rt-${suffix}@example.invalid`
const password = `Meta-Roundtrip-${randomUUID()}!Aa1`
const accountId = `qa-act-${suffix}`
const campaignId = `qa-camp-${suffix}`
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const must = response => { if (response.error) throw Error(`${response.error.code || response.status || 'API'}: ${response.error.message}`); return response.data }

const baseRow = {
  date: today, account_id: accountId, account_name: 'Conta QA', campaign_id: campaignId, campaign_name: 'Campanha QA',
  adset_id: '', adset_name: '', ad_id: '', ad_name: '', level: 'campaign', currency: 'BRL',
  attribution_window: '7 dias clique', objective: 'Geração de cadastro',
  spend: 100, leads: 10, purchases: 0, purchase_value: 0, impressions: 1000, reach: 900, link_clicks: 50,
  messaging_conversations_started: 0,
}
const allMetrics = ['objective', 'leads', 'purchases', 'purchase_value', 'impressions', 'reach', 'link_clicks', 'messaging_conversations_started']

let userId
try {
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `QA Meta Roundtrip ${suffix}` } }))
  userId = created.user.id
  must(await admin.from('registration_requests').update({ status: 'approved' }).eq('user_id', userId))
  must(await admin.from('user_roles').insert({ user_id: userId, role: 'traffic_manager' }).select('id').single())
  const session = must(await collaborator.auth.signInWithPassword({ email, password })).session
  assert(session, 'Disposable traffic_manager must be able to sign in')

  const firstImport = await collaborator.rpc('meta_import_daily', {
    p_filename: `qa-roundtrip-${suffix}.csv`,
    p_rows: [{ ...baseRow, present_metrics: allMetrics }],
  })
  assert.ifError(firstImport.error)
  assert.equal(firstImport.data.rows, 1)

  const afterFirst = must(await admin.from('meta_traffic_daily')
    .select('objective,leads,spend,purchases').eq('account_id', accountId).eq('campaign_id', campaignId).single())
  assert.equal(afterFirst.objective, 'Geração de cadastro')
  assert.equal(afterFirst.leads, 10)
  assert.equal(afterFirst.spend, 100)

  // Reimporta a mesma chave (date,account_id,campaign_id,adset_id,ad_id) com
  // present_metrics faltando 'objective' e 'leads' — mesmo com valores diferentes
  // no payload para essas duas colunas, eles precisam ser ignorados e o valor
  // do primeiro lote precisa sobreviver. 'spend' está em present_metrics e deve
  // ser atualizado, provando que o upsert distingue campo a campo.
  const secondImport = await collaborator.rpc('meta_import_daily', {
    p_filename: `qa-roundtrip-${suffix}-partial.csv`,
    p_rows: [{
      ...baseRow, objective: 'valor-que-nao-deveria-ser-usado', leads: 999, spend: 250,
      present_metrics: allMetrics.filter(metric => metric !== 'objective' && metric !== 'leads'),
    }],
  })
  assert.ifError(secondImport.error)

  const afterSecond = must(await admin.from('meta_traffic_daily')
    .select('objective,leads,spend,purchases').eq('account_id', accountId).eq('campaign_id', campaignId).single())
  assert.equal(afterSecond.objective, 'Geração de cadastro', 'objective absent from present_metrics must be preserved')
  assert.equal(afterSecond.leads, 10, 'leads absent from present_metrics must be preserved')
  assert.equal(afterSecond.spend, 250, 'spend present in present_metrics must be updated')

  console.log('PASS: meta_import_daily round-trip preserves metrics absent from present_metrics and updates the ones present')
} finally {
  await admin.from('meta_traffic_daily').delete().eq('account_id', accountId)
  await admin.from('meta_import_batches').delete().ilike('filename', `qa-roundtrip-${suffix}%`)
  await collaborator.auth.signOut().catch(() => undefined)
  if (userId) {
    await admin.from('user_roles').delete().eq('user_id', userId)
    const removed = await admin.auth.admin.deleteUser(userId)
    if (removed.error) throw removed.error
  }
  await collaborator.removeAllChannels()
  await admin.removeAllChannels()
  console.log('Removed the disposable traffic_manager account and Meta import rows.')
}
