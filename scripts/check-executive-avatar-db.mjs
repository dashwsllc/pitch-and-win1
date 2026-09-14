import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const version = '20260914190000'
const name = 'executive_avatar_management'
const migration = readFileSync(
  resolve(root, `supabase/migrations/${version}_${name}.sql`),
  'utf8',
)
const protectionMigration = readFileSync(
  resolve(root, 'supabase/migrations/20260914193000_avatar_target_protection.sql'),
  'utf8',
)
const tests = readFileSync(
  resolve(root, 'supabase/tests/executive_avatar_management.sql'),
  'utf8',
)
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(
  resolve(root, '.verification.local/executive-avatar-check.sql'),
  `${process.argv.includes('--deployed') ? 'BEGIN;' : `${migration.replace(/COMMIT;\s*$/, '')}\n${protectionMigration.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')}`}\n${tests}\nROLLBACK;`,
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
    '.verification.local/executive-avatar-check.sql',
    '--output',
    'json',
  ],
  {
    cwd: root,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
)
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log('PASS: executive avatar Storage policies compile and require executive access.')
}
