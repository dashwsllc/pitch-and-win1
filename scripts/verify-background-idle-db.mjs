// Banco descartavel (PGlite). Estado de partida = producao em 23/10 a noite: os 15 jobs reais (scripts/fixtures/cron-jobs-live-2026-10-23.json) com a
// migration de guardas 20261023150000 aplicada por cima, e google_calendar_scan_page com o texto de producao. Nada toca producao.
// Migration 20261023210000_background_skip_idle_work: trabalho de fundo so quando ha trabalho.
// Rodar: node scripts/verify-background-idle-db.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const file = process.env.IDLE_MIGRATION ?? 'supabase/migrations/20261023210000_background_skip_idle_work.sql'   // so a checagem de mutacao troca o arquivo
const migration = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const guards = readFileSync('supabase/migrations/20261023150000_background_load_guards.sql', 'utf8').replace(/\r\n/g, '\n')
const live = JSON.parse(readFileSync('scripts/fixtures/cron-jobs-live-2026-10-23.json', 'utf8'))
const q = (db, sql, p) => db.query(sql, p).then(r => r.rows)

// google_calendar_scan_page como esta em producao (pg_get_functiondef, 23/10), para provar a diferenca.
const SCAN_PAGE_PROD = `CREATE OR REPLACE FUNCTION public.google_calendar_scan_page(p_mode text, p_limit integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE c calendar_private.connection; cur uuid; q record; n integer:=0; last_id uuid; cap integer:=greatest(1,least(500,p_limit)); more boolean;
BEGIN
  IF p_mode NOT IN ('backfill','reconcile') THEN RAISE EXCEPTION 'invalid_scan_mode' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.connection_status<>'connected' OR c.activated_at IS NULL THEN RETURN jsonb_build_object('processed',0,'done',true); END IF;
  SELECT cursor INTO cur FROM calendar_private.scan_state WHERE mode=p_mode FOR UPDATE;
  IF p_mode='backfill' THEN
    FOR q IN SELECT call_id,lead_id FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id ORDER BY call_id LIMIT cap
      LOOP PERFORM calendar_private.enqueue(q.call_id,q.lead_id); n:=n+1; last_id:=q.call_id; END LOOP;
    more:=EXISTS(SELECT 1 FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id);
  ELSE
    FOR q IN SELECT id,call_id,lead_id FROM calendar_private.bindings WHERE calendar_id=c.calendar_id AND NOT completed AND NOT removed AND (cur IS NULL OR id>cur) ORDER BY id LIMIT cap
    LOOP
      INSERT INTO calendar_private.outbox(binding_id) VALUES(q.id) ON CONFLICT DO NOTHING;
      n:=n+1; last_id:=q.id;
    END LOOP;
    more:=n=cap AND EXISTS(SELECT 1 FROM calendar_private.bindings WHERE calendar_id=c.calendar_id AND NOT completed AND NOT removed AND id>last_id);
  END IF;
  UPDATE calendar_private.scan_state SET cursor=CASE WHEN more THEN last_id ELSE NULL END WHERE mode=p_mode;
  RETURN jsonb_build_object('processed',n,'done',NOT more);
END $function$;`

