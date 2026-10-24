// Banco descartavel (PGlite). Nada toca producao.
// Migration 20261024010000_db_pressure_history: foto da pressao do banco a cada 5 min numa tabela que sobrevive a reinicio, com retencao, sem dados pessoais e sem permissao para a API.
// Rodar: node scripts/verify-db-pressure-history-db.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname as dirOf } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const file = process.env.PRESSURE_MIGRATION ?? 'supabase/migrations/20261024010000_db_pressure_history.sql'   // so a checagem de mutacao troca o arquivo
const migration = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const q = (db, sql, p) => db.query(sql, p).then(r => r.rows)

// Funcoes de pressao como estao em producao (migration 20261023150000), para a foto chamar a de verdade.
const GUARD_FUNCTIONS = `
CREATE FUNCTION public.db_pressure_sessions() RETURNS TABLE(pid integer, app text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.pid, a.application_name::text, a.state::text FROM pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend'
$$;
CREATE FUNCTION public.db_under_pressure(p_active integer DEFAULT 12, p_total integer DEFAULT 48) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(count(*) FILTER (WHERE s.state <> 'idle' AND s.app NOT LIKE 'pg_cron%' AND s.pid <> pg_backend_pid()) >= p_active OR count(*) >= p_total, false)
    FROM public.db_pressure_sessions() s
$$;
CREATE FUNCTION public.db_pressure_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('sob_pressao', public.db_under_pressure(),
    'conexoes', count(*), 'ativas_fora_do_cron', count(*) FILTER (WHERE a.state <> 'idle' AND a.application_name NOT LIKE 'pg_cron%' AND a.pid <> pg_backend_pid()),
    'cron_em_execucao', count(*) FILTER (WHERE a.application_name LIKE 'pg_cron%' AND a.state <> 'idle'),
    'mais_antiga_ativa_s', coalesce(round(max(extract(epoch FROM now() - a.query_start)) FILTER (WHERE a.state = 'active' AND a.pid <> pg_backend_pid())), 0))
    FROM pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend'
$$;`

