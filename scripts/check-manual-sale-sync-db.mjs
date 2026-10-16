import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const before = process.argv.includes('--before')
const deployed = process.argv.includes('--deployed')
const version = '20261016140000'
const migration = before || deployed ? '' : readFileSync(`supabase/migrations/${version}_manual_sale_value_editing.sql`, 'utf8').replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const tests = readFileSync('supabase/tests/manual_sale_value_sync.sql', 'utf8')
const guard = deployed ? `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Manual value editing migration is missing'; END IF; END $$;` : ''
writeFileSync('.verification.local/manual-sale-sync-run.sql', `BEGIN ISOLATION LEVEL REPEATABLE READ;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='90s';\n${guard}\n${migration}\n${tests}\nROLLBACK;`)
const result = spawnSync('npx', ['--yes','supabase','db','query','--linked','--project-ref','mbzwchnxtskysqplqiyy','--file','.verification.local/manual-sale-sync-run.sql','--output','json'], { shell: process.platform === 'win32', encoding: 'utf8', timeout: 110000, maxBuffer: 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else console.log(`PASS manual sale synchronization (${deployed ? 'deployed' : before ? 'current' : 'migration rehearsal'}). All test fixtures rolled back.`)
