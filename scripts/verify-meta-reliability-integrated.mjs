import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { postgresApi } from './helpers/meta-postgres-api.mjs'
import { buildTrafficView } from '../src/lib/meta-traffic-view.ts'
import { loadHandler } from './helpers/meta-edge-harness.mjs'
import { leadDatabase, leadsGraph, json } from './helpers/meta-lead-fixtures.mjs'
const request = body => new Request('https://example.invalid', { method: 'POST', headers: { 'x-cron-secret': 'test-cron', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
test('cron discovery boolean selects drain-only and rejects malformed modes', async () => {
  const admin = leadDatabase(), paths = []
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', { admin, fetch: address => { paths.push(new URL(address).pathname); return leadsGraph(address) } })
  assert.equal((await handler(request({ discover: false }))).status, 200)
  assert.deepEqual(paths, [])
  assert.equal((await handler(request({ discover: 'false' }))).status, 400)
  assert.equal(admin.calls.find(call => call.name === 'meta_lead_run_start').args.p_discover, false)
})
test('busy pages rotate across minute workers so another authorized page is not starved', async () => {
  let now = 0
  class Clock extends Date { static now() { return now } }
  const admin = leadDatabase(), original = admin.rpc.bind(admin)
  for (const page of ['page1','page2']) await original('meta_webhook_event_receive', { p_leadgen_id: 'lead-'+page, p_page_id: page, p_form_id: 'form1' })
  admin.rpc = async (name,args) => { const response = await original(name,args); if(name==='meta_lead_event_ingest' || (name==='meta_lead_events_claim' && args.p_page_ids[0]==='page1' && response.data.length===0)) now+=40000; return response }
  const {handler} = await loadHandler('meta-leads-reconciliation/index.ts', {admin,clock:Clock,extraEnv:{META_PAGE_IDS:'page1,page2'},fetch:address=>{
    const url=new URL(address), id=url.pathname.split('/').at(-1)
    if (url.searchParams.get('fields')==='id,access_token') return json({id,access_token:'synthetic-'+id})
    return new Response(JSON.stringify(id==='form1'?{name:'Synthetic'}:{id,form_id:'form1',created_time:'2026-10-09T12:00:00Z',field_data:[{name:'full_name',values:['Synthetic']},{name:'phone_number',values:['11999990000']},{name:'email',values:['qa@example.invalid']}]}))
  }})
  assert.equal((await handler(request({discover:false}))).status,202)
  assert.equal(admin.events.get('lead-page1').status,'processed')
  assert.equal(admin.events.get('lead-page2').status,'pending')
  now=60000
  assert.equal((await handler(request({discover:false}))).status,202)
  assert.equal(admin.events.get('lead-page2').status,'processed')
})

test('hourly discovery rotates busy first pages on consecutive scheduled hours', async () => {
  let now = Date.parse('2026-10-11T12:15:00Z'), sequence = 0
  class Clock extends Date { static now() { return now } }
  const admin = leadDatabase()
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', { admin, clock: Clock, extraEnv: { META_PAGE_IDS: 'page1,page2' }, fetch: address => {
    const url = new URL(address), next = new URL(url)
    if (url.searchParams.get('fields')==='id,access_token') return json({id:url.pathname.split('/').at(-1),access_token:'synthetic-page'})
    assert(url.pathname.endsWith('/leadgen_forms'))
    next.searchParams.set('after', String(++sequence)); now += 39000
    return new Response(JSON.stringify({ data: [], paging: { next: next.href } }))
  } })
  assert.equal((await handler(request({ discover: true }))).status, 202)
  assert.equal(admin.discoveries.size, 1)
  now = Date.parse('2026-10-11T13:15:00Z')
  assert.equal((await handler(request({ discover: true }))).status, 202)
  assert.equal(admin.discoveries.size, 2)
})

