// Browser regression tests with an entirely fake Supabase backend. Use the benchmark
// build from verify-approval-sync-ui.mjs. Nothing in these tests touches production.
import assert from 'node:assert/strict'
import path from 'node:path'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, installMock, STORAGE_KEY, MOCK_HOST } from './perf/mock.mjs'
import { startServer } from './perf/server.mjs'

const dist = process.argv[process.argv.indexOf('--dist') + 1]
if (!process.argv.includes('--dist') || !dist) throw new Error('Informe --dist <build de benchmark>')
const expect = baseExpect.configure({ timeout: 15_000 })
const now = new Date('2026-10-07T18:00:00Z')
const { server, url } = await startServer(path.resolve(dist))
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
let failures = 0

async function open(route = '/vendas', { namesFail = false, width = 1440 } = {}) {
  const f = buildFixtures({ sales: 0, approaches: 0, now })
  const owners = f.tables.profiles.slice(1, 3)
  const sale = {
    ...f.tables.vendas[0], user_id: owners[0].user_id, nome_comprador: 'Cliente da regressão',
    valor_venda: 500, approval_status: 'aprovada', created_at: '2026-10-03T02:57:00Z',
    reviewed_at: '2026-10-06T21:52:00Z', updated_at: '2026-10-06T21:52:00Z',
  }
  f.tables.vendas = [sale]
  f.tables.abordagens = []
  f.tables.crm_activities = []
  f.tables.products = f.tables.products.map(product => ({ ...product, product_tickets: [] }))
  const arena = f.rpc.arena_dashboard()
  const closerCycle = arena.cycles.find(c => c.period === 'weekly')
  closerCycle.starts_at = '2026-10-05T03:00:00Z'
  closerCycle.ends_at = '2026-10-12T03:00:00Z'
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  const mock = installMock(context, f, { latencyMs: 10 })
  if (namesFail) await context.route(`https://${MOCK_HOST}/rest/v1/profiles?**`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    const query = new URL(route.request().url()).searchParams
    if (!query.get('user_id')?.startsWith('in.')) return route.fallback()
    return route.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ message: 'Profile lookup failure' }) })
  })
  await context.addInitScript(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session))
    localStorage.setItem('theme', 'dark')
  }, { key: STORAGE_KEY, session: fakeSession(now.getTime()) })
  const page = await context.newPage()
  await page.clock.setFixedTime(now)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url + route, { waitUntil: 'load' })
  return { f, sale, owners, arena, page, mock, errors, close: () => context.close() }
}

async function test(name, fn) {
  if (process.env.UI_TEST_FILTER && !name.includes(process.env.UI_TEST_FILTER)) return
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`) }
}

await test('approved sale displays its actual seller, purchase day and approval time; link opens the credited totals', async () => {
  const t = await open()
  try {
    const row = t.page.getByRole('article', { name: 'Venda de Cliente da regressão' })
    await expect(row).toContainText(`Vendedor: ${t.owners[0].display_name}`)
    await expect(row).toContainText('Contabilizada em 02/10/2026')
    await expect(row).toContainText('Aprovada em 06/10/2026')
    if (process.env.UI_SCREENSHOTS) await row.screenshot({ path: '.verification.local/sale-credit.png' })
    await row.getByRole('link', { name: /Ver venda/ }).click()
    await expect(t.page).toHaveURL(/periodo=intervalo&de=2026-10-02&ate=2026-10-02/)
    const total = t.page.getByRole('region', { name: 'Total de Vendas', exact: true })
    const count = t.page.getByRole('region', { name: 'Quantidade de Vendas', exact: true }).locator('p').first()
    await expect(total).toContainText('R$ 500,00')
    await expect(count).toHaveText('1')
    // Edits refresh the original purchase day without creating another sale.
    t.sale.valor_venda = 750
    t.sale.updated_at = now.toISOString()
    t.mock.bumpRevision('sales')
    await expect(total).toContainText('R$ 750,00')
    await expect(count).toHaveText('1')
    assert.deepEqual(t.errors, [])
  } finally { await t.close() }
})

await test('seller reassignment and approval changes update the open sales list without reloading', async () => {
  const t = await open()
  try {
    const row = t.page.getByRole('article', { name: 'Venda de Cliente da regressão' })
    await expect(row).toContainText(`Vendedor: ${t.owners[0].display_name}`)
    t.sale.user_id = t.owners[1].user_id
    t.mock.bumpRevision('sales')
    await expect(row).toContainText(`Vendedor: ${t.owners[1].display_name}`)
    await expect(row).not.toContainText(t.owners[0].display_name)
    t.sale.approval_status = 'pendente'
    t.sale.reviewed_at = null
    t.mock.bumpRevision('sales')
    await expect(row).toContainText('Aguardando aprovação para somar aos indicadores')
    await expect(row.getByRole('link', { name: /Ver venda/ })).toHaveCount(0)
    t.sale.approval_status = 'aprovada'
    t.sale.reviewed_at = now.toISOString()
    t.mock.bumpRevision('sales')
    await expect(row).toContainText('Contabilizada em 02/10/2026')
    await expect(row.getByRole('link', { name: /Ver venda/ })).toBeVisible()
    assert.deepEqual(t.errors, [])
  } finally { await t.close() }
})

await test('profile lookup failure never hides a registered sale or invents its seller', async () => {
  const t = await open('/vendas', { namesFail: true })
  try {
    const row = t.page.getByRole('article', { name: 'Venda de Cliente da regressão' })
    await expect(row).toContainText('R$ 500,00')
    await expect(row).toContainText('Responsável indisponível')
    await expect(t.page.getByRole('alert').filter({ hasText: 'nomes dos responsáveis' })).toBeVisible()
    await expect(row.getByRole('link', { name: /Ver venda/ })).toBeVisible()
    assert.deepEqual(t.errors, [])
  } finally { await t.close() }
})

for (const width of [1440, 390]) await test(`Arena keeps every participant and updates live results at ${width}px`, async () => {
  const t = await open('/arena', { width })
  try {
    const list = t.page.getByRole('region', { name: 'Participantes de Closers · semana', exact: true })
    await expect(list.locator('[data-person]')).toHaveCount(t.arena.closers.length)
    const fifth = t.arena.closers[4]
    const row = list.locator(`[data-person="${fifth.user_id}"]`)
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeInViewport()
    await expect(t.page.getByRole('region', { name: 'Closers · semana', exact: true })).toContainText('05/10/2026 a 11/10/2026')
    fifth.quantidadeVendas = 2
    fifth.totalVendas = 1997
    t.arena.revision++
    t.mock.bumpRevision('sales')
    await expect(row).toContainText('2 vendas · R$ 1.997,00')
    if (process.env.UI_SCREENSHOTS) await t.page.locator('.arena-rankings').screenshot({ path: `.verification.local/sales-rankings-${width}.png` })
    const geometry = await t.page.locator('.arena-rankings').evaluate(el => {
      const sections = [...el.children].map(n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width } })
      return { sections, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    assert.equal(geometry.overflow, false, 'no horizontal overflow')
    if (width >= 1000) {
      assert.equal(geometry.sections[0].y, geometry.sections[1].y, 'rankings stay side by side')
      assert.ok(Math.abs(geometry.sections[0].w - geometry.sections[1].w) <= 1, 'rankings each use half the width')
    }
    assert.deepEqual(t.errors, [])
  } finally { await t.close() }
})

await browser.close()
server.close()
process.exitCode = failures ? 1 : 0
