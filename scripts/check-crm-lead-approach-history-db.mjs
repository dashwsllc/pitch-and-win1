import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Verifica que todo lead cadastrado (fora o do Meta) tem a sua abordagem e o seu evento da Arena, com o histórico incluído.
// Tudo roda numa transação que sempre termina em ROLLBACK: nada é gravado.
//   (sem opção)  roda o corpo da migração do histórico DUAS vezes (a segunda não pode mudar nada) e depois o teste
//   --before     só o teste, contra o banco como está (deve FALHAR enquanto o histórico não estiver instalado)
//   --deployed   exige a migração no histórico e roda o teste contra o banco instalado
const root = resolve(import.meta.dirname, '..')
const version = '20261007160000'
const name = 'crm_lead_registration_approach_history'
const before = process.argv.includes('--before')
const deployed = process.argv.includes('--deployed')
const migration = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_lead_registration_approach_history.sql'), 'utf8')
const body = migration.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const installedGuard = `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration missing from history'; END IF; END $$;`
const snapshot = `CREATE TEMP TABLE hist_counts AS SELECT
  (SELECT count(*) FROM public.abordagens WHERE crm_lead_id IS NOT NULL) AS a,
  (SELECT count(*) FROM public.activity_feed WHERE event_key LIKE 'lead.approached:%:registered') AS e;`
const query = [
  'BEGIN;',
  "SET LOCAL lock_timeout='3s';",
  "SET LOCAL statement_timeout='120s';",
  before ? '' : deployed ? installedGuard : [body, snapshot, body].join('\n'),
  tests,
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-lead-approach-history.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/crm-lead-approach-history.sql', '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log(`PASS${before ? ' (banco atual)' : deployed ? ' (instalada)' : ' (migração duas vezes + teste)'}: todo lead cadastrado tem uma abordagem e um evento da Arena, com o histórico; rodar de novo não duplica nada. Tudo revertido (ROLLBACK).`)
}
