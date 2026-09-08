import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

// Creates isolated Auth accounts/products/sales and removes them in finally.
// Install the browser runner in the ignored .verification.local directory first.
if (!process.argv.includes('--run-disposable-check')) throw new Error('Use --run-disposable-check for isolated fixtures with automatic cleanup.')
const project = 'mbzwchnxtskysqplqiyy'
const origin = process.env.CATALOG_TEST_ORIGIN || 'http://127.0.0.1:5197'
const credentials = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project, '--output', 'json'], {
  shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 1024 * 1024,
})
if (credentials.status !== 0) throw new Error('Authorized Supabase credentials unavailable')
const keys = JSON.parse(credentials.stdout)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(`https://${project}.supabase.co`, keys.find(key => key.name === 'service_role').api_key, options)
const publicKey = keys.find(key => key.name === 'anon').api_key
const executive = createClient(`https://${project}.supabase.co`, publicKey, options)
const seller = createClient(`https://${project}.supabase.co`, publicKey, options)
const must = result => { if (result.error) throw new Error(result.error.message); return result.data }
const users = []
const suffix = randomUUID().slice(0, 8)
const productName = `QA Catálogo ${suffix}`
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const errors = []
mkdirSync('.verification.local', { recursive: true })
let execPage, sellerPage, channel
const expect = baseExpect.configure({ timeout: 15000 })

async function openAs(client, user, url, viewport) {
  const link = must(await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email }))
  const login = must(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }))
  const context = await browser.newContext({ viewport })
  context.setDefaultTimeout(15000)
  await context.addInitScript(({ key, session }) => { sessionStorage.setItem(key, JSON.stringify(session)) }, { key: `sb-${project}-auth-token`, session: login.session })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('.supabase.co/rest/')) errors.push(`${response.status()} ${new URL(response.url()).pathname}`) })
  await page.goto(`${origin}${url}`)
  return page
}
const step = text => console.log(`Checking: ${text}`)

