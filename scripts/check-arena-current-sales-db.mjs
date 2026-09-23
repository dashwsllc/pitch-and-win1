import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const version = '20260923150000'
const name = 'arena_current_sales'
const apply = process.argv.includes('--apply')
const deployed = process.argv.includes('--deployed')
if (apply && deployed) throw new Error('Choose --apply or --deployed')

const source = readFileSync(resolve('supabase/migrations', `${version}_${name}.sql`), 'utf8')
const migration = source.replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*$/m, '')
const verification = readFileSync(resolve('scripts/verify-arena-current-sales.sql'), 'utf8')
const tag = `$arena_current_sales_${version}$`
if (source.includes(tag)) throw new Error('SQL quoting delimiter conflict')

const query = apply
  ? `BEGIN;\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration already installed'; END IF; END $$;\n${migration}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${tag}${source}${tag}]);\nCOMMIT;\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${version}';\n`
  : `BEGIN;\n${deployed ? '' : migration}\n${verification}\nROLLBACK;\n`

mkdirSync('.verification.local', { recursive: true })
const path = resolve('.verification.local/arena-current-sales.sql')
writeFileSync(path, query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/arena-current-sales.sql', '--output-format', 'json')
const result = spawnSync(cli, args, { shell: process.platform === 'win32', encoding: 'utf8', stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
