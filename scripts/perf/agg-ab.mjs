// node agg-ab.mjs <outdir> -> writes A.json / B.json (median summaries) for compare.mjs
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.argv[2])
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null }
const round = (n) => (n == null ? null : Math.round(n * 100) / 100)

function agg(objs) {
  const ok = objs.filter((o) => o && typeof o === 'object')
  if (!ok.length) return null
  const keys = new Set(ok.flatMap((o) => Object.keys(o)))
  const res = {}
  for (const k of keys) {
    const vals = ok.map((o) => o[k]).filter((v) => v !== undefined)
    if (vals.every((v) => typeof v === 'number' || v == null)) res[k] = round(median(vals))
    else if (vals.every((v) => Array.isArray(v))) res[k] = vals[Math.floor(vals.length / 2)]
    else if (vals.every((v) => v && typeof v === 'object')) res[k] = agg(vals)
    else res[k] = vals[0]
  }
  return res
}

for (const side of ['A', 'B']) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(side + '-') && f.endsWith('.json'))
  const results = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).results).filter((r) => !r.failed)
  const summary = { label: side, runs: results.length }
  for (const s of ['boot', 'idle', 'scroll', 'filter', 'storm']) if (results.some((r) => r[s])) summary[s] = agg(results.map((r) => r[s]))
  if (results.some((r) => r.nav)) summary.nav = results[0].nav.map((_, i) => agg(results.map((r) => r.nav[i])))
  summary.consoleErrors = [...new Set(results.flatMap((r) => r.consoleErrors ?? []))].slice(0, 10)
  // Spread of the noisiest headline metrics so a reader can judge significance.
  summary.spread = {
    bootReady: [Math.min(...results.map((r) => r.boot?.readyMs ?? Infinity)), Math.max(...results.map((r) => r.boot?.readyMs ?? -Infinity))],
    idleTask: [Math.min(...results.map((r) => r.idle?.taskMs ?? Infinity)), Math.max(...results.map((r) => r.idle?.taskMs ?? -Infinity))],
  }
  fs.writeFileSync(path.join(dir, side + '.json'), JSON.stringify({ summary }, null, 2))
  console.log(side, 'runs:', results.length, 'spread', JSON.stringify(summary.spread))
}
