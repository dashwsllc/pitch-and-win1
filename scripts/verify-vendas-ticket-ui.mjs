import assert from 'node:assert/strict'
import { chromium, expect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, installMock, STORAGE_KEY, USER_ID } from './perf/mock.mjs'
import { startServer } from './perf/server.mjs'

// Real form and refresh behavior; all Supabase operations use isolated, in-memory fixtures.
const distIndex = process.argv.indexOf('--dist')
const server = distIndex < 0 ? null : await startServer(process.argv[distIndex + 1])
const origin = server?.url ?? process.env.SALES_TEST_ORIGIN ?? 'http://127.0.0.1:5208'

const browser = await chromium.launch({ headless: true })
const failures = []
let checks = 0
async function check(name, run, { role = 'super_admin', setup } = {}) {
  checks++
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'pt-BR' })
  const fixtures = buildFixtures({ sales: 0, approaches: 0, role })
  fixtures.tables.vendas = []
  fixtures.tables.products.forEach(product => {
    product.product_tickets = [{ id: product.id, name: 'Padrão', active: true, price: 2997 }]
  })
  setup?.(fixtures)
  installMock(context, fixtures, { latencyMs: 0 })
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: STORAGE_KEY, session: fakeSession() })
  const page = await context.newPage()
  const writes = []
  const edits = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/vendas') writes.push(request.postDataJSON()[0])
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/rpc/manage_sale') edits.push(request.postDataJSON())
  })
  try {
    await page.goto(`${origin}/vendas`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await expect(page.getByRole('button', { name: 'Registrar Venda', exact: true })).toBeEnabled()
    await run(page, writes, fixtures, edits)
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${error.message.split('\n').slice(0, 3).join(' ')}`)
  } finally {
    await context.close()
  }
}

await check('nome e WhatsApp são obrigatórios no formulário', async page => {
  for (const id of ['nome_comprador', 'whatsapp_comprador']) {
    assert.equal(await page.locator(`#${id}`).evaluate(input => input.required), true, `${id} obrigatório`)
    assert.equal(await page.locator(`#${id}`).evaluate(input => input.checkValidity()), false)
  }
})

await check('nome e WhatsApp vazios ou só espaços bloqueiam o envio', async (page, writes) => {
  await page.locator('input#sale-ticket, input#valor-total').fill('1.497,50')
  await page.locator('form').first().evaluate(form => { form.noValidate = true })
  for (const [name, phone] of [['', '11999999999'], ['  ', '11999999999'], ['Maria Silva', ''], ['Maria Silva', '  ']]) {
    await page.locator('#nome_comprador').fill(name)
    await page.locator('#whatsapp_comprador').fill(phone)
    await page.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
    await expect(page.getByText('Confira a venda', { exact: true }).first()).toBeVisible({ timeout: 1500 })
    assert.equal(writes.length, 0)
  }
})

await check('Ticket é digitável em reais e salva o valor informado', async (page, writes) => {
  assert.equal(await page.locator('#sale-ticket').evaluate(element => element.tagName), 'INPUT')
  await expect(page.locator('#sale-ticket').locator('..')).toContainText('R$')
  await page.locator('#sale-ticket').fill('1.497,50')
  await page.locator('#nome_comprador').fill('  Maria Silva  ')
  await page.locator('#whatsapp_comprador').fill('11999999999')
  await page.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
  await expect(page.getByText('Venda registrada! Aguardando aprovação', { exact: true })).toBeVisible()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].valor_venda, 1497.5)
  assert.equal(writes[0].ticket_id, null)
  assert.equal(writes[0].nome_comprador, 'Maria Silva')
  assert.equal(writes[0].whatsapp_comprador, '11999999999')
  assert.equal(writes[0].email_comprador, '')
  await expect(page.locator('#sale-ticket')).toHaveValue('')
})

await check('valor inválido é rejeitado e sinal mantém o valor total digitado', async (page, writes) => {
  await page.locator('input#sale-ticket, input#valor-total').fill('0')
  await page.locator('#nome_comprador').fill('Maria Silva')
  await page.locator('#whatsapp_comprador').fill('11999999999')
  await page.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
  await expect(page.getByText('Informe o valor total da venda (ex.: 2.997,00).', { exact: true }).first()).toBeVisible()
  assert.equal(writes.length, 0)
  await page.locator('input#sale-ticket, input#valor-total').fill('2.997,00')
  await page.getByRole('radio', { name: 'Sinal', exact: true }).check()
  await page.locator('#valor-sinal').fill('500,50')
  await expect(page.getByText('Falta receber R$ 2.496,50.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
  await expect(page.getByText('Venda registrada! Aguardando aprovação', { exact: true })).toBeVisible()
  assert.equal(writes[0].valor_venda, 2997)
  assert.equal(writes[0].payment_type, 'sinal')
  assert.equal(writes[0].deposit_amount, 500.5)
})

await check('produto ativo sem ticket de catálogo pode ser vinculado ao valor digitado', async (page, writes, fixtures) => {
  await expect(page.locator('#sale-product option', { hasText: fixtures.tables.products[0].name })).toHaveCount(1)
  await page.locator('#sale-product').selectOption(fixtures.tables.products[0].id)
  await page.locator('#sale-ticket').fill('1.497,50')
  await page.locator('#nome_comprador').fill('Maria Silva')
  await page.locator('#whatsapp_comprador').fill('11999999999')
  await page.getByRole('button', { name: 'Registrar Venda', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  assert.equal(writes[0].product_id, fixtures.tables.products[0].id)
  assert.equal(writes[0].valor_venda, 1497.5)
}, { setup: fixtures => { fixtures.tables.products[0].product_tickets = [] } })

const editableSale = {
  id: '00000000-0000-4000-8000-000000000188', user_id: USER_ID,
  product_id: null, ticket_id: null, nome_produto: 'Venda avulsa', valor_venda: 1497.5,
  nome_comprador: 'Maria Silva', whatsapp_comprador: '11999999999', email_comprador: '',
  approval_status: 'pendente', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commission_amount: 0, consideracoes_gerais: null,
}
await check('venda sem catálogo e e-mail pode ter o Ticket corrigido pelo responsável', async (page, writes, fixtures, edits) => {
  await page.getByRole('button', { name: 'Editar venda de Maria Silva', exact: true }).click()
  const dialog = page.getByRole('dialog')
  assert.equal(await dialog.locator('#edit-sale-email').evaluate(input => input.required), false)
  assert.equal(await dialog.locator('#edit-sale-value').evaluate(input => input.readOnly), false)
  await dialog.locator('#edit-sale-value').fill('1.750,25')
  await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(edits.length, 1)
  assert.equal(edits[0].p_data.valor_venda, 1750.25)
  assert.equal(edits[0].p_data.ticket_id, null)
  assert.equal(edits[0].p_data.email_comprador, '')
}, { role: 'seller', setup: fixtures => { fixtures.tables.vendas = [{ ...editableSale }] } })

await browser.close()
server?.server.close()
console.log(`${checks - failures.length}/${checks} verificações passaram`)
process.exitCode = failures.length ? 1 : 0
