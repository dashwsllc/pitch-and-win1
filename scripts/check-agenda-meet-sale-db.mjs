import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Verifica o link da reunião por call, o resultado "sinal" e a venda livre com sinal. Tudo roda numa
// transação que sempre termina em ROLLBACK: nenhum lead, call, venda ou evento é gravado.
//   (sem opção)  roda o corpo da migração e depois o teste, ainda antes de instalá-la
//   --before     só o teste, contra o banco como está (deve FALHAR enquanto a migração não estiver instalada)
//   --deployed   exige a migração no histórico e roda o teste contra o que está instalado
const root = resolve(import.meta.dirname, '..')
const version = '20261016130000'
const name = 'agenda_meet_link_call_result_and_free_sale'
const before = process.argv.includes('--before')
const deployed = process.argv.includes('--deployed')
const migration = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8')
const tests = readFileSync(resolve(root, `supabase/tests/${name}.sql`), 'utf8')
const body = migration.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const installedGuard = `DO $$ BEGIN IF NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}'
) THEN RAISE EXCEPTION 'Migration missing from history'; END IF; END $$;`
const query = [
  'BEGIN;',
  "SET LOCAL lock_timeout='3s';",
  "SET LOCAL statement_timeout='120s';",
  before ? '' : deployed ? installedGuard : body,
  tests,
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/agenda-meet-sale.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', '.verification.local/agenda-meet-sale.sql', '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log(`PASS${before ? ' (banco atual)' : deployed ? ' (instalada)' : ' (migração + teste)'}: link do Meet, resultado sinal e venda livre com sinal. Tudo revertido (ROLLBACK).`)
}
