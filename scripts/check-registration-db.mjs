import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const version = '20260912090000'
const name = 'registration_approval'
const source = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8')
const body = source.replace(/^[\s\S]*?BEGIN;/, '').replace(/COMMIT;\s*$/, '')
const tests = readFileSync(resolve(root, 'supabase/tests/registration_approval.sql'), 'utf8')
const apply = process.argv.includes('--apply')
const deployed = process.argv.includes('--deployed')
if (apply && deployed) throw Error('Choose --apply or --deployed')
const guard = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration already installed'; END IF; END; $$;`
const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);`
const query = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s';
${deployed ? '' : guard + body}
${apply ? record : tests}
${apply ? 'COMMIT;' : 'ROLLBACK;'}
SELECT '${apply ? 'Registration migration applied' : 'Registration assertions passed; fixtures rolled back'}' AS result;`
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/registration-query.sql'), query)
const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/registration-query.sql', '--output', 'json'], {
  cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
})
if (result.status !== 0) { console.error(result.stderr || result.stdout || result.error?.message); process.exitCode = result.status ?? 1 }
else console.log(result.stdout)
