// Two real SDR browser sessions; only the external HTTP database boundary is synthetic.
import assert from 'node:assert/strict'
import {chromium,expect as baseExpect} from '../.verification.local/node_modules/@playwright/test/index.mjs'
import {buildFixtures,fakeSession,USER_ID} from './perf/mock.mjs'
const expect=baseExpect.configure({timeout:20000}),origin=process.env.TRAFFIC_TEST_ORIGIN
assert(origin&&new URL(origin).hostname==='127.0.0.1','explicit local test origin required')
const fixture=buildFixtures('seed'),calls=[],errors=[],sid='ce130000-0000-4000-8000-000000000001',leadId='ce120000-0000-4000-8000-000000000001'
const state={revision:1,events:[{event_id:'ce140000-0000-4000-8000-000000000001',source_lead_id:'ce150000-0000-4000-8000-000000000001',source_revision:1,received_at:'2026-10-13T14:32:15Z',meta_form_lead_id:sid,status:'pending_review',error_code:null,event:{generated_at:'2026-09-10T13:04:05Z',source_updated_at:'2026-10-13T14:31:12Z',payload:{profile:{context:'INITIAL CONTEXT'},contact:{phone:'11999990000'}}}}]}
const lead={id:leadId,name:'Site fixture',phone:'11988887777',email:'qa@example.invalid',athlete_name:null,temperature:'frio',pipeline_stage:'novo',approach_stage:'nao_abordado',lead_source:'site_conversion',meta_form_lead_id:sid,lead_generated_at:'2026-09-10T13:04:05Z',lead_received_at:'2026-10-13T14:32:15Z',import_channel:'website',import_method:'automatic',created_at:'2026-10-13T14:34:15Z',updated_at:'2026-10-13T14:35:15Z',sdr_id:null,closer_id:null,approached:false,approach_count:0,tags:[],followup_attempt_count:0,version:1,import_snapshot:{source_snapshot:{approved:'APPROVED ORIGINAL'},field_data:[],created_time:'2026-09-10T13:04:05Z',import_contact:{time_known:true}}}
const browser=await chromium.launch({headless:true})
async function session(n){const context=await browser.newContext({viewport:{width:1440,height:1200},reducedMotion:'reduce'});await context.routeWebSocket(/supabase\.co/,s=>s.close());await context.route('https://**/*',async route=>{
 const request=route.request(),url=new URL(request.url());if(!url.hostname.endsWith('.supabase.co'))return route.abort()
 const name=url.pathname.split('/').at(-1),select=url.searchParams.get('select');calls.push({n,name,select});let data=[];let headers={}
 if(name==='profiles')data={user_id:USER_ID,display_name:'SDR fixture',suspended:false}
 else if(name==='user_roles')data=[{user_id:USER_ID,role:'sdr',crm_access:true}]
 else if(name==='get_my_registration_status')data={status:'approved'}
 else if(name==='dashboard_events')data=[{topic:'crm',revision:state.revision}]
 else if(name==='crm_leads')data=select==='id,import_snapshot'?{id:lead.id,import_snapshot:lead.import_snapshot}:[(({import_snapshot,...row})=>row)(lead)]
 else if(name==='site_import_events'){if(select==='*')data=state.events.find(e=>'eq.'+e.event_id===url.searchParams.get('event_id'));else if(url.searchParams.get('limit')==='1'){data=state.events.toSorted((a,b)=>b.source_revision-a.source_revision).slice(0,1).map(({event,...row})=>row)}else{data=state.events.map(({event,...row})=>row);headers={'content-range':`0-${data.length-1}/${data.length}`,'access-control-expose-headers':'content-range'}}}
 else if(fixture.rpc[name])data=fixture.rpc[name](request.postDataJSON()??{})
 else if(name.startsWith('get_'))data=0
 await route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify(data)})
 });await context.addInitScript(s=>localStorage.setItem('sb-mbzwchnxtskysqplqiyy-auth-token',JSON.stringify(s)),fakeSession());const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/crm?tab=importacoes');await page.getByRole('button',{name:'Contexto de Site fixture',exact:true}).click();return page}
try{const pages=[await session(1),await session(2)];
 for(const page of pages)await expect(page.getByRole('region',{name:'Contexto mais recente do site'}).getByText('INITIAL CONTEXT',{exact:true})).toBeVisible()
 assert.equal(calls.filter(c=>c.name==='site_import_events'&&c.select!=='*'&&c.select!=='event_id,source_revision,received_at').length,0,'history loaded before it was opened')
 for(const page of pages){await page.getByRole('button',{name:'Atualizações e contexto completo do site',exact:true}).click();await expect(page.getByRole('button',{name:/Versão 1 ·/})).toBeVisible()}
 assert.equal(calls.filter(c=>c.name==='site_import_events'&&c.select==='*').length,2)
 const raw='NEW COMPLETE CONTEXT '.repeat(250)+'<script>escaped</script>'
 state.events.unshift({...state.events[0],event_id:'ce140000-0000-4000-8000-000000000003',source_revision:3,status:'context_only',received_at:'2026-10-13T14:36:25Z',event:{source_updated_at:'2026-10-13T14:36:01Z',generated_at:'2026-09-10T13:04:05Z',payload:{profile:{context:raw},contact:{phone:'11900000000'}}}}, {...state.events[0],event_id:'ce140000-0000-4000-8000-000000000002',source_revision:2,status:'superseded',received_at:'2026-10-13T14:36:24Z'});state.revision++
 for(const page of pages){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('region',{name:'Contexto mais recente do site'}).getByText(raw,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Versão 3 · 13\/10\/2026 11:36:25/})).toBeVisible();await page.getByRole('button',{name:/Versão 3 ·/}).click();await expect(page.getByRole('button',{name:/Versão 3 ·/}).locator('..').locator('pre')).toContainText(raw);await expect(page.getByText('11988887777',{exact:false}).first()).toBeVisible()}
 assert.equal(lead.import_snapshot.source_snapshot.approved,'APPROVED ORIGINAL');assert(calls.filter(c=>c.name==='site_import_events'&&c.select==='*').length>=4);assert.deepEqual(errors,[])
 console.log('PASS: two SDR sessions without Realtime show categorized latest context automatically, exact seconds, intact SDR phone and immutable approved snapshot; history remains lazy')
}finally{await browser.close()}