async function freshDb({ jobs = live } = {}) {
  const db = new PGlite()
  await db.exec(`
create role anon; create role authenticated; create role service_role; create role authenticator;
create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
create table public.stub_calls(id bigserial primary key, what text not null);
create function public.arena_tick() returns void language sql as $$insert into public.stub_calls(what) values ('arena_tick')$$;
create function public.crm_context_reconcile(integer) returns jsonb language sql as $$insert into public.stub_calls(what) values ('reconcile'); select '{}'::jsonb$$;
create function public.meta_refresh_form_contexts() returns jsonb language sql as $$insert into public.stub_calls(what) values ('refresh'); select '{}'::jsonb$$;
create function public.meta_link_site_answers(boolean) returns jsonb language sql as $$insert into public.stub_calls(what) values ('site_link'); select '{}'::jsonb$$;
create schema net; create schema vault; create schema calendar_private;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds integer default 5000)
  returns bigint language sql as $$insert into public.stub_calls(what) values ('http:' || url || ' ' || body::text) returning id$$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('meta_cron_anon_key','a'),('meta_sync_cron_secret','b'),('google_calendar_cron_anon_key','c'),('google_calendar_cron_secret','d');
create table calendar_private.connection(singleton boolean primary key default true, connection_status text, activated_at timestamptz, calendar_id text);
insert into calendar_private.connection values (true, 'connected', now(), 'cal-1');
create table calendar_private.scan_state(mode text primary key, cursor uuid); insert into calendar_private.scan_state values ('backfill', null), ('reconcile', null);
create table calendar_private.bindings(id uuid primary key, call_id uuid not null, lead_id uuid, calendar_id text not null, completed boolean not null default false, removed boolean not null default false);
create table calendar_private.outbox(binding_id uuid primary key, attempt integer not null default 0, available_at timestamptz not null default clock_timestamp(), lease_token uuid, lease_until timestamptz, error_code text);
create table calendar_private.activation_seeds(call_id uuid primary key, lead_id uuid, calendar_id text);
create function calendar_private.enqueue(uuid, uuid) returns void language sql as $$insert into public.stub_calls(what) values ('enqueue:' || $1)$$;
create table public.crm_activities(id uuid primary key, scheduled_at timestamptz, duration_minutes integer);
create table public.meta_webhook_events(id uuid primary key default gen_random_uuid(), status text not null default 'pending', next_attempt_at timestamptz not null default clock_timestamp(), lease_until timestamptz);
create table public.meta_sync_runs(kind text, status text, level text); insert into public.meta_sync_runs values ('insights','running','campaign');
create schema cron; create table cron.job(jobid bigint primary key, jobname text unique, schedule text, command text, active boolean default true, username text default 'postgres', database text default 'postgres');
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as $$
  update cron.job set schedule = coalesce($2, schedule), command = coalesce($3, command), active = coalesce($6, active) where jobid = $1 $$;
${SCAN_PAGE_PROD}`)
  for (const j of jobs) await db.query('insert into cron.job(jobid, jobname, schedule, command, active) values ($1,$2,$3,$4,$5)', [j.jobid, j.jobname, j.schedule, j.command, j.active])
  await db.exec(guards)   // estado de producao: guardas de 23/10 ja aplicadas
  return db
}
const jobs = async db => Object.fromEntries((await q(db, 'select jobid, jobname, schedule, command, active from cron.job')).map(r => [r.jobname, r]))
const calls = async db => (await q(db, 'select what from public.stub_calls order by id')).map(r => r.what)
const reset = db => db.exec('truncate public.stub_calls')
async function fires(db, command) { await reset(db); await db.exec(command); return (await calls(db)).filter(c => c.startsWith('http:')).length }
const pressure = (db, on) => db.exec(`create or replace function public.db_under_pressure(p_active integer default 12, p_total integer default 48) returns boolean language sql as $$select ${on}$$`)

// Calls da agenda em varias idades: id da binding = id da call (bN).
const ID = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const AGES = [ // [n, horas a partir de agora do inicio da call, duracao em min] ; null = sem horario ; 'apagada' = sem linha em crm_activities
  [1, 48, 60], [2, 1, 60], [3, -0.5, 60], [4, -20, 60], [5, -30, 60], [6, -24 * 3, 60], [7, -24 * 10, 60], [8, -24 * 40, 30], [9, null, null], [10, 'apagada'],
  [11, -26, 180], [12, -24 * 2, null], [13, -24.5, null], [14, -24 * 5, 60]]   // 14: antiga DEPOIS da ultima valida (pega pagina vazia a mais)
