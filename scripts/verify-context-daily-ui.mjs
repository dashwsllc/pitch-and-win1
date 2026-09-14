// Browser component/flow tests with an in-memory API. No requests reach production.
// Database authorization and persistence are verified separately by the SQL suite.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { addDaysToDateKey, brasiliaDateKey, brasiliaDayBounds, brasiliaLocalToDate } from '../src/lib/brasilia-time.ts'

const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
const expect = baseExpect.configure({timeout:20000})
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce110000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const today = brasiliaDateKey()
const tomorrow = addDaysToDateKey(today, 1)
const contexts = [], tasks = [], errors = []
let role = 'sdr', goalReads = 0
const profile = { id: actor, user_id: actor, display_name: 'QA Colaborador', suspended: false, created_at: now }
const roles = () => [{ id: actor, user_id: actor, role, crm_access: false, commission_rate: 10, updated_at: now }]
const leads = [
  { id: randomUUID(), name: 'Futuro', temperature: 'quente', approach_stage: 'abordado', next_followup_at: new Date(Date.now()+86400000).toISOString(), pipeline_stage:'em_qualificacao', created_at:new Date(Date.now()-3*86400000).toISOString() },
  { id: randomUUID(), name: 'Atrasado', temperature: 'morno', approach_stage: 'em_abordagem', next_followup_at: new Date(Date.now()-86400000).toISOString(), pipeline_stage:'repassado_closer', created_at:new Date(Date.now()-2*86400000).toISOString() },
  { id: randomUUID(), name: 'Sem agenda', temperature: 'frio', approach_stage: 'nao_abordado', next_followup_at: null, pipeline_stage:'repassado_closer', created_at:new Date(Date.now()-86400000).toISOString() },
].map(l => ({ ...l, athlete_name:l.name, phone:'11999999999', email:null, version:1, sdr_id:actor, closer_id:actor, created_by:actor, updated_at:now }))
const leadByName = Object.fromEntries(leads.map(lead => [lead.name, lead]))
const calls = [
  { id:randomUUID(), lead_id:leadByName['Atrasado'].id, scheduled_at:brasiliaLocalToDate(tomorrow,'15:00:00').toISOString() },
  { id:randomUUID(), lead_id:leadByName['Sem agenda'].id, scheduled_at:brasiliaLocalToDate(tomorrow,'09:00:00').toISOString() },
].map(call => ({...call,user_id:actor,assigned_to:actor,activity_type:'reuniao',call_type:'fechamento_closer',title:'Call QA',description:null,is_completed:false,outcome:null,completed_at:null,created_at:now,updated_at:now}))
tasks.push({ id:randomUUID(), assignee_id:actor, task_date:today, title:'Revisar contexto', is_completed:false, version:1, position:0, created_at:now })
const browser = await chromium.launch({ headless:true })
const context = await browser.newContext({ viewport:{width:1440,height:1080}, reducedMotion:'reduce', timezoneId:'Asia/Tokyo' })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const payload = route.request().postDataJSON() ?? {}
  let data = []
  if (resource === 'get_my_registration_status') data = {status:'approved'}
  else if (resource === 'executive_list_registration_requests') data = []
  else if (resource === 'user_roles') data = roles()
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'crm_leads') data = leads
  else if (resource === 'crm_activities') data = calls.filter(call => !url.searchParams.has('lead_id') || call.lead_id === url.searchParams.get('lead_id').slice(3))
  else if (resource === 'crm_lead_contexts') data = contexts.filter(c => !url.searchParams.has('lead_id') || c.lead_id === url.searchParams.get('lead_id').slice(3))
  else if (resource === 'crm_call_assignees') data = [{user_id:actor,display_name:'QA Colaborador',role:'closer'}]
  else if (resource === 'daily_goal_tasks') {
    goalReads++
    data = tasks.filter(t => t.task_date === url.searchParams.get('task_date')?.slice(3))
  } else if (resource === 'crm_add_lead_context_with_media' || resource === 'crm_import_txt_context_with_media') {
    data = {id:randomUUID(),lead_id:payload.p_lead_id,context_type:payload.p_context_type,content:payload.p_content,media_url:payload.p_media_url,author_id:actor,author_name:'QA Colaborador',author_role:role,created_at:now,updated_at:now,version:1}
    if (resource === 'crm_import_txt_context_with_media') Object.assign(data, {file_name:payload.p_source_name.replace(/\.txt$/i,'.md'),file_content:payload.p_source_content,file_mime_type:'text/markdown'})
    contexts.push(data)
  } else if (resource === 'crm_update_lead_context_with_media') {
    data = contexts.find(c=>c.id===payload.p_context_id)
    Object.assign(data,{content:payload.p_content,context_type:payload.p_context_type,media_url:payload.p_media_url,updated_by:actor,updated_by_name:'QA Colaborador',updated_at:now,version:data.version+1})
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
  await expect(page.getByLabel('Ordenar leads')).toHaveValue('newest')
  assert.deepEqual(await page.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Lead Sem agenda','Lead Atrasado','Lead Futuro'])
  await page.getByRole('tab',{name:'SDR',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(3)
  assert.deepEqual(await page.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Lead Sem agenda','Lead Atrasado','Lead Futuro'])
  await page.getByRole('tab',{name:'Leads',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  const tomorrowButton = page.locator('[data-call-date-option="tomorrow"]')
  await expect(tomorrowButton).toContainText('Amanhã')
  const tomorrowBox = await tomorrowButton.boundingBox()
  const tomorrowLabelBox = await tomorrowButton.locator('span').first().boundingBox()
  assert(tomorrowBox && tomorrowBox.x >= 0 && tomorrowBox.x + tomorrowBox.width <= 390, 'Amanhã must remain fully inside the small viewport')
  assert(tomorrowLabelBox && tomorrowLabelBox.x >= tomorrowBox.x && tomorrowLabelBox.x + tomorrowLabelBox.width <= tomorrowBox.x + tomorrowBox.width, 'Amanhã label must not be clipped')
  await page.screenshot({path:'.verification.local/crm-call-filters-mobile.png',fullPage:true})
  await tomorrowButton.click()
  await expect(page.getByLabel('Ordenar leads')).toHaveValue('calls')
  await expect(page.getByLabel('Ordenar leads')).toBeDisabled()
  assert.deepEqual(await page.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Lead Sem agenda','Lead Atrasado'])
  await page.locator('[data-call-date-option="specific"]').click()
  await page.getByLabel('Escolher data das calls').fill(tomorrow)
  assert.deepEqual(await page.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Lead Sem agenda','Lead Atrasado'])
  await page.locator('[data-call-date-option="all"]').click()
  await expect(page.getByLabel('Ordenar leads')).toHaveValue('newest')
  await page.setViewportSize({width:1440,height:1080})
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
  await expect(card.getByRole('button',{name:/contexto/i})).toHaveCount(1)
  await expect(card.locator('[title="Abrir ficha e histórico"], [title="Sem contexto registrado"]')).toHaveCount(0)
  await expect(card.getByRole('button',{name:'Contexto de Atrasado',exact:true})).toHaveAttribute('title','Contexto')
  await card.getByRole('button',{name:/contexto/i}).click()
  await page.getByRole('button',{name:'Importar conversa/transcrição',exact:true}).click()
  let dialog = page.getByRole('dialog',{name:'Importar contexto do lead',exact:true})
  await dialog.getByLabel('Tipo do conteúdo *',{exact:true}).selectOption('call_transcript')
  const uploader = dialog.getByLabel('Anexar texto transcrito (opcional)',{exact:true})
  await expect(uploader).toHaveAttribute('accept','.txt')
  const mediaLink = dialog.getByLabel('Link do Google Drive (opcional)',{exact:true})
  await expect(mediaLink).toBeVisible()
  await expect(dialog.getByText('Para vídeo, áudio ou outra mídia pesada',{exact:false})).toBeVisible()
  await mediaLink.fill('https://evil.example/video')
  await dialog.getByLabel('Conteúdo *',{exact:true}).fill('Explicação da mídia')
  await dialog.getByRole('button',{name:'Importar e salvar',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('link compartilhável válido do Google Drive')
  await mediaLink.fill('')
  await dialog.getByLabel('Conteúdo *',{exact:true}).fill('')
  for (const [name,mimeType] of [['photo.jpg','image/jpeg'],['video.mp4','video/mp4'],['notes.md','text/markdown'],['notes.csv','text/csv']]) {
    await uploader.setInputFiles({name,mimeType,buffer:Buffer.from('not accepted')})
    await expect(dialog.getByRole('alert')).toContainText('Apenas arquivos .txt')
    await expect(dialog.getByLabel('Conteúdo *',{exact:true})).toHaveValue('')
  }
  const droppedVideo = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['video'],'video.mp4',{type:'video/mp4'}))
    return transfer
  })
  await dialog.dispatchEvent('drop',{dataTransfer:droppedVideo})
  await expect(dialog.getByRole('alert')).toContainText('Vídeos e fotos')
  await droppedVideo.dispose()
  await dialog.getByLabel('Anexar texto transcrito (opcional)',{exact:true}).setInputFiles({name:'long.txt',mimeType:'text/plain',buffer:Buffer.from('x'.repeat(50001))})
  await expect(dialog.getByRole('alert')).toContainText('excede')
  // Browser file pickers may normalize native line endings; this still verifies
  // byte-for-byte preservation of the bytes exposed by the selected File.
  const imported = '\uFEFF  Preocupação com prazo 😀\n<script>alert("unsafe")</script>\nhttps://drive.google.com/file/d/example/view  \n'
  await dialog.getByLabel('Anexar texto transcrito (opcional)',{exact:true}).setInputFiles({name:'call.txt',mimeType:'text/plain',buffer:Buffer.from(imported)})
  await mediaLink.fill(' https://drive.google.com/file/d/media-example/view?usp=sharing ')
  await dialog.getByRole('button',{name:'Importar e salvar',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Preocupação com prazo',{exact:false})).toBeVisible()
  assert.equal(contexts[0].author_role,'sdr')
  assert.equal(contexts[0].content,imported)
  assert.equal(contexts[0].file_content,imported)
  assert.equal(contexts[0].file_name,'call.md')
  assert.equal(contexts[0].file_mime_type,'text/markdown')
  assert.equal(contexts[0].media_url,'https://drive.google.com/file/d/media-example/view?usp=sharing')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button',{name:'Baixar call.md',exact:true}).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(),'call.md')
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(imported))
  await page.screenshot({path:'.verification.local/context-desktop.png'})
  await page.reload()
  await page.getByRole('article',{name:'Lead Atrasado',exact:true}).getByRole('button',{name:/contexto/i}).click()
  await expect(page.getByText('Preocupação com prazo',{exact:false})).toBeVisible()
  await expect(page.getByRole('button',{name:'Baixar call.md',exact:true})).toBeVisible()
  const savedMediaLink = page.getByRole('link',{name:'Abrir mídia no Google Drive em uma nova aba',exact:true})
  await expect(savedMediaLink).toHaveAttribute('href','https://drive.google.com/file/d/media-example/view?usp=sharing')
  await expect(savedMediaLink).toHaveAttribute('target','_blank')
  await page.getByRole('button',{name:'Editar Transcrição de ligação',exact:true}).click()
  let editDialog = page.getByRole('dialog',{name:'Editar contexto',exact:true})
  await expect(editDialog.getByLabel('Link do Google Drive (opcional)',{exact:true})).toHaveValue('https://drive.google.com/file/d/media-example/view?usp=sharing')
  await editDialog.getByLabel('Link do Google Drive (opcional)',{exact:true}).fill('https://drive.google.com/drive/folders/folder-example')
  await editDialog.getByLabel('Conteúdo *',{exact:true}).fill('Contexto editado com link https://drive.google.com/file/d/example/view')
  await editDialog.getByRole('button',{name:'Salvar alteração',exact:true}).click()
  await expect(editDialog).toHaveCount(0)
  assert.equal(contexts[0].file_content,imported,'Editing must preserve the archived original')
  assert.equal(contexts[0].media_url,'https://drive.google.com/drive/folders/folder-example')
  role='closer'
  await page.reload()
  await page.getByRole('tab',{name:'Closer',exact:true}).click()
  await expect(page.getByRole('article')).toHaveCount(2)
  assert.deepEqual(await page.getByRole('article').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Lead Sem agenda','Lead Atrasado'])
  await page.getByRole('tab',{name:'Leads',exact:true}).click()
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
  if (process.argv.includes('--context-only')) {
    assert.deepEqual(errors,[])
    console.log('PASS: Contexto supports validated Drive media links, TXT-only selection/drop rejection, faithful Markdown import/download, reload, editing, SDR/Closer and mobile')
    await browser.close()
    process.exit(0)
  }
  await page.goto(origin)
  const dashboardSections = page.locator('[data-dashboard-section]')
  await expect(dashboardSections).toHaveCount(7)
  assert.deepEqual(await dashboardSections.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-dashboard-section'))), [
    'greeting',
    'commercial-indicators',
    'goals-in-progress',
    'recent-sales',
    'transparent-operation',
    'commercial-evolution',
    'featured-products',
  ])
  const sectionTops = await dashboardSections.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top + scrollY))
  assert(sectionTops.every((top, index) => index === 0 || top > sectionTops[index - 1]), 'Dashboard sections must render in strict top-to-bottom order')
  await page.evaluate(() => {
    window.__dashboardRefreshEvents = 0
    window.addEventListener('dashboard-data-changed', () => { window.__dashboardRefreshEvents++ })
  })
  await page.clock.runFor(49_900)
  assert.equal(await page.evaluate(() => window.__dashboardRefreshEvents), 0, 'Dashboard refreshed before 50 seconds')
  await page.clock.runFor(200)
  await expect.poll(() => page.evaluate(() => window.__dashboardRefreshEvents)).toBe(1)
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
  console.log('PASS: exact six-section dashboard order, CRM context, checklist, universal 50-second polling, executive creation and mobile layout (mock API).')
} catch(error) {
  await page.screenshot({path:'.verification.local/context-daily-failure.png',fullPage:true})
  console.error(errors)
  console.error((await page.locator('body').innerText()).slice(0,4000))
  throw error
} finally { await browser.close() }
