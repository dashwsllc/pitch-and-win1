import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Applies exactly this reviewed migration; never reconciles/replays other migrations.
const version = '20260910010000'
const name = 'crm_shared_workflow'
const source = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
const query = source.replace('BEGIN;', () => `BEGIN;\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration already installed'; END IF; END; $$;`)
  .replace(/COMMIT;\s*$/, () => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);\nCOMMIT;\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${version}';`)
writeFileSync('.verification.local/crm-apply-specific.sql', query)
const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/crm-apply-specific.sql', '--output', 'json'], { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) { console.error(result.stderr || result.stdout); process.exitCode = 1 }
else console.log(result.stdout)
