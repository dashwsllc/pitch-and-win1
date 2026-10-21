// Concorrencia REAL (varias conexoes simultaneas) da fila da ponte dash -> VOXEN, num Postgres de verdade descartavel.
// O teste principal (verify-crm-context-bridge-db.mjs) usa PGlite, que tem uma sessao so. Este cobre o que ele nao consegue:
// claim simultaneo sem sobreposicao, ack/fail disputando o mesmo evento e enfileiramento simultaneo do mesmo lead.
// Nada toca producao. Requer um diretorio com `embedded-postgres` e `pg` instalados:
//   node scripts/verify-crm-context-bridge-concurrency.mjs <diretorio-com-node_modules>
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const toolsDir = resolve(process.argv[2] ?? '')
assert(process.argv[2], 'informe o diretorio com embedded-postgres e pg instalados')
const req = createRequire(join(toolsDir, 'package.json'))
const EmbeddedPostgres = (await import(pathToFileURL(req.resolve('embedded-postgres')).href)).default
const { Client } = req('pg')

const migration = readFileSync('supabase/migrations/20261020120000_crm_context_bridge.sql', 'utf8').replace(/\r\n/g, '\n')
const fieldRank = (() => {
  const src = readFileSync('supabase/migrations/20261015050000_meta_raw_capture_and_form_definitions.sql', 'utf8').replace(/\r\n/g, '\n')
  const start = src.indexOf('CREATE OR REPLACE FUNCTION public.meta_form_field_rank'); return src.slice(start, src.indexOf('$$;', src.indexOf('AS $$', start)) + 3)
})()
const matchName = (() => {
  const src = readFileSync('supabase/migrations/20261015021500_site_form_answers_link.sql', 'utf8').replace(/\r\n/g, '\n')
  const start = src.indexOf('CREATE OR REPLACE FUNCTION public.meta_match_name'); return src.slice(start, src.indexOf('$$;', src.indexOf('AS $$', start)) + 3)
})()
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const dataDir = mkdtempSync(join(tmpdir(), 'pgconc-'))
const port = 54000 + Math.floor(Math.random() * 1000)
const tempPassword = randomUUID()
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: tempPassword, port, persistent: false, onLog: () => {}, onError: () => {} })
const connect = async () => { const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: tempPassword, database: 'postgres' }); await c.connect(); return c }
let admin
try {
  await server.initialise(); await server.start()
  admin = await connect()
  await admin.query(`
   create role anon; create role authenticated; create role service_role; create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;
   create table public.user_roles(user_id uuid,role text);
   create function public.is_executive(_user_id uuid) returns boolean language sql stable as $$select false$$;
   create table public.meta_form_leads(id uuid primary key default gen_random_uuid(),meta_lead_id text unique not null,page_id text default 'p',form_id text default 'f',
    form_name text,campaign_name text,ad_id text,created_time timestamptz default now(),field_data jsonb not null default '[]',full_name text,phone text,email text,
    entry_channel text default 'form' check(entry_channel in('form','website')),answers_form_lead_id uuid unique references public.meta_form_leads(id),
    answers_link_basis text,answers_linked_at timestamptz,import_contact jsonb default '{}',source_snapshot jsonb,review_note text,approval_status text default 'pendente',updated_at timestamptz default now());
   create table public.crm_leads(id uuid primary key default gen_random_uuid(),name text,phone text,email text,athlete_name text,athlete_birth_date date,athlete_position text,
    athlete_age smallint,athlete_height_cm numeric,athlete_weight_kg numeric,city_state text,observations text,qualification_goal text,qualification_decision_maker text,qualification_timeline text,
    qualification_summary text,meta_form_lead_id uuid unique references public.meta_form_leads(id),updated_at timestamptz default now(),
    created_at timestamptz default clock_timestamp());
   create table public.crm_form_answer_links(crm_lead_id uuid primary key references public.crm_leads(id) on delete cascade,form_lead_id uuid not null references public.meta_form_leads(id),basis text);
   create table public.crm_lead_contexts(id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.crm_leads(id) on delete cascade,context_type text,content text,
    created_at timestamptz not null default clock_timestamp());
   create function public.crm_context_summary(p_offset integer default 0,p_limit integer default 500) returns table(lead_id uuid) language sql stable as $$ select c.id from public.crm_leads c order by c.id limit 500 $$;
   create table public.meta_form_definitions(form_id text primary key,page_id text,name text,questions jsonb not null default '[]',raw jsonb not null default '{}',fetched_at timestamptz default now());
   create schema cron; create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,active boolean default true);
   create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid$$;
   create function cron.unschedule(j bigint) returns boolean language sql as $$delete from cron.job where jobid=j returning true$$;
   create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
    returns void language sql as $$update cron.job set active=coalesce($6,active) where jobid=$1$$;
   create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
   create schema net; create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;
   ${matchName}
   ${fieldRank}`)
  await admin.query(migration)

  const FIELD = JSON.stringify([
    { name: 'quem_está_preenchendo_este_formulário?', values: ['sou_o_atleta'] },
    { name: 'qual_é_a_posição_e_a_categoria_atual_do_atleta?', values: ['Meia, sub-17'] },
    { name: 'full_name', values: ['Responsavel Teste'] }, { name: 'date_of_birth', values: ['2008-09-06'] }, { name: 'state', values: ['SP'] }])
  const seed = async n => {
    const sid = U(100 + n), form = U(1000 + n), site = U(2000 + n)
    await admin.query(`insert into public.meta_form_leads(id,meta_lead_id,field_data,full_name,entry_channel) values($1,$2,$3::jsonb,'Responsavel Teste','form')`, [form, 'form:' + n, FIELD])
    await admin.query(`insert into public.meta_form_leads(id,meta_lead_id,field_data,full_name,entry_channel,answers_form_lead_id,answers_link_basis) values($1,$2,'[]','Responsavel Teste','website',$3,'mesmo anúncio, nome completo igual, 61 s depois do formulário')`, [site, 'site:zyron:' + sid, form])
    return { sid, form, site }
  }
  const due = () => admin.query(`update public.crm_context_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where state='pending'`)
  const countBy = async sql => Number((await admin.query(sql)).rows[0].n)

  // ---------- 1) claim simultaneo: 60 eventos, 12 conexoes, lotes de 5 -> nenhum evento em dois claims ----------
  const EVENTS = 60, WORKERS = 12
  for (let n = 1; n <= EVENTS; n++) await seed(n)
  assert.equal(await countBy('select count(*) n from public.crm_context_outbox'), EVENTS)
  await due()
  const conns = await Promise.all(Array.from({ length: WORKERS }, connect))
  try {
    for (let round = 0; round < 3; round++) {
      await admin.query(`update public.crm_context_outbox set state='pending',claim_token=null,lease_until=null where state='processing'`); await due()
      const results = await Promise.all(conns.map(c => c.query('select public.crm_context_claim(5,60,null) r')))
      const claimed = results.flatMap(r => r.rows[0].r)
      const ids = claimed.map(e => e.event_id)
      assert.equal(new Set(ids).size, ids.length, `rodada ${round}: evento entregue a mais de um claim`)
      assert.equal(ids.length, Math.min(EVENTS, WORKERS * 5), `rodada ${round}: todos os eventos devidos foram reservados (SKIP LOCKED nao pode perder nenhum)`)
      assert(claimed.every(e => e.state === 'processing' && e.attempts >= 1 && e.claim_token && e.lease_until))
      assert.equal(await countBy(`select count(*) n from public.crm_context_outbox where state='processing'`), ids.length)
    }
    // drena tudo: workers repetindo ate acabar -> total reservado == total de eventos, sem repeticao
    await admin.query(`update public.crm_context_outbox set state='pending',claim_token=null,lease_until=null,attempts=0`); await due()
    const seen = new Set()
    for (let guard = 0; guard < 20; guard++) {
      const got = (await Promise.all(conns.map(c => c.query('select public.crm_context_claim(5,60,null) r')))).flatMap(r => r.rows[0].r).map(e => e.event_id)
      for (const id of got) { assert(!seen.has(id), 'evento reservado duas vezes ao drenar'); seen.add(id) }
      if (!got.length) break
    }
    assert.equal(seen.size, EVENTS, 'drenagem concorrente reserva exatamente todos os eventos')
  } finally { await Promise.all(conns.map(c => c.end())) }

  // ---------- 2) ack e fail disputando o mesmo evento: so um vence, o outro recebe "Stale claim" ----------
  {
    const s = await seed(500); await due()
    const ev = (await admin.query('select event_id from public.crm_context_outbox where source_lead_id=$1', [s.sid])).rows[0].event_id
    const [a, b, c] = await Promise.all([connect(), connect(), connect()])
    try {
      const row = (await a.query('select public.crm_context_claim(1,60,$1) r', [ev])).rows[0].r[0]
      const receipt = JSON.stringify({ ok: true, receipt_id: U(7001), event_id: ev, status: 'applied' })
      const settle = await Promise.allSettled([
        b.query('select public.crm_context_ack($1,$2,$3::jsonb)', [ev, row.claim_token, receipt]),
        c.query(`select public.crm_context_fail($1,$2,'http_503',now(),false)`, [ev, row.claim_token]),
        a.query('select public.crm_context_ack($1,$2,$3::jsonb)', [ev, row.claim_token, receipt])])
      assert.equal(settle.filter(r => r.status === 'fulfilled').length, 1, 'exatamente um dos tres vence a corrida: ' + settle.map(r => r.status).join(','))
      for (const r of settle.filter(r => r.status === 'rejected')) assert.match(String(r.reason.message), /Stale claim/)
      const final = (await admin.query('select state from public.crm_context_outbox where event_id=$1', [ev])).rows[0].state
      assert(['delivered', 'pending'].includes(final))
      assert.equal(await countBy(`select count(*) n from public.crm_context_delivery_attempts where event_id='${ev}'`), 1, 'uma unica tentativa registrada')
    } finally { await Promise.all([a.end(), b.end(), c.end()]) }
  }

  // ---------- 3) enfileirar o mesmo lead de varias conexoes: uma unica revisao, nunca duplicada nem erro de unicidade ----------
  {
    const s = await seed(600)
    await admin.query('delete from public.crm_context_outbox where source_lead_id=$1', [s.sid])
    const cs = await Promise.all(Array.from({ length: 8 }, connect))
    try {
      const out = await Promise.all(cs.map(c => c.query('select public.crm_context_enqueue($1,false) r', [s.site])))
      const states = out.map(r => r.rows[0].r).sort()
      assert.deepEqual(states.filter(x => x === 'enqueued').length, 1, 'so uma conexao cria a revisao: ' + states.join(','))
      assert(states.every(x => ['enqueued', 'unchanged'].includes(x)), 'as outras veem o mesmo conteudo: ' + states.join(','))
      assert.equal(await countBy(`select count(*) n from public.crm_context_outbox where source_lead_id='${s.sid}'`), 1)
      // mudancas simultaneas de conteudo no mesmo lead: revisoes consecutivas e unicas, sem lacuna
      await admin.query(`update public.crm_context_outbox set state='delivered',receipt='{"ok":true}'::jsonb,delivered_at=now() where source_lead_id=$1`, [s.sid])
      const variants = cs.map((_, i) => JSON.stringify([{ name: 'qual_é_a_posição_e_a_categoria_atual_do_atleta?', values: ['Posicao ' + i] }]))
      await Promise.all(cs.map((c, i) => c.query('begin').then(() => c.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [s.form, variants[i]]))
        .then(() => c.query('commit')).catch(async () => { await c.query('rollback').catch(() => {}) })))
      const revs = (await admin.query('select source_revision from public.crm_context_outbox where source_lead_id=$1 order by source_revision', [s.sid])).rows.map(r => Number(r.source_revision))
      assert.deepEqual(revs, revs.map((_, i) => i + 1), 'revisoes consecutivas sem buraco nem duplicata: ' + revs.join(','))
      assert(revs.length >= 2)
      assert.equal(await countBy(`select count(*) n from (select source_revision from public.crm_context_outbox where source_lead_id='${s.sid}' group by 1 having count(*)>1) d`), 0)
      assert.equal(await countBy('select trigger_error_count n from public.crm_context_delivery_control'), 0, 'nenhum erro de gatilho sob concorrencia')
    } finally { await Promise.all(cs.map(c => c.end())) }
  }
  // ---------- 4) entrelacamentos deterministas: uma transacao segura a trava, a outra tenta; falham sem a trava certa ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const within = (p, ms) => Promise.race([p.then(v => ({ v }), e => ({ e })), sleep(ms).then(() => ({ timeout: true }))])
  const pair = async fn => { const [a, b] = await Promise.all([connect(), connect()]); try { await fn(a, b) } finally { await a.query('rollback').catch(() => {}); await Promise.all([a.end(), b.end()]) } }

  // 4a) SKIP LOCKED: com o primeiro evento preso por outra transacao, o claim concorrente nao espera e leva os outros.
  await pair(async (A, B) => {
    await admin.query('truncate public.crm_context_outbox cascade')
    for (const n of [700, 701, 702]) await seed(n)
    await due()
    await A.query('begin')
    const held = (await A.query('select public.crm_context_claim(1,60,null) r')).rows[0].r
    assert.equal(held.length, 1)
    const rb = await within(B.query('select public.crm_context_claim(2,60,null) r'), 2500)
    assert(!rb.timeout, 'o claim concorrente ficou esperando a linha presa (falta SKIP LOCKED)')
    assert(!rb.e, String(rb.e?.message))
    const got = rb.v.rows[0].r.map(e => e.event_id)
    assert.equal(got.length, 2, 'leva os dois eventos livres'); assert(!got.includes(held[0].event_id), 'nunca leva o evento preso')
    await A.query('commit')
  })

  // 4b) lock por lead no enqueue: dois enfileiramentos simultaneos do mesmo lead novo; o segundo ve o conteudo e nao duplica a revisao 1.
  await pair(async (A, B) => {
    const s = await seed(710)
    await admin.query('delete from public.crm_context_outbox where source_lead_id=$1', [s.sid])
    await A.query('begin')
    assert.equal((await A.query('select public.crm_context_enqueue($1,false) r', [s.site])).rows[0].r, 'enqueued')
    const pb = B.query('select public.crm_context_enqueue($1,false) r', [s.site])
    await sleep(600)
    await A.query('commit')
    const rb = await within(pb, 8000)
    assert(!rb.timeout, 'o segundo enfileiramento nao terminou')
    assert(!rb.e, 'o segundo enfileiramento falhou em vez de ver o conteudo ja enfileirado: ' + rb.e?.message)
    assert.equal(rb.v.rows[0].r, 'unchanged')
    assert.equal(await countBy(`select count(*) n from public.crm_context_outbox where source_lead_id='${s.sid}'`), 1)
  })

  // 4c) FOR UPDATE no ack: o segundo ack do mesmo claim, depois do primeiro confirmar, recebe "Stale claim" e nao regrava o recibo.
  await pair(async (A, B) => {
    const s = await seed(720); await due()
    const ev = (await admin.query('select event_id from public.crm_context_outbox where source_lead_id=$1', [s.sid])).rows[0].event_id
    const row = (await admin.query('select public.crm_context_claim(1,60,$1) r', [ev])).rows[0].r[0]
    const receipt = JSON.stringify({ ok: true, receipt_id: U(7002), event_id: ev, status: 'applied' })
    await A.query('begin')
    await A.query('select public.crm_context_ack($1,$2,$3::jsonb)', [ev, row.claim_token, receipt])
    const pb = B.query('select public.crm_context_ack($1,$2,$3::jsonb)', [ev, row.claim_token, receipt])
    await sleep(600)
    await A.query('commit')
    const rb = await within(pb, 8000)
    assert(rb.e && /Stale claim/.test(rb.e.message), 'o segundo ack deveria receber Stale claim, veio: ' + JSON.stringify(rb.e?.message ?? rb.v?.rows))
    assert.equal(await countBy(`select count(*) n from public.crm_context_delivery_attempts where event_id='${ev}'`), 1, 'o recibo e a tentativa foram gravados uma unica vez')
  })

  // 4d) varredura de alinhamento: duas execucoes ao mesmo tempo nao se sobrepoem (a segunda e pulada) e nada fica duplicado.
  await pair(async (A, B) => {
    await admin.query('truncate public.crm_context_outbox cascade')
    const s = await seed(730)
    await admin.query(`update public.crm_context_delivery_control set reconcile_cursor=null`)
    await A.query('begin')
    const first = (await A.query('select public.crm_context_reconcile(150) s')).rows[0].s
    assert(first.examined >= 1 && first.changed >= 1, 'a primeira varredura trabalha: ' + JSON.stringify(first))
    const second = await within(B.query('select public.crm_context_reconcile(150) s'), 5000)
    assert(!second.timeout && !second.e, 'a segunda varredura nao pode esperar nem falhar: ' + JSON.stringify(second.e?.message ?? 'timeout'))
    assert.deepEqual(second.v.rows[0].s, { skipped: 'running' }, 'a segunda varredura e pulada enquanto a primeira nao termina')
    await A.query('commit')
    const third = (await B.query('select public.crm_context_reconcile(150) s')).rows[0].s
    assert.equal(third.changed, 0, 'depois da primeira terminar, nada muda de novo')
    assert.equal(await countBy(`select count(*) n from public.crm_context_outbox where source_lead_id='${s.sid}'`), 1)
  })

  console.log('verify-crm-context-bridge-concurrency: OK')
} finally {
  try { await admin?.end() } catch { /* encerrando */ }
  try { await server.stop() } catch { /* encerrando */ }
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* Windows pode manter o arquivo travado por instantes; a pasta e temporaria */ }
}
