// Requires an authenticated Supabase CLI and a linked project. Safe against production:
// the SQL enforces a read-only transaction and prints only aggregate totals.
// SUPABASE_CLI may point to an already installed CLI executable.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', 'supabase/tests/sales_reconciliation.sql', '--output', 'json')
const result = spawnSync(cli, args, {
  cwd: resolve(import.meta.dirname, '..'), shell: process.platform === 'win32' && !process.env.SUPABASE_CLI,
  encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else {
  console.log(result.stdout.trim())
  console.log('PASS: approved sales, seller attribution, purchase dates and daily/monthly totals reconcile.')
}
