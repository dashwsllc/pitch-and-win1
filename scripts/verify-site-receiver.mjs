import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { loadHandler } from './helpers/meta-edge-harness.mjs'

const secret='synthetic-site-bridge-secret'
const event=()=>({schema_version:1,event_id:randomUUID(),source_project:'mehmqibxzxfqdxqjnjad',source_lead_id:randomUUID(),source_revision:1,generated_at:'2026-10-12T13:04:05Z',source_updated_at:'2026-10-13T13:04:05Z',payload:{contact:{name:'João ⚽',phone:'11999990000'},profile:{city:'São Paulo'}}})
function request(body,timestamp=Math.floor(Date.now()/1000),signature) {
 const raw=typeof body==='string'?body:JSON.stringify(body)
 return new Request('https://receiver.invalid',{method:'POST',body:raw,headers:{'x-site-timestamp':String(timestamp),'x-site-signature':signature??'sha256='+createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')}})
}
async function receiver(rpc,extraEnv={}) {return (await loadHandler('site-lead-receiver/index.ts',{admin:{rpc},extraEnv:{SITE_BRIDGE_SHARED_SECRET:secret,...extraEnv}})).handler}
test('Unicode signature covers raw bytes and replay returns the committed receipt',async()=>{
 const records=new Map();let calls=0
 const handler=await receiver(async(name,args)=>{calls++;assert.equal(name,'site_import_receive');const e=args.p_event;if(calls===1)assert.equal(e.payload.contact.name,'João ⚽');const old=records.get(e.event_id);if(old&&old.hash!==args.p_body_sha256)return {error:{code:'23505'}};const data=old?.data??{event_id:e.event_id,source_lead_id:e.source_lead_id,source_revision:e.source_revision,receipt_id:randomUUID(),status:'pending_review'};records.set(e.event_id,{data,hash:args.p_body_sha256});return {data}})
 const e=event();const first=await (await handler(request(e))).json()
 const replay=await (await handler(request(e))).json()
 assert.equal(replay.receipt_id,first.receipt_id);assert.equal(calls,2)
 e.payload.contact.name='Changed';assert.equal((await handler(request(e))).status,409)
})
test('signature, age, malformed JSON and identity are rejected before database writes',async()=>{
 let calls=0;const handler=await receiver(async()=>{calls++;return {data:{}}})
 assert.equal((await handler(request(event(),Math.floor(Date.now()/1000)-301))).status,403)
 assert.equal((await handler(request(event(),undefined,'sha256='+'0'.repeat(64)))).status,403)
 assert.equal((await handler(request('{'))).status,400)
 assert.equal((await handler(request({...event(),source_project:'wrong'}))).status,400)
 assert.equal((await handler(request({...event(),source_revision:0}))).status,400)
 assert.equal(calls,0)
})
test('database errors and thrown transport failures never acknowledge a receipt',async()=>{
 for(const rpc of [async()=>({error:{code:'XX000'}}),async()=>{throw Error('connection lost')}]){
  assert.equal((await (await receiver(rpc))(request(event()))).status,503)
 }
})
test('unknown schema with valid identity reaches durable quarantine',async()=>{
 const handler=await receiver(async(name,{p_event:e})=>({data:{event_id:e.event_id,source_lead_id:e.source_lead_id,source_revision:e.source_revision,receipt_id:randomUUID(),status:'quarantined'}}))
 const response=await handler(request({...event(),schema_version:9}));assert.equal(response.status,200);assert.equal((await response.json()).status,'quarantined')
})
test('signed heartbeat stores health separately, and missing secrets fail closed',async()=>{
 let calls=0;const body={schema_version:1,kind:'heartbeat',source_project:'mehmqibxzxfqdxqjnjad',observed_at:new Date().toISOString(),pending_count:2,quarantined_count:1,oldest_pending_at:null}
 const handler=await receiver(async(name,args)=>{calls++;assert.equal(name,'site_bridge_heartbeat_receive');assert.equal(args.p_status.pending_count,2);return {data:null}})
 assert.equal((await handler(request(body))).status,200);assert.equal(calls,1)
 assert.equal((await (await receiver(async()=>{throw Error('must not run')},{SITE_BRIDGE_SHARED_SECRET:''}))(request(event()))).status,503)
})
test('body size is bounded by UTF8 bytes without a false acknowledgement',async()=>{
 let calls=0;const handler=await receiver(async()=>{calls++;return {data:{}}})
 assert.equal((await handler(request({...event(),payload:{photo:'⚽'.repeat(6*1024*1024)}}))).status,413);assert.equal(calls,0)
})
