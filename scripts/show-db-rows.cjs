// Lê a saída JSON da CLI do Supabase (rows) e imprime cada coluna de forma legível. Uso: node show-rows.cjs <arquivo> [coluna...]
const fs = require('fs')
const text = fs.readFileSync(process.argv[2], 'utf8')
const start = text.indexOf('{'), json = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1))
const first = json.rows[0], keys = Object.keys(first)
// uma coluna só com um objeto (ex.: "diag" do db-incident-diag.sql): mostra cada chave do objeto como seção
const row = keys.length === 1 && first[keys[0]] && typeof first[keys[0]] === 'object' && !Array.isArray(first[keys[0]]) ? first[keys[0]] : first
const only = process.argv.slice(3)
const pad = (v, n) => String(v ?? '').padEnd(n)
for (const [key, value] of Object.entries(row)) {
  if (only.length && !only.includes(key)) continue
  console.log('\n== ' + key)
  if (!Array.isArray(value)) { console.log(typeof value === 'object' ? JSON.stringify(value) : value); continue }
  if (!value.length) { console.log('(vazio)'); continue }
  const cols = Object.keys(value[0]), widths = cols.map(c => Math.min(70, Math.max(c.length, ...value.map(r => String(r[c] ?? '').length))))
  console.log(cols.map((c, i) => pad(c, widths[i])).join(' | '))
  for (const r of value) console.log(cols.map((c, i) => pad(r[c], widths[i]).slice(0, widths[i])).join(' | '))
}
