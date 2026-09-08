import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260908190000_complete_products_catalog.sql'), 'utf8')
const conflicts = readFileSync(resolve(root, 'supabase/migrations/20260908193000_catalog_conflict_responses.sql'), 'utf8')
const tests = readFileSync(resolve(root, 'supabase/tests/products_catalog.sql'), 'utf8')
const target = resolve(root, '.verification.local')
mkdirSync(target, { recursive: true })
writeFileSync(resolve(target, 'products-query.sql'), process.argv.includes('--deployed')
  ? `BEGIN;\n${tests}\nROLLBACK;`
  : process.argv.includes('--conflicts-only')
    ? conflicts.replace(/COMMIT;\s*$/, () => `${tests}\nROLLBACK;`)
    : migration.replace(/COMMIT;\s*$/, '') + conflicts.replace(/BEGIN;/, '').replace(/COMMIT;\s*$/, () => `${tests}\nROLLBACK;`))
const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/products-query.sql', '--output', 'json'], {
  cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: product catalog SQL checks completed; all fixtures and verification changes rolled back.')
}
