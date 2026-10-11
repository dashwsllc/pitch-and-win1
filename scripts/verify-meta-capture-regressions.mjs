import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync} from 'node:fs'
import {loadHandler} from './helpers/meta-edge-harness.mjs'
import {captureDatabase} from './helpers/meta-capture-fixtures.mjs'
const json=(body,status=200)=>new Response(JSON.stringify(body),{status})
const request=body=>new Request('https://example.invalid',{method:'POST',headers:{'x-cron-secret':'test-cron','Content-Type':'application/json'},body:JSON.stringify(body??{})})
function graph({pages=1,currency='BRL',onPage=()=>{},timezones={}}={}){
 return async address=>{
  const url=new URL(address),id=url.pathname.split('/').at(-1)
  if(/^act_\d+$/.test(id))return json({id:id.slice(4),name:'Real account',currency,timezone_name:timezones[id.slice(4)]??'America/Sao_Paulo'})
  if(id==='campaign')return json({objective:'OUTCOME_LEADS'})
  if(id==='insights'){
   const page=Number(url.searchParams.get('after')??0);onPage(page)
   const next=new URL(url);next.searchParams.set('after',String(page+1))
   return json({data:pages===0?[]:[{date_start:'2026-10-09',campaign_id:'campaign',campaign_name:'Campaign',adset_id:'set',ad_id:'ad-'+page,spend:'10',actions:[{action_type:'lead',value:'2'}]}],...(page+1<pages?{paging:{next:next.toString()}}:{})})
  }
  throw new Error('Unexpected Graph '+url.pathname)
 }
}
test('capture_budget_exhaustion_persists_cursor_without_preparing_review',async()=>{
 let now=Date.now()
 class Clock extends Date {static now(){return now}}
 const admin=captureDatabase()
 const {handler}=await loadHandler('meta-insights-sync/index.ts',{admin,clock:Clock,fetch:graph({pages:21,onPage(){now+=40001}})})
 const response=await handler(request())
 assert.equal(response.status,202);assert.equal((await response.json()).partial,true)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_append').length,1)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_prepare').length,0)
 assert(!JSON.stringify([...admin.runs.values()]).includes('test-token'))
})
test('21 pages resume under one lease at a time and objectives are cached',async()=>{
 assert(existsSync('supabase/functions/_shared/meta-insights-capture.ts'),'resumable capture implementation missing')
 let now=Date.now(),limited=true,objectiveCalls=0
 class Clock extends Date {static now(){return now}}
 const admin=captureDatabase(),fetchGraph=graph({pages:21,onPage(){if(limited)now+=40001}})
 const {exports:c}=await loadHandler('_shared/meta-insights-capture.ts',{admin,clock:Clock,fetch:address=>{if(new URL(address).pathname.endsWith('/campaign'))objectiveCalls++;return fetchGraph(address)}})
 const input={accountId:'act_123',level:'ad',since:'2026-10-08',until:'2026-10-10',actor:null,triggeredBy:'cron',deadlineMs:now+45000}
 const first=await c.captureAccountLevel(admin,input,'test-token')
 assert.equal(first.state,'partial');assert.equal(admin.runs.size,1)
 limited=false
 const second=await c.captureAccountLevel(admin,{...input,deadlineMs:now+45000},'test-token')
 assert.equal(second.state,'complete');assert.equal(second.rowsCaptured,21)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_append').length,21)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_prepare').length,1)
 assert.equal(objectiveCalls,1)
 assert(admin.imported.every(r=>r.account_id==='123'))
})
test('empty complete capture is reviewed; non-BRL metadata blocks staging',async()=>{
 const admin=captureDatabase()
 const {handler}=await loadHandler('meta-insights-sync/index.ts',{admin,fetch:graph({pages:0})})
 assert.equal((await handler(request())).status,200)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_prepare').length,3)
 const usd=captureDatabase()
 const {handler:bad}=await loadHandler('meta-insights-sync/index.ts',{admin:usd,fetch:graph({currency:'USD'})})
 assert.equal((await bad(request())).status,502)
 assert.equal(usd.calls.filter(c=>c.name==='meta_capture_open').length,0)
})
test('finalization failure cannot return a completed capture',async()=>{
 const admin=captureDatabase({failPrepare:true})
 const {handler}=await loadHandler('meta-insights-sync/index.ts',{admin,fetch:graph()})
 const response=await handler(request())
 assert.equal(response.status,502);assert.equal((await response.json()).ok,false)
 assert([...admin.runs.values()].every(r=>r.status!=='success'))
})
test('account calendars cross midnight independently and resumeOnly creates no work',async()=>{
 const now=Date.parse('2026-10-11T01:00:00Z')
 class Clock extends Date {static now(){return now};constructor(...args){super(args.length?args[0]:now)}}
 const admin=captureDatabase({accounts:[{account_id:'123'},{account_id:'456'}]})
 const {handler}=await loadHandler('meta-insights-sync/index.ts',{admin,clock:Clock,fetch:graph({pages:0,timezones:{'123':'America/Sao_Paulo','456':'Asia/Tokyo'}})})
 assert.equal((await handler(request({days:2}))).status,200)
 const openings=admin.calls.filter(c=>c.name==='meta_capture_open')
 assert(openings.some(c=>c.args.p_account_id==='123'&&c.args.p_start==='2026-10-09'&&c.args.p_end==='2026-10-10'))
 assert(openings.some(c=>c.args.p_account_id==='456'&&c.args.p_start==='2026-10-10'&&c.args.p_end==='2026-10-11'))
 const before=admin.calls.length
 assert.equal((await handler(request({resumeOnly:true}))).status,200)
 assert.equal(admin.calls.slice(before).filter(c=>c.name==='meta_capture_open').length,0)
})
test('an expired cursor aborts the attempt without preparing a review',async()=>{
 const admin=captureDatabase(),base=graph()
 const {handler}=await loadHandler('meta-insights-sync/index.ts',{admin,fetch:address=>new URL(address).pathname.endsWith('/insights')?json({error:{code:100,message:'Invalid cursor'}},400):base(address)})
 const response=await handler(request())
 assert.equal(response.status,502)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_abort').length,3)
 assert.equal(admin.calls.filter(c=>c.name==='meta_capture_prepare').length,0)
 assert([...admin.runs.values()].every(run=>run.status==='error'))
})
