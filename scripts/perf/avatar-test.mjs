// Runs the real src/lib/avatar.ts (transpiled) inside Chromium and checks optimizeAvatar end to end.
// node scripts/perf/avatar-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, projectRoot } from './pw.mjs'

const require = createRequire(path.join(projectRoot, 'package.json'))
const ts = require('typescript')
const source = fs.readFileSync(path.join(projectRoot, 'src', 'lib', 'avatar.ts'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('about:blank')

const report = await page.evaluate(async (url) => {
  const { optimizeAvatar } = await import(url)
  const out = {}
  const canvasFile = async (w, h, type, quality, paint) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); paint(g, w, h)
    const blob = await new Promise((r) => c.toBlob(r, type, quality))
    return new File([blob], 'x', { type })
  }
  const photoLike = (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#264653'); grad.addColorStop(0.5, '#e9c46a'); grad.addColorStop(1, '#e76f51')
    g.fillStyle = grad; g.fillRect(0, 0, w, h)
    for (let i = 0; i < 400; i++) { g.fillStyle = `hsla(${(i * 37) % 360},70%,55%,0.5)`; g.beginPath(); g.arc((i * 131) % w, (i * 89) % h, 10 + (i % 60), 0, 7); g.fill() }
  }
  const dims = async (file) => { const b = await createImageBitmap(file); const d = [b.width, b.height]; b.close(); return d }

  // 1. large photo-like JPEG -> small WebP, short side <= 256
  const big = await canvasFile(2000, 1500, 'image/jpeg', 0.95, photoLike)
  const r1 = await optimizeAvatar(big, 'jpg')
  out.large = { before: big.size, after: r1.file.size, type: r1.file.type, ext: r1.extension, dims: await dims(r1.file), converted: r1.file !== big }

  // 2. transparent PNG keeps its alpha (corner stays transparent)
  const alpha = await canvasFile(1400, 1400, 'image/png', 1, (g, w, h) => { photoLike(g, w, h); g.clearRect(0, 0, 300, 300) })
  const r2 = await optimizeAvatar(alpha, 'png')
  const bmp = await createImageBitmap(r2.file)
  const probe = document.createElement('canvas'); probe.width = bmp.width; probe.height = bmp.height
  const pg = probe.getContext('2d'); pg.drawImage(bmp, 0, 0)
  out.alpha = { ext: r2.extension, type: r2.file.type, cornerAlpha: pg.getImageData(2, 2, 1, 1).data[3], centerAlpha: pg.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data[3], before: alpha.size, after: r2.file.size }

  // 3. tiny file is returned untouched (same object, same extension)
  const tiny = await canvasFile(64, 64, 'image/png', 1, (g) => { g.fillStyle = '#f00'; g.fillRect(0, 0, 64, 64) })
  const r3 = await optimizeAvatar(tiny, 'png')
  out.tiny = { same: r3.file === tiny, ext: r3.extension, size: tiny.size }

  // 4. undecodable bytes above the size threshold fall back to the original
  const junk = new File([new Uint8Array(90 * 1024).map((_, i) => (i * 7) & 255)], 'junk.png', { type: 'image/png' })
  const r4 = await optimizeAvatar(junk, 'png')
  out.junk = { same: r4.file === junk, ext: r4.extension }

  // 5. small original that is already smaller than the re-encoded result keeps the original
  const flat = await canvasFile(300, 300, 'image/png', 1, (g) => { g.fillStyle = '#111'; g.fillRect(0, 0, 300, 300) })
  const r5 = await optimizeAvatar(flat, 'png')
  out.flat = { size: flat.size, sameOrSmaller: r5.file === flat || r5.file.size < flat.size }

  // 6. very wide panorama is bounded
  const pano = await canvasFile(6000, 400, 'image/jpeg', 0.95, photoLike)
  const r6 = await optimizeAvatar(pano, 'jpg')
  out.pano = { before: pano.size, after: r6.file.size, dims: await dims(r6.file) }
  return out
}, moduleUrl)
await browser.close()

const kb = (n) => (n / 1024).toFixed(1) + ' KB'
const checks = [
  ['large JPEG becomes WebP under 15% of its size', report.large.type === 'image/webp' && report.large.ext === 'webp' && report.large.after < report.large.before * 0.15, `${kb(report.large.before)} -> ${kb(report.large.after)} ${report.large.dims.join('x')}`],
  ['short side is at most 256 px', Math.min(...report.large.dims) <= 256, report.large.dims.join('x')],
  ['transparent PNG keeps transparency', report.alpha.cornerAlpha === 0 && report.alpha.centerAlpha > 200, `corner alpha ${report.alpha.cornerAlpha}, center alpha ${report.alpha.centerAlpha}; ${kb(report.alpha.before)} -> ${kb(report.alpha.after)}`],
  ['tiny file is returned untouched', report.tiny.same && report.tiny.ext === 'png', `${kb(report.tiny.size)}`],
  ['undecodable file falls back to the original', report.junk.same && report.junk.ext === 'png', ''],
  ['never returns a bigger file', report.flat.sameOrSmaller, `${kb(report.flat.size)}`],
  ['wide panorama is bounded', Math.max(...report.pano.dims) <= 1024 && report.pano.after < report.pano.before, `${kb(report.pano.before)} -> ${kb(report.pano.after)} ${report.pano.dims.join('x')}`],
]
let failed = 0
for (const [name, ok, detail] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failed++ }
console.log(`\navatar optimizer: ${checks.length - failed}/${checks.length} passed`)
process.exitCode = failed ? 1 : 0
