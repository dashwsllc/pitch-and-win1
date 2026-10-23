// Banco descartavel (PGlite) com um pg_cron simulado carregando os textos REAIS dos 15 jobs de producao (scripts/fixtures/cron-jobs-live-2026-10-23.json). Nada toca producao.
// Migration 20261023150000_background_load_guards: guarda de pressao, horarios espalhados, tetos de tempo nas varreduras, transacao pendurada da API encerrada em 20 s.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const dir = process.env.GUARDS_MIGRATIONS_DIR ?? 'supabase/migrations/'   // so a checagem de mutacao troca a pasta
const FILE = '20261023150000_background_load_guards.sql'
const migration = readFileSync(dir + FILE, 'utf8').replace(/\r\n/g, '\n')
const live = JSON.parse(readFileSync('scripts/fixtures/cron-jobs-live-2026-10-23.json', 'utf8'))
const q = (db, sql, p) => db.query(sql, p).then(r => r.rows)

async function freshDb({ cron = true, authenticator = true, jobs = live } = {}) {
  const db = new PGlite()
  await db.exec(`
create role anon; create role authenticated; create role service_role; ${authenticator ? 'create role authenticator;' : ''}
create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
create table public.stub_calls(id bigserial primary key, what text not null);
create function public.arena_tick() returns void language sql as $$insert into public.stub_calls(what) values ('arena_tick')$$;
create function public.crm_context_reconcile(integer) returns jsonb language sql as $$insert into public.stub_calls(what) values ('reconcile'); select '{}'::jsonb$$;
create function public.meta_refresh_form_contexts() returns jsonb language sql as $$insert into public.stub_calls(what) values ('refresh'); select '{}'::jsonb$$;
create function public.meta_link_site_answers(boolean) returns jsonb language sql as $$insert into public.stub_calls(what) values ('site_link'); select '{}'::jsonb$$;
-- o necessario para os comandos net.http_post dos jobs reais rodarem de verdade (com assinatura do pg_net)
create schema net; create schema vault; create schema calendar_private;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds integer default 5000)
  returns bigint language sql as $$insert into public.stub_calls(what) values ('http:' || url) returning id$$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('meta_cron_anon_key','a'),('meta_sync_cron_secret','b'),('google_calendar_cron_anon_key','c'),('google_calendar_cron_secret','d');
create table calendar_private.connection(connection_status text, activated_at timestamptz); insert into calendar_private.connection values ('connected', now());
create table public.meta_sync_runs(kind text, status text, level text); insert into public.meta_sync_runs values ('insights','running','campaign');
${cron ? `create schema cron; create table cron.job(jobid bigint primary key, jobname text unique, schedule text, command text, active boolean default true, username text default 'postgres', database text default 'postgres');
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as $$
  update cron.job set schedule = coalesce($2, schedule), command = coalesce($3, command), active = coalesce($6, active) where jobid = $1 $$;` : ''}`)
  if (cron) for (const j of jobs) await db.query('insert into cron.job(jobid, jobname, schedule, command, active) values ($1,$2,$3,$4,$5)', [j.jobid, j.jobname, j.schedule, j.command, j.active])
  return db
}
const jobsOf = db => q(db, 'select jobid, jobname, schedule, command, active from cron.job order by jobid')
const byName = rows => Object.fromEntries(rows.map(r => [r.jobname, r]))
const calls = async db => (await q(db, 'select what from public.stub_calls order by id')).map(r => r.what)
const reset = db => db.exec('truncate public.stub_calls')

// ---------- antes: nenhum job tem guarda; arena a cada 15 s; varredura da ponte a cada 15 min ----------
const db = await freshDb()
const before = byName(await jobsOf(db))
assert(Object.values(before).every(j => !/db_under_pressure/.test(j.command)), 'antes nao ha guarda nenhuma')
assert.equal(before['arena-cycle-deadlines'].schedule, '15 seconds'); assert.equal(before['crm-context-reconcile'].schedule, '*/15 * * * *')

