// Roda, um por um, os testes que protegem o banco e o navegador contra o que derrubou o dashboard em 22-23/10. Tudo local e descartavel: nenhum toca producao nem usa segredo.
//   node scripts/run-guards.mjs            roda todos e mostra o resumo (sai com codigo 1 se algum falhar)
//   node scripts/run-guards.mjs rls        roda so os que tem "rls" no nome
// Os de banco usam PGlite (Postgres em WASM) instalado em .verification.local/calendar-tools (fora do Git). Local: ver docs/RUNBOOK_BANCO_FORA_DO_AR.md. CI: .github/workflows/db-guards.yml.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const GUARDS = [
  ['verify-postgrest-no-retry-errcode-db.mjs', 'nenhum 40001 (o PostgREST 14 repete sem fim e prende o pool)'],
  ['verify-rls-initplan-db.mjs', 'politicas de acesso avaliadas uma vez por consulta'],
  ['verify-background-guards-db.mjs', 'jobs do pg_cron com guarda de pressao, teto de tempo e fora do :00'],
  ['verify-background-signals-db.mjs', 'o dashboard so recebe aviso quando algo muda; gatilho de aviso novo precisa de justificativa'],
  ['verify-background-idle-db.mjs', 'trabalho de fundo so quando ha trabalho'],
  ['verify-db-pressure-history-db.mjs', 'historico da pressao do banco'],
  ['verify-load-guards-ui.mjs', 'navegador: piso de 45 s, disjuntor, uma nova tentativa, releitura limitada'],
]
const pglite = resolve(root, '.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js')
if (!existsSync(pglite)) {
  console.error('PGlite nao instalado. Rode uma vez:\n  mkdir -p .verification.local/calendar-tools && npm install --prefix .verification.local/calendar-tools --no-package-lock --no-save @electric-sql/pglite@0.5.8')
  process.exit(2)
}
const filter = process.argv[2]
const selected = GUARDS.filter(([file]) => !filter || file.includes(filter))
if (!selected.length) { console.error(`Nenhum teste combina com "${filter}"`); process.exit(2) }
const results = []
for (const [file, what] of selected) {
  const started = Date.now()
  console.log(`\n=== ${file}  (${what})`)
  const r = spawnSync(process.execPath, [`scripts/${file}`], { cwd: root, stdio: 'inherit', env: process.env })
  results.push({ file, ok: r.status === 0, seconds: Math.round((Date.now() - started) / 1000) })
}
console.log('\n--- resumo')
for (const r of results) console.log(`${r.ok ? 'ok   ' : 'FALHA'} ${r.file} (${r.seconds}s)`)
const failed = results.filter(r => !r.ok)
console.log(failed.length ? `\n${failed.length} de ${results.length} falharam` : `\n${results.length}/${results.length} ok`)
process.exit(failed.length ? 1 : 0)
