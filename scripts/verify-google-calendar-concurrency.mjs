// Native PostgreSQL only; clone the disposable fixture DB, never a remote target.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawn,spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),base=process.env.GOOGLE_CALENDAR_TEST_DATABASE_URL
if(!base || !['localhost','127.0.0.1'].includes(new URL(base).hostname) || new URL(base).pathname!=='/calendar_qa')throw Error('Requires the disposable local calendar_qa baseline')
const database='calendar_qa_c'+Date.now(),address=new URL(base);address.pathname='/'+database
const psql=process.env.PSQL||'psql',sessions=[]
function query(sql,db=address.href){
  const r=spawnSync(psql,['-X','-qAt','--no-password','--set','ON_ERROR_STOP=1','--dbname',db],{input:sql,encoding:'utf8',maxBuffer:4*1024*1024})
  if(r.status!==0)throw Error(r.stderr||r.error?.message)
  return r.stdout.trim()
}
function session(sql){
  const child=spawn(psql,['-X','-qAt','--no-password','--set','ON_ERROR_STOP=1','--dbname',address.href],{stdio:['pipe','pipe','pipe']})
  const s={child,out:'',err:''};sessions.push(s)
  child.stdout.on('data',v=>s.out+=v);child.stderr.on('data',v=>s.err+=v)
  s.done=new Promise(resolve=>child.on('close',code=>resolve(code)))
  child.stdin.end(sql+'\n');return s
}
async function until(check){
  const deadline=Date.now()+15000
  while(!check()){if(Date.now()>deadline)throw Error('Timed out arranging PostgreSQL interleaving');await new Promise(r=>setTimeout(r,50))}
}
try{
  query(`CREATE DATABASE ${database} TEMPLATE calendar_qa;`,base)
  for(const name of ['20261011100000_google_calendar_storage.sql','20261011103000_google_calendar_queue.sql','20261011180000_google_calendar_safeupdate.sql'])
    query(readFileSync(resolve(root,'supabase/migrations',name),'utf8').replace('CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;',''))
  const fixture=readFileSync(resolve(root,'supabase/tests/google_calendar_sync.sql'),'utf8').split("UPDATE public.profiles SET suspended=true")[0]
  query('BEGIN;\n'+fixture+`
    CREATE TABLE calendar_private.concurrency_fixture AS SELECT * FROM calendar_qa;
    DELETE FROM calendar_private.outbox; DELETE FROM calendar_private.bindings; DELETE FROM public.crm_google_calendar_status;
    INSERT INTO calendar_private.activation_seeds SELECT call_id,lead_id,'test@group.calendar.google.com' FROM calendar_qa;
    CREATE FUNCTION calendar_private.test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE gate bigint; BEGIN
      gate:=CASE current_setting('application_name') WHEN 'calendar_qa_mutation' THEN 54261111 ELSE 54261112 END;
      PERFORM pg_advisory_lock_shared(gate); PERFORM pg_advisory_unlock_shared(gate); RETURN NEW;
    END $$;
    CREATE TRIGGER test_barrier BEFORE INSERT ON calendar_private.bindings FOR EACH ROW EXECUTE FUNCTION calendar_private.test_barrier();
    COMMIT;`)
  session("SET application_name='calendar_qa_gate_mutation'; SELECT pg_advisory_lock(54261111); SELECT pg_sleep(60);")
  session("SET application_name='calendar_qa_gate_backfill'; SELECT pg_advisory_lock(54261112); SELECT pg_sleep(60);")
  await until(()=>query("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name LIKE 'calendar_qa_gate_%' AND l.locktype='advisory' AND l.granted;")==='2')
  const mutation=session(`BEGIN; SET application_name='calendar_qa_mutation';
    SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
    UPDATE public.crm_activities SET is_completed=true,completed_at=now(),outcome='venda_perdida'
    WHERE id=(SELECT call_id FROM calendar_private.concurrency_fixture); COMMIT;`)
  const waiting=name=>query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='advisory';`)==='1'
  await until(()=>{if(mutation.child.exitCode!==null)throw Error(mutation.err||'CRM mutation ended before the barrier');return waiting('calendar_qa_mutation')})
  const backfill=session("BEGIN; SET application_name='calendar_qa_backfill'; SELECT public.google_calendar_scan_page('backfill',20); COMMIT;")
  await until(()=>{if(backfill.child.exitCode!==null)throw Error(backfill.err||'Backfill ended before the barrier');return waiting('calendar_qa_backfill')})
  // Both read a missing binding; finish the commercial update first, then the scan.
  query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND application_name='calendar_qa_gate_mutation';`)
  assert.equal(await mutation.done,0,mutation.err)
  const first=JSON.parse(query("SELECT json_build_object('event',event_id,'revision',revision) FROM calendar_private.bindings;"))
  query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND application_name='calendar_qa_gate_backfill';`)
  assert.equal(await backfill.done,0,'First-registration race aborted backfill: '+backfill.err)
  const actual=JSON.parse(query(`SELECT json_build_object('bindings',(SELECT count(*) FROM calendar_private.bindings),
    'jobs',(SELECT count(*) FROM calendar_private.outbox),'event',b.event_id,'revision',b.revision,'completed',b.completed,
    'status_revision',s.desired_revision) FROM calendar_private.bindings b JOIN public.crm_google_calendar_status s ON s.call_id=b.call_id;`))
  assert.equal(actual.bindings,1);assert.equal(actual.jobs,1);assert.equal(actual.event,first.event)
  assert.equal(actual.revision,first.revision+1);assert.equal(actual.completed,true,'Waiting scan used a stale call snapshot')
  assert.equal(actual.status_revision,String(actual.revision))
  console.log('PASS: real overlapping CRM update/backfill, one identity, both revisions, latest completed state')
}finally{
  for(const s of sessions)if(s.child.exitCode===null)s.child.kill()
  await Promise.all(sessions.map(s=>s.done))
  if(/^calendar_qa_c[0-9]+$/.test(database))query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`,base)
}
