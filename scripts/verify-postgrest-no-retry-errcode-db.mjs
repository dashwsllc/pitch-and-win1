// Banco descartavel (PGlite). Nada toca producao.
// Migration 20261023020000_postgrest_no_retry_errcode: troca ERRCODE/SQLSTATE '40001' por 'PT409' nas funcoes vivas (o PostgREST 14 repete 40001 sem fim),
// sem perder grants, SECURITY DEFINER, search_path nem tocar em quem nao usa 40001; e nenhuma migration posterior pode voltar a usar 40001.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const dir = process.env.RETRY_MIGRATIONS_DIR ?? 'supabase/migrations/'   // so a checagem de mutacao troca a pasta
const FILE = '20261023020000_postgrest_no_retry_errcode.sql'
const migration = readFileSync(dir + FILE, 'utf8').replace(/\r\n/g, '\n')
const db = new PGlite()
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const sqlstate = async sql => { try { await db.exec(sql); return null } catch (e) { return e.code } }
const meta = async name => one(`select p.proacl::text acl, p.prosecdef sec, p.proconfig::text cfg, p.proowner::regrole::text owner, md5(p.prosrc) src
  from pg_proc p where p.oid = $1::regprocedure`, [name])

await db.exec(`
create role service_role; create role authenticated; create role anon; create schema calendar_private;
-- estilos de escrita reais das migrations: "ERRCODE='40001'" e "ERRCODE = '40001'", SECURITY DEFINER com search_path, grants so para service_role
create function public.claim_a(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin if p_id is null then raise exception 'Stale claim' using errcode='40001'; end if; end $$;
revoke all on function public.claim_a(uuid) from public; grant execute on function public.claim_a(uuid) to service_role;
create function public.edit_b(p_v bigint) returns bigint language plpgsql as $$
begin if p_v < 0 then raise exception 'Importação alterada, recarregue' using ERRCODE = '40001'; end if; return p_v; end $$;
grant execute on function public.edit_b(bigint) to authenticated;
-- sobrecarga: a assinatura certa tem que ser reescrita, nao so uma
create function public.edit_b(p_v bigint, p_w bigint) returns bigint language plpgsql as $$
begin raise exception 'sobrecarga' using errcode = '40001'; end $$;
-- handler no corpo: quem captura a falha tem que continuar capturando depois da troca
create function public.catches_c() returns text language plpgsql as $$
begin perform public.claim_a(null); return 'nao falhou';
exception when sqlstate '40001' then return 'capturou'; end $$;
create function public.raises_by_state_d() returns void language plpgsql as $$
begin raise sqlstate '40001' using message = 'por estado'; end $$;
create procedure public.proc_e() language plpgsql as $$
begin raise exception 'em procedure' using errcode='40001'; end $$;
create function calendar_private.f_f() returns void language plpgsql as $$
begin raise exception 'schema privado' using errcode='40001'; end $$;
-- controles: nao usam 40001 e nao podem mudar
create function public.control_g() returns void language plpgsql as $$
begin raise exception 'conflito normal' using errcode='PT409'; end $$;
create function public.control_h() returns integer language sql as $$ select 40002 $$;
`)

const sig = ['public.claim_a(uuid)', 'public.edit_b(bigint)', 'public.edit_b(bigint,bigint)', 'public.catches_c()', 'public.raises_by_state_d()', 'public.proc_e()', 'calendar_private.f_f()']
const controls = ['public.control_g()', 'public.control_h()']

// ---------- antes: todos levantam 40001 ----------
assert.equal(await sqlstate(`select public.claim_a(null)`), '40001')
assert.equal(await sqlstate(`select public.edit_b(-1)`), '40001')
assert.equal(await sqlstate(`select public.edit_b(1,2)`), '40001')
assert.equal(await sqlstate(`select public.raises_by_state_d()`), '40001')
assert.equal(await sqlstate(`call public.proc_e()`), '40001')
assert.equal(await sqlstate(`select calendar_private.f_f()`), '40001')
assert.equal((await one(`select public.catches_c() r`)).r, 'capturou')
const before = Object.fromEntries(await Promise.all([...sig, ...controls].map(async s => [s, await meta(s)])))

