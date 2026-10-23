// Banco descartavel (PGlite). Nada toca producao.
// Migration 20261023140000_rls_initplan_wrap: politicas de acesso (RLS) que chamam funcoes por linha passam a chama-las uma vez por consulta (InitPlan),
// sem mudar o que ninguem enxerga. Esquema fiel ao de producao: politicas permissivas e restritivas, WITH CHECK, ja embrulhadas, formas com argumento de linha.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const dir = process.env.RLS_MIGRATIONS_DIR ?? 'supabase/migrations/'   // so a checagem de mutacao troca a pasta (copia com a migration alterada)
const FILE = '20261023140000_rls_initplan_wrap.sql'
const migration = readFileSync(dir + FILE, 'utf8').replace(/\r\n/g, '\n')
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const EXEC = U(1), CLOSER = U(2), TRAFFIC = U(3), NOROLE = U(4), SUSP = U(5), GHOST = U(6)
const PEOPLE = { EXEC, CLOSER, TRAFFIC, NOROLE, SUSP, GHOST }

async function freshDb({ volatile = false } = {}) {
  const db = new PGlite()
  await db.exec(`
create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create type public.app_role as enum ('executive','super_admin','sdr','closer','seller','traffic_manager');
create table public.user_roles(user_id uuid not null, role public.app_role not null);
create table public.registration_requests(user_id uuid primary key, status text);
create table public.profiles(user_id uuid primary key, suspended boolean not null default false);
-- as funcoes de acesso de producao: STABLE + SECURITY DEFINER + search_path fixo
create function public.registration_has_access() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from registration_requests where user_id=auth.uid() and status='approved')$$;
create function public.dashboard_account_active() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from profiles p where p.user_id=auth.uid() and not p.suspended)$$;
create function public.crm_has_access() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=auth.uid() and r.role in('executive','super_admin','sdr','closer','seller'))$$;
create function public.traffic_has_access() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=auth.uid() and r.role in('executive','super_admin','traffic_manager'))$$;
create function public.is_executive(_u uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=_u and r.role in('executive','super_admin'))$$;
create function public.is_super_admin(_u uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=_u and r.role='super_admin')$$;
create function public.dashboard_require_access() returns void language plpgsql stable security definer set search_path=pg_catalog,public as $$begin if not exists(select 1 from profiles p where p.user_id=auth.uid() and not p.suspended) then raise exception 'Acesso nao autorizado' using errcode='42501'; end if; end$$;
create function public.get_user_role(_u uuid) returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$begin perform public.dashboard_require_access(); return (select r.role::text from user_roles r where r.user_id=_u order by r.role limit 1); end$$;
create function public.crm_can(_cap text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select (_cap='leads' and crm_has_access()) or (_cap='sales' and exists(select 1 from user_roles r where r.user_id=auth.uid() and r.role in('executive','closer')))$$;
create function public.arena_has_access(_strict boolean default false) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=auth.uid() and (r.role in('executive','super_admin') or (not _strict and r.role in('sdr','closer'))))$$;
create function public.meta_lead_inbox_access() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=auth.uid() and r.role in('sdr','closer'))$$;
-- funcao com argumento de LINHA: nao pode ser tocada
create function public.row_check(_o uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select _o=auth.uid()$$;

create table public.crm_leads(id int primary key, name text, closer_id uuid);
create table public.crm_activities(id int primary key, user_id uuid, note text);
create table public.vendas(id int primary key, user_id uuid, valor numeric);
create table public.dashboard_events(topic text primary key, revision bigint);
create table public.company_goals(id int primary key, scope text, target_role text, created_by uuid);
create table public.meta_form_leads(id int primary key, approval_status text);
create table public.crm_lead_contexts(id int primary key, lead_id int, content text);
create table public.notes(id int primary key, owner_id uuid);
create table public.rowdep(id int primary key, owner_id uuid);

insert into public.registration_requests values ('${EXEC}','approved'),('${CLOSER}','approved'),('${TRAFFIC}','approved'),('${NOROLE}','approved'),('${SUSP}','approved');
insert into public.profiles values ('${EXEC}',false),('${CLOSER}',false),('${TRAFFIC}',false),('${NOROLE}',false),('${SUSP}',true);
insert into public.user_roles values ('${EXEC}','executive'),('${EXEC}','super_admin'),('${CLOSER}','closer'),('${CLOSER}','seller'),('${TRAFFIC}','traffic_manager'),('${SUSP}','closer');
insert into public.crm_leads select g, 'lead '||g, case when g%2=0 then '${CLOSER}'::uuid else '${EXEC}'::uuid end from generate_series(1,40) g;
insert into public.crm_activities select g, case when g%3=0 then '${CLOSER}'::uuid else '${EXEC}'::uuid end, 'n'||g from generate_series(1,40) g;
insert into public.vendas select g, case when g%2=0 then '${CLOSER}'::uuid else '${EXEC}'::uuid end, g*10 from generate_series(1,30) g;
insert into public.dashboard_events values ('sales',5),('goals',3),('arena',9),('crm',12),('users',2);
insert into public.company_goals values (1,'global',null,'${EXEC}'),(2,'role','closer','${EXEC}'),(3,'role','sdr','${EXEC}'),(4,'role','traffic_manager','${EXEC}');
insert into public.meta_form_leads values (1,'aprovado'),(2,'pendente'),(3,'aprovado');
insert into public.crm_lead_contexts values (1,1,'a'),(2,2,'b');
insert into public.notes select g, case when g%2=0 then '${CLOSER}'::uuid else '${EXEC}'::uuid end from generate_series(1,10) g;
insert into public.rowdep select g, case when g%2=0 then '${CLOSER}'::uuid else '${EXEC}'::uuid end from generate_series(1,10) g;
${volatile ? `create or replace function public.crm_has_access() returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$select exists(select 1 from user_roles r where r.user_id=auth.uid() and r.role in('executive','super_admin','sdr','closer','seller'))$$;` : ''}

alter table public.crm_leads enable row level security; alter table public.crm_activities enable row level security; alter table public.vendas enable row level security;
alter table public.dashboard_events enable row level security; alter table public.company_goals enable row level security; alter table public.meta_form_leads enable row level security;
alter table public.crm_lead_contexts enable row level security; alter table public.notes enable row level security; alter table public.rowdep enable row level security;

-- crm_leads / crm_activities: duas politicas iguais (a de ALL restritiva e a de SELECT) + restritivas gerais, como em producao
create policy crm_active_access on public.crm_leads as restrictive for all using (crm_has_access()) with check (crm_has_access());
create policy crm_leads_select on public.crm_leads for select using (crm_has_access());
create policy crm_active_access on public.crm_activities as restrictive for all using (crm_has_access()) with check (crm_has_access());
create policy crm_activities_select on public.crm_activities for select using (crm_has_access());
create policy crm_activities_insert on public.crm_activities for insert with check (crm_has_access() and (user_id = auth.uid()));
create policy crm_activities_update on public.crm_activities for update using ((auth.uid() is not null) and ((user_id = auth.uid()) or is_executive(auth.uid()))) with check ((auth.uid() is not null) and ((user_id = auth.uid()) or is_executive(auth.uid())));
create policy crm_activities_delete on public.crm_activities for delete using ((auth.uid() is not null) and ((user_id = auth.uid()) or is_executive(auth.uid())));
create policy vendas_select on public.vendas for select using ((auth.uid() is not null) and ((user_id = auth.uid()) or is_executive(auth.uid())));
create policy vendas_capacity_insert on public.vendas as restrictive for insert with check (crm_can('sales'::text));
create policy dashboard_events_read on public.dashboard_events for select using ((not (exists (select 1 from profiles p where p.user_id = auth.uid() and p.suspended))) and ((topic = any (array['sales'::text,'goals'::text,'products'::text])) or is_executive(auth.uid())));
create policy arena_revision_read on public.dashboard_events for select using ((topic = 'arena'::text) and arena_has_access());
create policy dashboard_events_crm_read on public.dashboard_events for select using ((topic = 'crm'::text) and crm_has_access());
create policy traffic_revision_read on public.dashboard_events for select using ((topic = any (array['arena'::text,'crm'::text])) and traffic_has_access());
create policy goals_select on public.company_goals for select using (registration_has_access() and (exists (select 1 from profiles where profiles.user_id = auth.uid() and not profiles.suspended)) and ((scope = 'global'::text) or ((scope = 'role'::text) and (arena_has_access(true) or (get_user_role(auth.uid()) = target_role)))));
create policy goals_insert on public.company_goals for insert with check (is_executive(auth.uid()) and (created_by = auth.uid()));
create policy goals_update on public.company_goals for update using (is_executive(auth.uid())) with check (is_executive(auth.uid()));
create policy goals_delete on public.company_goals for delete using (is_executive(auth.uid()) or is_super_admin(auth.uid()));
create policy meta_form_leads_read on public.meta_form_leads for select using (traffic_has_access() or (meta_lead_inbox_access() and (approval_status = 'aprovado'::text)));
create policy crm_lead_contexts_select on public.crm_lead_contexts for select using ((auth.uid() is not null) and crm_can('leads'::text));
-- restritivas gerais (uma ja vem embrulhada, como em producao; a outra solta)
do $$ declare t text; begin
  foreach t in array array['crm_leads','crm_activities','vendas','dashboard_events','company_goals','meta_form_leads','crm_lead_contexts'] loop
    execute format('create policy dashboard_active_account on public.%I as restrictive for all using (dashboard_account_active()) with check (dashboard_account_active())', t);
    execute format('create policy registration_access on public.%I as restrictive for all using ((select registration_has_access())) with check ((select registration_has_access()))', t);
  end loop; end $$;
-- tabelas "quentes" (lidas por toda funcao de acesso): ficam adiadas, a menos que app.rls_include_hot = 'on'
alter table public.profiles enable row level security; alter table public.user_roles enable row level security; alter table public.registration_requests enable row level security;
create policy profiles_select on public.profiles for select using ((auth.uid() is not null) and ((user_id = auth.uid()) or is_executive(auth.uid())));
create policy dashboard_active_account on public.profiles as restrictive for all using (dashboard_account_active()) with check (dashboard_account_active());
create policy user_roles_select on public.user_roles for select using ((auth.uid() is not null) and ((user_id = auth.uid()) or is_executive(auth.uid())));
create policy registration_requests_select on public.registration_requests for select using ((user_id = auth.uid()) or is_executive(auth.uid()));
-- controles: nada disto pode mudar
create policy notes_own on public.notes for select using (owner_id = auth.uid());
create policy rowdep_check on public.rowdep for select using (row_check(owner_id));

grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema auth to authenticated; grant execute on all functions in schema public to authenticated; grant execute on all functions in schema auth to authenticated;
create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);`)
  return db
}

