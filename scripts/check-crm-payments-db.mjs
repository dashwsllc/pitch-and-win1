import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Verifies the CRM lead payments (crm_lead_payments + crm_payment_* functions) with isolated fixtures.
// Everything runs in one transaction that always ends in ROLLBACK.
// Default: runs the migration body first (before it is installed). --deployed: uses what is installed.
const root = resolve(import.meta.dirname, '..')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_lead_payments.sql'), 'utf8')
const deployed = process.argv.includes('--deployed')
const body = deployed
  ? ''
  : readFileSync(resolve(root, 'supabase/migrations/20261007110000_crm_lead_payments.sql'), 'utf8')
      .replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const query = [
  'BEGIN;',
  "SET LOCAL lock_timeout='3s';",
  "SET LOCAL statement_timeout='60s';",
  deployed ? '' : body,
  tests,
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-payments.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', '.verification.local/crm-payments.sql', '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: crm_lead_payments permissions, constraints, status rules, summary, revisions, timeline and lead-deletion cascade verified. Migration and all fixtures rolled back.')
}
