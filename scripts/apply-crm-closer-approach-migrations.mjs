import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Instala as duas migrações revisadas: (1) qualquer SDR/Closer escolhe o Closer do fechamento, inclusive a si mesmo e
// (2) cada lead cadastrado conta como uma abordagem (daqui para frente, sem tocar no histórico). Rode antes
// scripts/check-crm-closer-approach-db.mjs (sempre em ROLLBACK). Cada migração entra numa transação própria, com guarda
// contra reinstalação e registro em supabase_migrations.schema_migrations.
const migrations = [
  ['20261007140000', 'crm_closer_self_assignment'],
  ['20261007150000', 'crm_lead_registration_counts_as_approach'],
]
mkdirSync('.verification.local', { recursive: true })
let failed = false
for (const [version, name] of migrations) {
  const source = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
  if (source.includes('$migration$')) throw new Error('SQL quoting delimiter conflict')
  const guard = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration already installed'; END IF; END; $$;`
  const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[$migration$${source}$migration$]);`
  const query = source
    .replace('BEGIN;', () => `BEGIN;\n${guard}`)
    .replace(/COMMIT;\s*$/, () => `${record}\nCOMMIT;\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${version}';\n`)
  const file = `.verification.local/${name}-apply.sql`
  writeFileSync(file, query)
  const cli = process.env.SUPABASE_CLI || 'npx'
  const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
  args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', file, '--output', 'json')
  const result = spawnSync(cli, args, { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.status !== 0) {
    console.error(`FALHOU ${version} ${name}:`, result.stderr || result.stdout)
    failed = true
    break
  }
  console.log(`INSTALADA ${version} ${name}`)
}
process.exitCode = failed ? 1 : 0
