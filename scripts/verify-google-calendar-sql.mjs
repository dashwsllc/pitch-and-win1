// PostgreSQL WASM verification with temporary tooling; no package or production dependency.
// Pass the absolute path to an installed PGlite module. All data lives in memory.
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const root=resolve(import.meta.dirname,'..')
const modulePath=process.argv[2]
if(!modulePath) throw Error('Pass the local PGlite dist/index.js path; no database URL is used.')
const {PGlite}=await import(pathToFileURL(resolve(modulePath)).href)
const db=new PGlite(); await db.waitReady
let label='fixture bootstrap'
try {
 const setup=readFileSync(resolve(root,'scripts/setup-google-calendar-test-db.mjs'),'utf8')
 const start=setup.indexOf('run(`')+5
 await db.exec(setup.slice(start,setup.indexOf("`,'foundation')")).replace('CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',''))
 const legacy=setup.slice(setup.indexOf("if(name.startsWith('20260907180000')) run(`")+"if(name.startsWith('20260907180000')) run(`".length,setup.indexOf("`,'legacy fixture objects')"))
 const dir=resolve(root,'supabase/migrations')
 const selected=readdirSync(dir).filter(n=>n.endsWith('.sql')&&n.slice(0,14)<='20260912090000')
 selected.push(...readdirSync(dir).filter(n=>['20260914030000','20260921120000','20260921160000','20260922140000','20260923100000','20260923190000','20260925100000','20261006100000','20261007140000','20261008100000'].includes(n.slice(0,14))))
 for(label of selected.sort()) {
  if(label.startsWith('20260329054553')) continue
  if(label.startsWith('20260907180000')) await db.exec(legacy)
  let sql=readFileSync(resolve(dir,label),'utf8')
  if(label.startsWith('20260907180000')) sql=sql.replace('REVOKE ALL ON FUNCTION public.process_withdrawal(uuid,numeric) FROM PUBLIC,anon,authenticated;','')
  if(label.startsWith('20260910050000')) sql=sql.replace(/REVOKE[^;]*public\.log_security_event\([^;]*;/g,'')
  if(label.startsWith('20260923190000')) sql=sql.split('DO $grant_sdr_head$')[0]+'COMMIT;'
  if(label.startsWith('20260925100000')) sql=sql.slice(0,sql.indexOf('DO $$'))+sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.arena_sdr_exception'),sql.indexOf('-- Preserve the installed ranking'))+'COMMIT;'
  await db.exec(sql)
 }
 for(label of ['20261011100000_google_calendar_storage.sql','20261011103000_google_calendar_queue.sql']) await db.exec(readFileSync(resolve(dir,label),'utf8').replace('CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;',''))
 label='transactional fixtures'
 await db.exec('BEGIN;'+readFileSync(resolve(root,'supabase/tests/google_calendar_sync.sql'),'utf8')+'ROLLBACK;')
 label='cron contract fixtures'
 await db.exec(readFileSync(resolve(root,'supabase/tests/google_calendar_cron.sql'),'utf8'))
 await db.exec(readFileSync(resolve(dir,'20261011110000_google_calendar_cron.sql'),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_net;','').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;',''))
 await db.exec(readFileSync(resolve(root,'supabase/tests/google_calendar_cron_assert.sql'),'utf8'))
 console.log('PASS: real PostgreSQL DDL, CRM/RLS/queue/OAuth fixtures and cron SQL. Vault, cron and HTTP use local stand-ins; native encryption and concurrent sessions remain release gates.')
} catch(error) {
 // Do not dump SQL query text, token values or request bodies on failure.
 console.error('FAIL:',label,{message:error.message,code:error.code,where:error.where});process.exitCode=1
} finally {await db.close()}
