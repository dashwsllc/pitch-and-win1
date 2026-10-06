import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Installs only the reviewed update_crm_call migration. Run scripts/check-crm-edit-call-db.mjs first.
const version = '20261006100000'
const name = 'crm_edit_scheduled_call'
const source = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
if (source.includes('$migration$')) throw new Error('SQL quoting delimiter conflict')
const guard = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration already installed'; END IF; END; $$;`
const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);`
const query = source
  .replace('BEGIN;', () => `BEGIN;\n${guard}`)
  .replace(/COMMIT;\s*$/, () => `${record}\nCOMMIT;\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${version}';\n`)
mkdirSync('.verification.local', { recursive: true })
writeFileSync('.verification.local/crm-edit-call-apply.sql', query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', '.verification.local/crm-edit-call-apply.sql', '--output', 'json')
const result = spawnSync(cli, args, { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exitCode = 1
} else console.log(result.stdout)
