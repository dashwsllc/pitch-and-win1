// Deterministic snapshots of every main screen (text + screenshot) for before/after comparison.
// node snap.mjs --dist <dir built with the fake bench env> --out <dir> [--role super_admin|closer]
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './pw.mjs'
import { startServer } from './server.mjs'
import { buildFixtures, installMock, fakeSession, STORAGE_KEY } from './mock.mjs'

const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
  return acc
}, []))
const OUT = path.resolve(argv.out)
fs.mkdirSync(OUT, { recursive: true })
const ROLE = argv.role ?? 'super_admin'
const FIXED = new Date('2026-09-29T18:00:00Z') // 15:00 in Brasília, a Tuesday
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROUTES = [
  '/', '/ranking', '/arena', '/metas', '/metas?tab=atribuicoes', '/crm', '/crm?tab=sdr', '/crm?tab=closer', '/crm?tab=results', '/leads', '/trafego', '/perfil', '/configuracoes',
  '/saques', '/vendas', '/minhas-vendas', '/abordagens', '/executive', '/assinaturas',
]

const { server, url } = await startServer(path.resolve(argv.dist))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce',
})
installMock(context, buildFixtures({ role: ROLE, now: FIXED }), { latencyMs: 20 })
await context.addInitScript(({ key, session }) => { try { sessionStorage.setItem(key, JSON.stringify(session)) } catch (e) { /* ignore */ } }, { key: STORAGE_KEY, session: fakeSession(FIXED.getTime()) })
const page = await context.newPage()
await page.clock.setFixedTime(FIXED)
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`) })

const slug = (route) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[/?=&]/g, '_'))
const summary = {}
for (const route of ROUTES) {
  const name = slug(route)
  try {
    await page.goto(url + route, { waitUntil: 'load' })
    await page.waitForSelector('main, #root > div', { timeout: 20000 }).catch(() => {})
    await sleep(2600) // queries + Recharts' entry animation settle
    const text = (await page.evaluate(() => document.body.innerText)).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
    fs.writeFileSync(path.join(OUT, `${name}.txt`), text)
    await page.screenshot({ path: path.join(OUT, `${name}.png`) })
    if (route === '/') {
      for (const y of [700, 1500, 99999]) {
        await page.evaluate((top) => window.scrollTo(0, top), y)
        await sleep(600)
        await page.screenshot({ path: path.join(OUT, `${name}-scroll${y === 99999 ? 'end' : y}.png`) })
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      // Interaction snapshot: change the period filter and let the metrics reload.
      const tab = page.locator('[role="radio"], [role="tab"]').nth(2)
      await tab.click()
      await sleep(1800)
      fs.writeFileSync(path.join(OUT, `${name}-7dias.txt`), (await page.evaluate(() => document.body.innerText)).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim())
      await page.screenshot({ path: path.join(OUT, `${name}-7dias.png`) })
    }
    summary[name] = { chars: text.length }
  } catch (e) {
    summary[name] = { error: String(e.message).split('\n')[0] }
  }
}
fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify({ summary, errors: [...new Set(errors)] }, null, 2))
console.log(JSON.stringify({ routes: Object.keys(summary).length, failed: Object.entries(summary).filter(([, v]) => v.error).map(([k, v]) => `${k}: ${v.error}`), errors: [...new Set(errors)].slice(0, 8) }, null, 2))
await browser.close()
server.close()