// ---------- a migration ----------
await db.exec(migration)
assert.equal(await sqlstate(`select public.claim_a(null)`), 'PT409', 'claim vencido nao pode mais ser 40001')
assert.equal(await sqlstate(`select public.edit_b(-1)`), 'PT409')
assert.equal(await sqlstate(`select public.edit_b(1,2)`), 'PT409', 'sobrecarga reescrita')
assert.equal(await sqlstate(`select public.raises_by_state_d()`), 'PT409', 'RAISE SQLSTATE tambem')
assert.equal(await sqlstate(`call public.proc_e()`), 'PT409', 'procedure tambem')
assert.equal(await sqlstate(`select calendar_private.f_f()`), 'PT409', 'schema calendar_private tambem')
assert.equal((await one(`select public.catches_c() r`)).r, 'capturou', 'handler WHEN SQLSTATE continua capturando')
assert.equal(Number((await one(`select public.edit_b(5) r`)).r), 5, 'caminho feliz intacto')
assert.equal(await sqlstate(`select public.control_g()`), 'PT409')
assert.equal((await one(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname in ('public','calendar_private') and p.prosrc ~ '40001'`)).n, 0, 'nada sobra com 40001')

// grants, SECURITY DEFINER, search_path e dono ficam como estavam; so o corpo muda
for (const s of sig) {
  const a = before[s], b = await meta(s)
  assert.deepEqual({ ...b, src: null }, { ...a, src: null }, `${s}: acl/security/config/dono mudaram`)
  assert.notEqual(b.src, a.src, `${s}: corpo nao foi reescrito`)
}
for (const s of controls) assert.deepEqual(await meta(s), before[s], `${s}: controle sem 40001 foi tocado`)
assert.equal((await one(`select has_function_privilege('service_role','public.claim_a(uuid)','EXECUTE') s, has_function_privilege('authenticated','public.claim_a(uuid)','EXECUTE') a`)).a, false, 'claim_a continua fechada para authenticated')
assert.equal((await one(`select has_function_privilege('authenticated','public.edit_b(bigint)','EXECUTE') a`)).a, true)

// ---------- repetir nao faz nada ----------
const snapshot = async () => q(`select p.oid::regprocedure::text s, md5(pg_get_functiondef(p.oid)) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','calendar_private') order by 1`)
const once = JSON.stringify(await snapshot())
await db.exec(migration)
assert.equal(JSON.stringify(await snapshot()), once, 'segunda execucao e idempotente')

// ---------- se sobrar 40001 que a migration nao sabe trocar, ela FALHA inteira e nao deixa meio feito ----------
const db2 = new PGlite()
await db2.exec(`create schema calendar_private;
create function public.ok_a() returns void language plpgsql as $$ begin raise exception 'x' using errcode='40001'; end $$;
create function public.estranha_b() returns text language plpgsql as $$ begin return 'codigo 40001 so em texto'; end $$;`)
await assert.rejects(db2.exec(migration), /Ainda mencionam 40001.*estranha_b/s, 'sobra nao reconhecida derruba a migration')
await db2.exec('ROLLBACK')
const left = await db2.query(`select prosrc ~ '40001' as has from pg_proc where proname = 'ok_a'`)
assert.equal(left.rows[0].has, true, 'falha nao pode deixar a migration pela metade (transacao desfeita)')

// ---------- o script preflight/apply: ensaio nao grava nada e diz o que mudaria; instalacao registra e nao repete ----------
const generated = mode => {
  const r = spawnSync(process.execPath, ['scripts/apply-postgrest-no-retry-errcode-migration.mjs', mode, '--print'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr); return readFileSync(r.stdout.trim(), 'utf8').replace(/\r\n/g, '\n')
}
const fresh = async () => {
  const d = new PGlite()
  await d.exec(`create role service_role; create role authenticated; create schema calendar_private; create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    create function public.claim_a(p_id uuid) returns void language plpgsql security definer set search_path = public as $$ begin raise exception 'Stale claim' using errcode='40001'; end $$;
    grant execute on function public.claim_a(uuid) to service_role;
    create function public.control_g() returns void language plpgsql as $$ begin raise exception 'ok' using errcode='PT409'; end $$;`)
  return d
}
{
  const d = await fresh()
  const preflight = generated('preflight')
  await assert.rejects(d.exec(preflight), e => {
    assert.match(e.message, /PREFLIGHT_PT409_OK/)
    const r = JSON.parse(e.message.slice(e.message.indexOf('{')))
    assert.equal(r.funcoes_com_40001_antes, 1); assert.equal(r.funcoes_com_PT409_agora, 1); assert.equal(r.funcoes_que_ainda_citam_40001, 0)
    assert.equal(r.owner_grants_security_config_mudaram, null); assert.match(r.funcoes, /claim_a/)
    return true
  }, 'o ensaio sempre termina em excecao com o resumo')
  await d.exec('ROLLBACK')
  assert.equal((await d.query(`select count(*)::int n from pg_proc where prosrc ~ '40001'`)).rows[0].n, 1, 'o ensaio nao pode gravar nada')
  assert.equal((await d.query(`select count(*)::int n from supabase_migrations.schema_migrations`)).rows[0].n, 0)
  await d.exec(generated('apply'))
  assert.equal((await d.query(`select count(*)::int n from pg_proc where prosrc ~ '40001'`)).rows[0].n, 0)
  assert.equal((await d.query(`select version from supabase_migrations.schema_migrations`)).rows[0].version, '20261023020000')
  await assert.rejects(d.exec(generated('apply')), /ja instalada/, 'nao reinstala')
  await d.exec('ROLLBACK')
}

// ---------- regra para o futuro: nenhuma migration posterior usa 40001 ----------
const later = readdirSync(dir).filter(f => f.endsWith('.sql') && f > FILE)
for (const f of later) assert(!/40001/.test(readFileSync(dir + f, 'utf8')), `${f}: 40001 e proibido (PostgREST 14 repete sem fim); use PT409`)
const used = readdirSync(dir).filter(f => f.endsWith('.sql') && f < FILE && /40001/.test(readFileSync(dir + f, 'utf8'))).length
console.log(`OK: migration troca 40001 por PT409 (${sig.length} funcoes sinteticas, ${controls.length} controles intactos, idempotente, falha limpa); ${used} migrations antigas ainda citam 40001 e sao corrigidas por esta; ${later.length} posteriores limpas.`)
