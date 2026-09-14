import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260914120000_sales_management.sql'), 'utf8')
const tests = ['sales_management', 'crm_shared_workflow', 'executive_delete_account']
  .map(name => "RESET ROLE;\nSELECT set_config('request.jwt.claims','{}',true);\n" + readFileSync(resolve(root, `supabase/tests/${name}.sql`), 'utf8'))
  .join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/sales-management-query.sql'),
  (process.argv.includes('--deployed') ? 'BEGIN;' : migration.replace(/COMMIT;\s*$/, '')) + '\n' + tests + '\nROLLBACK;')
const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/sales-management-query.sql', '--output', 'json'], {
  cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else console.log('PASS: sale management, conflicts, rejected visibility, commission/balance/aggregates/audit, CRM age/permissions/linkage and account deletion. All fixtures and schema changes rolled back.')
