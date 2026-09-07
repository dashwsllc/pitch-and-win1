import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Generate a rollback-only copy; no fixture or migration change survives this verification.
const root = resolve(import.meta.dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260907180000_executive_sales_control.sql'), 'utf8')
const tests = readFileSync(resolve(root, 'supabase/tests/executive_controls.sql'), 'utf8')
const target = resolve(root, '.verification.local')
mkdirSync(target, { recursive: true })
writeFileSync(resolve(target, 'query.sql'), process.argv.includes('--deployed')
  ? `BEGIN;\n${tests}\nROLLBACK;`
  : migration.replace(/COMMIT;\s*$/, () => `${tests}\nROLLBACK;`))
const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/query.sql', '--output', 'json'], {
  cwd: root, shell: process.platform === 'win32', stdio: 'inherit',
})
process.exitCode = result.status ?? 1