test('real PostgreSQL: paginated capture and signed webhook require approval, survive recovery and reject concurrent decisions atomically', { timeout: 180000 }, async () => {
  const address = new URL(process.env.TRAFFIC_TEST_DATABASE_URL || 'missing://local')
  assert(address.hostname === '127.0.0.1' && address.port === '55432' && address.pathname === '/traffic_migration_check', 'Use the disposable local template database')
  assert(process.env.TRAFFIC_PG_MODULE, 'Provide the local pg test dependency')
  const { default: pg } = await import(pathToFileURL(process.env.TRAFFIC_PG_MODULE).href)
  pg.types.setTypeParser(1082, value => value)
  pg.types.setTypeParser(1184, value => value) // Preserve PostgreSQL microseconds for optimistic concurrency.
  const database = 'traffic_integration_' + Date.now()
  const control = new pg.Client({ connectionString: new URL('/postgres', address).href })
  const url = new URL('/' + database, address).href
  const client = new pg.Client({ connectionString: url }), rival = new pg.Client({ connectionString: url })
  await control.connect()
  try {
    await control.query(`CREATE DATABASE "${database}" TEMPLATE traffic_migration_check`)
    await client.connect(); await rival.connect()
    await client.query(readFileSync('scripts/helpers/meta-db-fixtures.sql', 'utf8'))
    const actor = (await client.query("SELECT pg_temp.seed_meta_actor('approved',false,'executive') AS id")).rows[0].id
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false)")
    await client.query("INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES('95001','Synthetic integrated account','BRL','America/Sao_Paulo','active',$1)", [actor])
    const admin = postgresApi(client)
    const rpc = async (name, args) => { const result = await admin.rpc(name, args); assert.equal(result.error, null, JSON.stringify(result.error)); return result.data }
    const since = '2026-10-09', params = { level: 'ad', time_increment: '1', time_range: JSON.stringify({ since, until: since }), fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions,action_values', limit: '500' }
    const run = await rpc('meta_capture_open', { p_account_id: '95001', p_level: 'ad', p_start: since, p_end: since, p_params: params, p_metadata: { id: '95001', name: 'Synthetic', currency: 'BRL', timezone: 'America/Sao_Paulo' }, p_triggered_by: 'cron', p_actor: null })
    // A crashed claimant cannot keep ownership once the lease expires.
    const abandoned = await rpc('meta_capture_claim', { p_id: run, p_lease_seconds: 1 })
    await client.query("UPDATE public.meta_sync_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [run])
    const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    let graphPages = 0
    const fetch = address => {
      const u = new URL(address), endpoint = u.pathname.split('/').at(-1)
      if (endpoint === 'act_95001') return json({ id: '95001', name: 'Synthetic', currency: 'BRL', timezone_name: 'America/Sao_Paulo' })
      if (endpoint === 'campaign') return json({ objective: 'OUTCOME_LEADS' })
      if (endpoint === 'insights') {
        const page = Number(u.searchParams.get('after') || 0); graphPages++
        const data = Array.from({ length: Math.min(500, 2001 - page * 500) }, (_, n) => ({ date_start: since, campaign_id: 'campaign', campaign_name: 'Synthetic', adset_id: 'set', ad_id: 'ad-' + (page * 500 + n), spend: '10', actions: [{ action_type: 'lead', value: '2' }] }))
        const next = new URL(u); next.searchParams.set('after', String(page + 1))
        return json({ data, ...(page < 4 ? { paging: { next: next.href } } : {}) })
      }
      throw Error('Unexpected synthetic Graph endpoint: ' + endpoint)
    }
    const { handler } = await loadHandler('meta-insights-sync/index.ts', { admin, fetch })
    for (let turn = 0; turn < 3; turn++) {
      assert.equal((await handler(request({ resumeOnly: true }))).status, turn < 2 ? 202 : 200)
      assert.equal((await client.query('SELECT count(*)::int n FROM public.meta_traffic_daily')).rows[0].n, 0)
    }
    assert.equal(graphPages, 5)
    const review = (await client.query('SELECT id,version FROM public.meta_capture_reviews WHERE sync_run_id=$1', [run])).rows[0]
    assert.equal((await client.query('SELECT count(*)::int n FROM public.meta_capture_review_rows WHERE review_id=$1', [review.id])).rows[0].n, 2001)
    const oldClaim = await admin.rpc('meta_capture_append', { p_id: run, p_claim: abandoned.claim_token, p_page_no: 0, p_request_hash: 'stale', p_rows: [], p_next: null })
    assert.equal(oldClaim.error.code, 'PT409')
    console.log('PASS: 2001 captured rows, five pages, expired claimant, no publication before approval')
    await client.query('BEGIN'); await rival.query('BEGIN')
    for (const conn of [client, rival]) { await conn.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor]); await conn.query('SET LOCAL ROLE authenticated') }
    await client.query("SELECT public.meta_capture_review_decide($1,1,'aprovar','Synthetic integrated approval')", [review.id])
    const rivalPid = (await rival.query('SELECT pg_backend_pid() id')).rows[0].id
    const competing = rival.query("SELECT public.meta_capture_review_decide($1,1,'aprovar','Competing decision')", [review.id]).then(() => null, error => error)
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt++) { waiting = (await control.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1", [rivalPid])).rows[0]?.waiting; if (waiting) break; await new Promise(resolve => setTimeout(resolve, 20)) }
    assert(waiting, 'Concurrent reviewer did not wait on the transaction lock')
    await client.query('COMMIT'); assert.equal((await competing).code, 'PT409'); await rival.query('ROLLBACK')
    const published = (await client.query('SELECT * FROM public.meta_traffic_daily')).rows
    assert.equal(published.length, 2001)
    const view = buildTrafficView(published, { start: since, end: since, level: 'ad', accountId: '95001', campaignId: null, source: 'api' })
    assert.equal(view.rows.length, 2001); assert.equal(view.total.spend, 20010)
    console.log('PASS: concurrent decision rejected as a whole; 2001 published identities and view total agree')
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false)")
    const raw = JSON.stringify({ object: 'page', entry: [{ id: 'page1', changes: [{ field: 'leadgen', value: { leadgen_id: 'lead-integration', page_id: 'page1', form_id: 'form1' } }] }] })
    const signed = () => new Request('https://example.invalid', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'test-secret').update(raw).digest('hex') } })
    const webhook = await loadHandler('meta-lead-webhook/index.ts', { admin, extraEnv: { META_APP_SECRET: 'test-secret' }, fetch: () => { throw Error('Inline webhook Graph call') } })
    assert.equal((await webhook.handler(signed())).status, 200); assert.equal((await webhook.handler(signed())).status, 200)
    const fields = [{ name: 'full_name', values: ['Synthetic Parent'] }, { name: 'phone_number', values: ['11999990000'] }, { name: 'email', values: ['qa@example.invalid'] }, { name: 'athlete_name', values: ['Synthetic Athlete'] }, { name: 'athlete_birth_date', values: ['2010-03-15'] }, { name: 'athlete_position', values: ['Meia'] }, { name: 'Objetivo', values: ['Preservar resposta original'] }]
    const worker = await loadHandler('meta-leads-reconciliation/index.ts', { admin, fetch: address => {
      const url = new URL(address)
      if (url.pathname.endsWith('/page1') && url.searchParams.get('fields') === 'id,access_token') return json({ id: 'page1', access_token: 'synthetic-page-token' })
      return url.pathname.endsWith('/form1') ? json({ name: 'Synthetic form' }) : json({ id: 'lead-integration', form_id: 'form1', created_time: since + 'T12:00:00Z', field_data: fields })
    } })
    assert.equal((await worker.handler(request({ discover: false }))).status, 200)
    const lead = (await client.query("SELECT * FROM public.meta_form_leads WHERE meta_lead_id='lead-integration'")).rows[0]
    assert.equal(lead.approval_status, 'pendente'); assert.equal(lead.crm_lead_id, null); assert.deepEqual(lead.field_data, fields)
    await client.query('BEGIN'); await client.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor]); await client.query('SET LOCAL ROLE authenticated')
    await client.query("SELECT public.meta_review_form_lead($1,'aprovar',$2,'Synthetic lead approval')", [lead.id, lead.updated_at]); await client.query('COMMIT')
    const confirmed = (await client.query('SELECT crm_lead_id,approval_status FROM public.meta_form_leads WHERE id=$1', [lead.id])).rows[0]
    assert.equal(confirmed.approval_status, 'aprovado'); assert(confirmed.crm_lead_id)
    assert.equal((await client.query('SELECT count(*)::int n FROM public.crm_leads WHERE id=$1', [confirmed.crm_lead_id])).rows[0].n, 1)
    assert.equal((await client.query("SELECT receipt_count FROM public.meta_webhook_events WHERE leadgen_id='lead-integration'")).rows[0].receipt_count, 2)
    console.log('PASS: signed webhook -> durable deduplicated receipt -> real worker -> pending lead -> explicit approval -> CRM, originals preserved')
    await client.query("SELECT set_config('request.jwt.claim.role','service_role',false)")
    const discovery = await rpc('meta_lead_run_start',{p_page_id:'page-mode',p_discover:true})
    const drain = await rpc('meta_lead_run_start',{p_page_id:'page-mode',p_discover:false})
    assert.notEqual(discovery,drain)
    assert.equal((await admin.rpc('meta_lead_run_start',{p_page_id:'page-mode',p_discover:false})).error.code,'55006')
    await client.query("UPDATE public.meta_sync_runs SET started_at=clock_timestamp()-interval '3 minutes' WHERE id=$1",[drain])
    const resumed = await rpc('meta_lead_run_start',{p_page_id:'page-mode',p_discover:false})
    assert.notEqual(resumed,drain)
    assert.equal((await client.query('SELECT status FROM public.meta_sync_runs WHERE id=$1',[drain])).rows[0].status,'error')
    await client.query("UPDATE public.meta_sync_runs SET status='error',error_message='pages_manage_ads access_token=secret' WHERE id=$1",[discovery])
    await client.query("UPDATE public.meta_sync_runs SET status='success' WHERE id=$1",[resumed])
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[actor])
    const operation=await rpc('meta_traffic_operation',{})
    const modes=operation.runs.filter(row=>row.account_id==='page-mode')
    assert.equal(modes.length,2)
    assert.equal(modes.find(row=>row.discover).status,'error')
    assert.equal(modes.find(row=>!row.discover).status,'success')
    assert.doesNotMatch(JSON.stringify(modes),/access_token|secret/)
    console.log('PASS: discovery and drain coexist, duplicate mode rejects, abandoned run recovers, permission error remains visible')
    const schema = readFileSync('scripts/verify-meta-reliability-schema.sql', 'utf8')
    assert.equal((await client.query(schema)).rows[0].preflight.ready, true)
    await client.query('BEGIN'); await client.query('DROP FUNCTION public.meta_capture_review_decide(uuid,bigint,text,text)')
    assert.equal((await client.query(schema)).rows[0].preflight.ready, false); await client.query('ROLLBACK')
    await client.query('BEGIN'); await client.query('ALTER TABLE public.meta_traffic_daily DISABLE TRIGGER meta_traffic_signal_delete')
    assert.equal((await client.query(schema)).rows[0].preflight.ready, false); await client.query('ROLLBACK')
    await client.query('BEGIN'); await client.query('GRANT EXECUTE ON FUNCTION public.meta_lead_events_claim(integer,integer,text[]) TO authenticated')
    assert.equal((await client.query(schema)).rows[0].preflight.ready, false); await client.query('ROLLBACK')
    await client.query('BEGIN'); await client.query("DELETE FROM supabase_migrations.schema_migrations WHERE version='20261011140000'")
    assert((await client.query(schema)).rows[0].preflight.checks.some(check => check.detail === 'present_unrecorded')); await client.query('ROLLBACK')
    await client.query(readFileSync('supabase/migrations/20261011170000_meta_worker_cron.sql','utf8'))
    const jobs=(await client.query('SELECT jobname,schedule,command,active FROM cron.job ORDER BY jobname')).rows
    assert.equal(jobs.length,5);assert(jobs.every(job=>job.active===false))
    await client.query("CREATE TEMP TABLE requests(url text,headers jsonb,body jsonb,timeout_ms integer); CREATE OR REPLACE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO pg_temp.requests VALUES(url,headers,body,timeout_milliseconds); RETURN 1; END $$")
    for(const job of jobs) await client.query(job.command)
    assert.equal((await client.query('SELECT count(*)::int n FROM pg_temp.requests')).rows[0].n,0,'Missing secrets must not send requests')
    await client.query("INSERT INTO vault.decrypted_secrets VALUES ('meta_cron_anon_key','synthetic'),('meta_sync_cron_secret','synthetic')")
    for(const job of jobs) await client.query(job.command)
    const requests=(await client.query('SELECT * FROM pg_temp.requests')).rows
    assert.equal(requests.length,5);assert(requests.every(row=>row.timeout_ms===60000))
    assert.equal(requests.filter(row=>row.body.discover===false).length,1)
    assert.equal(requests.filter(row=>row.body.discover===true).length,1)
    assert.equal(requests.filter(row=>row.body.resumeOnly===true).length,1)
    assert.equal(jobs.find(row=>row.jobname==='meta-lead-worker').schedule,'* * * * *')
    console.log('PASS: preflight detects disabled trigger, unsafe grant and unrecorded object; five deployment jobs remain paused')
  } finally {
    await Promise.allSettled([client.end(), rival.end()])
    await control.query(`DROP DATABASE IF EXISTS "${database}"`); await control.end()
  }
})