const policiesOf = async db => (await db.query(`select c.relname t, p.polname n, pg_get_expr(p.polqual,p.polrelid) q, pg_get_expr(p.polwithcheck,p.polrelid) wc
   from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace order by 1,2`)).rows
const BARE = /(?<![A-Za-z0-9_.])(?<!select\s)(dashboard_account_active\(\)|crm_has_access\(\)|traffic_has_access\(\)|registration_has_access\(\)|meta_lead_inbox_access\(\)|arena_has_access\((?:true)?\)|is_executive\(auth\.uid\(\)\)|is_super_admin\(auth\.uid\(\)\)|get_user_role\(auth\.uid\(\)\)|crm_can\('[a-z_]+'::text\))/gi
const bareCalls = rows => rows.flatMap(r => [r.q, r.wc].filter(Boolean).flatMap(e => [...e.matchAll(BARE)].map(m => `${r.t}.${r.n}: ${m[1]}`)))
// o que cada usuario enxerga de cada tabela (calculado de fora, independente da verificacao embutida na migration)
async function seen(db) {
  const out = {}
  for (const [name, uid] of Object.entries(PEOPLE)) for (const t of ['crm_leads', 'crm_activities', 'vendas', 'dashboard_events', 'company_goals', 'meta_form_leads', 'crm_lead_contexts', 'notes', 'rowdep']) {
    await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated`)
    try { out[`${name}.${t}`] = (await db.query(`select coalesce(string_agg(x::text, '|' order by x::text),'') s from public.${t} x`)).rows[0].s }
    catch (e) { out[`${name}.${t}`] = `ERRO:${e.code}` }
    await db.exec('reset role')
  }
  return out
}
const explainOf = async (db, sql) => { await db.exec(`select set_config('request.jwt.claim.sub','${EXEC}',false); set role authenticated`); const r = (await db.query('explain (costs off) ' + sql)).rows.map(x => x['QUERY PLAN']).join('\n'); await db.exec('reset role'); return r }

const generated = mode => {
  const r = spawnSync(process.execPath, ['scripts/apply-rls-initplan-migration.mjs', mode, '--print'], { encoding: 'utf8', env: { ...process.env, RLS_MIGRATIONS_DIR: dir.replace(/\/$/, '') } })
  assert.equal(r.status, 0, r.stderr); return readFileSync(r.stdout.trim(), 'utf8').replace(/\r\n/g, '\n')
}

// ---------- antes ----------
const db = await freshDb()
const before = await policiesOf(db), beforeSeen = await seen(db)
const bareBefore = bareCalls(before)
assert(bareBefore.length >= 30, `o esquema de teste deveria ter muitas chamadas soltas (achou ${bareBefore.length})`)
const planBefore = await explainOf(db, 'select * from public.crm_leads')
assert.match(planBefore, /Filter:.*crm_has_access\(\).*/, 'antes: crm_has_access() e chamada no filtro, por linha')
assert.match(planBefore, /Filter:.*dashboard_account_active\(\)/, 'antes: dashboard_account_active() tambem')
assert.doesNotMatch(planBefore, /InitPlan 3/, 'antes: so a politica ja embrulhada vira InitPlan')
assert(Object.values(beforeSeen).some(v => v.length > 0), 'dados de teste devem ser visiveis para alguem')
assert.equal(beforeSeen['GHOST.crm_leads'], '', 'quem nao tem cadastro nao ve nada')
assert.equal(beforeSeen['SUSP.vendas'], '', 'suspenso nao ve vendas (restritiva dashboard_account_active)')
assert.notEqual(beforeSeen['EXEC.crm_leads'], '', 'executivo ve os leads')

// ---------- a migration ----------
await db.exec(migration)
const after = await policiesOf(db), afterSeen = await seen(db)
const HOT = /^(profiles|user_roles|registration_requests)\./
assert.deepEqual(bareCalls(after).filter(x => !HOT.test(x)), [], 'depois: nenhuma chamada solta pode sobrar (fora as tabelas quentes adiadas)')
assert(bareCalls(after).some(x => HOT.test(x)) && bareCalls(before).filter(x => HOT.test(x)).length === bareCalls(after).filter(x => HOT.test(x)).length, 'as tabelas quentes ficam como estao')
// unica diferenca aceita: antes dava ERRO de permissao (nada visivel) e depois enxerga 0 linhas (nada visivel); o resto tem que ser identico
const sameSeen = (b, a) => Object.keys(b).every(k => b[k] === a[k] || (b[k].startsWith('ERRO:') && a[k] === ''))
assert(sameSeen(beforeSeen, afterSeen), 'cada usuario enxerga exatamente o mesmo de antes em todas as tabelas (so erro -> 0 linhas e tolerado)')
assert(Object.keys(afterSeen).every(k => !afterSeen[k].startsWith('ERRO:') || beforeSeen[k] === afterSeen[k]), 'depois nao pode surgir erro novo')
assert(Object.entries(beforeSeen).some(([k, v]) => v.startsWith('ERRO:') && afterSeen[k] === ''), 'o caso conta suspensa (erro antes, 0 linhas depois) precisa estar sendo exercitado')
const planAfter = await explainOf(db, 'select * from public.crm_leads')
assert.match(planAfter, /InitPlan 3/, 'depois: cada funcao vira um InitPlan (uma vez por consulta)')
assert.doesNotMatch(planAfter, /Filter:.*(crm_has_access|dashboard_account_active)\(\)/, 'depois: nao ha mais chamada por linha no filtro')
const planWrite = await explainOf(db, 'select * from public.vendas')
assert.match(planWrite, /InitPlan/, 'vendas tambem')
const byName = rows => Object.fromEntries(rows.map(r => [`${r.t}.${r.n}`, r]))
const b = byName(before), a = byName(after)
for (const k of Object.keys(b)) {
  if (['notes.notes_own', 'rowdep.rowdep_check'].includes(k)) assert.deepEqual(a[k], b[k], `${k}: controle nao pode mudar`)
}
assert.match(a['crm_leads.crm_leads_select'].q, /SELECT crm_has_access\(\)/)
assert.match(a['crm_activities.crm_activities_update'].q, /SELECT is_executive\(auth\.uid\(\)\)/); assert.match(a['crm_activities.crm_activities_update'].wc, /SELECT is_executive\(auth\.uid\(\)\)/)
assert.match(a['crm_activities.crm_activities_insert'].wc, /SELECT crm_has_access\(\)/); assert.equal(a['crm_activities.crm_activities_insert'].q, null, 'INSERT continua sem USING')
assert.match(a['company_goals.goals_select'].q, /SELECT arena_has_access\(true\)/); assert.match(a['company_goals.goals_select'].q, /SELECT get_user_role\(auth\.uid\(\)\)/)
assert.match(a['vendas.vendas_capacity_insert'].wc, /SELECT crm_can\('sales'::text\)/)
assert.match(a['meta_form_leads.meta_form_leads_read'].q, /SELECT meta_lead_inbox_access\(\)/)
assert.match(a['dashboard_events.arena_revision_read'].q, /SELECT arena_has_access\(\)/)
assert.equal((a['crm_leads.registration_access'].q.match(/registration_has_access/g) ?? []).length, 2, 'o que ja estava embrulhado nao e embrulhado de novo (aparece na chamada e no alias)')
assert.doesNotMatch(a['crm_leads.registration_access'].q, /SELECT\s*\(?\s*SELECT/i)
assert.match(a['vendas.vendas_select'].q, /user_id = auth\.uid\(\)/, 'auth.uid() sozinho continua como esta')

// ---------- reaplicar nao muda nada ----------
await db.exec(migration)
assert.deepEqual(await policiesOf(db), after, 'segunda execucao e idempotente')
// janela tranquila: incluindo as quentes, nada mais sobra
await db.exec(`select set_config('app.rls_include_hot', 'on', false)`); await db.exec(migration); await db.exec(`select set_config('app.rls_include_hot', 'off', false)`)
assert.deepEqual(bareCalls(await policiesOf(db)), [], 'com app.rls_include_hot=on as tabelas quentes tambem sao reescritas')
assert(sameSeen(beforeSeen, await seen(db)), 'e continua tudo igual')
assert(sameSeen(beforeSeen, await seen(db)))

// ---------- tabela ocupada (consulta longa segurando a tabela): pula, nao registra, e uma nova rodada termina o servico ----------
{
  const busyDb = await freshDb(), original = await policiesOf(busyDb), expected = await seen(busyDb)
  // o gatilho de evento faz 1 de cada 3 ALTER POLICY falhar com lock_not_available, como o lock_timeout faria numa tabela ocupada
  await busyDb.exec(`create table public.evt_count(n int not null); insert into public.evt_count values (0);
    create function public.evt_busy() returns event_trigger language plpgsql as $$ begin
      if current_setting('test.busy', true) = '1' then update public.evt_count set n = n + 1; if (select n % 3 from public.evt_count) = 0 then raise exception 'ocupada' using errcode = '55P03'; end if; end if; end $$;
    create event trigger evt_busy_trg on ddl_command_start when tag in ('ALTER POLICY') execute function public.evt_busy();
    select set_config('test.busy', '1', false)`)
  await assert.rejects(busyDb.exec(generated('preflight')), e => {
    const r = JSON.parse(e.message.slice(e.message.indexOf('{')))
    assert(r.ocupadas > 0 && r.politicas > 0, 'algumas puladas, outras reescritas'); assert(Array.isArray(r.tabelas_ocupadas) && r.tabelas_ocupadas.length > 0)
    return true
  })
  await busyDb.exec('rollback').catch(() => {})
  assert.deepEqual(await policiesOf(busyDb), original, 'ensaio nao altera nada')
  await busyDb.exec(generated('apply'))
  const partial = await policiesOf(busyDb)
  assert(bareCalls(partial).filter(x => !HOT.test(x)).length > 0 && bareCalls(partial).length < bareBefore.length, 'parte reescrita, parte pulada')
  assert(sameSeen(expected, await seen(busyDb)), 'mesmo no caso parcial ninguem enxerga algo diferente')
  assert.deepEqual((await busyDb.query(`select count(*)::int n from supabase_migrations.schema_migrations`)).rows[0].n, 0, 'com politicas puladas a migration NAO e registrada')
  await busyDb.exec(`select set_config('test.busy', '0', false)`)
  await busyDb.exec(generated('apply'))
  assert.deepEqual(bareCalls(await policiesOf(busyDb)).filter(x => !HOT.test(x)), [], 'a segunda rodada termina o servico')
  assert.equal((await busyDb.query(`select count(*)::int n from supabase_migrations.schema_migrations`)).rows[0].n, 1, 'agora registra')
  assert(sameSeen(expected, await seen(busyDb)))
}

// ---------- erro -> linhas visiveis seria GANHO de acesso: a migration recusa (so erro -> 0 linhas e tolerado) ----------
{
  const x = await freshDb()
  await x.exec(`create table public.public_items(id int primary key, is_public boolean, target_role text);
    insert into public.public_items values (1,true,'closer'),(3,true,'sdr');   -- so linhas publicas: depois da reescrita get_user_role() nunca chega a rodar e as linhas aparecem
    alter table public.public_items enable row level security;
    create policy public_items_read on public.public_items for select using (is_public or (get_user_role(auth.uid()) = target_role));
    grant select on public.public_items to authenticated;`)
  await x.exec(`select set_config('request.jwt.claim.sub','${SUSP}',false); set role authenticated`)
  await assert.rejects(x.query('select count(*) from public.public_items'), e => e.code === '42501', 'cenario: conta suspensa da ERRO antes (get_user_role lanca no planejamento)')
  await x.exec('reset role')
  await assert.rejects(x.exec(migration), /RLS_EQUIVALENCIA_FALHOU/, 'erro antes e linhas visiveis depois = ganho de acesso: a migration recusa')
  await x.exec('rollback').catch(() => {})
}

// ---------- funcao VOLATILE: nao e seguro embrulhar, a migration recusa ----------
{
  const v = await freshDb({ volatile: true })
  await assert.rejects(v.exec(migration), /VOLATILE/, 'funcao volatil barra a migration')
  await v.exec('rollback').catch(() => {})
  assert.deepEqual(bareCalls(await policiesOf(v)).length > 0, true, 'nada foi alterado')
}

// ---------- se algo mudar o que alguem enxerga, a migration INTEIRA e desfeita ----------
{
  // mutante: a reescrita fica valida mas ERRADA (crm_has_access() vira false para todo mundo) - so a comparacao "antes x depois" pode pegar
  const bad = migration.replace('SELECT replace(\n           regexp_replace(', 'SELECT replace(replace(\n           regexp_replace(')
    .replace("'zzwrapzz', '')\n$f$;", "'zzwrapzz', ''), '(SELECT crm_has_access())', '(SELECT false)')\n$f$;")
  assert(bad.includes("'(SELECT false)'") && bad.includes('SELECT replace(replace('), 'o mutante precisa aplicar')
  const w = await freshDb(), original = await policiesOf(w)
  await assert.rejects(w.exec(bad), /RLS_ESTRUTURA/, 'a prova estrutural pega a reescrita que muda mais que o embrulho')
  await w.exec('rollback').catch(() => {})
  assert.deepEqual(await policiesOf(w), original, 'e nada foi gravado (politicas iguais as de antes)')
  // desligando a prova estrutural, a comparacao "o que cada usuario enxerga" tambem derruba (as duas camadas sao independentes)
  const noStruct = bad.replace("IF v_bad IS NOT NULL THEN\n    RAISE EXCEPTION 'RLS_ESTRUTURA", "IF false THEN\n    RAISE EXCEPTION 'RLS_ESTRUTURA")
  assert.notEqual(noStruct, bad, 'o mutante da estrutura precisa aplicar')
  const w2 = await freshDb()
  await assert.rejects(w2.exec(noStruct), /RLS_EQUIVALENCIA_FALHOU/, 'diferenca de visibilidade derruba a migration')
  await w2.exec('rollback').catch(() => {})
  assert.deepEqual(await policiesOf(w2), original, 'e nada foi gravado tambem aqui')
}

// ---------- o script preflight/apply ----------
{
  const d = await freshDb(), original = await policiesOf(d)
  await assert.rejects(d.exec(generated('preflight')), e => {
    assert.match(e.message, /PREFLIGHT_RLS_OK/)
    const r = JSON.parse(e.message.slice(e.message.indexOf('{')))
    assert(r.politicas >= 20, 'preflight informa quantas politicas mudariam'); assert(r.comparacoes >= 20, 'e quantas comparacoes passaram')
    assert.equal(r.ocupadas, 0, 'e quantas ficaram ocupadas'); assert(r.adiadas_tabelas_quentes >= 3, 'e quantas ficaram adiadas por serem tabelas quentes')
    assert(r.ms_por_tabela && Object.keys(r.ms_por_tabela).length >= 3, 'e o tempo por tabela antes/depois')
    assert(e.message.length < 900, `a mensagem precisa caber no que a CLI mostra (${e.message.length})`)
    return true
  }, 'o ensaio sempre termina em excecao com o resumo')
  await d.exec('rollback').catch(() => {})
  assert.deepEqual(await policiesOf(d), original, 'o ensaio nao pode alterar nada')
  await d.exec(generated('apply'))
  assert.deepEqual(bareCalls(await policiesOf(d)).filter(x => !HOT.test(x)), [], 'a instalacao reescreve')
  assert.equal((await d.query(`select version from supabase_migrations.schema_migrations`)).rows[0].version, '20261023140000')
  await assert.rejects(d.exec(generated('apply')), /ja instalada/, 'nao reinstala')
}

console.log(`OK: ${bareBefore.length} chamadas soltas viraram InitPlan em ${Object.keys(b).length} politicas; ${Object.keys(beforeSeen).length} combinacoes usuario x tabela identicas; idempotente; volatil barrado; diferenca de visibilidade desfaz tudo; preflight/apply ok.`)
