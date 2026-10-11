import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../../../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures } from './perf/mock.mjs'
const expect=baseExpect.configure({timeout:20000}), origin=process.env.TRAFFIC_TEST_ORIGIN||'http://127.0.0.1:5199'
const actor='ce110000-0000-4000-8000-000000000001',project='mbzwchnxtskysqplqiyy',now=new Date().toISOString()
const fixtures=buildFixtures({role:'super_admin',now:new Date()}).rpc,calls=[],errors=[]
const summary={format:'capture-v1',kind:'metrics',id:'ce110000-0000-4000-8000-000000000002',filename:'API revisão A',version:5,updated_at:now,created_at:now,status:'pendente',row_count:2001,upsert_count:2000,remove_count:1,conflict_count:0,source:'api',window_start:'2026-10-07',window_end:'2026-10-09',replaced_by_review_id:null}
const second={...summary,id:'ce110000-0000-4000-8000-000000000003',filename:'API revisão B',version:3,row_count:1,upsert_count:1,remove_count:0,conflict_count:1}
const payload={date:'2026-10-09',account_id:'93001',level:'campaign',campaign_id:'A',campaign_name:'Campanha sintética',spend:10,leads:2,purchases:0,purchase_value:0,impressions:0,reach:0,link_clicks:0,messaging_conversations_started:0}
let reviews=[summary,second],stale=true
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'})
await context.routeWebSocket(/supabase\.co/,s=>s.close())
await context.route('https://**/*',async route=>{
 const url=new URL(route.request().url());if(!url.hostname.endsWith('.supabase.co'))return route.abort()
 const name=url.pathname.split('/').at(-1),args=route.request().postDataJSON()??{};calls.push({name,args,query:url.search})
 let data=[]
 if(name==='get_my_registration_status')data={status:'approved'}
 else if(name==='profiles')data={id:actor,user_id:actor,display_name:'QA Tráfego',suspended:false}
 else if(name==='user_roles')data=[{id:actor,user_id:actor,role:'super_admin'}]
 else if(name==='meta_traffic_review_list')data={rows:reviews.slice(args.p_offset,args.p_offset+args.p_limit),count:reviews.length}
 else if(name==='meta_traffic_operation')data={runs:[],published:[],pending:{}}
 else if(name==='meta_traffic_cohort')data={state:'insufficient',campaigns:[],reasons:[],unattributed_contacts:0}
 else if(name==='meta_capture_review_part'){
  const s=reviews.find(s=>s.id===args.p_id)
  if(!s||s.version!==args.p_version)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'changed'})})
  data={id:s.id,version:s.version,total:s.row_count,next_offset:args.p_offset+500<s.row_count?args.p_offset+500:null,rows:[{row_no:args.p_offset,operation:s.id===summary.id?'remove':'upsert',payload,before_snapshot:{...payload,id:actor},edit_reason:null,conflict_details:s.conflict_count?{reason:'published_changed',incoming:{...payload,spend:20}}:null}]}
 } else if(name==='meta_capture_review_decide'){
  if(stale){stale=false;summary.version=6;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'changed'})})}
  reviews=reviews.filter(s=>s.id!==args.p_id);data={status:'aprovado'}
 } else if(name==='meta_capture_review_resolve'){second.version++;second.conflict_count=0;data={id:second.id,version:second.version}}
 else if(fixtures[name])data=fixtures[name](args)
 else if(name.startsWith('get_'))data=0
 await route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-0/0'},body:JSON.stringify(data)})
})
await context.addInitScript(({actor,project})=>{const enc=v=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:actor,role:'authenticated',exp:4102444800})}.test`,refresh_token:'test',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id:actor,email:'qa@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}))},{actor,project})
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto(origin+'/trafego');await expect(page.getByRole('heading',{name:'Tráfego',exact:true})).toBeVisible()
 await page.getByRole('tab',{name:/Aprovações/}).click()
 let a=page.getByRole('article').filter({hasText:'API revisão A'})
 await expect(a.getByRole('button',{name:'Aprovar revisão inteira'})).toBeDisabled()
 assert.equal(calls.filter(c=>c.name==='meta_capture_review_part').length,0)
 assert.equal(calls.filter(c=>['meta_import_batches','meta_lead_import_batches'].includes(c.name)).length,0)
 await a.getByRole('button',{name:'Conferir detalhes'}).click();await expect(a.getByText('Remoção proposta',{exact:false})).toBeVisible()
 assert.deepEqual(calls.filter(c=>c.name==='meta_capture_review_part').at(-1).args,{p_id:summary.id,p_version:5,p_offset:0,p_limit:500})
 await a.getByRole('button',{name:'Próxima',exact:true}).click();await expect(a.getByText('Linha 501',{exact:false})).toBeVisible()
 assert.equal(calls.filter(c=>c.name==='meta_capture_review_part').at(-1).args.p_offset,500)
 await a.getByRole('checkbox').check();await a.getByRole('button',{name:'Aprovar revisão inteira'}).click()
 await expect(page.getByText('A revisão mudou ou já foi decidida.',{exact:false})).toBeVisible()
 await expect(a.getByRole('checkbox')).not.toBeChecked();await expect(a.getByRole('button',{name:'Aprovar revisão inteira'})).toBeDisabled()
 assert.equal(calls.find(c=>c.name==='meta_capture_review_decide').args.p_version,5)
 await a.getByRole('button',{name:'Conferir detalhes'}).click();await expect(a.getByRole('checkbox')).toBeEnabled();await a.getByRole('checkbox').check();await a.getByRole('button',{name:'Aprovar revisão inteira'}).click();await expect(a).toHaveCount(0)
 const b=page.getByRole('article').filter({hasText:'API revisão B'});await b.getByRole('button',{name:'Conferir detalhes'}).click()
 await expect(b.getByRole('checkbox')).toBeDisabled();await expect(b.getByLabel('Resolução da linha 1',{exact:true}).locator('option')).toHaveCount(4)
 await b.getByLabel('Resolução da linha 1',{exact:true}).selectOption('use_incoming');await b.getByLabel('Motivo da resolução da linha 1').fill('Conferido com exportação original');await b.getByRole('button',{name:'Confirmar resolução'}).click()
 await expect(b.getByText('0 conflitos',{exact:false})).toBeVisible();assert.equal(calls.find(c=>c.name==='meta_capture_review_resolve').args.p_version,3)
 await page.getByRole('tab',{name:'Desempenho',exact:true}).click()
 const before=calls.filter(c=>c.name==='meta_traffic_review_list').length
 await page.clock.install();await page.clock.fastForward(31000)
 assert.equal(calls.filter(c=>c.name==='meta_traffic_review_list').length,before,'inactive approvals kept polling')
 assert.deepEqual(errors,[])
 console.log('PASS: real browser lazy details/500-row parts, removal acknowledgement, stale version, whole-review approval, four conflict choices and inactive polling')
}finally{await browser.close()}
