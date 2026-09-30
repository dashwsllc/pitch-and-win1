// node compare.mjs before.json after.json [label]
import fs from 'node:fs'

const [beforeFile, afterFile, title = ''] = process.argv.slice(2)
const b = JSON.parse(fs.readFileSync(beforeFile, 'utf8')).summary
const a = JSON.parse(fs.readFileSync(afterFile, 'utf8')).summary

const fmt = (n) => (n == null ? '   n/a' : Number.isInteger(n) ? String(n) : n.toFixed(1))
function row(label, path, { lowerIsBetter = true, unit = '' } = {}) {
  const get = (s) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), s)
  const x = get(b), y = get(a)
  if (x == null && y == null) return
  const delta = x != null && y != null && x !== 0 ? ((y - x) / Math.abs(x)) * 100 : null
  const good = delta == null ? '' : (lowerIsBetter ? delta < -3 : delta > 3) ? ' OK' : (lowerIsBetter ? delta > 3 : delta < -3) ? ' WORSE' : ''
  console.log(`${label.padEnd(34)} ${fmt(x).padStart(9)}${unit} -> ${fmt(y).padStart(9)}${unit}   ${delta == null ? '' : (delta > 0 ? '+' : '') + delta.toFixed(0) + '%'}${good}`)
}

console.log(`\n=== ${title} ===`)
console.log('-- BOOT --')
row('ready (dashboard usable)', 'boot.readyMs', { unit: 'ms' })
row('LCP', 'boot.lcp', { unit: 'ms' })
row('TBT (long-task blocking)', 'boot.tbtMs', { unit: 'ms' })
row('long tasks', 'boot.longTasks')
row('static requests', 'boot.staticRequests')
row('transferred', 'boot.transferKB', { unit: 'KB' })
row('backend requests (boot+6s)', 'boot.backendRequests')
row('JS heap', 'boot.jsHeapMB', { unit: 'MB' })
console.log('-- IDLE 10s (nothing happening) --')
row('main-thread task time', 'idle.taskMs', { unit: 'ms' })
row('script time', 'idle.scriptMs', { unit: 'ms' })
row('style recalcs', 'idle.styleRecalcs')
row('long tasks', 'idle.longTasks')
row('long animation frames', 'idle.loaf')
row('DOM mutation batches', 'idle.mutationBatches')
console.log('-- SCROLL --')
row('frames > 20ms', 'scroll.over20')
row('frames > 50ms', 'scroll.over50')
row('p95 frame', 'scroll.p95', { unit: 'ms' })
row('p99 frame', 'scroll.p99', { unit: 'ms' })
row('max frame', 'scroll.max', { unit: 'ms' })
row('script time', 'scroll.scriptMs', { unit: 'ms' })
row('style recalcs', 'scroll.styleRecalcs')
console.log('-- FILTER CLICK --')
for (let i = 1; i < 4; i++) row(`tab ${i} click->paint`, `filter.timings.${i}.clickToPaintMs`, { unit: 'ms' })
row('worst event duration', 'filter.worstEventMs', { unit: 'ms' })
console.log('-- REALTIME STORM (5 events) --')
row('requests per event', 'storm.requestsPerEvent')
row('total requests', 'storm.totalRequests')
row('main-thread task time', 'storm.taskMs', { unit: 'ms' })
row('script time', 'storm.scriptMs', { unit: 'ms' })
console.log('-- ROUTE NAVIGATION (#1 = first visit, #2 = warm) --')
if (b.nav && a.nav) b.nav.forEach((row0, i) => {
  const r1 = a.nav[i]
  console.log(`${String(row0.title).padEnd(14)} ready ${fmt(row0.readyMs).padStart(6)}ms ${fmt(row0.requests)}req tbt ${fmt(row0.tbtMs)} -> ready ${fmt(r1?.readyMs).padStart(6)}ms ${fmt(r1?.requests)}req tbt ${fmt(r1?.tbtMs)}`)
})
if (a.consoleErrors?.length) console.log('\nCONSOLE ERRORS (after):', a.consoleErrors)
