// Static bundle meter: raw / gzip / brotli per asset + critical path per route.
// Usage: node measure-dist.mjs <distDir> [label]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const dist = path.resolve(process.argv[2])
const label = process.argv[3] ?? path.basename(dist)
const assetsDir = path.join(dist, 'assets')

const sizes = new Map()
function size(rel) {
  if (sizes.has(rel)) return sizes.get(rel)
  const buf = fs.readFileSync(path.join(dist, rel))
  const s = {
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  }
  sizes.set(rel, s)
  return s
}
const sum = (files) => files.reduce((a, f) => {
  const s = size(f)
  return { raw: a.raw + s.raw, gzip: a.gzip + s.gzip, brotli: a.brotli + s.brotli, n: a.n + 1 }
}, { raw: 0, gzip: 0, brotli: 0, n: 0 })
const kb = (n) => (n / 1024).toFixed(1).padStart(8) + ' KB'

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const entry = /<script[^>]+src="\/(assets\/[^"]+\.js)"/.exec(html)[1]
const htmlPreloads = [...html.matchAll(/<link rel="modulepreload"[^>]+href="\/(assets\/[^"]+)"/g)].map((m) => m[1])
const htmlCss = [...html.matchAll(/<link rel="stylesheet"[^>]+href="\/(assets\/[^"]+)"/g)].map((m) => m[1])

// Static import closure of a chunk (dynamic imports excluded).
const staticDeps = new Map()
function deps(rel) {
  if (staticDeps.has(rel)) return staticDeps.get(rel)
  const code = fs.readFileSync(path.join(dist, rel), 'utf8')
  const found = new Set()
  for (const m of code.matchAll(/(?:from|import)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)) found.add('assets/' + m[1])
  staticDeps.set(rel, [...found])
  return [...found]
}
function closure(rel, seen = new Set()) {
  if (seen.has(rel)) return seen
  seen.add(rel)
  for (const d of deps(rel)) closure(d, seen)
  return seen
}

// Lazy route map from the Vite preload table in the entry chunk.
const entryCode = fs.readFileSync(path.join(dist, entry), 'utf8')
const table = JSON.parse(/m\.f\|\|\(m\.f=(\[[^\]]*\])\)/.exec(entryCode)[1])
const lazy = {}
for (const m of entryCode.matchAll(/import\(["'`]\.\/([^"'`]+\.js)["'`]\)\s*,\s*__vite__mapDeps\(\[([\d,\s]+)\]\)/g)) {
  lazy['assets/' + m[1]] = m[2].split(',').map((i) => table[Number(i.trim())])
}

const baseJs = [...closure(entry)]
const base = new Set([entry, ...htmlPreloads, ...baseJs])
const baseCss = htmlCss

function route(name) {
  const file = Object.keys(lazy).find((f) => path.basename(f).startsWith(name + '-'))
  if (!file) return null
  const all = new Set(base)
  const cssSet = new Set(baseCss)
  for (const d of lazy[file]) (d.endsWith('.css') ? cssSet : all).add(d)
  for (const d of closure(file)) all.add(d)
  const js = [...all]
  return { file, js: sum(js), css: sum([...cssSet]), jsList: js, cssList: [...cssSet] }
}

const report = { label, generatedAt: new Date().toISOString(), assets: {}, initial: null, routes: {} }
const allFiles = fs.readdirSync(assetsDir).filter((f) => /.(js|css)$/.test(f)).map((f) => 'assets/' + f)
for (const f of allFiles) report.assets[f] = size(f)
const total = sum(allFiles)
report.total = total
report.initial = { js: sum([...base]), css: sum(baseCss), files: [...base] }

console.log(`\n=== ${label} ===`)
console.log(`assets: ${allFiles.length} files | total raw ${kb(total.raw)} | gzip ${kb(total.gzip)} | brotli ${kb(total.brotli)}`)
console.log(`entry: ${entry}`)
const ini = report.initial
console.log(`index.html eager JS (entry + static closure): ${ini.js.n} files | raw ${kb(ini.js.raw)} | gzip ${kb(ini.js.gzip)} | brotli ${kb(ini.js.brotli)}`)
console.log(`index.html CSS: ${ini.css.n} file | raw ${kb(ini.css.raw)} | gzip ${kb(ini.css.gzip)} | brotli ${kb(ini.css.brotli)}`)

for (const name of ['Auth', 'Index', 'Arena', 'CRM', 'Ranking', 'Metas', 'Trafego', 'Leads', 'ExecutiveDashboard', 'RegistrarVenda', 'Saques']) {
  const r = route(name)
  if (!r) continue
  report.routes[name] = { js: r.js, css: r.css, jsFiles: r.jsList, cssFiles: r.cssList }
  console.log(`route ${name.padEnd(18)} JS ${String(r.js.n).padStart(3)} files raw ${kb(r.js.raw)} gzip ${kb(r.js.gzip)} br ${kb(r.js.brotli)} | CSS raw ${kb(r.css.raw)} gzip ${kb(r.css.gzip)}`)
}

console.log('\nTop 25 chunks by raw size:')
Object.entries(report.assets).sort((a, b) => b[1].raw - a[1].raw).slice(0, 25).forEach(([f, s]) => {
  console.log(`${kb(s.raw)} raw ${kb(s.gzip)} gzip ${kb(s.brotli)} br  ${f}`)
})

const out = process.argv[4]
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2))