try {
  step('isolated executive and seller sessions')
  for (const role of ['executive', 'seller']) {
    const created = must(await admin.auth.admin.createUser({ email: `qa-catalog-${role}-${suffix}@example.invalid`, email_confirm: true, user_metadata: { display_name: `QA Catálogo ${role}` } }))
    users.push(created.user)
  }
  must(await admin.from('user_roles').insert({ user_id: users[0].id, role: 'executive' }))
  must(await admin.from('user_roles').update({ commission_rate: 20 }).eq('user_id', users[1].id))
  execPage = await openAs(executive, users[0], '/executive?tab=products', { width: 1440, height: 1080 })
  sellerPage = await openAs(seller, users[1], '/vendas', { width: 1280, height: 900 })
  await expect(execPage.getByRole('button', { name: 'Novo produto', exact: true })).toBeVisible()
  await expect(sellerPage.getByRole('combobox', { name: 'Nome Do Produto Vendido *' })).toBeEnabled()
  assert.equal(await sellerPage.getByRole('button', { name: 'Produtos e tickets', exact: true }).count(), 0)

  let productSignal = false
  channel = seller.channel(`catalog-qa-${suffix}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dashboard_events', filter: 'topic=eq.products' }, () => { productSignal = true })
  await seller.realtime.setAuth((await seller.auth.getSession()).data.session.access_token)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timeout')), 15000)
    channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() } else if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('Realtime subscription failed')) } })
  })

  step('create product and first ticket through executive UI')
  await execPage.getByRole('button', { name: 'Novo produto', exact: true }).click()
  await execPage.getByLabel('Nome do produto *', { exact: true }).fill(productName)
  await execPage.getByLabel('Descrição', { exact: true }).fill('Produto temporário para validar catálogo, tickets e sincronização.')
  await execPage.getByLabel('Nome do primeiro ticket *', { exact: true }).fill('Completo')
  await execPage.getByLabel('Preço do ticket (R$) *', { exact: true }).fill('0')
  await execPage.getByRole('button', { name: 'Criar produto e ticket', exact: true }).click()
  await expect(execPage.getByRole('dialog').getByRole('alert')).toContainText('Informe o nome do ticket')
  await execPage.getByLabel('Preço do ticket (R$) *', { exact: true }).fill('1.497,50')
  await execPage.getByRole('button', { name: 'Criar produto e ticket', exact: true }).click()
  await expect(execPage.getByRole('dialog')).toHaveCount(0)
  await execPage.getByRole('textbox', { name: 'Buscar produtos ou tickets' }).fill(productName)
  await expect(execPage.getByRole('heading', { name: productName, exact: true })).toBeVisible()
  await expect.poll(() => productSignal, { timeout: 10000 }).toBe(true)
  const product = must(await executive.from('products').select('*, product_tickets(*)').eq('name', productName).single())
  const ticket = product.product_tickets[0]
  assert.equal(ticket.price, 1497.50)
  await execPage.getByRole('heading', { name: 'Produtos e tickets', exact: true }).scrollIntoViewIfNeeded()
  await execPage.screenshot({ path: '.verification.local/catalog-desktop.png', animations: 'disabled' })

  step('seller receives new product without reloading and records a sale')
  await sellerPage.getByRole('combobox', { name: 'Nome Do Produto Vendido *' }).click()
  await sellerPage.getByRole('option', { name: productName, exact: true }).click()
  await sellerPage.getByRole('combobox', { name: 'Ticket e valor da venda *' }).click()
  await sellerPage.getByRole('option', { name: /Completo.*1\.497,50/ }).click()
  await sellerPage.getByLabel('Nome Do Comprador *').fill('Comprador de verificação')
  await sellerPage.getByLabel('WhatsApp Do Comprador *').fill('11999999999')
  await sellerPage.getByLabel('Email Do Comprador *').fill(`qa-buyer-${suffix}@example.invalid`)
  await sellerPage.screenshot({ path: '.verification.local/seller-sale.png', animations: 'disabled' })
  await sellerPage.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
  await expect(sellerPage.getByText('Venda registrada! Aguardando aprovação', { exact: true })).toBeVisible()
  const sale = must(await seller.from('vendas').select('*').eq('user_id', users[1].id).single())
  assert.equal(sale.valor_venda, 1497.50)
  assert.equal(sale.ticket_name, 'Completo')
  assert.equal(sale.approval_status, 'pendente')

  step('add ticket and reject invalid/direct API writes')
  await execPage.getByRole('button', { name: `Novo ticket para ${productName}`, exact: true }).click()
  await execPage.getByLabel('Nome do ticket *', { exact: true }).fill('Entrada')
  await execPage.getByLabel('Preço do ticket (R$) *', { exact: true }).fill('275,25')
  await execPage.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(execPage.getByRole('dialog')).toHaveCount(0)
  assert((await seller.rpc('executive_create_product', { p_name: 'Forbidden QA', p_description: '', p_ticket_name: 'Invalid', p_ticket_price: 1 })).error)
  assert((await seller.from('product_tickets').update({ price: 1 }).eq('id', ticket.id)).error)
  assert((await seller.from('vendas').update({ valor_venda: 1 }).eq('id', sale.id)).error)

  step('price update reaches open seller form and preserves existing sale')
  await sellerPage.getByRole('combobox', { name: 'Nome Do Produto Vendido *' }).click()
  await sellerPage.getByRole('option', { name: productName, exact: true }).click()
  await sellerPage.getByRole('combobox', { name: 'Ticket e valor da venda *' }).click()
  await sellerPage.getByRole('option', { name: /Completo.*1\.497,50/ }).click()
  await execPage.getByRole('button', { name: `Editar ticket Completo de ${productName}`, exact: true }).click()
  await execPage.getByLabel('Preço do ticket (R$) *', { exact: true }).fill('1.997,75')
  await execPage.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(execPage.getByRole('dialog')).toHaveCount(0)
  await expect(sellerPage.getByRole('combobox', { name: 'Ticket e valor da venda *' })).toContainText('1.997,75', { timeout: 15000 })
  await expect(sellerPage.getByText('Preço do ticket atualizado', { exact: true })).toBeVisible()
  assert.equal(must(await seller.from('vendas').select('valor_venda').eq('id', sale.id).single()).valor_venda, 1497.50)
  const stale = await executive.rpc('executive_save_product_ticket', { p_ticket_id: ticket.id, p_product_id: product.id, p_name: ticket.name, p_price: 1, p_expected_updated_at: ticket.updated_at })
  assert.equal(stale.error?.code, 'PT409')

  step('deactivation removes selected product and blocks submission')
  await execPage.getByRole('button', { name: `Editar produto ${productName}`, exact: true }).click()
  await execPage.getByRole('switch', { name: 'Produto ativo', exact: true }).click()
  await execPage.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(execPage.getByRole('dialog')).toHaveCount(0)
  await expect(sellerPage.getByRole('combobox', { name: 'Nome Do Produto Vendido *' })).toContainText('Selecione o produto')
  await expect(sellerPage.getByRole('button', { name: 'Registrar Venda', exact: true })).toBeDisabled()
  must(await executive.rpc('executive_review_sale', { p_sale_id: sale.id, p_action: 'approve', p_expected_status: 'pendente' }))
  assert.equal(must(await seller.from('vendas').select('commission_amount').eq('id', sale.id).single()).commission_amount, 299.50)
  assert.equal(Number(must(await seller.rpc('get_available_balance', { p_seller_id: users[1].id }))), 299.50)
  const feed = must(await seller.rpc('get_sales_board', { p_status: 'aprovada', p_search: productName }))
  assert.equal(feed.items[0].ticket_name, 'Completo')
  assert(!('email_comprador' in feed.items[0]))

  step('reactivation, mobile layout, and seller route protection')
  await execPage.getByRole('button', { name: `Editar produto ${productName}`, exact: true }).click()
  await execPage.getByRole('switch', { name: 'Produto ativo', exact: true }).click()
  await execPage.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(execPage.getByRole('dialog')).toHaveCount(0)
  await execPage.setViewportSize({ width: 390, height: 844 })
  await execPage.getByRole('button', { name: `Editar ticket Completo de ${productName}`, exact: true }).click()
  await expect(execPage.getByRole('dialog')).toBeVisible()
  await expect(execPage.getByRole('dialog')).toHaveCSS('opacity', '1')
  await execPage.screenshot({ path: '.verification.local/catalog-mobile.png', animations: 'disabled' })
  const dialogBox = await execPage.getByRole('dialog').boundingBox()
  assert(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390)
  await execPage.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await sellerPage.goto(`${origin}/executive?tab=products`)
  await expect(sellerPage).toHaveURL(`${origin}/`)
  assert.deepEqual(errors, [])
  console.log('PASS: real browser executive/seller flow, live catalog synchronization, API permissions, mobile layout and frozen sale commissions.')
} catch (error) {
  if (execPage) await execPage.screenshot({ path: '.verification.local/catalog-failure.png' }).catch(() => {})
  if (sellerPage) await sellerPage.screenshot({ path: '.verification.local/seller-failure.png' }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  if (channel) await seller.removeChannel(channel)
  const cleanupErrors = []
  const clean = async action => { try { must(await action()) } catch (error) { cleanupErrors.push(error.message) } }
  if (users.length) {
    await clean(() => admin.from('vendas').delete().in('user_id', users.map(user => user.id)))
    const products = await admin.from('products').select('id').eq('created_by', users[0].id)
    if (products.error) cleanupErrors.push(products.error.message)
    const ids = products.data?.map(product => product.id) ?? []
    if (ids.length) {
      await clean(() => admin.from('product_tickets').delete().in('product_id', ids))
      await clean(() => admin.from('products').delete().in('id', ids))
    }
    await clean(() => admin.from('executive_audit_events').delete().in('actor_id', users.map(user => user.id)))
    for (const user of users) await clean(() => admin.auth.admin.deleteUser(user.id))
  }
  await Promise.all([executive.removeAllChannels(), seller.removeAllChannels(), admin.removeAllChannels()])
  if (cleanupErrors.length) { console.error('Cleanup errors:', cleanupErrors); process.exitCode = 1 }
  else console.log('Temporary accounts, products, tickets, sales and audit records cleaned up.')
}
