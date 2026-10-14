// Real CRM ficha in SDR/Closer Chromium sessions. Only the HTTP boundary is synthetic.
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, USER_ID } from './perf/mock.mjs'
const expect = baseExpect.configure({ timeout: 20000 }), origin = process.env.TRAFFIC_TEST_ORIGIN
assert(origin && new URL(origin).hostname === '127.0.0.1')
const id = 'ce120000-0000-4000-8000-000000000099', errors = [], writes = []
const questions = [
 ['quem_está_preenchendo_este_formulário?', 'sou_o_atleta'],
 ['atualmente,_o_atleta_está_vinculado_a_algum_clube?', 'Não'],
 ['o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?', 'Sim'],
 ['o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?', 'Não'],
 ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', 'Tornar-se profissional'],
 ['o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?', 'Falta de oportunidades'],
 ['qual_é_a_posição_e_a_categoria_atual_do_atleta?', 'Ala, sub-17'],
 ['quais_são_os_principais_clubes_que_o_atleta_já_representou?', 'Clube sintético'],
 ['quais_clubes_avaliou_e_qual_foi_o_resultado?', 'Avaliação sintética sem aprovação'],
 ['quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?', 'Velocidade, passe e finalização'],
 ['de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10', '8/10'],
]
const long = 'Resposta livre integral '.repeat(100) + 'FIM <script>não executar</script>'
const contactFields=[{name:'full_name',values:['Contato sintético']},{name:'phone_number',values:['11988887777']},{name:'date_of_birth',values:['2008-01-01']},{name:'state',values:['SP']}]
const capture = { field_data: [...questions.map(([name,value]) => ({name,values:[value]})),...contactFields], created_time:'2026-10-12T12:32:15Z',
 import_contact:{time_known:true,source_has_date:true}, source_snapshot:{manual_row:{raw_cells:[
  ...questions.map(([header,value])=>({header,value})),{header:'Resposta livre adicional',value:long},{header:'Observação sem resposta',value:''}
 ]}} }
const lead = { id,name:'Contato sintético',phone:'11988887777',email:'qa@example.invalid',athlete_name:null,temperature:'frio',
 pipeline_stage:'repassado_closer',approach_stage:'abordado',lead_source:'meta_ads_form',meta_form_lead_id:'ce130000-0000-4000-8000-000000000099',
 import_channel:'form',import_method:'manual',lead_received_at:'2026-10-13T14:32:15Z',lead_generated_at:capture.created_time,
 created_at:'2026-10-13T14:33:00Z',updated_at:'2026-10-13T14:33:00Z',sdr_id:USER_ID,closer_id:USER_ID,tags:[],version:1,approached:true }
const browser = await chromium.launch({headless:true})
try {
 for(const role of ['sdr','closer']) for(const method of ['automatic','manual']) {
  const completeLead={...lead,import_method:method}
  const fixture=buildFixtures({sales:0,approaches:0,role}), context=await browser.newContext({viewport:{width:1440,height:1200},reducedMotion:'reduce'})
  await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
  await context.route('https://**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(!url.hostname.endsWith('.supabase.co'))return route.abort()
   const name=url.pathname.split('/').at(-1);let data=[]
   if(['crm_leads','crm_lead_contexts','meta_form_leads','meta_import_leads'].includes(name)&&request.method()!=='GET')writes.push(name)
   if(name==='profiles')data={user_id:USER_ID,display_name:role+' QA',suspended:false}
   else if(name==='user_roles')data=[{user_id:USER_ID,role,crm_access:true,crm_closer_access:role==='closer'}]
   else if(name==='get_my_registration_status')data={status:'approved'}
   else if(name==='dashboard_events')data=[{topic:'crm',revision:1}]
   else if(name==='crm_context_summary')data=[{lead_id:id}]
   else if(name==='crm_leads')data=url.searchParams.get('select')==='id,import_snapshot'?{id,import_snapshot:capture}:[completeLead]
   else if(name==='crm_lead_contexts')data=url.searchParams.get('select')==='lead_id'?[{lead_id:id}]:[{id:'qa-summary',lead_id:id,author_name:'Tráfego QA',author_role:'trafego',context_type:'meta_form',created_at:lead.created_at,content:'RESUMO ANTIGO ABREVIADO',file_name:null}]
   else if(fixture.rpc[name])data=fixture.rpc[name](request.postDataJSON()??{})
   else if(name.startsWith('get_'))data=0
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  await context.addInitScript(s=>localStorage.setItem('sb-mbzwchnxtskysqplqiyy-auth-token',JSON.stringify(s)),fakeSession())
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin+`/crm?tab=${role==='closer'?'closer':'importacoes'}&lead=${id}`)
  const source=page.getByRole('region',{name:'Dados completos da importação'})
  await expect(page.locator('button[aria-label="Contexto de Contato sintético"]')).toHaveClass(/bg-primary\/10/)
  await expect(page.locator('button[aria-label="Contexto de Contato sintético"]')).toHaveCSS('color','rgb(253, 135, 38)')
  await expect(page.getByRole('region',{name:'Contexto para o contato'}).getByRole('heading',{name:'Respostas do formulário',exact:true})).toBeVisible()
  await expect(source.locator('pre')).toHaveCount(0)
  await expect(page.getByText('Sem contexto importado.',{exact:false})).toHaveCount(0)
  for(const category of ['Contato e identificação','Perfil do atleta','Histórico no futebol','Objetivos e dificuldades','Comprometimento','Outras respostas'])await expect(source.getByRole('heading',{name:category,exact:true})).toBeVisible()
  assert.equal(await source.locator('section dl dt').count(),17,'all eleven questions, four contact fields and two manual extras; repeated raw columns must not duplicate answers')
  for(const [,answer]of questions.slice(1))await expect(source.getByText(answer,{exact:true}).first()).toBeVisible()
  await expect(source.getByText('Não',{exact:true})).toHaveCount(2)
  await expect(source.getByText(long,{exact:true})).toBeVisible()
  await expect(source.getByText('Não informado na origem',{exact:true})).toBeVisible()
  await expect(source.getByText('13/10/2026 11:32:15',{exact:true})).toBeVisible()
  await expect(source.getByText('As respostas de qualificação deste formulário ainda não estão disponíveis no CRM.',{exact:true})).toHaveCount(0)
  await expect(page.getByText('RESUMO ANTIGO ABREVIADO',{exact:true})).toBeHidden()
  await expect(page.locator('script').filter({hasText:'não executar'})).toHaveCount(0)
  if(process.env.CRM_CONTEXT_SCREENSHOT_DIR){await page.screenshot({path:process.env.CRM_CONTEXT_SCREENSHOT_DIR+`/crm-context-${role}-${method}.png`})}
  await context.close()
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[])
 console.log('PASS: SDR and Closer read all eleven campaign questions and four contact fields in automatic and manual forms, orange context, full extras, exact receipt seconds, honest blanks and no duplicated/truncated answers; no imports or CRM writes')
}finally{await browser.close()}
