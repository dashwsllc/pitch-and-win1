import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260922140000_closer_inherits_sdr_qualification.sql'), 'utf8')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_remarketing_qualification.sql'), 'utf8')
const body = migration.slice(migration.indexOf('BEGIN;') + 'BEGIN;'.length).replace(/COMMIT;\s*$/, '')
const directory = resolve(root, '.verification.local')
mkdirSync(directory, { recursive: true })
writeFileSync(
  resolve(directory, 'crm-remarketing-query.sql'),
  process.argv.includes('--deployed')
    ? `BEGIN;\n${tests}\nROLLBACK;\n`
    : `BEGIN;\n${body}\n${tests}\nROLLBACK;\n`,
)
const result = spawnSync('npx', [
  'supabase','db','query','--linked','--project-ref','mbzwchnxtskysqplqiyy',
  '--file','.verification.local/crm-remarketing-query.sql','--output','json',
], { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: CRM remarketing, shared SDR and Closer qualification, role hierarchy, remarketing ownership and reactivation verified; fixtures rolled back.')
}
