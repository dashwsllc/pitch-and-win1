// CPU profile of user flows with sourcemap attribution.
// node profile.mjs --dist <dir built with --sourcemap> --steps idle,filter,scroll,storm [--cpu 4] [--top 30]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, projectRoot } from './pw.mjs'
import { startServer } from './server.mjs'
import { buildFixtures, installMock, fakeSession, STORAGE_KEY } from './mock.mjs'

const require = createRequire(path.join(projectRoot, 'package.json'))
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping')

const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
  return acc
}, []))
const DIST = path.resolve(argv.dist)
const STEPS = (argv.steps ?? 'idle,filter,scroll,storm').split(',')
const CPU = Number(argv.cpu ?? 4)
const TOP = Number(argv.top ?? 30)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const maps = new Map()
function mapFor(url) {
  const file = decodeURIComponent(new URL(url).pathname)
  if (maps.has(file)) return maps.get(file)
  const mapPath = path.join(DIST, file + '.map')
  const tm = fs.existsSync(mapPath) ? new TraceMap(JSON.parse(fs.readFileSync(mapPath, 'utf8'))) : null
  maps.set(file, tm)
  return tm
}
function attribute(callFrame) {
  const { functionName, url, lineNumber, columnNumber } = callFrame
  if (!url || lineNumber < 0) return { key: `(${functionName || 'native'})`, group: '(native/idle)' }
  const tm = mapFor(url)
  if (tm) {
    const o = originalPositionFor(tm, { line: lineNumber + 1, column: columnNumber })
    if (o.source) {
      const src = o.source.replace(/^.*?node_modules\//, 'node_modules/').replace(/^(\.\.\/)+/, '')
      const pkg = src.startsWith('node_modules/') ? src.split('/').slice(0, src.split('/')[1]?.startsWith('@') ? 3 : 2).join('/') : null
      return { key: `${src}:${o.line} ${o.name || functionName || '(anon)'}`, group: pkg ?? (src.startsWith('src/') ? src.split('/').slice(0, 3).join('/') : src) }
    }
  }
  return { key: `${path.basename(url)}:${lineNumber + 1} ${functionName || '(anon)'}`, group: path.basename(url) }
}

const { server, url } = await startServer(DIST)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const mock = installMock(context, buildFixtures({}), { latencyMs: Number(argv['api-latency'] ?? 70) })
await context.addInitScript(({ key, session }) => { try { sessionStorage.setItem(key, JSON.stringify(session)) } catch (e) { /* ignore */ } }, { key: STORAGE_KEY, session: fakeSession() })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

await page.goto(url + '/', { waitUntil: 'commit' })
await page.waitForSelector('section[aria-label="Últimas dez vendas aprovadas"] article', { timeout: 60000 })
await sleep(5000)

await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
const t0 = Date.now()

for (const step of STEPS) {
  if (step === 'idle') await sleep(6000)
  if (step === 'filter') {
    const tabs = page.locator('[role="tab"]')
    for (const i of [1, 2, 3, 0]) { await tabs.nth(i).click().catch(() => {}); await sleep(1500) }
  }
  if (step === 'scroll') {
    await page.mouse.move(900, 420)
    for (let i = 0; i < 70; i++) { await page.mouse.wheel(0, 90); await sleep(16) }
    await sleep(1200)
    for (let i = 0; i < 70; i++) { await page.mouse.wheel(0, -90); await sleep(16) }
    await sleep(1200)
  }
  if (step === 'storm') { for (let i = 0; i < 2; i++) { mock.bumpRevision('sales'); await sleep(3500) } }
  if (step === 'boot') { await page.reload({ waitUntil: 'commit' }); await page.waitForSelector('section[aria-label="Últimas dez vendas aprovadas"] article', { timeout: 60000 }); await sleep(3000) }
}

const { profile } = await cdp.send('Profiler.stop')
const wall = Date.now() - t0
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const dt = profile.timeDeltas[i] / 1000
  const node = byId.get(profile.samples[i])
  const a = attribute(node.callFrame)
  const e = self.get(a.key) ?? { ms: 0, group: a.group }
  e.ms += dt
  self.set(a.key, e)
  total += dt
}
const groups = new Map()
for (const [, e] of self) groups.set(e.group, (groups.get(e.group) ?? 0) + e.ms)
const idle = groups.get('(native/idle)') ?? 0
console.log(`steps=${STEPS.join(',')} cpu=${CPU}x wall=${wall}ms sampled=${total.toFixed(0)}ms (idle/native ${idle.toFixed(0)}ms)`)
console.log('\n== self time by package/module group ==')
;[...groups].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([g, ms]) => console.log(`${ms.toFixed(0).padStart(7)} ms  ${g}`))
console.log(`\n== top ${TOP} self-time functions ==`)
;[...self].sort((a, b) => b[1].ms - a[1].ms).slice(0, TOP).forEach(([k, e]) => console.log(`${e.ms.toFixed(0).padStart(7)} ms  ${k.slice(0, 150)}`))
if (argv.out) fs.writeFileSync(argv.out, JSON.stringify(profile))

await browser.close()
server.close()
