import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Applies only this migration, preserving divergent history. Run the rollback verifier first.
// --dry-run prepares the exact SQL without contacting the database.
const root = resolve(import.meta.dirname, '..')
const version = '20261007120000'
const name = 'crm_lead_payment_status'
const source = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8')
if (source.includes('$migration$')) throw new Error('SQL quoting delimiter conflict')
const guard = `
SELECT pg_advisory_xact_lock(20261007,120000);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN
    RAISE EXCEPTION 'Migration already installed';
  END IF;
  IF to_regclass('public.crm_lead_payments') IS NULL THEN
    RAISE EXCEPTION 'Legacy payment migration must be installed first';
  END IF;
END; $$;`
const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);`
const query = source
  .replace('BEGIN;', () => `BEGIN;\n${guard}`)
  .replace(/COMMIT;\s*$/, () => `${record}\nCOMMIT;\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${version}';\n`)
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-payment-status-apply.sql'), query)
if (process.argv.includes('--dry-run')) {
  console.log('Prepared .verification.local/crm-payment-status-apply.sql. No database changes made.')
} else {
  const cli = process.env.SUPABASE_CLI || 'npx'
  const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
  args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
    '--file', '.verification.local/crm-payment-status-apply.sql', '--output', 'json')
  const options = { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  const psQuote = value => `'${value.replaceAll("'", "''")}'`
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `& ${[process.env.SUPABASE_CLI || 'npx.cmd', ...args].map(psQuote).join(' ')}`], options)
    : spawnSync(cli, args, options)
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || result.error?.message)
    process.exitCode = result.status ?? 1
  } else console.log(result.stdout)
}
