// Browser component/flow tests with an in-memory API. No requests reach production.
// Database authorization and persistence are verified separately by the SQL suite.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { brasiliaDateKey, brasiliaDayBounds } from '../src/lib/brasilia-time.ts'

const origin = 'http://127.0.0.1:5198'
const expect = baseExpect.configure({timeout:20000})
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce110000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const today = brasiliaDateKey()
const contexts = [], tasks = [], errors = []
let role = 'sdr', goalReads = 0
const profile = { id: actor, user_id: actor, display_name: 'QA Colaborador', suspended: false, created_at: now }
const roles = () => [{ id: actor, user_id: actor, role, crm_access: false, commission_rate: 10, updated_at: now }]
const leads = [
  { id: randomUUID(), name: 'Futuro', temperature: 'quente', approach_stage: 'abordado', next_followup_at: new Date(Date.now()+86400000).toISOString() },
  { id: randomUUID(), name: 'Atrasado', temperature: 'morno', approach_stage: 'em_abordagem', next_followup_at: new Date(Date.now()-86400000).toISOString() },
  { id: randomUUID(), name: 'Sem agenda', temperature: 'frio', approach_stage: 'nao_abordado', next_followup_at: null },
].map(l => ({ ...l, athlete_name:'Atleta', phone:'11999999999', email:null, pipeline_stage:'em_qualificacao', version:1, sdr_id:actor, created_by:actor, created_at:now, updated_at:now }))
tasks.push({ id:randomUUID(), assignee_id:actor, task_date:today, title:'Revisar contexto', is_completed:false, version:1, position:0, created_at:now })
const browser = await chromium.launch({ headless:true })
const context = await browser.newContext({ viewport:{width:1440,height:1080}, reducedMotion:'reduce', timezoneId:'Asia/Tokyo' })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const payload = route.request().postDataJSON() ?? {}
  let data = []
  if (resource === 'user_roles') data = roles()
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'crm_leads') data = leads
  else if (resource === 'crm_lead_contexts') data = contexts.filter(c => !url.searchParams.has('lead_id') || c.lead_id === url.searchParams.get('lead_id').slice(3))
  else if (resource === 'crm_call_assignees') data = [{user_id:actor,display_name:'QA Colaborador',role:'closer'}]
  else if (resource === 'daily_goal_tasks') {
    goalReads++
    data = tasks.filter(t => t.task_date === url.searchParams.get('task_date')?.slice(3))
  } else if (resource === 'crm_add_lead_context') {
    data = {id:randomUUID(),lead_id:payload.p_lead_id,context_type:payload.p_context_type,content:payload.p_content,author_id:actor,author_name:'QA Colaborador',author_role:role,created_at:now,updated_at:now,version:1}
    contexts.push(data)
  } else if (resource === 'crm_update_lead_context') {
    data = contexts.find(c=>c.id===payload.p_context_id)
    Object.assign(data,{content:payload.p_content,context_type:payload.p_context_type,updated_by:actor,updated_by_name:'QA Colaborador',updated_at:now,version:data.version+1})
  } else if (resource === 'set_daily_goal_task_completed') {
    data = tasks.find(t=>t.id===payload.p_task_id)
    Object.assign(data,{is_completed:payload.p_completed,version:data.version+1})
  } else if (resource === 'executive_create_daily_goal_task') {
    data = {id:randomUUID(),assignee_id:payload.p_assignee_id,task_date:payload.p_task_date,title:payload.p_title,is_completed:false,version:1,position:tasks.length,created_at:now}
    tasks.push(data)
  } else if (resource === 'executive_list_users') data = {users:[{...profile,email:'qa@example.invalid',user_roles:roles()}]}
  else if (resource === 'get_sales_board') data = {items:[],total:0,summary:{pending:0,approved:0,rejected:0,pending_value:0,approved_value:0,overdue:0},fetched_at:now}
  else if (resource.startsWith('get_')) data = resource==='get_team_ranking' ? [] : 0
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
})
await context.addInitScript(({actor,project}) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const session = {access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:actor,role:'authenticated',exp:4102444800})}.test`,refresh_token:'test',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id:actor,email:'qa@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{display_name:'QA Colaborador'},created_at:new Date().toISOString()}}
  sessionStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session))
}, {actor,project})
const page = await context.newPage()
await page.clock.install()
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`${origin}/crm`)
  await expect(page.getByRole('article')).toHaveCount(3)
  assert.deepEqual(await page.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Lead Atrasado','Lead Futuro','Lead Sem agenda'])
  await page.getByRole('button',{name:'Filtrar por Temperatura',exact:true}).click()
  await page.getByLabel('Mornos',{exact:true}).check()
  await page.getByLabel('Quentes',{exact:true}).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('article')).toHaveCount(2)
  await page.getByRole('button',{name:'Filtrar por Abordagem',exact:true}).click()
  await page.getByLabel('Abordado',{exact:true}).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.reload()
  const card = page.getByRole('article',{name:'Lead Atrasado',exact:true})
  await card.getByRole('button',{name:/contexto/i}).click()
  await page.getByRole('button',{name:'Importar conversa/transcrição',exact:true}).click()
  let dialog = page.getByRole('dialog',{name:'Importar contexto do lead',exact:true})
  await dialog.getByLabel('Tipo do conteúdo *',{exact:true}).selectOption('call_transcript')
  await dialog.getByLabel('Anexar texto transcrito (opcional)',{exact:true}).setInputFiles({name:'long.txt',mimeType:'text/plain',buffer:Buffer.from('x'.repeat(50001))})
  await expect(dialog.getByRole('alert')).toContainText('excede')
  const imported = 'Preocupação com prazo\n<script>alert("unsafe")</script>'
  await dialog.getByLabel('Anexar texto transcrito (opcional)',{exact:true}).setInputFiles({name:'call.txt',mimeType:'text/plain',buffer:Buffer.from(imported)})
  await dialog.getByRole('button',{name:'Importar e salvar',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(imported,{exact:true})).toBeVisible()
  assert.equal(contexts[0].author_role,'sdr')
  await page.screenshot({path:'.verification.local/context-desktop.png'})
  await page.reload()
  await page.getByRole('article',{name:'Lead Atrasado',exact:true}).getByRole('button',{name:/contexto/i}).click()
  await expect(page.getByText(imported,{exact:true})).toBeVisible()
  role='closer'
  await page.reload()
  await page.getByRole('article',{name:'Lead Atrasado',exact:true}).getByRole('button',{name:/contexto/i}).click()
  await page.getByRole('button',{name:'Importar conversa/transcrição',exact:true}).click()
  dialog = page.getByRole('dialog',{name:'Importar contexto do lead',exact:true})
  await dialog.getByLabel('Tipo do conteúdo *',{exact:true}).selectOption('whatsapp_summary')
  await dialog.getByLabel('Conteúdo *',{exact:true}).fill('Resumo pelo Closer')
  await dialog.getByRole('button',{name:'Importar e salvar',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Resumo pelo Closer',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'.verification.local/context-mobile.png'})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.goto(origin)
  await expect(page.getByRole('checkbox',{name:'Concluir Revisar contexto',exact:true})).toBeVisible()
  await page.getByRole('checkbox',{name:'Concluir Revisar contexto',exact:true}).click()
  await expect(page.getByText('Todas as metas do dia foram concluídas.',{exact:true})).toBeVisible()
  await page.screenshot({path:'.verification.local/goals-mobile.png',fullPage:true})
  const before = goalReads
  await page.clock.runFor(50100)
  await expect.poll(()=>goalReads).toBeGreaterThan(before)
  await page.clock.setSystemTime(new Date(brasiliaDayBounds(today).end.getTime()-60000))
  await page.reload()
  await expect(page.getByText('Todas as metas do dia foram concluídas.',{exact:true})).toBeVisible()
  await page.clock.fastForward(61000)
  await expect(page.getByText('Nenhuma tarefa definida para hoje',{exact:true})).toBeVisible()
  assert.equal(tasks[0].is_completed,true)
  await page.clock.setSystemTime(new Date())
  role='executive'
  await page.setViewportSize({width:1440,height:1080})
  await page.goto(`${origin}/executive?tab=goals`)
  await page.getByRole('textbox',{name:'Nova tarefa diária',exact:true}).fill('Planejar amanhã')
  await page.getByRole('button',{name:'Adicionar tarefa',exact:true}).click()
  await expect(page.getByText('Planejar amanhã',{exact:true})).toBeVisible()
  await page.getByLabel('Data da tarefa · horário de Brasília',{exact:true}).fill('')
  await expect(page.getByRole('heading',{name:'Metas diárias por colaborador'})).toBeVisible()
  await page.getByLabel('Data da tarefa · horário de Brasília',{exact:true}).fill(today)
  await page.screenshot({path:'.verification.local/goals-executive.png'})
  assert.deepEqual(errors,[])
  console.log('PASS: default order, combined multiselect, import file/size/XSS text, SDR/Closer, reload, checklist, 50-second polling, executive creation and mobile layout (mock API).')
} catch(error) {
  await page.screenshot({path:'.verification.local/context-daily-failure.png',fullPage:true})
  console.error(errors)
  console.error((await page.locator('body').innerText()).slice(0,4000))
  throw error
} finally { await browser.close() }
