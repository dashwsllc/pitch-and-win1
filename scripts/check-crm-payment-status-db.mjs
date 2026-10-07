import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Verifies the CRM lead payment status (crm_lead_payment_status + crm_set_payment_status) with isolated fixtures.
// Everything runs in one transaction that always ends in ROLLBACK.
// Default: runs the migration body first (before it is installed). --deployed: uses what is installed.
const root = resolve(import.meta.dirname, '..')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_lead_payment_status.sql'), 'utf8')
const deployed = process.argv.includes('--deployed')
const body = deployed
  ? ''
  : readFileSync(resolve(root, 'supabase/migrations/20261007120000_crm_lead_payment_status.sql'), 'utf8')
      .replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const query = [
  'BEGIN;',
  "SET LOCAL lock_timeout='3s';",
  "SET LOCAL statement_timeout='60s';",
  'CREATE TEMP TABLE paystatus_backfill_expectations(lead_id uuid,status text,updated_by uuid,updated_at timestamptz);',
  deployed ? '' : readFileSync(resolve(root, 'supabase/tests/crm_lead_payment_status_legacy_fixture.sql'), 'utf8'),
  'CREATE TEMP TABLE paystatus_legacy_snapshot AS SELECT id,to_jsonb(p) row_data FROM public.crm_lead_payments p;',
  body,
  tests,
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-payment-status.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', '.verification.local/crm-payment-status.sql', '--output', 'json')
const options = { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
const psQuote = value => `'${value.replaceAll("'", "''")}'`
const result = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `& ${[process.env.SUPABASE_CLI || 'npx.cmd', ...args].map(psQuote).join(' ')}`], options)
  : spawnSync(cli, args, options)
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: CRM payment status permissions, constraints, transitions, author/time history, idempotency, version stability, deletion cascade, realtime, legacy preservation and backfill verified. Migration and all fixtures rolled back.')
}
