// Banco descartavel (PGlite) com dashboard_signal / meta_changed_signal copiados de producao (23/10) e os gatilhos ORIGINAIS de meta_sync_runs e
// meta_webhook_events. Nada toca producao.
// Migration 20261023200000_background_signals_only_on_change: o trabalho de fundo da Meta so sinaliza o dashboard quando algo muda de verdade.
// Rodar: node scripts/verify-background-signals-db.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const file = process.env.SIGNALS_MIGRATION ?? 'supabase/migrations/20261023200000_background_signals_only_on_change.sql'   // so a checagem de mutacao troca o arquivo
const migration = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

// Estado de producao antes da migration (funcoes com o texto de producao; gatilhos de 20260927140000 e 20260927160000).
const BASE = `
create table public.dashboard_events(topic text primary key, revision bigint not null default 0, updated_at timestamptz not null default now());
insert into public.dashboard_events(topic) values ('arena'), ('crm');
create function public.dashboard_signal() returns trigger language plpgsql as $$
BEGIN
  UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp()
    WHERE topic = TG_ARGV[0];
  RETURN NULL;
END;
$$;
create function public.meta_changed_signal() returns trigger language plpgsql as $$
DECLARE changed boolean; signal_topic text;
BEGIN
 IF TG_OP='INSERT' THEN SELECT EXISTS(SELECT 1 FROM meta_signal_new) INTO changed;
 ELSIF TG_OP='DELETE' THEN SELECT EXISTS(SELECT 1 FROM meta_signal_old) INTO changed;
 ELSE SELECT EXISTS(SELECT to_jsonb(n)-'updated_at' FROM meta_signal_new n EXCEPT SELECT to_jsonb(o)-'updated_at' FROM meta_signal_old o)
   OR EXISTS(SELECT to_jsonb(o)-'updated_at' FROM meta_signal_old o EXCEPT SELECT to_jsonb(n)-'updated_at' FROM meta_signal_new n) INTO changed;
 END IF;
 IF changed THEN FOREACH signal_topic IN ARRAY TG_ARGV LOOP
   UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE dashboard_events.topic=signal_topic;
 END LOOP; END IF;
 RETURN NULL;
END $$;
create table public.meta_sync_runs(id uuid primary key default gen_random_uuid(), kind text not null, triggered_by text not null check (triggered_by in ('cron','manual')),
  status text not null default 'running', rows_synced integer, page_count integer not null default 0, lease_until timestamptz, finished_at timestamptz);
create table public.meta_webhook_events(id uuid primary key default gen_random_uuid(), leadgen_id text not null, page_id text not null default '',
  status text not null default 'pending', processing_attempts integer not null default 0, lease_until timestamptz, claim_token uuid,
  next_attempt_at timestamptz not null default clock_timestamp(), received_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp());
CREATE TRIGGER meta_sync_runs_signal AFTER INSERT OR UPDATE ON public.meta_sync_runs FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER meta_webhook_events_signal AFTER INSERT OR UPDATE ON public.meta_webhook_events FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
`
// O UPDATE de meta_lead_events_claim (texto de producao), sem evento vencido na fila ele nao altera nenhuma linha.
const CLAIM = `WITH due AS (SELECT e.id FROM public.meta_webhook_events e WHERE e.page_id = ANY($1) AND
   ((e.status IN ('pending','error') AND e.next_attempt_at <= clock_timestamp()) OR (e.status = 'processing' AND e.lease_until <= clock_timestamp()))
   ORDER BY e.next_attempt_at, e.received_at, e.id FOR UPDATE SKIP LOCKED LIMIT 10)
 UPDATE public.meta_webhook_events e SET status = 'processing', claim_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '60 seconds',
   processing_attempts = e.processing_attempts + 1, updated_at = clock_timestamp() FROM due WHERE e.id = due.id`

async function freshDb(withMigration) {
  const db = new PGlite()
  await db.exec(BASE)
  if (withMigration) await db.exec(migration)
  return db
}
const rev = async (db, topic) => Number((await db.query('select revision from public.dashboard_events where topic = $1', [topic])).rows[0].revision)
// Quantos sinais (arena, crm) uma acao produz.
async function signals(db, action) {
  const before = [await rev(db, 'arena'), await rev(db, 'crm')]
  await action()
  return { arena: await rev(db, 'arena') - before[0], crm: await rev(db, 'crm') - before[1] }
}
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]