// ---------- a migration ----------
await db.exec(migration)
const after = byName(await jobsOf(db))
const GUARDED = ['arena-cycle-deadlines', 'crm-context-reconcile', 'meta-form-context-refresh', 'meta-site-form-link', 'google-calendar-reconcile', 'google-calendar-deliver', 'meta-lead-worker', 'meta-insights-resume', 'meta-leads-reconciliation-hourly', 'meta-insights-sync-frequent']
for (const name of GUARDED) assert.match(after[name].command, /AND NOT public\.db_under_pressure\(\)|WHERE NOT public\.db_under_pressure\(\)/, `${name}: precisa da guarda de pressao`)
assert.equal(after['arena-cycle-deadlines'].schedule, '45 seconds')
assert.equal(after['crm-context-reconcile'].schedule, '7,22,37,52 * * * *'); assert.match(after['crm-context-reconcile'].command, /crm_context_reconcile\(40\)/, 'lote menor (era 150)')
assert.equal(after['meta-form-context-refresh'].schedule, '4,34 * * * *')
assert.equal(after['meta-site-form-link'].schedule, '3,13,23,33,43,53 * * * *')
assert.equal(after['google-calendar-reconcile'].schedule, '1,16,31,46 * * * *')
for (const name of ['google-calendar-deliver', 'meta-lead-worker', 'meta-insights-resume', 'meta-leads-reconciliation-hourly', 'meta-insights-sync-frequent'])
  assert.equal(after[name].schedule, before[name].schedule, `${name}: o horario nao muda (so ganha a guarda)`)
// as varreduras pesadas NUNCA caem no mesmo minuto (foi a coincidencia no minuto :00 que derrubou o banco em 23/10)
{
  const minutes = name => new Set(after[name].schedule.split(' ')[0].split(',').map(Number))
  const heavy = ['crm-context-reconcile', 'meta-form-context-refresh', 'meta-site-form-link', 'google-calendar-reconcile']
  for (let i = 0; i < heavy.length; i++) for (let j = i + 1; j < heavy.length; j++) {
    const clash = [...minutes(heavy[i])].filter(m => minutes(heavy[j]).has(m))
    assert.deepEqual(clash, [], `${heavy[i]} e ${heavy[j]} caem no mesmo minuto: ${clash}`)
  }
  assert(![...minutes('crm-context-reconcile'), ...minutes('meta-form-context-refresh'), ...minutes('meta-site-form-link')].includes(0), 'nenhuma varredura pesada no minuto :00')
}
// varreduras pesadas: teto de tempo e de espera por trava no proprio comando
for (const name of ['crm-context-reconcile', 'meta-form-context-refresh', 'meta-site-form-link']) assert.match(after[name].command, /^SET statement_timeout='\d+s'; SET lock_timeout='3s'; SELECT /, `${name}: tetos de tempo`)
// o que a migration NAO decide continua exatamente igual (inclusive jobs ativos/inativos)
for (const name of ['crm-context-delivery', 'db-housekeeping', 'db-vacuum-cron-history', 'db-vacuum-net-responses', 'meta-insights-sync-deep']) assert.deepEqual(after[name], before[name], `${name}: nao pode mudar`)
for (const name of Object.keys(before)) assert.equal(after[name].active, before[name].active)
// as guardas nao mudaram o resto do comando dos jobs de HTTP (so acrescentaram uma condicao no fim)
for (const name of ['google-calendar-deliver', 'google-calendar-reconcile', 'meta-lead-worker', 'meta-insights-resume', 'meta-leads-reconciliation-hourly', 'meta-insights-sync-frequent']) {
  const stripped = after[name].command.replace(' AND NOT public.db_under_pressure();', '')
  assert.equal(stripped, before[name].command.replace(/\s*;?\s*$/, ''), `${name}: so a condicao final foi acrescentada`)
}

