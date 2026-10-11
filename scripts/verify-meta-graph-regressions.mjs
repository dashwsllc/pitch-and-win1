import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { loadHandler } from './helpers/meta-edge-harness.mjs'
const json=(body,status=200)=>new Response(JSON.stringify(body),{status})
const load=fetch=>loadHandler('_shared/meta-graph.ts',{fetch,admin:{}})
test('overlapping action aliases count one result and preserve explicit zero',async()=>{
 const {exports:g}=await load()
 const aliases=g.LEAD_ACTION_TYPES
 assert.equal(g.sumActions(aliases.map(action_type=>({action_type,value:'10'})),aliases),10)
 assert.equal(typeof g.selectCanonicalAction,'function')
 assert.deepEqual(JSON.parse(JSON.stringify(g.selectCanonicalAction([{action_type:'lead',value:'0'},{action_type:aliases[1],value:'10'}],aliases))),{actionType:'lead',value:0})
 assert.throws(()=>g.selectCanonicalAction([{action_type:'lead',value:'NaN'}],aliases))
})
test('host and path of pagination are verified before sending credentials',async()=>{
 let calls=0
 const {exports:g}=await load(()=>{calls++;return json({data:[],paging:{next:'https://evil.invalid/steal?access_token=test-token'}})})
 await assert.rejects(()=>g.fetchAllPages('/act_123/insights',{},'test-token'),/paginação/i)
 assert.equal(calls,1)
})
test('page limits fail explicitly and persisted cursor excludes all secrets',async()=>{
 const {exports:g}=await load(()=>json({data:[{id:'1'}],paging:{next:'https://graph.facebook.com/v23.0/act_123/insights?after=abc&access_token=secret&appsecret_proof=proof'}}))
 await assert.rejects(()=>g.fetchAllPages('/act_123/insights',{},'secret',1),/incompleta/i)
 const page=await g.fetchGraphPage({path:'/act_123/insights',params:{fields:'spend'}},'secret',{deadlineMs:Date.now()+1000})
 assert.equal(page.next.params.after,'abc')
 assert(!JSON.stringify(page.next).includes('secret'))
 assert(!JSON.stringify(page.next).includes('proof'))
})
test('invalid cursors and malformed data never complete a capture',async()=>{
 const {exports:g}=await load(()=>json({error:{code:100,message:'invalid cursor'}},400))
 await assert.rejects(()=>g.fetchAllPages('/act_123/insights',{},'secret'),/cursor/)
 const {exports:bad}=await load(()=>json({data:null}))
 await assert.rejects(()=>bad.fetchAllPages('/act_123/insights',{},'secret'),/dados/i)
})
test('rate limits do not retry beyond the deadline or leak tokens in errors',async()=>{
 let calls=0
 const {exports:g}=await load(()=>{calls++;return json({error:{code:4,message:'token secret failed'}},429)})
 await assert.rejects(()=>g.fetchGraphPage({path:'/act_123/insights',params:{}},'secret',{deadlineMs:Date.now()+20}),e=>!e.message.includes('secret'))
 assert.equal(calls,1)
})
test('purchase revenue matches chosen action; unavailable fields remain distinguishable',async()=>{
 assert(existsSync('supabase/functions/_shared/meta-insights.ts'),'captured insight contract is missing')
 const {exports:i}=await loadHandler('_shared/meta-insights.ts',{admin:{}})
 const row=i.buildInsightRow({date_start:'2026-10-09',campaign_id:'A',campaign_name:'A',spend:'5',actions:[{action_type:'purchase',value:'2'}],action_values:[{action_type:'omni_purchase',value:'900'}]},
 {account:{id:'act_123',name:'Real account',currency:'BRL',timezone:'America/Sao_Paulo'},level:'campaign',objective:'',params:{fields:'spend,actions,action_values'},graphVersion:'v23.0'})
 assert.equal(row.account_id,'123');assert.equal(row.purchase_value,0)
 assert(!row.available_metrics.includes('purchase_value'))
 assert(!row.available_metrics.includes('impressions'))
 assert.equal(row.account_name,'Real account')
 assert.equal(row.metric_metadata.purchase_action,'purchase')
})
