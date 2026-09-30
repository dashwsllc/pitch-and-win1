// Main-thread self time by trace event while the dashboard just sits open.
// node trace-idle.mjs --dist <dir> [--route /arena --ready 'main.arena-shell article'] [--css file] [--init file.js] [--seconds 10] [--cpu 1] [--runs 3] [--label x] [--anims]
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './pw.mjs'
import { startServer } from './server.mjs'
import { buildFixtures, installMock, fakeSession, STORAGE_KEY } from './mock.mjs'

const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
  return acc
}, []))
const RUNS = Number(argv.runs ?? 3)
const SECONDS = Number(argv.seconds ?? 10)
const ROUTE = argv.route ?? '/'
const READY = argv.ready ?? 'section[aria-label="Últimas dez vendas aprovadas"] article'
const CPU = Number(argv.cpu ?? 1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }

function selfTimes(events, threadKey) {
  const list = events.filter((e) => e.ph === 'X' && e.dur >= 0 && `${e.pid}:${e.tid}` === threadKey).sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const self = new Map()
  const stack = []
  for (const e of list) {
    while (stack.length && stack.at(-1).end <= e.ts) stack.pop()
    const node = { name: e.name, end: e.ts + e.dur, child: 0, dur: e.dur }
    if (stack.length) stack.at(-1).child += e.dur
    stack.push(node)
    node.finish = () => self.set(node.name, (self.get(node.name) ?? 0) + Math.max(0, node.dur - node.child) / 1000)
    ;(stack.done ??= []).push(node)
  }
  for (const n of stack.done ?? []) n.finish()
  return self
}

const { server, url } = await startServer(path.resolve(argv.dist))
const all = []
for (let run = 0; run < RUNS; run++) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  installMock(context, buildFixtures({}), { latencyMs: 30 })
  await context.addInitScript(({ key, session }) => { try { sessionStorage.setItem(key, JSON.stringify(session)) } catch (e) { /* ignore */ } }, { key: STORAGE_KEY, session: fakeSession() })
  if (argv.init) await context.addInitScript(fs.readFileSync(argv.init, 'utf8'))
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  await page.goto(url + ROUTE, { waitUntil: 'commit' })
  await page.waitForSelector(READY, { timeout: 60000 })
  if (argv.css) await page.addStyleTag({ content: fs.readFileSync(argv.css, 'utf8') })
  await sleep(6000)
  if (argv.anims && run === 0) {
    const anims = await page.evaluate(() => document.getAnimations().map((a) => ({ type: a.constructor.name, name: a.animationName || a.transitionProperty || '', target: (a.effect?.target?.className?.toString?.() ?? '').slice(0, 60), state: a.playState })))
    console.log('running animations:', JSON.stringify(anims))
  }
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink'] })
  await sleep(SECONDS * 1000)
  const buffer = await browser.stopTracing()
  await browser.close()
  const trace = JSON.parse(buffer.toString('utf8'))
  const events = Array.isArray(trace) ? trace : trace.traceEvents
  const names = new Map()
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name)
  const mainKeys = [...names].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k)
  // The page under test is the renderer with the most main-thread events.
  const counts = mainKeys.map((k) => [k, events.filter((e) => `${e.pid}:${e.tid}` === k).length]).sort((a, b) => b[1] - a[1])
  const self = selfTimes(events, counts[0][0])
  const total = [...self.values()].reduce((s, v) => s + v, 0)
  all.push({ self, total })
}
server.close()
const keys = new Set(all.flatMap((r) => [...r.self.keys()]))
const rows = [...keys].map((k) => [k, median(all.map((r) => r.self.get(k) ?? 0))]).sort((a, b) => b[1] - a[1]).slice(0, 14)
console.log(`${(argv.label ?? 'idle').padEnd(10)} main-thread busy (excluding idle) over ${SECONDS}s, median of ${RUNS}: total=${Math.round(median(all.map((r) => r.total)))}ms`)
console.log(rows.map(([k, v]) => `   ${String(Math.round(v * 10) / 10).padStart(7)}ms  ${k}`).join('\n'))