// ---------- os comandos novos funcionam de verdade, e PULAM sob pressao ----------
const runnable = ['arena-cycle-deadlines', 'crm-context-reconcile', 'meta-form-context-refresh', 'meta-site-form-link', 'google-calendar-reconcile', 'google-calendar-deliver', 'meta-lead-worker', 'meta-insights-resume', 'meta-leads-reconciliation-hourly', 'meta-insights-sync-frequent']
await reset(db)
for (const name of runnable) await db.exec(after[name].command)
const fired = await calls(db)
assert.equal(fired.length, runnable.length, `sem pressao todos disparam: ${fired}`)
assert(fired.includes('arena_tick') && fired.includes('reconcile') && fired.includes('refresh') && fired.includes('site_link'))
assert.equal(fired.filter(x => x.startsWith('http:')).length, 6)
await db.exec(`create or replace function public.db_under_pressure(p_active integer default 12, p_total integer default 48) returns boolean language sql as $$select true$$`)
await reset(db)
for (const name of runnable) await db.exec(after[name].command)
assert.deepEqual(await calls(db), [], 'sob pressao NENHUM dispara')
await db.exec(`create or replace function public.db_under_pressure(p_active integer default 12, p_total integer default 48) returns boolean language sql as $$select false$$`)
await reset(db)
for (const name of ['arena-cycle-deadlines', 'meta-lead-worker']) await db.exec(after[name].command)
assert.equal((await calls(db)).length, 2, 'e volta a disparar quando a pressao passa')
// as condicoes ORIGINAIS dos jobs continuam valendo (sem segredo, sem conexao Google, sem captura em andamento: nao dispara)
await db.exec('delete from vault.decrypted_secrets where name = \'meta_sync_cron_secret\''); await reset(db)
await db.exec(after['meta-lead-worker'].command); assert.deepEqual(await calls(db), [], 'sem segredo nao dispara (condicao original preservada)')
await db.exec('update calendar_private.connection set connection_status = \'error\''); await reset(db)
await db.exec(after['google-calendar-deliver'].command); assert.deepEqual(await calls(db), [], 'Google desconectado nao dispara (condicao original preservada)')
await db.exec('delete from public.meta_sync_runs'); await reset(db)
await db.exec(after['meta-insights-resume'].command); assert.deepEqual(await calls(db), [], 'sem captura em andamento nao dispara (condicao original preservada)')

