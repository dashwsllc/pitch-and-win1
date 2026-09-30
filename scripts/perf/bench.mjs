// Runtime benchmark for the dashboard against a fake Supabase backend.
// node bench.mjs --dist <dir> --label <name> [--runs 3] [--cpu 1] [--out file.json] [--scenarios boot,idle,scroll,filter,storm,nav]
import fs from 'node:fs'
import { chromium } from './pw.mjs'
import { startServer } from './server.mjs'
import { buildFixtures, installMock, fakeSession, STORAGE_KEY } from './mock.mjs'

const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
  return acc
}, []))
const DIST = argv.dist
const LABEL = argv.label ?? 'run'
const RUNS = Number(argv.runs ?? 3)
const CPU = Number(argv.cpu ?? 1)
const SCENARIOS = (argv.scenarios ?? 'boot,idle,scroll,filter,storm,nav').split(',')
const ROLE = argv.role ?? 'super_admin'
// Static-asset network profile (mock backend latency is simulated separately, ~70ms).
const NET_PROFILES = {
  none: {},
  cable: { latency: 30, down: 6 * 1024 * 1024, up: 1024 * 1024 },
  fast4g: { latency: 80, down: 1.4 * 1024 * 1024, up: 0.7 * 1024 * 1024 },
  slow4g: { latency: 150, down: 0.2 * 1024 * 1024, up: 0.1 * 1024 * 1024 },
}
const NET = NET_PROFILES[argv.net ?? 'cable']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const INIT_OBSERVERS = `
window.__perf = { longtasks: [], loaf: [], lcp: null, cls: 0, events: [], errors: [] };
const obs = (type, fn, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }) } catch (e) {} };
obs('longtask', (e) => __perf.longtasks.push({ start: e.startTime, dur: e.duration }));
obs('long-animation-frame', (e) => __perf.loaf.push({ start: e.startTime, dur: e.duration, block: e.blockingDuration, scripts: (e.scripts || []).map((s) => ({ src: String(s.sourceURL).split('/').pop(), fn: s.sourceFunctionName, dur: Math.round(s.duration), inv: s.invokerType })) }));
obs('largest-contentful-paint', (e) => { __perf.lcp = e.startTime });
obs('layout-shift', (e) => { if (!e.hadRecentInput) __perf.cls += e.value });
obs('event', (e) => __perf.events.push({ name: e.name, dur: e.duration, start: e.startTime }), { durationThreshold: 16 });
`

const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null }
const pct = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null }
const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d)

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}
const diffMetrics = (a, b) => ({
  taskMs: round((b.TaskDuration - a.TaskDuration) * 1000),
  scriptMs: round((b.ScriptDuration - a.ScriptDuration) * 1000),
  layoutMs: round((b.LayoutDuration - a.LayoutDuration) * 1000),
  styleMs: round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
  layouts: b.LayoutCount - a.LayoutCount,
  styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
})

function groupRequests(list) {
  const g = {}
  for (const r of list) { const k = `${r.method} ${r.kind ?? 'x'}:${r.name ?? r.path}`; g[k] = (g[k] ?? 0) + 1 }
  return g
}

async function waitQuiet(mock, quietMs = 700, maxMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const last = mock.stats.requests.at(-1)?.t ?? 0
    if (Date.now() - last > quietMs) return
    await sleep(100)
  }
}