async function freshDb({ cron = true, withCronDetails = true } = {}) {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
-- como no Supabase: tudo que nasce em public ja vem com acesso total para anon/authenticated/service_role (por isso o REVOKE da migration precisa existir de verdade)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
${cron ? `create schema cron;
create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
${withCronDetails ? `create table cron.job_run_details(runid bigserial primary key, jobid bigint, status text, start_time timestamptz, end_time timestamptz, command text);` : ''}
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values ($1, $2, $3) returning jobid $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = $1 returning true $$;` : ''}
${GUARD_FUNCTIONS}`)
  return db
}
const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('a migration cria tabela, funcoes e o job; ninguem da API tem acesso', async () => {
  const db = await freshDb(); await db.exec(migration)
  const [{ rls }] = await q(db, `select relrowsecurity as rls from pg_class where oid = 'public.db_pressure_history'::regclass`)
  assert.equal(rls, true, 'RLS ligado')
  assert.equal((await q(db, `select count(*)::int as n from pg_policies where tablename = 'db_pressure_history'`))[0].n, 0, 'sem politica: nem com RLS desligado por engano alguem leria')
  for (const role of ['anon', 'authenticated', 'service_role', 'public']) {
    const [{ t }] = await q(db, `select has_table_privilege($1, 'public.db_pressure_history', 'select,insert,update,delete') as t`, [role === 'public' ? 'anon' : role])
    assert.equal(t, false, `${role} nao pode tocar na tabela`)
    for (const fn of ['db_pressure_snapshot()', 'db_pressure_mask(text)']) {
      const [{ ok }] = await q(db, `select has_function_privilege($1, 'public.${fn}', 'execute') as ok`, [role === 'public' ? 'anon' : role]); assert.equal(ok, false, `${role} nao executa ${fn}`)
    }
  }
})

test('a foto grava UMA linha com todos os campos e devolve o id', async () => {
  const db = await freshDb(); await db.exec(migration)
  await db.exec(`insert into cron.job_run_details(jobid, status, start_time, end_time) values (1, 'succeeded', now() - interval '2 minutes', now() - interval '2 minutes' + interval '3 seconds'),
    (1, 'failed', now() - interval '3 minutes', now() - interval '3 minutes' + interval '40 seconds'), (2, 'running', now() - interval '20 seconds', null),
    (3, 'failed', now() - interval '3 hours', now() - interval '3 hours')`)
  const [{ id }] = await q(db, 'select public.db_pressure_snapshot() as id'); assert(Number(id) > 0)
  const rows = await q(db, 'select * from public.db_pressure_history'); assert.equal(rows.length, 1)
  const r = rows[0]
  for (const k of ['conexoes', 'ativas_fora_do_cron', 'cron_em_execucao', 'mais_antiga_ativa_s', 'sob_pressao']) assert(k in r.pressao, `pressao.${k}`)
  assert.equal(r.pressao.erro, undefined)
  assert.equal(r.cron.rodando, 1); assert.equal(r.cron.falhas_10min, 1, 'so a falha dos ultimos 10 min conta'); assert.equal(r.cron.mais_lento_s, 40)
  for (const k of ['commits', 'rollbacks', 'deadlocks', 'temp_bytes', 'blks_read']) assert(k in r.banco, `banco.${k}`)
  assert(Date.now() - new Date(r.taken_at).getTime() < 60000)
})

test('uma parte que falha nao impede a foto (cron indisponivel vira {"erro": ...})', async () => {
  const db = await freshDb({ withCronDetails: false }); await db.exec(migration)
  const [{ id }] = await q(db, 'select public.db_pressure_snapshot() as id'); assert(Number(id) > 0)
  const [r] = await q(db, 'select * from public.db_pressure_history')
  assert.ok(r.cron.erro, 'cron marcado como erro'); assert.equal(r.pressao.erro, undefined, 'o resto da foto saiu normal'); assert('commits' in r.banco)
  const db2 = await freshDb(); await db2.exec(migration); await db2.exec('drop function public.db_pressure_status()')   // pressao quebrada
  await q(db2, 'select public.db_pressure_snapshot()'); const [r2] = await q(db2, 'select * from public.db_pressure_history')
  assert.ok(r2.pressao.erro, 'pressao marcada como erro'); assert('commits' in r2.banco)
})

test('retencao: apaga o que passou de 7 dias, em lote de 500, e guarda o resto', async () => {
  const db = await freshDb(); await db.exec(migration)
  await db.exec(`insert into public.db_pressure_history(taken_at) select now() - interval '8 days' - make_interval(mins => g) from generate_series(1, 700) g;
    insert into public.db_pressure_history(taken_at) values (now() - interval '6 days 23 hours'), (now() - interval '1 hour')`)
  await q(db, 'select public.db_pressure_snapshot()')
  assert.equal((await q(db, `select count(*)::int as n from public.db_pressure_history where taken_at < now() - interval '7 days'`))[0].n, 200, '500 apagadas por foto, 200 ficam para a proxima')
  await q(db, 'select public.db_pressure_snapshot()')
  assert.equal((await q(db, `select count(*)::int as n from public.db_pressure_history where taken_at < now() - interval '7 days'`))[0].n, 0)
  assert.equal((await q(db, 'select count(*)::int as n from public.db_pressure_history'))[0].n, 2 + 2, 'as 2 recentes + 2 fotos novas')
})

test('o texto da consulta sai sem dados pessoais (literais, numeros longos, espacos)', async () => {
  const db = await freshDb(); await db.exec(migration)
  const mask = async s => (await q(db, 'select public.db_pressure_mask($1) as m', [s]))[0].m
  assert.equal(await mask(`select * from leads where email = 'maria@x.com' and phone = '5561999998888'`), `select * from leads where email = '?' and phone = '?'`)
  assert.equal(await mask(`update t set n = 'O''Brien', cpf = 12345678901 where id = 7`), `update t set n = '?', cpf = ? where id = 7`, 'aspas escapadas e CPF')
  assert.equal(await mask(`select   1\n\tfrom    t`), 'select 1 from t')
  assert.equal(await mask(null), ''); assert((await mask('x'.repeat(500))).length <= 120)
  assert.doesNotMatch(await mask(`select 'Authorization: Bearer eyJhbGciOi.secret.token'`), /eyJ|secret|Bearer/)
})

test('agenda: um job, fora do :00, com tetos de tempo, e reaplicar nao duplica', async () => {
  const db = await freshDb(); await db.exec(migration)
  let jobs = await q(db, `select jobname, schedule, command from cron.job where jobname = 'db-pressure-snapshot'`); assert.equal(jobs.length, 1)
  assert.equal(jobs[0].schedule, '5-55/5 * * * *'); assert.match(jobs[0].command, /statement_timeout='5s'/); assert.match(jobs[0].command, /lock_timeout='1s'/); assert.match(jobs[0].command, /public\.db_pressure_snapshot\(\)/)
  const minutes = []; for (let m = 5; m <= 55; m += 5) minutes.push(m); assert(!minutes.includes(0), 'nada no minuto :00')
  await db.exec(migration)
  assert.equal((await q(db, `select count(*)::int as n from cron.job where jobname = 'db-pressure-snapshot'`))[0].n, 1)
  await db.exec(`update cron.job set schedule = '* * * * *' where jobname = 'db-pressure-snapshot'`); await db.exec(migration)
  assert.equal((await q(db, `select schedule from cron.job where jobname = 'db-pressure-snapshot'`))[0].schedule, '5-55/5 * * * *', 'reaplicar corrige agenda alterada')
})

test('sem pg_cron a migration falha alto (e nao deixa a tabela pela metade)', async () => {
  const db = await freshDb({ cron: false })
  await assert.rejects(db.exec(migration), /pg_cron nao instalado/)
  await db.exec('rollback').catch(() => undefined)
  assert.equal((await q(db, `select to_regclass('public.db_pressure_history') as t`))[0].t, null, 'transacao desfeita')
})

test('o ensaio e a instalacao gerados pelo apply-migrations.mjs funcionam de verdade (e o ensaio desfaz tudo)', async () => {
  const gen = mode => {
    const r = spawnSync(process.execPath, ['scripts/apply-migrations.mjs', mode, '20261024010000', '--print'], { encoding: 'utf8', env: { ...process.env, APPLY_MIGRATIONS_DIR: dirOf(file) } })
    assert.equal(r.status, 0, r.stderr); return readFileSync(r.stdout.trim(), 'utf8').replace(/\r\n/g, '\n')
  }
  const withRegistry = async () => { const d = await freshDb(); await d.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[])`); return d }
  const db = await withRegistry()
  await assert.rejects(db.exec(gen('preflight')), err => {
    const m = /PREFLIGHT_OK (.*)/.exec(err.message); assert(m, err.message)
    const rep = JSON.parse(m[1])['20261024010000']
    assert.equal(rep.job, '5-55/5 * * * *'); assert(rep.foto && rep.foto.pressao && 'commits' in rep.foto.banco, 'o ensaio mostra uma foto de verdade, nao null'); return true
  })
  await db.exec('rollback').catch(() => undefined)
  assert.equal((await q(db, `select to_regclass('public.db_pressure_history') as t`))[0].t, null, 'ensaio desfez tudo')
  const db2 = await withRegistry(); await db2.exec(gen('apply'))
  assert.deepEqual((await q(db2, `select version, name from supabase_migrations.schema_migrations`)), [{ version: '20261024010000', name: 'db_pressure_history' }])
  await assert.rejects(db2.exec(gen('apply')), /ja instalada/, 'nao reinstala versao registrada')
})