// ---------- a funcao de pressao, com sessoes fabricadas (o PGlite so tem uma) ----------
{
  const fake = async (rows) => {
    const d = await freshDb(); await d.exec(migration)
    const values = rows.length ? rows.map(r => `(${r.pid}, '${r.app}', ${r.state === null ? 'null' : `'${r.state}'`})`).join(',') : ''
    await d.exec(`create or replace function public.db_pressure_sessions() returns table(pid integer, app text, state text) language sql as $$ ${values ? `select * from (values ${values}) v(pid, app, state)` : "select null::int, null::text, null::text where false"} $$`)
    return async (a, t) => (await q(d, `select public.db_under_pressure(${a ?? 12}, ${t ?? 48}) v`))[0].v
  }
  const many = (n, app, state, from = 1000) => Array.from({ length: n }, (_, i) => ({ pid: from + i, app, state }))
  let under = await fake([]); assert.equal(await under(), false, 'sem sessoes: sem pressao')
  under = await fake(many(30, 'pg_cron scheduler', 'active')); assert.equal(await under(), false, '30 jobs do pg_cron ativos NAO contam (senao se bloqueariam entre si)')
  under = await fake([...many(30, 'pg_cron', 'active'), ...many(11, 'PostgREST 14.5', 'active', 2000)]); assert.equal(await under(), false, '11 consultas da API + cron: abaixo do limite')
  under = await fake(many(12, 'PostgREST 14.5', 'active')); assert.equal(await under(), true, '12 consultas ativas fora do cron = pressao')
  under = await fake(many(12, 'supabase/dashboard', 'idle in transaction')); assert.equal(await under(), true, 'transacao aberta conta como ocupada')
  under = await fake(many(40, 'PostgREST 14.5', 'idle')); assert.equal(await under(), false, '40 conexoes ociosas: ainda ha folga')
  under = await fake(many(48, 'PostgREST 14.5', 'idle')); assert.equal(await under(), true, '48 conexoes (quase as 60): pressao mesmo ociosas')
  under = await fake(many(47, 'PostgREST 14.5', 'idle')); assert.equal(await under(), false, '47: ainda nao')
  under = await fake(many(20, 'PostgREST 14.5', null)); assert.equal(await under(), false, 'sessoes sem estado visivel nao contam como ativas')
  under = await fake([{ pid: 1, app: 'PostgREST 14.5', state: 'active' }]); assert.equal(await under(1, 48), true, 'limite configuravel')
}
// ---------- a funcao de pressao ----------
const dbp = await freshDb()
await dbp.exec(migration)
assert.equal((await q(dbp, 'select public.db_under_pressure() v'))[0].v, false, 'banco ocioso: sem pressao')
assert.equal((await q(dbp, 'select public.db_under_pressure(0, 48) v'))[0].v, true, 'limite de ativas 0: sempre pressao')
assert.equal((await q(dbp, 'select public.db_under_pressure(12, 0) v'))[0].v, true, 'limite de conexoes 0: sempre pressao')
const status = (await q(dbp, 'select public.db_pressure_status() s'))[0].s
for (const k of ['sob_pressao', 'conexoes', 'ativas_fora_do_cron', 'cron_em_execucao', 'mais_antiga_ativa_s']) assert(k in status, `status tem ${k}`)
for (const role of ['anon', 'authenticated', 'service_role']) for (const fn of ['db_under_pressure(integer,integer)', 'db_pressure_status()'])
  assert.equal((await q(dbp, `select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') v`))[0].v, false, `${role} nao executa ${fn}`)

// ---------- transacao pendurada da API ----------
assert.match((await q(db, `select rolconfig::text c from pg_roles where rolname = 'authenticator'`))[0].c, /idle_in_transaction_session_timeout=20s/)

// ---------- reaplicar nao muda nada ----------
const once = JSON.stringify(await jobsOf(db))
await db.exec(migration)
assert.equal(JSON.stringify(await jobsOf(db)), once, 'segunda execucao e idempotente (nao duplica a guarda)')

// ---------- casos de borda ----------
{
  const semWhere = await freshDb({ jobs: [{ jobid: 7, jobname: 'meta-insights-resume', schedule: '* * * * *', command: 'SELECT 1', active: true }] })
  await semWhere.exec(migration)   // nao falha
  assert.equal((await jobsOf(semWhere))[0].command, 'SELECT 1', 'comando sem WHERE nao e adivinhado: fica como esta')
  const semCron = await freshDb({ cron: false })
  await semCron.exec(migration)   // sem pg_cron nao falha, so cria as funcoes
  assert.equal((await q(semCron, 'select public.db_under_pressure() v'))[0].v, false)
  const semPapel = await freshDb({ authenticator: false })
  await semPapel.exec(migration)  // sem o papel authenticator: aviso, nao erro
  assert.equal((await jobsOf(semPapel)).filter(j => /db_under_pressure/.test(j.command)).length, 10)
  const semJob = await freshDb({ jobs: live.filter(j => j.jobname !== 'arena-cycle-deadlines') })
  await semJob.exec(migration)    // job ausente: pula sem erro
  assert.equal((await jobsOf(semJob)).filter(j => /db_under_pressure/.test(j.command)).length, 9)
}

