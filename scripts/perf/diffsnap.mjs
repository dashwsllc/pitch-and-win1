// node diffsnap.mjs <beforeDir> <afterDir>   -> text equality + pixel diff per screen
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './pw.mjs'

const [beforeDir, afterDir] = process.argv.slice(2).map((p) => path.resolve(p))
const names = [...new Set(fs.readdirSync(beforeDir).filter((f) => /\.(txt|png)$/.test(f)).map((f) => f.replace(/\.(txt|png)$/, '')))].sort()

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('about:blank')

async function pixelDiff(fileA, fileB) {
  const a = 'data:image/png;base64,' + fs.readFileSync(fileA).toString('base64')
  const b = 'data:image/png;base64,' + fs.readFileSync(fileB).toString('base64')
  return page.evaluate(async ([x, y]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
    const [ia, ib] = await Promise.all([load(x), load(y)])
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] }
    const draw = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data }
    const da = draw(ia), db = draw(ib)
    let diff = 0, strong = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1
    for (let p = 0; p < da.length; p += 4) {
      const d = Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2]))
      if (d > 2) {
        diff++
        if (d > 24) strong++
        const px = (p / 4) % ia.width, py = Math.floor(p / 4 / ia.width)
        if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py
      }
    }
    return { pct: (diff / (da.length / 4)) * 100, strongPct: (strong / (da.length / 4)) * 100, box: diff ? [minX, minY, maxX, maxY] : null }
  }, [a, b])
}

let textDiffs = 0, visualFlags = 0
for (const name of names) {
  const line = [name.padEnd(28)]
  const ta = path.join(beforeDir, name + '.txt'), tb = path.join(afterDir, name + '.txt')
  if (fs.existsSync(ta) && fs.existsSync(tb)) {
    const A = fs.readFileSync(ta, 'utf8').split('\n'), B = fs.readFileSync(tb, 'utf8').split('\n')
    const same = A.length === B.length && A.every((l, i) => l === B[i])
    if (same) line.push('text=IDENTICAL')
    else {
      textDiffs++
      const removed = A.filter((l) => !B.includes(l)).slice(0, 4), added = B.filter((l) => !A.includes(l)).slice(0, 4)
      line.push(`text=DIFFERENT (-${A.filter((l) => !B.includes(l)).length}/+${B.filter((l) => !A.includes(l)).length})`)
      if (removed.length || added.length) line.push(`\n      - ${removed.join(' | ').slice(0, 220)}\n      + ${added.join(' | ').slice(0, 220)}`)
    }
  }
  const pa = path.join(beforeDir, name + '.png'), pb = path.join(afterDir, name + '.png')
  if (fs.existsSync(pa) && fs.existsSync(pb)) {
    const r = await pixelDiff(pa, pb)
    if (r.sizeMismatch) { visualFlags++; line.push(`pixels=SIZE ${r.sizeMismatch}`) }
    else {
      const flag = r.strongPct > 0.5 ? ' <== CHECK' : ''
      if (flag) visualFlags++
      line.push(`pixels: ${r.pct.toFixed(2)}% differ, ${r.strongPct.toFixed(2)}% strongly${r.box ? ` box=${r.box.join(',')}` : ''}${flag}`)
    }
  }
  console.log(line.join('  '))
}
console.log(`\nscreens: ${names.length} | text diffs: ${textDiffs} | visual flags: ${visualFlags}`)
await browser.close()