async function seedCalendar(db) {
  for (const [n, h, dur] of AGES) {
    if (h === null) await db.query('insert into public.crm_activities values ($1, null, $2)', [ID(n), dur])
    else if (h !== 'apagada') await db.query('insert into public.crm_activities values ($1, now() + make_interval(secs => $2::float8 * 3600), $3)', [ID(n), h, dur])
    await db.query(`insert into calendar_private.bindings(id, call_id, calendar_id) values ($1, $1, 'cal-1')`, [ID(n)])
  }
  await db.query(`insert into calendar_private.bindings(id, call_id, calendar_id, completed) values ($1, $1, 'cal-1', true)`, [ID(20)])
  await db.query(`insert into calendar_private.bindings(id, call_id, calendar_id, removed) values ($1, $1, 'cal-1', true)`, [ID(21)])
  await db.query(`insert into calendar_private.bindings(id, call_id, calendar_id) values ($1, $1, 'outro-cal')`, [ID(22)])
}
// Reconciliacao completa (pagina a pagina, como a Edge Function faz em execucoes seguidas) e devolve os numeros das bindings enfileiradas.
async function reconcileAll(db, limit, expectedPages) {
  await db.exec('delete from calendar_private.outbox')
  let pages = 0
  for (let i = 0; i < 50; i++) {
    const [{ r }] = await q(db, `select public.google_calendar_scan_page('reconcile', $1) as r`, [limit]); pages++
    if (r.done) break
  }
  const [{ cursor }] = await q(db, `select cursor from calendar_private.scan_state where mode = 'reconcile'`)
  assert.equal(cursor, null, 'a varredura termina com o cursor zerado')
  if (expectedPages !== undefined) assert.equal(pages, expectedPages, 'nenhuma pagina vazia a mais')
  return (await q(db, 'select binding_id from calendar_private.outbox order by 1')).map(r => Number(r.binding_id.slice(-12)))
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('sensibilidade: ANTES, a reconciliacao reconferia ate call de 40 dias atras', async () => {
  const db = await freshDb(); await seedCalendar(db)
  assert.deepEqual(await reconcileAll(db, 500), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
})

test('reconciliacao: so call futura, em andamento ou que terminou ha menos de 1 dia (sem horario e apagada continuam por seguranca)', async () => {
  const db = await freshDb(); await seedCalendar(db); await db.exec(migration)
  // 4: comecou ha 20 h e durou 1 h -> terminou ha 19 h (fica); 5: terminou ha 29 h (sai); 11: comecou ha 26 h com 3 h -> terminou ha 23 h (fica)
  // 12: sem duracao, comecou ha 48 h -> 60 min padrao, terminou ha 47 h (sai); 13: sem duracao, comecou ha 24,5 h -> terminou ha 23,5 h (fica)
  assert.deepEqual(await reconcileAll(db, 500), [1, 2, 3, 4, 9, 10, 11, 13])
})

test('reconciliacao paginada (lote 1 e 3) chega ao mesmo conjunto, sem pagina vazia, e zera o cursor', async () => {
  const db = await freshDb(); await seedCalendar(db); await db.exec(migration)
  assert.deepEqual(await reconcileAll(db, 1, 8), [1, 2, 3, 4, 9, 10, 11, 13])
  assert.deepEqual(await reconcileAll(db, 3, 3), [1, 2, 3, 4, 9, 10, 11, 13])
})

test('ativacao (backfill) nao mudou; Google desconectado nao enfileira nada', async () => {
  const db = await freshDb(); await db.exec(migration)
  await db.exec(`insert into calendar_private.activation_seeds values ('${ID(30)}', null, 'cal-1'), ('${ID(31)}', null, 'outro-cal')`)
  await reset(db)
  const [{ r }] = await q(db, `select public.google_calendar_scan_page('backfill', 500) as r`)
  assert.equal(r.processed, 1); assert.deepEqual(await calls(db), [`enqueue:${ID(30)}`])
  await seedCalendar(db); await db.exec(`update calendar_private.connection set connection_status = 'error'`)
  assert.deepEqual(await reconcileAll(db, 500), [])
})

test('robo de leads sem descoberta: so dispara com evento de webhook vencido', async () => {
  const db = await freshDb(); const before = (await jobs(db))['meta-lead-worker'].command
  assert.equal(await fires(db, before), 1, 'antes disparava com a fila vazia')
  await db.exec(migration); const cmd = (await jobs(db))['meta-lead-worker'].command
  assert.equal(await fires(db, cmd), 0, 'fila vazia: nao chama a Edge Function')
  await db.exec(`insert into public.meta_webhook_events(status) values ('processed'), ('ignored')`)
  assert.equal(await fires(db, cmd), 0, 'so eventos ja tratados: nao chama')
  await db.exec(`insert into public.meta_webhook_events(status, next_attempt_at) values ('error', now() + interval '5 minutes')`)
  assert.equal(await fires(db, cmd), 0, 'erro aguardando nova tentativa: ainda nao')
  await db.exec(`insert into public.meta_webhook_events(status, lease_until) values ('processing', now() + interval '1 minute')`)
  assert.equal(await fires(db, cmd), 0, 'em processamento com lease valido: nao')
  await db.exec(`update public.meta_webhook_events set lease_until = now() - interval '1 second' where status = 'processing'`)
  assert.equal(await fires(db, cmd), 1, 'lease vencido: chama')
  await db.exec(`delete from public.meta_webhook_events where status = 'processing'; insert into public.meta_webhook_events(status) values ('pending')`)
  assert.equal(await fires(db, cmd), 1, 'evento novo: chama')
  assert.match((await calls(db))[0], /"discover": false/, 'continua sem descoberta')
  await pressure(db, true); assert.equal(await fires(db, cmd), 0, 'sob pressao continua pulando')
  await pressure(db, false); await db.exec(`delete from vault.decrypted_secrets where name = 'meta_sync_cron_secret'`)
  assert.equal(await fires(db, cmd), 0, 'sem segredo continua sem disparar (condicao original)')
})

test('entrega da agenda: so dispara com item vencido e livre na fila ou com ativacao pendente', async () => {
  const db = await freshDb(); const before = (await jobs(db))['google-calendar-deliver'].command
  assert.equal(await fires(db, before), 1, 'antes disparava com a fila vazia')
  await db.exec(migration); const cmd = (await jobs(db))['google-calendar-deliver'].command
  assert.equal(await fires(db, cmd), 0, 'fila vazia: nao chama')
  await db.exec(`insert into calendar_private.outbox(binding_id, available_at) values ('${ID(1)}', now() + interval '2 minutes')`)
  assert.equal(await fires(db, cmd), 0, 'nova tentativa agendada para depois: ainda nao')
  await db.exec(`insert into calendar_private.outbox(binding_id, lease_until) values ('${ID(2)}', now() + interval '30 seconds')`)
  assert.equal(await fires(db, cmd), 0, 'item com lease valido (outra execucao entregando): nao')
  await db.exec(`update calendar_private.outbox set lease_until = now() - interval '1 second' where binding_id = '${ID(2)}'`)
  assert.equal(await fires(db, cmd), 1, 'lease vencido: chama')
  await db.exec('delete from calendar_private.outbox')
  await db.exec(`insert into calendar_private.outbox(binding_id) values ('${ID(3)}')`)
  assert.equal(await fires(db, cmd), 1, 'item novo: chama')
  assert.match((await calls(db))[0], /"mode": "deliver"/, 'continua no modo de entrega')
  await db.exec(`delete from calendar_private.outbox; insert into calendar_private.activation_seeds values ('${ID(40)}', null, 'cal-1')`)
  assert.equal(await fires(db, cmd), 1, 'ativacao pendente: chama')
  await pressure(db, true); assert.equal(await fires(db, cmd), 0, 'sob pressao continua pulando')
  await pressure(db, false); await db.exec(`update calendar_private.connection set connection_status = 'error'`)
  assert.equal(await fires(db, cmd), 0, 'Google desconectado continua sem disparar (condicao original)')
})

test('horarios: os dois jobs do :00 saem do :00; o resto dos jobs fica identico', async () => {
  const db = await freshDb(); const before = await jobs(db)
  await db.exec(migration); const after = await jobs(db)
  assert.equal(after['meta-insights-sync-frequent'].schedule, '9,39 * * * *'); assert.equal(after['meta-insights-sync-deep'].schedule, '11 3 * * *')
  assert.equal(after['meta-insights-sync-frequent'].command, before['meta-insights-sync-frequent'].command)
  assert.equal(after['meta-insights-sync-deep'].command, before['meta-insights-sync-deep'].command)
  for (const name of Object.keys(before)) {
    if (['meta-lead-worker', 'google-calendar-deliver', 'meta-insights-sync-frequent', 'meta-insights-sync-deep'].includes(name)) continue
    assert.deepEqual(after[name], before[name], `${name}: nao pode mudar`)
  }
  for (const name of ['meta-lead-worker', 'google-calendar-deliver']) {
    assert.equal(after[name].schedule, before[name].schedule)
    assert.match(after[name].command, /AND NOT public\.db_under_pressure\(\);$/, `${name}: a guarda de pressao continua no fim`)
  }
  // nenhum job (fora o de 45 s) cai no minuto :00
  for (const j of Object.values(after)) if (!/seconds/.test(j.schedule)) assert(!/^(0|\*\/(5|10|15|30))\s/.test(j.schedule) || j.jobname === 'meta-leads-reconciliation-hourly', `${j.jobname} no :00`)
})

test('aplicar de novo nao muda nada (comandos ja ajustados sao reconhecidos)', async () => {
  const db = await freshDb(); await db.exec(migration); const once = await jobs(db)
  await db.exec(migration); assert.deepEqual(await jobs(db), once)
})

test('comando inesperado em producao: a migration falha alto e nao aplica nada', async () => {
  const odd = live.map(j => j.jobname === 'google-calendar-deliver' ? { ...j, command: j.command.replace('"deliver"', '"outro"') } : j)
  const db = await freshDb({ jobs: odd }); const before = await jobs(db)
  await assert.rejects(db.exec(migration), /google-calendar-deliver: comando diferente do esperado/)
  await db.exec('rollback').catch(() => undefined)
  assert.deepEqual(await jobs(db), before, 'nada mudou')
})

test('a reversao documentada no runbook devolve exatamente o estado anterior', async () => {
  const runbook = readFileSync('docs/RUNBOOK_BANCO_FORA_DO_AR.md', 'utf8').replace(/\r\n/g, '\n')
  const block = runbook.split('<!-- rollback-20261023210000 -->')[1].match(/```sql\n([\s\S]*?)```/)[1].replace(/^ {2}/gm, '')
  const db = await freshDb(); await seedCalendar(db)
  await db.exec(`insert into supabase_migrations.schema_migrations(version, name) values ('20261023210000', 'background_skip_idle_work')`)
  const before = await jobs(db); const scanBefore = await reconcileAll(db, 500)
  await db.exec(migration); assert.notDeepEqual(await jobs(db), before)
  await db.exec(block)
  assert.deepEqual(await jobs(db), before, 'jobs voltam ao texto e horario de antes')
  assert.deepEqual(await reconcileAll(db, 500), scanBefore, 'reconciliacao volta a pegar todas as calls')
  assert.equal((await q(db, `select count(*)::int as n from supabase_migrations.schema_migrations where version = '20261023210000'`))[0].n, 0)
})

let failed = 0
for (const t of tests) {
  try { await t.fn(); console.log('ok   ', t.name) } catch (e) { failed++; console.log('FALHA', t.name, '\n      ', e.message) }
}
console.log(failed ? `\n${failed} de ${tests.length} falharam` : `\n${tests.length}/${tests.length} ok`)
process.exit(failed ? 1 : 0)
