// Executa o componente real no Chromium, sem autenticação ou acesso ao Supabase.
// Requer @playwright/test em .verification.local/node_modules, como os demais testes de navegador.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build, preview as createPreviewServer } from 'vite'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 5000 })
const root = fileURLToPath(new URL('../', import.meta.url))
const preview = resolve(root, '.verification.local/metric-references-ui')
mkdirSync(preview, { recursive: true })
writeFileSync(resolve(preview, 'index.html'), '<!doctype html><html lang="pt-BR" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="./preview.tsx"></script></body></html>')
writeFileSync(resolve(preview, 'preview.tsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MetaTrafficPerformance } from '../../src/components/traffic/MetaTrafficPerformance'
import { buildTrafficView } from '../../src/lib/meta-traffic-view'
import { metricRow, scope } from '../../scripts/helpers/meta-view-fixtures.mjs'
import '../../src/index.css'
const rows = [metricRow()]
if (new URLSearchParams(location.search).has('mixed')) rows.push(metricRow({ id: 'sales', campaign_id: 'B', objective: 'OUTCOME_SALES' }))
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-background p-4 text-foreground sm:p-8"><MetaTrafficPerformance view={buildTrafficView(rows, scope)} queryState={{ state: 'ready', data: rows }} cohortState={null} onRetry={() => {}} /></main>)
`)

console.log('Gerando prévia do componente de métricas…')
const outDir = resolve(preview, 'dist')
await build({ root: preview, configFile: resolve(root, 'vite.config.ts'), publicDir: resolve(root, 'public'), mode: 'test', logLevel: 'error', build: { outDir } })
const server = await createPreviewServer({ root, configFile: false, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const origin = `http://127.0.0.1:${server.httpServer.address().port}/`
  await page.goto(origin, { timeout: 20000 })
  console.log('Prévia carregada; verificando o botão…')
  const trigger = page.getByRole('button', { name: 'Para se basear', exact: true })
  await expect(trigger).toBeVisible()
  const allMetrics = page.getByRole('button', { name: 'Ver todas as métricas', exact: true })
  const [allBox, referenceBox] = await Promise.all([allMetrics.boundingBox(), trigger.boundingBox()])
  assert.ok(referenceBox.x >= allBox.x + allBox.width && Math.abs(referenceBox.y - allBox.y) < 2, 'Referências devem ficar ao lado de todas as métricas no desktop')
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Para se basear', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/sugestiv/i)
  const subjects = ['Connect rate', 'CPM', 'CTR', 'Taxa de conversão da página', 'Quantidade de leads gerados', 'Número de leads qualificados', 'Número de reuniões marcadas']
  const examples = [/200.*250.*80%/, /200.*10.000.*20/, /150.*10.000.*1,5%/, /45.*900.*5%/, /120.*7 dias/, /120.*25%.*30/, /30.*50%.*15/]
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  const thumbnails = dialog.getByRole('button', { name: /^Ampliar referência:/ })
  await expect(thumbnails).toHaveCount(7)
  const thumbnailBoxes = await thumbnails.evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right }
  }))
  assert.ok(thumbnailBoxes.every(box => Math.abs(box.y - thumbnailBoxes[0].y) < 2), 'As sete miniaturas ficam na mesma linha no desktop')
  assert.ok(thumbnailBoxes.every((box, index) => !index || box.x > thumbnailBoxes[index - 1].right), 'Miniaturas lado a lado com espaçamento')
  await expect.poll(() => thumbnails.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  await thumbnails.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  if (process.env.METRIC_REFERENCE_SCREENSHOTS) {
    mkdirSync(process.env.METRIC_REFERENCE_SCREENSHOTS, { recursive: true })
    await page.screenshot({ path: resolve(process.env.METRIC_REFERENCE_SCREENSHOTS, 'galeria-desktop.png') })
  }
  for (const subject of subjects) {
    const thumbnail = dialog.getByRole('button', { name: `Ampliar referência: ${subject}`, exact: true })
    await expect.poll(() => thumbnail.locator('img').evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
    const thumbnailWidth = (await thumbnail.locator('img').boundingBox()).width
    await thumbnail.click()
    const image = dialog.getByRole('img', { name: /^Guia ilustrado:/ })
    await expect(image).toHaveCount(1)
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('alt', examples[subjects.indexOf(subject)])
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
    const dimensions = await image.evaluate(element => ({ width: element.width, height: element.height, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight }))
    assert.ok(Math.abs(dimensions.width / dimensions.height - dimensions.naturalWidth / dimensions.naturalHeight) < 0.005, `${subject}: proporções preservadas`)
    assert.ok(dimensions.width > thumbnailWidth * 2 && dimensions.width <= dimensions.naturalWidth, `${subject}: ampliada sem esticar além da resolução original`)
    assert.equal(await dialog.getByRole('link', { name: 'Abrir imagem original' }).getAttribute('href'), await image.getAttribute('src'))
    await dialog.getByRole('button', { name: 'Todas as referências', exact: true }).click()
    await expect(thumbnail).toBeFocused()
  }
  await thumbnails.first().click()
  await expect(dialog.getByRole('button', { name: 'Referência anterior' })).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('heading', { name: 'CPM', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(dialog.getByRole('heading', { name: 'Connect rate', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(thumbnails).toHaveCount(7)
  await expect(thumbnails.first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await allMetrics.click()
  await expect(page.getByRole('button', { name: 'Ocultar todas as métricas' })).toBeVisible()
  await expect(page.getByText('CPM · custo por mil impressões', { exact: true })).toBeVisible()

  if (process.env.METRIC_REFERENCE_SCREENSHOTS) {
    mkdirSync(process.env.METRIC_REFERENCE_SCREENSHOTS, { recursive: true })
    await page.screenshot({ path: resolve(process.env.METRIC_REFERENCE_SCREENSHOTS, 'metricas-botoes.png') })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await trigger.click()
  await expect(dialog).toBeVisible()
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Painel sem transbordamento horizontal no celular')
  const mobileBox = await dialog.boundingBox()
  assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 391 && mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 845, 'Painel dentro da tela no celular')
  if (process.env.METRIC_REFERENCE_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.METRIC_REFERENCE_SCREENSHOTS, 'galeria-celular.png') })
  await dialog.getByRole('button', { name: 'Ampliar referência: CTR', exact: true }).click()
  const expanded = dialog.getByRole('img', { name: /^Guia ilustrado:/ })
  const fittedWidth = (await expanded.boundingBox()).width
  await dialog.getByRole('button', { name: 'Ver imagem no tamanho original' }).click()
  await expect.poll(() => expanded.evaluate(element => element.width === element.naturalWidth && element.width > 900)).toBe(true)
  const imageViewport = dialog.getByRole('region', { name: 'Imagem ampliada: CTR', exact: true })
  await expect(imageViewport).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => imageViewport.evaluate(element => element.scrollLeft > 0)).toBe(true)
  await expect(dialog.getByRole('heading', { name: 'CTR', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Ajustar imagem à tela' }).click()
  await expect.poll(async () => Math.abs((await expanded.boundingBox()).width - fittedWidth) < 2).toBe(true)
  if (process.env.METRIC_REFERENCE_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.METRIC_REFERENCE_SCREENSHOTS, 'referencias-celular.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await trigger.click()
  await thumbnails.first().click()
  if (process.env.METRIC_REFERENCE_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.METRIC_REFERENCE_SCREENSHOTS, 'referencias-desktop.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.goto(origin + '?mixed=1')
  await expect(page.getByText('O recorte mistura objetivos.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver todas as métricas' })).toHaveCount(0)
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(dialog).toBeVisible()
  assert.deepEqual(errors, [])
  console.log('PASS: sete miniaturas, ampliação, resolução original, desktop, celular, teclado, métricas e objetivos mistos verificados.')
} finally {
  await browser?.close()
  await new Promise((resolveClose, rejectClose) => server.httpServer.close(error => error ? rejectClose(error) : resolveClose()))
}
