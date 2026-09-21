// Browser flow verification against an isolated in-memory API. No production writes.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const expect = baseExpect.configure({ timeout: 15000 })
const actor = 'af140000-0000-4000-8000-000000000001', accountId = 'af140000-0000-4000-8000-000000000002'
const project = 'mbzwchnxtskysqplqiyy', now = new Date().toISOString()
let role = 'super_admin', writes = 0, reschedules = 0, accountDeletes = 0, leadDeletes = 0, conflict = false
const errors = [], leads = [], mutations = []
const profile = { id: actor, user_id: actor, display_name: 'QA Admin', suspended: false, created_at: now }
const roles = id => [{ id, user_id: id, role: id === actor ? role : 'seller', crm_access: true, commission_rate: 20, updated_at: now }]
const products = [1000,2000].map((price,i) => { const id = randomUUID(); return { id, name: `Produto ${i+1}`, active: true, product_tickets: [{ id: randomUUID(), product_id: id, name: `Ticket ${i+1}`, price, active: true }] } })
const sales = ['aprovada','pendente','rejeitada'].map((status,i) => ({ id: randomUUID(), user_id: actor, nome_comprador: `Comprador ${i+1}`, email_comprador: 'qa@example.invalid', whatsapp_comprador: '11999999999', nome_produto: products[0].name, product_id: products[0].id, ticket_id: products[0].product_tickets[0].id, ticket_name: 'Ticket 1', valor_venda: 1000, approval_status: status, created_at: now, updated_at: now, reviewed_at: status === 'pendente' ? null : now, commission_amount: status === 'aprovada' ? 200 : 0, withdrawn: false, withdrawal_id: null }))
const accounts = [profile, { ...profile, user_id: accountId, display_name: 'Conta teste' }]
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1), payload = route.request().postDataJSON() ?? {}, method = route.request().method()
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods':'POST,GET,PATCH,DELETE,OPTIONS', 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info' } })
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'user_roles') data = roles(actor)
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'products') data = products
  else if (resource === 'vendas') {
    data = sales.filter(sale => {
      const status = url.searchParams.get('approval_status')
      return (!status || (status.startsWith('eq.') ? sale.approval_status === status.slice(3) : status.includes(sale.approval_status)))
    })
  } else if (resource === 'get_sales_board') {
    const visible = sales.filter(s => s.approval_status !== 'rejeitada' || ['executive','super_admin'].includes(role))
    const items = visible.filter(s => s.approval_status === payload.p_status).map(s => ({ ...s, seller_name: 'QA Seller' }))
    data = { items, total: items.length, fetched_at: now, summary: { approved: visible.filter(s => s.approval_status === 'aprovada').length, pending: visible.filter(s => s.approval_status === 'pendente').length, rejected: visible.filter(s => s.approval_status === 'rejeitada').length, approved_value: visible.filter(s => s.approval_status === 'aprovada').reduce((sum,s) => sum+s.valor_venda,0), pending_value: 1000, overdue: 0 } }
  } else if (resource === 'super_admin_reschedule_sale') {
    assert.equal(role,'super_admin','Only Super Admin may call reschedule')
    const sale = sales.find(s => s.id === payload.p_sale_id)
    assert(sale)
    assert.equal(payload.p_expected_created_at,sale.created_at)
    assert.equal(payload.p_expected_status,sale.approval_status)
    assert(payload.p_reason.trim().length >= 5)
    assert(['pendente','aprovada'].includes(sale.approval_status))
    reschedules++
    sale.created_at = payload.p_created_at
    sale.updated_at = new Date(Date.now()+reschedules).toISOString()
    data = { id:sale.id, created_at:sale.created_at, approval_status:sale.approval_status }
  } else if (resource === 'manage_sale') {
    writes++
    if (conflict) { conflict = false; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PT409', message: 'Esta venda foi alterada. Atualize a lista.' }) }) }
    const sale = sales.find(s => s.id === payload.p_sale_id)
    assert.equal(payload.p_expected_updated_at, sale.updated_at)
    mutations.push(payload)
    if (payload.p_action === 'delete') sales.splice(sales.indexOf(sale),1)
    else {
      const oldValue = sale.valor_venda, oldCommission = sale.commission_amount
      Object.assign(sale, payload.p_data, { updated_at: new Date(Date.now()+writes).toISOString() })
      const product = products.find(p => p.id === sale.product_id)
      sale.nome_produto = product.name
      sale.ticket_name = product.product_tickets.find(t => t.id === sale.ticket_id).name
      sale.commission_amount = oldCommission / oldValue * sale.valor_venda
    }
    data = sale
  } else if (resource === 'get_available_balance') data = sales.filter(s => s.approval_status === 'aprovada').reduce((sum,s) => sum+s.commission_amount,0)
  else if (resource === 'get_team_ranking') data = []
  else if (resource === 'crm_leads') {
    if (method === 'POST') { data = { ...payload, id: randomUUID(), version: 1, pipeline_stage: 'novo', temperature: 'frio', approach_stage: 'nao_abordado', created_at: now }; leads.push(data) }
    else data = leads
  } else if (resource === 'crm_transition') {
    data = leads.find(l => l.id === payload.p_lead_id)
    Object.assign(data, payload.p_data, { version: data.version + 1 })
  } else if (resource === 'crm_delete_lead') {
    const index = leads.findIndex(l => l.id === payload.p_lead_id)
    assert.notEqual(index,-1)
    assert.equal(payload.p_expected_version,leads[index].version)
    leadDeletes++
    data = { lead_id: leads[index].id, detached_sales: 0 }
    leads.splice(index,1)
  } else if (resource === 'executive_list_users') data = { users: accounts.map(a => ({ ...a, email: 'qa@example.invalid', user_roles: roles(a.user_id), account_revision: now })), fetched_at: now }
  else if (resource === 'executive-delete-account') { accountDeletes++; accounts.splice(accounts.findIndex(a => a.user_id === payload.user_id),1); data = { success: true } }
  else if (resource.startsWith('get_')) data = 0
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({ alg:'HS256',typ:'JWT' })}.${enc({ sub:actor,role:'authenticated',exp:4102444800 })}.test`, refresh_token:'test',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id:actor,email:'qa@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{display_name:'QA Admin'},created_at:new Date().toISOString()} }))
}, { actor, project })
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(origin)
  await expect(page.locator('[data-dashboard-section="commercial-indicators"]')).toContainText('R$ 1.000,00')
  assert.deepEqual((await page.locator('[data-dashboard-section]').evaluateAll(nodes => nodes.map(n => n.dataset.dashboardSection))).slice(0,5), ['greeting','commercial-indicators','goals-in-progress','commercial-evolution','featured-products'])
  const homeTabs = page.getByRole('tablist', { name:'Status da venda' })
  assert.deepEqual(await homeTabs.getByRole('tab').allTextContents(), ['Aprovadas 1','Pendentes 1'])
  await expect(homeTabs.getByRole('tab').first()).toHaveAttribute('aria-selected','true')
  await expect(page.getByText('Rejeitadas',{exact:true})).toHaveCount(0)
  await page.goto(`${origin}/vendas`)
  const board = page.getByRole('region',{name:'Gerenciamento das últimas vendas'})
  await expect(board.getByRole('article')).toHaveCount(2)
  const approvedCard = board.getByRole('article',{name:'Venda de Comprador 1'})
  await approvedCard.getByRole('button',{name:'Remarcar data da venda de Comprador 1'}).click()
  await page.getByLabel('Nova data e horário da compra (Brasília)').fill('2026-09-18T10:30:25')
  await page.getByLabel('Motivo da correção (obrigatório)').fill('Compra registrada em outra data')
  await page.getByRole('button',{name:'Remarcar e sincronizar'}).click()
  await expect(approvedCard).toContainText('18/09/2026, 10:30:25')
  assert.equal(reschedules,1)
  const pendingCard = board.getByRole('article',{name:'Venda de Comprador 2'})
  await pendingCard.getByRole('button',{name:'Remarcar data da venda de Comprador 2'}).click()
  await page.getByLabel('Nova data e horário da compra (Brasília)').fill('2026-09-17T09:15:10')
  await page.getByLabel('Motivo da correção (obrigatório)').fill('Compra registrada no horário incorreto')
  await page.getByRole('button',{name:'Remarcar e sincronizar'}).click()
  await expect(pendingCard).toContainText('17/09/2026, 09:15:10')
  assert.equal(reschedules,2)
  await page.goto(`${origin}/executive?tab=approvals`)
  const central = page.getByRole('region',{name:'Vendas do time'})
  await expect(central.getByRole('button',{name:'Remarcar data da venda de QA Seller'})).toHaveCount(1)
  await central.getByRole('tab',{name:/Aprovadas/}).click()
  await expect(central.getByRole('button',{name:'Remarcar data da venda de QA Seller'})).toHaveCount(1)
  await central.getByRole('tab',{name:/Rejeitadas/}).click()
  await expect(central.getByRole('button',{name:/Remarcar data da venda/})).toHaveCount(0)
  role = 'executive'
  await page.goto(`${origin}/vendas`)
  await expect(board.getByRole('article')).toHaveCount(2)
  await expect(board.getByRole('button',{name:/Remarcar data da venda/})).toHaveCount(0)
  await board.getByRole('button',{name:'Editar venda de Comprador 1',exact:true}).click()
  await page.getByLabel('Produto',{exact:true}).selectOption(products[1].id)
  await page.getByLabel('Ticket',{exact:true}).selectOption(products[1].product_tickets[0].id)
  await page.getByLabel('Valor da venda (R$)').fill('2500')
  await page.getByLabel('Nome do comprador',{exact:true}).fill('Comprador atualizado')
  await page.getByRole('button',{name:'Salvar alterações',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(board.getByRole('article',{name:'Venda de Comprador atualizado'})).toContainText('R$ 2.500,00')
  // Navigate using the actual sidebar, retaining the query cache.
  await page.getByRole('link',{name:'Dashboard',exact:true}).click()
  await expect(page.locator('[data-dashboard-section="commercial-indicators"]')).toContainText('R$ 2.500,00')
  await expect(page.locator('[data-dashboard-section="featured-products"]')).toContainText('Produto 2')
  await page.goto(`${origin}/minhas-vendas`)
  await expect(page.getByText('R$ 500,00',{exact:true}).first()).toBeVisible()
  await page.getByRole('button',{name:'Excluir venda de Comprador atualizado',exact:true}).click()
  const beforeCancel = writes
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  assert.equal(writes,beforeCancel)
  await page.getByRole('button',{name:'Editar venda de Comprador atualizado',exact:true}).click()
  conflict = true
  await page.getByLabel('Nome do comprador',{exact:true}).fill('Conflito de edição')
  await page.getByRole('button',{name:'Salvar alterações',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Esta venda foi alterada')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.getByRole('button',{name:'Excluir venda de Comprador atualizado',exact:true}).click()
  await page.getByLabel('Motivo da exclusão',{exact:true}).fill('Registro duplicado de teste')
  await page.getByRole('button',{name:'Excluir venda',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('link',{name:'Dashboard',exact:true}).click()
  await expect(page.locator('[data-dashboard-section="commercial-indicators"]')).toContainText('R$ 0,00')
  await expect(page.locator('[data-dashboard-section="featured-products"]')).not.toContainText('Produto 2')
  await page.goto(`${origin}/crm?tab=leads`)
  await page.getByRole('button',{name:'Novo Lead',exact:true}).click()
  await page.getByLabel('Nome do responsável').fill('Responsável QA')
  await page.getByLabel('Nome do atleta').fill('Atleta QA')
  await page.getByLabel('WhatsApp',{exact:false}).fill('11999999999')
  await page.getByLabel('Idade do atleta').fill('14')
  await page.getByRole('button',{name:'Criar Lead',exact:true}).click()
  const leadCard = page.getByRole('article',{name:'Lead Atleta QA',exact:true})
  await expect(leadCard.getByRole('heading')).toHaveText('Atleta QA')
  await expect(leadCard).toContainText('Responsável: Responsável QA')
  await expect(leadCard).toContainText('14 anos')
  await leadCard.getByRole('button',{name:'Editar Responsável QA',exact:true}).click()
  await expect(page.getByLabel('Idade do atleta')).toHaveValue('14')
  await page.getByLabel('Idade do atleta').fill('15')
  await page.getByRole('button',{name:'Salvar cadastro',exact:true}).click()
  await expect(leadCard).toContainText('15 anos')
  assert.equal(leads[0].athlete_age,15)
  await leadCard.getByRole('button',{name:'Contexto de Responsável QA',exact:true}).click()
  const leadDetail = page.getByRole('dialog')
  await expect(leadDetail.getByRole('button',{name:'Editar Atleta QA',exact:true})).toBeVisible()
  await leadDetail.getByRole('button',{name:'Excluir lead de Atleta QA',exact:true}).click()
  await expect(page.getByRole('alertdialog')).toContainText('Excluir este lead?')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  assert.equal(leadDeletes,0)
  await leadCard.getByRole('button',{name:'Excluir lead de Atleta QA',exact:true}).click()
  await page.getByRole('button',{name:'Excluir lead',exact:true}).click()
  await expect(leadCard).toHaveCount(0)
  assert.equal(leadDeletes,1)
  await page.goto(`${origin}/executive?tab=users`)
  const accountCard = page.getByText('Conta teste',{exact:true}).locator('xpath=ancestor::article')
  await accountCard.getByRole('button',{name:'Editar conta',exact:true}).click()
  await expect(page.getByText('Foto de perfil (URL HTTPS)',{exact:true})).toHaveCount(0)
  await page.getByLabel('Selecionar foto do membro na galeria').setInputFiles({
    name:'membro.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),
  })
  await expect(page.getByText('Selecionada: membro.png',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.getByRole('button',{name:'Excluir conta de Conta teste',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('Excluir conta e acesso')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  assert.equal(accountDeletes,0)
  await page.getByRole('button',{name:'Excluir conta de Conta teste',exact:true}).click()
  await page.getByLabel('Motivo da exclusão',{exact:true}).fill('Conta duplicada de teste')
  await page.getByRole('button',{name:'Excluir conta',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal(accountDeletes,1)
  role = 'seller'
  await page.setViewportSize({width:390,height:844})
  await page.goto(`${origin}/vendas`)
  await expect(board.getByRole('article')).toHaveCount(1)
  await expect(page.getByText('Rejeitadas',{exact:true})).toHaveCount(0)
  await board.scrollIntoViewIfNeeded()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow')
  await page.screenshot({path:'.verification.local/sales-management-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Editar venda de Comprador 2',exact:true}).click()
  await expect(page.getByLabel('Valor da venda (R$)')).toHaveAttribute('readonly','')
  await page.getByLabel('Produto',{exact:true}).selectOption(products[1].id)
  await page.getByLabel('Ticket',{exact:true}).selectOption(products[1].product_tickets[0].id)
  await page.getByRole('button',{name:'Salvar alterações',exact:true}).click()
  await expect(board.getByRole('article')).toContainText('R$ 2.000,00')
  await page.getByRole('button',{name:'Excluir venda de Comprador 2',exact:true}).click()
  await page.getByRole('button',{name:'Excluir venda',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => sales.length).toBe(1)
  await expect(board.getByRole('article')).toHaveCount(0)
  assert.equal(sales.length,1)
  assert.equal(sales[0].approval_status,'rejeitada')
  assert.deepEqual(errors,[])
  console.log('PASS: Super Admin reschedules pending/approved sales, Executive cannot see the action; home order/statuses; sale edit/delete + dashboard sync; CRM and account confirmations; seller permissions and mobile layout.')
} catch(error) {
  await page.screenshot({path:'.verification.local/sales-management-failure.png',fullPage:true})
  throw error
} finally { await browser.close() }