// Ciclo do robo da Meta sem nada novo (o que acontece a cada minuto): inicia execucao automatica, pagina sem linhas, finaliza com 0; reivindica fila vazia.
async function idleWorkerMinute(db) {
  const run = await one(db, `insert into public.meta_sync_runs(kind, triggered_by) values ('leads_reconciliation', 'cron') returning id`)
  await db.query(`update public.meta_sync_runs set lease_until = now() + interval '60 seconds' where id = $1`, [run.id])
  await db.query(`update public.meta_sync_runs set status = 'running' where kind = 'insights' and status = 'running' and lease_until < now()`) // nao casa nenhuma linha
  await db.query(`update public.meta_sync_runs set status = 'success', rows_synced = 0, finished_at = clock_timestamp() where id = $1 and status = 'running'`, [run.id])
  await db.query(CLAIM, [['page-1']])
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('sensibilidade: ANTES da migration, um minuto ocioso do robo ja sinalizava arena e crm', async () => {
  const db = await freshDb(false)
  const s = await signals(db, () => idleWorkerMinute(db))
  assert.ok(s.arena >= 4 && s.crm >= 1, `esperava ruido antes da migration, veio ${JSON.stringify(s)}`)
})

test('minuto ocioso do robo (execucao automatica sem linhas + fila vazia) nao sinaliza nada', async () => {
  const db = await freshDb(true)
  assert.deepEqual(await signals(db, () => idleWorkerMinute(db)), { arena: 0, crm: 0 })
})

test('execucao automatica que traz linhas sinaliza arena uma vez ao terminar (pagina intermediaria nao)', async () => {
  const db = await freshDb(true)
  const run = await one(db, `insert into public.meta_sync_runs(kind, triggered_by) values ('leads_reconciliation', 'cron') returning id`)
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_sync_runs set page_count = page_count + 1, rows_synced = coalesce(rows_synced, 0) + 3 where id = $1`, [run.id])), { arena: 0, crm: 0 })
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_sync_runs set status = 'success', finished_at = clock_timestamp() where id = $1`, [run.id])), { arena: 1, crm: 0 })
})

test('execucao automatica que falha depois de trazer linhas tambem sinaliza', async () => {
  const db = await freshDb(true)
  const run = await one(db, `insert into public.meta_sync_runs(kind, triggered_by, rows_synced) values ('insights', 'cron', 5) returning id`)
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_sync_runs set status = 'error', finished_at = clock_timestamp() where id = $1`, [run.id])), { arena: 1, crm: 0 })
})

test('execucao manual sinaliza ao comecar e ao terminar, mesmo com 0 linhas', async () => {
  const db = await freshDb(true)
  let run
  assert.deepEqual(await signals(db, async () => { run = await one(db, `insert into public.meta_sync_runs(kind, triggered_by) values ('insights', 'manual') returning id`) }), { arena: 1, crm: 0 })
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_sync_runs set lease_until = now() where id = $1`, [run.id])), { arena: 0, crm: 0 })
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_sync_runs set status = 'success', rows_synced = 0, finished_at = clock_timestamp() where id = $1`, [run.id])), { arena: 1, crm: 0 })
})

test('lead novo pelo webhook sinaliza crm; a reivindicacao dele tambem; reenvio identico nao', async () => {
  const db = await freshDb(true)
  let ev
  assert.deepEqual(await signals(db, async () => { ev = await one(db, `insert into public.meta_webhook_events(leadgen_id, page_id) values ('lg-1', 'page-1') returning id`) }), { arena: 0, crm: 1 })
  assert.deepEqual(await signals(db, () => db.query(CLAIM, [['page-1']])), { arena: 0, crm: 1 })
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_webhook_events set status = 'done' where id = $1`, [ev.id])), { arena: 0, crm: 1 })
  assert.deepEqual(await signals(db, () => db.query(`update public.meta_webhook_events set status = 'done', updated_at = clock_timestamp() where id = $1`, [ev.id])), { arena: 0, crm: 0 })
  assert.deepEqual(await signals(db, () => db.query(`insert into public.meta_webhook_events(leadgen_id, page_id) select 'x', 'y' where false`)), { arena: 0, crm: 0 })
})

test('rollback nao vaza sinal', async () => {
  const db = await freshDb(true)
  const s = await signals(db, async () => {
    await db.query('begin')
    await db.query(`insert into public.meta_sync_runs(kind, triggered_by) values ('insights', 'manual')`)
    await db.query(`insert into public.meta_webhook_events(leadgen_id) values ('lg-r')`)
    await db.query('rollback')
  })
  assert.deepEqual(s, { arena: 0, crm: 0 })
})

test('os gatilhos incondicionais antigos sumiram e os novos existem', async () => {
  const db = await freshDb(true)
  const names = (await db.query(`select tgname from pg_trigger where not tgisinternal and tgrelid in ('public.meta_sync_runs'::regclass, 'public.meta_webhook_events'::regclass) order by 1`)).rows.map(r => r.tgname)
  assert.deepEqual(names, ['meta_sync_runs_signal_manual_start', 'meta_sync_runs_signal_status', 'meta_webhook_events_signal_insert', 'meta_webhook_events_signal_update'])
})

test('reaplicar a migration falha alto em vez de duplicar gatilhos', async () => {
  const db = await freshDb(true)
  await assert.rejects(db.exec(migration), /already exists/)
})

let failed = 0
for (const t of tests) {
  try { await t.fn(); console.log('ok   ', t.name) } catch (e) { failed++; console.log('FALHA', t.name, '\n      ', e.message) }
}
console.log(failed ? `\n${failed} de ${tests.length} falharam` : `\n${tests.length}/${tests.length} ok`)
process.exit(failed ? 1 : 0)