async function frameProbe(page, fn) {
  await page.evaluate(() => {
    window.__frames = []; window.__frameRun = true
    let last = performance.now()
    const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frameRun) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await fn()
  const frames = await page.evaluate(() => { window.__frameRun = false; return window.__frames.slice(1) })
  return {
    frames: frames.length,
    p50: round(pct(frames, 0.5)), p95: round(pct(frames, 0.95)), p99: round(pct(frames, 0.99)), max: round(Math.max(0, ...frames)),
    over20: frames.filter((f) => f > 20).length, over33: frames.filter((f) => f > 33).length, over50: frames.filter((f) => f > 50).length,
  }
}

async function run(baseUrl, runIndex) {
  const browser = await chromium.launch({ headless: argv.headed !== 'true' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const fixtures = buildFixtures({ role: ROLE })
  const mock = installMock(context, fixtures, { latencyMs: Number(argv['api-latency'] ?? 70) })
  await context.addInitScript(({ key, session }) => { try { sessionStorage.setItem(key, JSON.stringify(session)) } catch (e) { /* ignore */ } }, { key: STORAGE_KEY, session: fakeSession() })
  await context.addInitScript(INIT_OBSERVERS)
  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`) })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable'); await cdp.send('Performance.enable')
  if (NET.latency !== undefined) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET.latency, downloadThroughput: NET.down, uploadThroughput: NET.up })
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

  let transferred = 0, staticRequests = 0
  cdp.on('Network.loadingFinished', (e) => { transferred += e.encodedDataLength ?? 0 })
  const staticLog = []
  page.on('request', (r) => { if (r.url().startsWith(baseUrl)) { staticRequests += 1; staticLog.push({ t: Date.now(), what: new URL(r.url()).pathname.split('/').pop() }) } })

  const out = { run: runIndex, consoleErrors }
  const T0 = Date.now()
  await page.goto(baseUrl + '/', { waitUntil: 'commit' })
  await page.waitForSelector('section[aria-label="Últimas dez vendas aprovadas"] article', { timeout: 45000 })
  const readyMs = Date.now() - T0
  if (argv.css) await page.addStyleTag({ content: fs.readFileSync(argv.css, 'utf8') })

  if (SCENARIOS.includes('boot')) {
    await sleep(6000) // let the post-subscribe refresh waves land
    await waitQuiet(mock)
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0]
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp?.startTime ?? null, lcp: window.__perf.lcp, cls: window.__perf.cls }
    })
    const m = await cdpMetrics(cdp)
    const reqs = mock.stats.requests
    const at = (from, to) => reqs.filter((r) => r.t - T0 >= from && r.t - T0 < to)
    const lt = await page.evaluate(() => window.__perf.longtasks)
    out.boot = {
      readyMs, ...Object.fromEntries(Object.entries(nav).map(([k, v]) => [k, round(v)])),
      cls: round(nav.cls, 4), transferKB: round(transferred / 1024), staticRequests, backendRequests: reqs.length,
      wave0_readyWindow: at(0, readyMs).length, wave1_ready_to_ready2s: at(readyMs, readyMs + 2000).length, wave2_2to6s: at(readyMs + 2000, readyMs + 6000).length, wave3_6s_plus: at(readyMs + 6000, 1e12).length,
      longTasks: lt.length, tbtMs: round(lt.reduce((s, t) => s + Math.max(0, t.dur - 50), 0)),
      jsHeapMB: round(m.JSHeapUsedSize / 1048576), domNodes: m.Nodes, listeners: m.JSEventListeners,
      requestsByEndpoint: groupRequests(reqs),
      wsMessages: mock.stats.ws.messages.length,
    }
  }

  if (SCENARIOS.includes('idle')) {
    await waitQuiet(mock)
    const a = await cdpMetrics(cdp)
    const mut = await page.evaluate(() => {
      window.__mut = { batches: 0, records: 0 }
      new MutationObserver((rs) => { window.__mut.batches += 1; window.__mut.records += rs.length }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
      window.__perf.longtasks.length = 0; window.__perf.loaf.length = 0
    })
    const before = mock.stats.requests.length
    await sleep(10000)
    const b = await cdpMetrics(cdp)
    const d = await page.evaluate(() => ({ mut: window.__mut, lt: window.__perf.longtasks.length, loaf: window.__perf.loaf.length, loafTop: window.__perf.loaf.slice(0, 3) }))
    out.idle = { seconds: 10, ...diffMetrics(a, b), mutationBatches: d.mut.batches, mutationRecords: d.mut.records, longTasks: d.lt, loaf: d.loaf, loafTop: d.loafTop, backendRequests: mock.stats.requests.length - before }
  }

  if (SCENARIOS.includes('scroll')) {
    await page.mouse.move(900, 420)
    const total = await page.evaluate(() => { window.__maxScroll = 0; addEventListener('scroll', () => { window.__maxScroll = Math.max(window.__maxScroll, document.scrollingElement.scrollTop) }, { passive: true }); return document.scrollingElement.scrollHeight - innerHeight })
    const a = await cdpMetrics(cdp)
    const stats = await frameProbe(page, async () => {
      for (let i = 0; i < 90; i++) { await page.mouse.wheel(0, 90); await sleep(16) }
      await sleep(1500)
      for (let i = 0; i < 90; i++) { await page.mouse.wheel(0, -90); await sleep(16) }
      await sleep(1500)
    })
    const b = await cdpMetrics(cdp)
    const scrolled = await page.evaluate(() => window.__maxScroll)
    out.scroll = { pageHeightPx: total, maxScrollTop: round(scrolled), ...stats, ...diffMetrics(a, b) }
  }

  if (SCENARIOS.includes('filter')) {
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(500)
    const tabs = page.locator('[role="tab"]')
    const count = await tabs.count()
    const timings = []
    for (let i = 0; i < Math.min(count, 4); i++) {
      const before = mock.stats.requests.length
      const t = Date.now()
      await tabs.nth(i).click().catch(() => {})
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      const clickToPaint = Date.now() - t
      await waitQuiet(mock, 400, 8000)
      timings.push({ tab: i, clickToPaintMs: clickToPaint, settleMs: Date.now() - t, requests: mock.stats.requests.length - before })
    }
    const ev = await page.evaluate(() => window.__perf.events.filter((e) => e.name === 'click' || e.name === 'pointerup').map((e) => Math.round(e.dur)))
    out.filter = { tabs: count, timings, worstEventMs: Math.max(0, ...ev) }
  }

  if (SCENARIOS.includes('storm')) {
    await waitQuiet(mock)
    const events = 5
    const a = await cdpMetrics(cdp)
    const before = mock.stats.requests.length
    const delivered = []
    for (let i = 0; i < events; i++) { delivered.push(mock.bumpRevision('sales')); await sleep(3000); await waitQuiet(mock, 500, 6000) }
    const b = await cdpMetrics(cdp)
    const list = mock.stats.requests.slice(before)
    out.storm = { events, delivered: delivered.reduce((s, n) => s + n, 0), totalRequests: list.length, requestsPerEvent: round(list.length / events), ...diffMetrics(a, b), byEndpoint: groupRequests(list) }
  }

  if (SCENARIOS.includes('nav')) {
    // Client-side navigation (no reload), same as clicking a sidebar link. Pass 1 = cold chunks, pass 2 = warm.
    const routes = [
      ['/ranking', 'main h1:has-text("Ranking de")'], ['/arena', 'main.arena-shell h1'], ['/metas', 'main h1:has-text("Metas")'],
      ['/crm', 'main h1:has-text("CRM")'], ['/leads', 'main h1'], ['/trafego', 'main h1:has-text("Tráfego")'],
      ['/', 'section[aria-label="Últimas dez vendas aprovadas"] article'],
    ]
    const rows = []
    await page.evaluate(() => window.scrollTo(0, 0))
    for (const pass of [1, 2]) {
      for (const [path, selector] of routes) {
        await waitQuiet(mock, 400, 8000)
        await page.evaluate(() => { window.__perf.longtasks.length = 0 })
        const before = mock.stats.requests.length
        const t = Date.now()
        await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate', { state: {} })) }, path)
        await page.waitForSelector(selector, { timeout: 30000 }).catch(() => {})
        const readyMs = Date.now() - t
        await sleep(400)
        const lt = await page.evaluate(() => window.__perf.longtasks.map((x) => x.dur))
        rows.push({ title: path + '#' + pass, readyMs, requests: mock.stats.requests.length - before, longTasks: lt.length, tbtMs: round(lt.reduce((s, d) => s + Math.max(0, d - 50), 0)) })
      }
    }
    out.nav = rows
  }

  if (argv.timeline) {
    const evs = [
      ...mock.stats.requests.map((r) => ({ t: r.t - T0, what: `${r.method} ${r.kind ?? ''}:${r.name ?? r.path}` })),
      ...mock.stats.ws.messages.map((m) => ({ t: m.t - T0, what: `WS ${m.event} ${m.topic}` })),
      ...staticLog.map((r) => ({ t: r.t - T0, what: `JS/CSS ${r.what}` })),
    ].sort((a, b) => a.t - b.t)
    fs.writeFileSync(argv.timeline, evs.map((e) => `${String(e.t).padStart(6)}ms  ${e.what}`).join('\n'))
  }

  out.unmockedEndpoints = [...new Set(mock.stats.requests.filter((r) => r.unmocked).map((r) => `${r.kind}:${r.name}`))]
  await browser.close()
  return out
}

const { server, url } = await startServer(DIST)
const results = []
for (let i = 0; i < RUNS; i++) {
  process.stderr.write(`[${LABEL}] run ${i + 1}/${RUNS} cpu=${CPU}x ...\n`)
  try { results.push(await run(url, i)) } catch (e) { console.error('RUN FAILED', e.message); results.push({ run: i, failed: String(e.message).split('\n')[0] }) }
}
server.close()

// Aggregate numeric leaves by median.
function agg(objs) {
  const ok = objs.filter((o) => o && typeof o === 'object')
  if (!ok.length) return null
  const keys = new Set(ok.flatMap((o) => Object.keys(o)))
  const res = {}
  for (const k of keys) {
    const vals = ok.map((o) => o[k]).filter((v) => v !== undefined)
    if (vals.every((v) => typeof v === 'number' || v == null)) res[k] = round(median(vals), 2)
    else if (vals.every((v) => Array.isArray(v))) res[k] = vals[Math.floor(vals.length / 2)]
    else if (vals.every((v) => v && typeof v === 'object')) res[k] = agg(vals)
    else res[k] = vals[0]
  }
  return res
}
const good = results.filter((r) => !r.failed)
const summary = { label: LABEL, dist: DIST, cpu: CPU, runs: results.length, ok: good.length }
for (const s of ['boot', 'idle', 'scroll', 'filter', 'storm']) if (good.some((r) => r[s])) summary[s] = agg(good.map((r) => r[s]))
if (good.some((r) => r.nav)) summary.nav = good[0].nav.map((row, i) => agg(good.map((r) => r.nav[i])))
summary.consoleErrors = [...new Set(good.flatMap((r) => r.consoleErrors))].slice(0, 15)
summary.unmockedEndpoints = [...new Set(good.flatMap((r) => r.unmockedEndpoints ?? []))]
if (argv.out) fs.writeFileSync(argv.out, JSON.stringify({ summary, results }, null, 2))
console.log(JSON.stringify(summary, null, 2))
