import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tests = readFileSync(resolve(root, 'supabase/tests/crm_shared_workflow.sql'), 'utf8')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260910010000_crm_shared_workflow.sql'), 'utf8')
const directory = resolve(root, '.verification.local')
mkdirSync(directory, { recursive: true })
const query = process.argv.includes('--deployed') ? 'BEGIN;' : migration.replace(/COMMIT;\s*$/, '')
writeFileSync(
  resolve(directory, 'crm-query.sql'),
  query.replace('BEGIN;', "BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';") +
    '\n' +
    tests +
    '\nROLLBACK;'
)
const result = spawnSync(
  'npx',
  [
    'supabase',
    'db',
    'query',
    '--linked',
    '--project-ref',
    'mbzwchnxtskysqplqiyy',
    '--file',
    '.verification.local/crm-query.sql',
    '--output',
    'json'
  ],
  { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
)
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else
  console.log(
    'PASS: CRM schema, RLS, role boundaries, atomic transitions, conflicts, notes and sales linkage verified. Migration and all fixtures rolled back.'
  )