// ---------- o script preflight/apply/rollback ----------
const generated = mode => {
  const r = spawnSync(process.execPath, ['scripts/apply-background-guards-migration.mjs', mode, '--print'], { encoding: 'utf8', env: { ...process.env, GUARDS_MIGRATIONS_DIR: dir.replace(/\/$/, '') } })
  assert.equal(r.status, 0, r.stderr); return readFileSync(r.stdout.trim(), 'utf8').replace(/\r\n/g, '\n')
}
{
  const d = await freshDb(), original = JSON.stringify(await jobsOf(d))
  const rollbackSql = generated('rollback')
  const saved = (await q(d, rollbackSql))[0].comandos   // comandos que devolvem os jobs ao estado de antes
  await assert.rejects(d.exec(generated('preflight')), e => {
    assert.match(e.message, /PREFLIGHT_GUARDS_OK/)
    const r = JSON.parse(e.message.slice(e.message.indexOf('{')))
    assert.deepEqual(r['crm-context-reconcile'], ['7,22,37,52 * * * *', true]); assert.deepEqual(r['meta-lead-worker'], ['* * * * *', true]); assert.equal(r.sob_pressao, false)
    assert(e.message.length < 900, `a mensagem precisa caber no que a CLI mostra (${e.message.length})`)
    return true
  }, 'o ensaio sempre termina em excecao com o resumo')
  await d.exec('rollback').catch(() => {})
  assert.equal(JSON.stringify(await jobsOf(d)), original, 'o ensaio nao pode alterar nada')
  await d.exec(generated('apply'))
  assert.equal((await jobsOf(d)).filter(j => /db_under_pressure/.test(j.command)).length, 10)
  assert.equal((await q(d, 'select version from supabase_migrations.schema_migrations'))[0].version, '20261023150000')
  await assert.rejects(d.exec(generated('apply')), /ja instalada/, 'nao reinstala')
  await d.exec('rollback').catch(() => {})
  await d.exec(saved)   // reversao: devolve os jobs exatamente como estavam
  assert.equal(JSON.stringify(await jobsOf(d)), original, 'a reversao gerada ANTES do apply restaura os jobs exatamente')
}

// ---------- regra para o futuro: nenhum job novo do pg_cron sem guarda, sem teto de tempo e fora do minuto :00 ----------
{
  const { readdirSync } = await import('node:fs')
  const later = readdirSync(dir).filter(f => f.endsWith('.sql') && f > FILE)
  const offenders = []
  for (const f of later) {
    const text = readFileSync(dir + f, 'utf8')
    if (!/cron\.schedule\s*\(/i.test(text)) continue
    if (/--\s*guard-exempt:\s*\S+/i.test(text)) continue   // comentario "-- guard-exempt: <motivo>" documenta a excecao
    if (!/db_under_pressure\s*\(/.test(text)) offenders.push(`${f}: cron.schedule sem "WHERE NOT public.db_under_pressure()"`)
    if (!/statement_timeout/i.test(text)) offenders.push(`${f}: cron.schedule sem statement_timeout`)
    // minuto :00 explícito ("0 ...") ou passos que começam no :00 ("*/5", "*/10", "*/15", "*/30"): coincidem com os outros jobs
    for (const m of text.matchAll(/cron\.schedule\s*\(\s*'[^']+'\s*,\s*'([^']+)'/gi)) if (/^(0|\*\/(5|10|15|30))\s/.test(m[1])) offenders.push(`${f}: horario "${m[1]}" cai no minuto :00 (espalhe: o colapso de 23/10 comecou com 5 jobs pesados no :00)`)
  }
  assert.deepEqual(offenders, [], `jobs novos do pg_cron precisam de guarda de pressao, teto de tempo e horario fora do :00 (ou "-- guard-exempt: motivo"):\n${offenders.join('\n')}`)
}

console.log(`OK: ${GUARDED.length} jobs com guarda (${runnable.length} comandos executados de verdade, todos pulam sob pressao e preservam a condicao original); horarios espalhados; ${Object.keys(before).length - GUARDED.length} jobs intocados; authenticator com teto de 20 s; idempotente; reversao testada.`)
