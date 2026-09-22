import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260922120000_sale_seller_reassignment.sql'), 'utf8')
const tests = readFileSync(resolve(root, 'supabase/tests/sale_seller_reassignment.sql'), 'utf8')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(
  resolve(root, '.verification.local/sale-seller-reassignment-query.sql'),
  (process.argv.includes('--deployed') ? 'BEGIN;' : migration.replace(/COMMIT;\s*$/, '')) + `\n${tests}\nROLLBACK;`,
)
const result = spawnSync(
  'npx',
  ['supabase', 'db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/sale-seller-reassignment-query.sql', '--output', 'json'],
  { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
)

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: seller reassignment authorization, commission, both balances, executive board and audit. All fixtures rolled back.')
}
