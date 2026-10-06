import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Verifies update_crm_call with isolated fixtures. Everything runs in one transaction that always ends in ROLLBACK.
// Default: runs the migration body first (before it is installed). --deployed: uses the installed function.
const root = resolve(import.meta.dirname, '..')
const version = '20261006100000'
const name = 'crm_edit_scheduled_call'
const deployed = process.argv.includes('--deployed')
const migration = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_edit_scheduled_call.sql'), 'utf8')
const body = migration.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const installedGuard = `DO $$ BEGIN IF NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}'
) THEN RAISE EXCEPTION 'Migration missing from history'; END IF; END $$;`
const query = [
  'BEGIN;',
  "SET LOCAL lock_timeout='3s';",
  "SET LOCAL statement_timeout='60s';",
  deployed ? installedGuard : body,
  tests,
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-edit-call.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', '.verification.local/crm-edit-call.sql', '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: update_crm_call permissions, assignee and time edits, lead sync, timeline, Arena neutrality and stale/finished guards verified. Migration and all fixtures rolled back.')
}
