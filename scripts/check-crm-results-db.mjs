import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const version = '20260921160000'
const name = 'crm_results_and_returns'
const source = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
const body = source.slice(source.indexOf('BEGIN;') + 6).replace(/COMMIT;\s*$/, '')
const tests = readFileSync('supabase/tests/crm_results_and_returns.sql', 'utf8')
const apply = process.argv.includes('--apply')
const deployed = process.argv.includes('--deployed')
const query = apply ? source.replace(/COMMIT;\s*$/, () =>
  `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);\nCOMMIT;\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${version}';`)
  : `BEGIN;\n${deployed ? '' : body}\n${tests}\nROLLBACK;`
mkdirSync('.verification.local', { recursive: true })
writeFileSync('.verification.local/crm-results-query.sql', query)
const result = spawnSync('npx', ['supabase','db','query','--linked','--project-ref','mbzwchnxtskysqplqiyy',
  '--file','.verification.local/crm-results-query.sql','--output','json'],
  { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else console.log(apply ? result.stdout : 'PASS: Result snapshots, SDR/Closer returns, calls, remarketing cycles, approval metadata, permissions and stale versions; all test data rolled back.')
