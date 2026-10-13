import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'

test('concurrent intake never exceeds twenty and competing decisions reject the stale snapshot', {timeout:90000}, async () => {
  const url=new URL(process.env.META_WAVE_TEST_DATABASE_URL || 'missing://local')
  assert.equal(url.hostname,'127.0.0.1')
  assert.equal(url.port,'55812')
  assert.equal(url.pathname,'/traffic_waves_test')
  const {default:pg}=await import(pathToFileURL(process.env.META_TEST_PG_MODULE).href)
  pg.types.setTypeParser(1184,value=>value)
  const name='traffic_waves_concurrency_'+Date.now()
  assert.match(name,/^traffic_waves_concurrency_[0-9]+$/)
  const control=new pg.Client({connectionString:new URL('/postgres',url).href})
  const address=new URL('/'+name,url).href
  const [setup,first,second]=Array.from({length:3},()=>new pg.Client({connectionString:address}))
  await control.connect()
  const waitOnLock=async client=>{
    const pid=(await client.query('SELECT pg_backend_pid() id')).rows[0].id
    for(let n=0;n<100;n++){
      if((await control.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting)return
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert.fail('competing transaction never waited on the required lock')
  }
  try {
    await control.query(`CREATE DATABASE "${name}" TEMPLATE traffic_waves_test`)
    await Promise.all([setup,first,second].map(client=>client.connect()))
    await setup.query(readFileSync('scripts/helpers/meta-db-fixtures.sql','utf8'))
    const actor=(await setup.query("SELECT pg_temp.seed_meta_actor('approved',false,'executive') id")).rows[0].id
    await setup.query("SELECT set_config('request.jwt.claim.role','service_role',false)")
    const payload=n=>({meta_lead_id:'qa-concurrent-'+n,page_id:'qa-page',form_id:'qa-form',full_name:'Synthetic parent',phone:'11999990000',created_time:'2026-10-12T14:00:00Z',field_data:[]})
    for(let n=1;n<=19;n++)await setup.query('SELECT public.meta_ingest_form_lead($1)',[payload(n)])
    const wave=(await setup.query('SELECT id FROM public.meta_lead_waves WHERE is_open')).rows[0].id
    for(const client of [first,second])await client.query("BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true)")
    await first.query('SELECT public.meta_ingest_form_lead($1)',[payload(20)])
    const rivalPid=(await second.query('SELECT pg_backend_pid() id')).rows[0].id
    const rival=second.query('SELECT public.meta_ingest_form_lead($1)',[payload(21)])
    let locked=false
    for(let n=0;n<100;n++){
      locked=(await control.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[rivalPid])).rows[0]?.waiting
      if(locked)break
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert(locked,'intake failed to serialize at capacity boundary')
    await first.query('COMMIT'); await rival; await second.query('COMMIT')
    const distribution=(await setup.query('SELECT count(*)::int n FROM public.meta_form_leads GROUP BY wave_id ORDER BY n DESC')).rows.map(x=>x.n)
    assert.deepEqual(distribution,[20,1])
    await setup.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[actor])
    const snapshot=(await setup.query('SELECT public.meta_wave_begin_review($1) snapshot',[wave])).rows[0].snapshot
    const members=snapshot.leads.map(lead=>({id:lead.id,updated_at:lead.updated_at}))
    for(const client of [first,second]){
      await client.query('BEGIN');await client.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actor]);await client.query('SET LOCAL ROLE authenticated')
    }
    const args=[wave,snapshot.wave.version,JSON.stringify(members)]
    await first.query("SELECT public.meta_wave_decide_versioned($1,$2,$3,'aprovar','[]','',$4)",[...args,randomUUID()])
    const competingPid=(await second.query('SELECT pg_backend_pid() id')).rows[0].id
    const competing=second.query("SELECT public.meta_wave_decide_versioned($1,$2,$3,'rejeitar','[]','Synthetic rejection',$4)",[...args,randomUUID()]).then(()=>null,error=>error)
    locked=false
    for(let n=0;n<100;n++){
      locked=(await control.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[competingPid])).rows[0]?.waiting
      if(locked)break
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert(locked,'review did not lock the wave before deciding')
    await first.query('COMMIT')
    assert.equal((await competing).code,'40001')
    await second.query('ROLLBACK')
    assert.equal((await setup.query("SELECT count(*)::int n FROM public.meta_form_leads WHERE wave_id=$1 AND approval_status='aprovado'",[wave])).rows[0].n,20)
  } finally {
    await Promise.allSettled([setup,first,second].map(client=>client.query('ROLLBACK')))
    await Promise.allSettled([setup,first,second].map(client=>client.end()))
    await control.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`)
    await control.end()
  }
})
