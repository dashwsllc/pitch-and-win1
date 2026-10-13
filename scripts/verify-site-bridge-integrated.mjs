import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {loadHandler} from './helpers/meta-edge-harness.mjs'

test('real source and destination PostgreSQL + production handlers survive lost ACK, recovery, review and subsequent full context',{timeout:90000},async()=>{
 assert(process.env.SITE_TEST_PG_MODULE&&process.env.SITE_TEST_SOURCE_ROOT,'provide isolated test dependencies/source checkout')
 const {default:pg}=await import(pathToFileURL(process.env.SITE_TEST_PG_MODULE).href)
 pg.types.setTypeParser(1184,value=>value)
 assert(process.env.SITE_TEST_DATABASE_PASSWORD,'provide the owned local test credential')
 const config={host:'127.0.0.1',port:55812,user:'postgres',password:process.env.SITE_TEST_DATABASE_PASSWORD}
 const source=new pg.Client({...config,database:'site_bridge_source'}),dash=new pg.Client({...config,database:'site_bridge_dash'})
 await source.connect();await dash.connect()
 const api=client=>({async rpc(name,args={}){assert.match(name,/^(site_import_receive|site_bridge_heartbeat_receive|funnel_outbox_claim|funnel_outbox_ack|funnel_outbox_fail|funnel_outbox_health)$/);try{const params=Object.entries(args);const sql=`SELECT public.${name}(${params.map(([key],i)=>key+'=> $'+(i+1)).join(',')}) AS data`;return {data:(await client.query(sql,params.map(([,value])=>value&&typeof value==='object'?JSON.stringify(value):value))).rows[0].data,error:null}}catch(error){return {data:null,error:{code:error.code}}}}})
 const secret='synthetic-integrated-secret',sourceRoot=process.env.SITE_TEST_SOURCE_ROOT
 const {loadFunnelModule}=await import(pathToFileURL(resolve(sourceRoot,'scripts/helpers/funnel-edge-harness.mjs')).href)
 const receiver=(await loadHandler('site-lead-receiver/index.ts',{admin:api(dash),extraEnv:{SITE_BRIDGE_SHARED_SECRET:secret}})).handler
 let lose=false;const observed=[]
 const {exports:worker}=await loadFunnelModule('_shared/funnel-lead-delivery.ts',{admin:api(source),fetch:async(url,init)=>{
  const response=await receiver(new Request(url,init));const body=JSON.parse(init.body);if(body.event_id)observed.push(body.event_id)
  if(lose&&body.event_id){lose=false;assert.equal(response.status,200);throw Error('lost after durable destination commit')}
  return response
 }})
 const deliver=()=>worker.deliverFunnelEvents(api(source),{receiverUrl:'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/site-lead-receiver',sharedSecret:secret,deadlineMs:45000})
 try{
  const email='qa-integrated-'+randomUUID()+'@example.invalid',contact={name:'Integrated synthetic',email,phone:'11999990000'}
  const capture=async(profile,report=null)=>(await source.query('SELECT public.capture_funnel_lead_v2($1,$2,$3,$4) AS result',[JSON.stringify(contact),JSON.stringify(profile),JSON.stringify({utm_campaign:'Integral campaign '+ 'á'.repeat(900)}),report?JSON.stringify(report):null])).rows[0].result
  const initial=await capture({name:contact.name,city:'Initial',photo:'X'.repeat(100000)},{method:'deterministic-profile-v1',overall:87})
  const sid=initial.lead_id
  lose=true;const first=await deliver();assert.equal(first.retryable,1)
  await source.query("UPDATE funnel_lead_outbox SET next_attempt_at=clock_timestamp() WHERE source_lead_id=$1 AND state='pending'",[sid])
  await deliver()
  const lead=(await dash.query("SELECT * FROM meta_form_leads WHERE meta_lead_id='site:zyron:'||$1::text",[sid])).rows[0]
  assert.equal(lead.approval_status,'pendente');assert.equal(lead.crm_lead_id,null)
  assert.equal((await dash.query('SELECT count(*)::int n FROM meta_form_leads WHERE id=$1',[lead.id])).rows[0].n,1)
  assert.equal((await dash.query('SELECT count(*)::int n FROM site_import_events WHERE source_lead_id=$1',[sid])).rows[0].n,2)
  assert(observed.length>new Set(observed).size,'lost response did not exercise actual duplicate receive')
  await dash.query(readFileSync('scripts/helpers/meta-db-fixtures.sql','utf8'))
  const actor=(await dash.query("SELECT pg_temp.seed_meta_actor('approved',false,'executive') id")).rows[0].id
  await dash.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[actor])
  const review=(await dash.query('SELECT public.meta_wave_begin_review($1) r',[lead.wave_id])).rows[0].r
  const members=review.leads.map(x=>({id:x.id,updated_at:x.updated_at}))
  const decision=(await dash.query("SELECT public.meta_wave_decide_versioned($1,$2,$3,'aprovar','[]','',$4) r",[lead.wave_id,review.wave.version,JSON.stringify(members),randomUUID()])).rows[0].r
  assert(decision.approved>=1)
  const crm=(await dash.query('SELECT * FROM crm_leads WHERE meta_form_lead_id=$1',[lead.id])).rows[0]
  assert.equal(crm.import_channel,'website');assert.equal(crm.import_method,'automatic');assert.equal(crm.lead_received_at,lead.first_received_at)
  assert.equal(crm.import_snapshot.source_snapshot.site_event.payload.profile.photo.length,100000)
  await dash.query("UPDATE crm_leads SET phone='11988887777' WHERE id=$1",[crm.id]);const approved=crm.import_snapshot
  await capture({city:'New complete profile',nationality:'Brasil',preferredFoot:'Direito'});await deliver()
  const current=(await dash.query('SELECT * FROM crm_leads WHERE id=$1',[crm.id])).rows[0]
  assert.equal(current.phone,'11988887777');assert.deepEqual(current.import_snapshot,approved)
  assert.equal((await dash.query("SELECT count(*)::int n FROM site_import_events WHERE source_lead_id=$1 AND status='context_only'",[sid])).rows[0].n,1)
  // Trusted manual source identity merges only the link, never the manual capture.
  const manualSid=(await source.query("SELECT public.capture_funnel_lead('Manual fixture',$1,'11999990000') id",['qa-manual-'+randomUUID()+'@example.invalid'])).rows[0].id
  const manual=(await dash.query('SELECT public.meta_import_leads($1,$2) r',['site-fixture.csv',JSON.stringify([{meta_lead_id:'site:zyron:'+manualSid,entry_channel:'website',full_name:'Manual original',phone:'11999990000'}])])).rows[0].r
  await deliver();const matched=(await dash.query("SELECT * FROM meta_form_leads WHERE meta_lead_id='site:zyron:'||$1::text",[manualSid])).rows[0]
  assert.equal(matched.full_name,'Manual original');assert(matched.lead_import_batch_id)
  // Recover the historical source by UUID sets; repeated backfill leaves the same events.
  let cursor=null;for(let page=0;page<10;page++){const r=(await source.query('SELECT public.funnel_outbox_backfill($1,200) r',[cursor])).rows[0].r;cursor=r.last_id;if(r.done)break}
  const before=(await source.query('SELECT count(*)::int n FROM funnel_lead_outbox')).rows[0].n
  await source.query('SELECT public.funnel_outbox_backfill(NULL,200)');assert.equal((await source.query('SELECT count(*)::int n FROM funnel_lead_outbox')).rows[0].n,before)
  for(let pass=0;pass<20;pass++){const r=await deliver();if(!r.claimed)break}
  const ids=(await source.query('SELECT id FROM funnel_leads ORDER BY id')).rows.map(x=>x.id)
  const projected=(await dash.query("SELECT substring(meta_lead_id from 12) id FROM meta_form_leads WHERE meta_lead_id LIKE 'site:zyron:%' ORDER BY 1")).rows.map(x=>x.id)
  assert.deepEqual(projected,ids)
  assert.equal((await dash.query('SELECT max(n)::int n FROM(SELECT count(*) n FROM meta_form_leads GROUP BY wave_id)s')).rows[0].n<=20,true)
  console.log('PASS: two real local databases; lost committed ACK; full capture → review → CRM → history; manual canonical identity and historical UUID reconciliation',ids.length,'synthetic/local contacts')
 }finally{await source.end();await dash.end()}
})