test('a reversao documentada no runbook remove tudo e deixa o banco como antes', async () => {
  const runbook = readFileSync('docs/RUNBOOK_BANCO_FORA_DO_AR.md', 'utf8').replace(/\r\n/g, '\n')
  const block = runbook.split('<!-- rollback-20261024010000 -->')[1].match(/```sql\n([\s\S]*?)```/)[1].replace(/^ {2}/gm, '')
  const db = await freshDb(); await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
    insert into supabase_migrations.schema_migrations(version, name) values ('20261024010000', 'db_pressure_history')`)
  const objectsBefore = await q(db, `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)
  await db.exec(migration); await q(db, 'select public.db_pressure_snapshot()')
  await db.exec(block)
  assert.equal((await q(db, `select to_regclass('public.db_pressure_history') as t`))[0].t, null, 'tabela removida')
  assert.equal((await q(db, `select count(*)::int as n from cron.job where jobname = 'db-pressure-snapshot'`))[0].n, 0, 'job removido')
  assert.deepEqual(await q(db, `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`), objectsBefore, 'nenhuma funcao sobrou')
  assert.equal((await q(db, `select count(*)::int as n from supabase_migrations.schema_migrations`))[0].n, 0, 'registro removido')
})

test('a migration respeita as regras do repositorio: guard-exempt documentado e horario fora do :00', async () => {
  assert.match(migration, /--[ \t]*guard-exempt:[ \t]*\S+/)
  assert.doesNotMatch(migration, /40001/)
  // a sessao mais antiga so aparece de verdade com OUTRA conexao ativa (o PGlite tem uma so), entao o mascaramento dela e travado no texto:
  assert.match(migration, /'q',\s*public\.db_pressure_mask\(query\)/, 'o texto da consulta da sessao mais antiga passa pelo mascaramento')
  for (const m of migration.matchAll(/cron\.schedule\s*\(\s*'[^']+'\s*,\s*'([^']+)'/gi)) assert.doesNotMatch(m[1], /^(0|\*\/(5|10|15|30))\s/)
})

let failed = 0
for (const t of tests) {
  try { await t.fn(); console.log('ok   ', t.name) } catch (e) { failed++; console.log('FALHA', t.name, '\n      ', e.message) }
}
console.log(failed ? `\n${failed} de ${tests.length} falharam` : `\n${tests.length}/${tests.length} ok`)
process.exit(failed ? 1 : 0)
