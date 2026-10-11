import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {pathToFileURL} from 'node:url'

test('two independent PostgreSQL workers claim different events while both transactions remain open',async()=>{
 const address=process.env.META_TRAFFIC_TEST_DB_URL
 assert(address,'META_TRAFFIC_TEST_DB_URL must point to a disposable local database')
 const url=new URL(address)
 assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname.startsWith('/traffic_'),'synthetic test is restricted to a local traffic test database')
 const module=process.env.META_TEST_PG_MODULE
 const {default:pg}=await import(module?pathToFileURL(module).href:'pg')
 const clients=Array.from({length:3},()=>new pg.Client({connectionString:address}))
 const [setup,first,second]=clients
 const ids=[],page='qa-concurrency-'+randomUUID(),form='qa-form'
 try {
  await Promise.all(clients.map(c=>c.connect()))
  await setup.query('BEGIN')
  await setup.query("SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true)")
  for(let n=0;n<2;n++)ids.push((await setup.query('SELECT public.meta_webhook_event_receive($1,$2,$3) AS id',['qa-lead-'+randomUUID(),page,form])).rows[0].id)
  await setup.query('COMMIT')
  for(const client of [first,second])await client.query("BEGIN; SET LOCAL statement_timeout='3s'; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',true)")
  const results=await Promise.all([first,second].map(c=>c.query('SELECT * FROM public.meta_lead_events_claim(1,60,$1)',[[page]])))
  assert.equal(results[0].rows.length,1);assert.equal(results[1].rows.length,1)
  assert.notEqual(results[0].rows[0].id,results[1].rows[0].id)
  assert.notEqual(results[0].rows[0].claim_token,results[1].rows[0].claim_token)
  assert.deepEqual(new Set(results.flatMap(r=>r.rows.map(row=>row.id))),new Set(ids))
 } finally {
  await Promise.allSettled(clients.map(c=>c.query('ROLLBACK')))
  if(ids.length)await setup.query('DELETE FROM public.meta_webhook_events WHERE id=ANY($1::uuid[])',[ids])
  await Promise.allSettled(clients.map(c=>c.end()))
 }
})
