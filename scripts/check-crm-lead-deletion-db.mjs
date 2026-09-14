import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const version = '20260914210000'
const name = 'crm_lead_deletion'
const source = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8')
const body = source.replace(/^[\s\S]*?BEGIN;/, '').replace(/COMMIT;\s*$/, '')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_lead_deletion.sql'), 'utf8')
const salesRegression = readFileSync(resolve(root, 'supabase/tests/sales_management.sql'), 'utf8')
const apply = process.argv.includes('--apply')
const deployed = process.argv.includes('--deployed')
if (apply && deployed) throw Error('Choose --apply or --deployed')
const guard = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration already installed'; END IF; END; $$;`
const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);`
const query = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s';
${deployed ? '' : guard + body}
${apply ? record : tests + '\n' + salesRegression}
${apply ? 'COMMIT;' : 'ROLLBACK;'}
SELECT '${apply ? 'CRM lead deletion migration applied' : 'CRM lead deletion and sales regression assertions passed; fixtures rolled back'}' AS result;`
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-lead-deletion-query.sql'), query)
const result = spawnSync(
  'npx',
  ['supabase','db','query','--linked','--project-ref','mbzwchnxtskysqplqiyy','--file','.verification.local/crm-lead-deletion-query.sql','--output','json'],
  { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
)
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else console.log(result.stdout)
