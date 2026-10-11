import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const address = process.env.GOOGLE_CALENDAR_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const url = new URL(address)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw Error('Use an isolated local Supabase test database. Remote/production targets are rejected.')
}
const migrations = ['20261011100000_google_calendar_storage.sql', '20261011103000_google_calendar_queue.sql', '20261011180000_google_calendar_safeupdate.sql']
const standIn = process.env.GOOGLE_CALENDAR_TEST_VAULT_STANDIN === '1'
if (standIn && url.pathname !== '/calendar_qa') throw Error('Vault stand-in is restricted to the disposable local calendar_qa database')
const query = ['BEGIN;', "SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='90s';",
  ...migrations.map(name => readFileSync(resolve(root, 'supabase/migrations', name), 'utf8').replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '').replace(standIn ? /CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;/ : /$^/, '')),
  readFileSync(resolve(root, 'supabase/tests/google_calendar_sync.sql'), 'utf8'),
  readFileSync(resolve(root, 'supabase/tests/google_calendar_safeupdate.sql'), 'utf8'), 'ROLLBACK;'].join('\n')
const scratch = resolve(root, '.verification.local')
mkdirSync(scratch, { recursive: true })
const file = resolve(scratch, 'google-calendar-test.sql')
writeFileSync(file, query)
const result = spawnSync(process.env.PSQL || 'psql', ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', '--dbname', address, '--file', file], {
  cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.error?.code === 'ENOENT' ? 'Test database unavailable: install/start local Supabase and set PSQL to the PostgreSQL client.' : (result.stderr || 'SQL verification failed'))
  process.exitCode = 1
} else console.log('PASS: Google Calendar SQL fixtures; all schema changes and fixtures rolled back.')
