// Semantics of the realtime/poll synchronization, measured as request "waves" against the fake backend.
// node sync-tests.mjs --dist <dir> [--label x]
import path from 'node:path'
import { chromium } from './pw.mjs'
import { startServer } from './server.mjs'
import { buildFixtures, installMock, fakeSession, STORAGE_KEY } from './mock.mjs'

const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
  return acc
}, []))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { server, url } = await startServer(path.resolve(argv.dist))
const browser = await chromium.launch({ headless: true })

const results = []
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`) }
// A "wave" is many page queries refetched together; the cursor poll alone is 1 small request.
const waveRequests = (reqs) => reqs.filter((r) => !(r.kind === 'rest' && r.name === 'dashboard_events') && r.name !== 'arena_live_cursor' && r.name !== 'get_my_registration_status')

async function open({ ws = 'normal', wsJoinDelayMs = 0, latencyMs = 40 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  // Lets a test flip the tab between visible and hidden (headless never reports hidden on its own).
  await context.addInitScript(() => {
    window.__hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') })
  })
  const mock = installMock(context, buildFixtures({}), { latencyMs, ws, wsJoinDelayMs })
  await context.addInitScript(({ key, session }) => { try { sessionStorage.setItem(key, JSON.stringify(session)) } catch (e) { /* ignore */ } }, { key: STORAGE_KEY, session: fakeSession() })
  const page = await context.newPage()
  const t0 = Date.now()
  await page.goto(url + '/', { waitUntil: 'commit' })
  await page.waitForSelector('section[aria-label="Últimas dez vendas aprovadas"] article', { timeout: 45000 })
  return { context, page, mock, t0 }
}
async function quiet(mock, ms = 1200, max = 15000) {
  const start = Date.now()
  while (Date.now() - start < max) { if (Date.now() - (mock.stats.requests.at(-1)?.t ?? 0) > ms) return; await sleep(100) }
}
const since = (mock, t) => mock.stats.requests.filter((r) => r.t >= t)

// T1 + T2: one realtime event -> exactly one wave, and the next poll does not repeat it.
{
  const { context, mock } = await open()
  await quiet(mock, 1500); await sleep(2500); await quiet(mock)
  const mark = Date.now()
  mock.bumpRevision('sales')
  await sleep(2500); await quiet(mock)
  const first = waveRequests(since(mock, mark))
  record('T1 realtime event refreshes the screens', first.length >= 10, `wave size after event = ${first.length} requests`)
  const mark2 = Date.now()
  await sleep(13000) // longer than the 10 s poll interval
  const second = waveRequests(since(mock, mark2))
  record('T2 the next revision poll does not repeat that refresh', second.length <= 2, `extra data requests during the following 13 s = ${second.length} (baseline design repeated the whole wave here)`)
  await context.close()
}

// T3: Realtime unavailable -> the poll must still notice a change and refresh.
{
  const { context, mock } = await open({ ws: 'closed' })
  await quiet(mock, 1500); await sleep(2000); await quiet(mock)
  const mark = Date.now()
  mock.touchRevision('sales') // committed in the database, but nothing is pushed to the browser
  await sleep(12500)
  const wave = waveRequests(since(mock, mark))
  record('T3 poll fallback refreshes when Realtime is down', wave.length >= 10, `wave size after a silent change = ${wave.length} requests within 12.5 s`)
  await context.close()
}

// T4: hidden tab does not refetch every screen unseen, and catches up as soon as it is visible.
{
  const { context, page, mock } = await open()
  await quiet(mock, 1500); await sleep(2000); await quiet(mock)
  const setHidden = (value) => page.evaluate((h) => { window.__hidden = h; document.dispatchEvent(new Event('visibilitychange')) }, value)
  await setHidden(true)
  const mark = Date.now()
  mock.bumpRevision('sales')
  await sleep(2500)
  const whileHidden = waveRequests(since(mock, mark))
  const mark2 = Date.now()
  await setHidden(false); await sleep(3000); await quiet(mock)
  const afterShow = waveRequests(since(mock, mark2))
  record('T4 hidden tab defers refresh, then catches up when shown', whileHidden.length <= 2 && afterShow.length >= 10, `while hidden = ${whileHidden.length} requests; after showing = ${afterShow.length} requests`)
  await context.close()
}

// T5: a change committed between the screens' first reads and the Realtime subscription must not be lost.
{
  const { context, mock } = await open({ wsJoinDelayMs: 3500 })
  // The Realtime join is held for 3.5 s and the page is already showing data: change the database in that gap without any push.
  const mark = Date.now()
  mock.touchRevision('sales')
  await sleep(9000); await quiet(mock)
  const wave = waveRequests(since(mock, mark))
  record('T5 a change during the subscription gap is picked up', wave.length >= 10, `refresh wave after the change = ${wave.length} requests`)
  await context.close()
}

// T6: with nothing changed there is no extra boot wave (each page query is fetched once).
{
  const { context, mock } = await open()
  await sleep(6000); await quiet(mock)
  const counts = {}
  for (const r of mock.stats.requests) { const k = `${r.kind}:${r.name}`; counts[k] = (counts[k] ?? 0) + 1 }
  const dupes = Object.entries(counts).filter(([k, v]) => v > 1 && !/profiles|user_roles|crm_can_schedule|daily_goal_tasks|get_sales_board|dashboard_events/.test(k))
  record('T6 boot does not fetch page data twice', dupes.length === 0, `total=${mock.stats.requests.length} requests; duplicated page queries: ${dupes.map(([k, v]) => `${k}x${v}`).join(', ') || 'none'}`)
  await context.close()
}

await browser.close()
server.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${argv.label ?? 'sync'}: ${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length ? 1 : 0
