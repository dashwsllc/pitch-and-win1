import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Verifica (1) que qualquer SDR ou Closer escolhe e troca o Closer responsável por um fechamento, inclusive a si mesmo, e
// (2) que cada lead cadastrado conta como uma abordagem de quem o cadastrou. Tudo roda numa transação que sempre termina
// em ROLLBACK: nada é gravado.
//   (sem opção)  roda o corpo das duas migrações e depois o teste, ainda antes de instalá-las
//   --before     só o teste, contra o banco como está (deve FALHAR enquanto as migrações não estiverem instaladas)
//   --deployed   exige as duas migrações no histórico e roda o teste contra o banco instalado
const root = resolve(import.meta.dirname, '..')
const migrations = [
  ['20261007140000', 'crm_closer_self_assignment'],
  ['20261007150000', 'crm_lead_registration_counts_as_approach'],
]
const before = process.argv.includes('--before')
const deployed = process.argv.includes('--deployed')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_closer_self_and_registration_approach.sql'), 'utf8')
const bodies = migrations.map(([version, name]) =>
  readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8').replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, ''))
const installedGuard = `DO $$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${migrations.map(([v]) => `'${v}'`).join(',')})) <> ${migrations.length} THEN RAISE EXCEPTION 'Migration missing from history'; END IF; END $$;`
const query = [
  'BEGIN;',
  "SET LOCAL lock_timeout='3s';",
  "SET LOCAL statement_timeout='60s';",
  before ? '' : deployed ? installedGuard : bodies.join('\n'),
  tests,
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-closer-approach.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/crm-closer-approach.sql', '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log(`PASS${before ? ' (banco atual)' : deployed ? ' (instaladas)' : ' (migrações + teste)'}: SDR e Closer escolhem e trocam o Closer do fechamento (inclusive a si mesmos), e cada lead cadastrado conta como uma abordagem. Tudo revertido (ROLLBACK).`)
}
