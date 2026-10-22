// Banco descartavel (PGlite) com as funcoes REAIS das migrations. Nada toca producao.
// Ponte de saida dash -> VOXEN (contexto do atleta): fila, revisoes, lista fechada do payload, gatilhos que nunca derrubam o lead,
// claim/ack/fail, backfill so-contagem, saude, agendamento desligado e o script preflight/apply.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const dir = process.env.CRM_MIGRATIONS_DIR ?? 'supabase/migrations/'   // so a checagem de mutacao troca a pasta (copia com a migration alterada)
const read = file => readFileSync(dir + file, 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261020120000_crm_context_bridge.sql'
function extractFunction(file, name) {
  const src = read(file), starts = [...src.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g'))]
  assert(starts.length, `${name} nao encontrada em ${file}`)
  const start = starts.at(-1).index, tag = src.slice(start).match(/\bAS\s+(\$[A-Za-z_]*\$)/)
  const bodyStart = start + tag.index + tag[0].length, end = src.indexOf(tag[1], bodyStart)
  return src.slice(start, src.indexOf(';', end + tag[1].length) + 1)
}
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const db = new PGlite()
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const N = async (sql, params) => Number((await one(sql, params)).n)
const rejects = (promise, re, msg) => assert.rejects(promise, re, msg)

await db.exec(`
create role anon; create role authenticated; create role service_role; create schema auth;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;
create table public.user_roles(user_id uuid,role text);
create function public.crm_has_access() returns boolean language sql stable as $$select exists(select 1 from public.user_roles r where r.user_id=auth.uid() and r.role in('executive','super_admin','sdr','closer','seller'))$$;
create function public.is_executive(_user_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.user_roles r where r.user_id=_user_id and r.role in('executive','super_admin'))$$;
create table public.meta_form_leads(id uuid primary key default gen_random_uuid(),meta_lead_id text unique not null,page_id text default 'p',form_id text default 'f',
 form_name text,campaign_name text,ad_id text,created_time timestamptz default now(),field_data jsonb not null default '[]',full_name text,phone text,email text,
 entry_channel text default 'form' check(entry_channel in('form','website')),answers_form_lead_id uuid unique references public.meta_form_leads(id),
 answers_link_basis text,answers_linked_at timestamptz,import_contact jsonb default '{}',source_snapshot jsonb,review_note text,approval_status text default 'pendente',
 updated_at timestamptz default now());
create table public.crm_leads(id uuid primary key default gen_random_uuid(),name text,phone text,email text,athlete_name text,athlete_birth_date date,athlete_position text,
 athlete_age smallint,athlete_height_cm numeric,athlete_weight_kg numeric,city_state text,observations text,temperature text,qualification_notes text,followup_note text,
 qualification_goal text,qualification_decision_maker text,qualification_timeline text,qualification_summary text,
 import_snapshot jsonb,meta_form_lead_id uuid unique references public.meta_form_leads(id),updated_at timestamptz default now(),created_at timestamptz default clock_timestamp());
create table public.crm_form_answer_links(crm_lead_id uuid primary key references public.crm_leads(id) on delete cascade,form_lead_id uuid not null references public.meta_form_leads(id),basis text);
create table public.crm_lead_contexts(id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.crm_leads(id) on delete cascade,context_type text,content text,
 author_name text default 'AUTOR SEGREDO',created_at timestamptz not null default clock_timestamp());
create function public.crm_context_summary(p_offset integer default 0,p_limit integer default 500) returns table(lead_id uuid) language sql stable as $$
 select c.id from public.crm_leads c where exists(select 1 from public.crm_lead_contexts x where x.lead_id=c.id and nullif(btrim(x.content),'') is not null)
  or exists(select 1 from public.crm_form_answer_links k where k.crm_lead_id=c.id)
  or exists(select 1 from public.meta_form_leads m where m.id=c.meta_form_lead_id and m.entry_channel='form')
  or exists(select 1 from public.meta_form_leads m where m.id=c.meta_form_lead_id and m.answers_form_lead_id is not null)
 order by c.id limit least(greatest(coalesce(p_limit,500),1),500) offset greatest(coalesce(p_offset,0),0) $$;
create table public.meta_form_definitions(form_id text primary key,page_id text,name text,questions jsonb not null default '[]',raw jsonb not null default '{}',fetched_at timestamptz default now());
create schema cron; create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,active boolean default true);
create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid$$;
create function cron.unschedule(j bigint) returns boolean language sql as $$delete from cron.job where jobid=j returning true$$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
 returns void language sql as $$update cron.job set active=coalesce($6,active) where jobid=$1$$;
create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
create schema net; create table net.calls(id bigserial primary key,url text,headers jsonb,body jsonb,timeout_ms integer);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{"Content-Type":"application/json"}',timeout_milliseconds integer default 5000)
 returns bigint language sql as $$insert into net.calls(url,headers,body,timeout_ms) values(url,headers,body,timeout_milliseconds) returning id$$;
create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`)
// Funcoes reais do projeto das quais a ponte depende.
await db.exec(extractFunction('20261015021500_site_form_answers_link.sql', 'meta_match_name'))
await db.exec(extractFunction('20261015050000_meta_raw_capture_and_form_definitions.sql', 'meta_form_field_rank'))

// ---------- o script preflight/apply: ensaio nao deixa nada; instalacao registra e nao repete ----------
const generated = mode => {
  const r = spawnSync(process.execPath, ['scripts/apply-crm-context-bridge-migration.mjs', mode, '--print'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr); return readFileSync(r.stdout.trim(), 'utf8').replace(/\r\n/g, '\n')
}
let preflightError = ''
try { await db.exec(generated('preflight')) } catch (e) { preflightError = String(e.message) }
assert.match(preflightError, /PREFLIGHT_OK locais_com_formulario=0 eventos_a_enfileirar=0 job_cron_ativo=false enabled=false/, 'ensaio: ' + preflightError.slice(0, 300))
await db.exec('ROLLBACK')
for (const t of ['crm_context_outbox', 'crm_context_delivery_control', 'crm_context_delivery_attempts'])
  assert.equal((await one(`select to_regclass('public.${t}') r`)).r, null, 'o ensaio nao instala ' + t)
assert.equal(await N(`select count(*) n from cron.job where jobname like 'crm-context-%'`), 0, 'o ensaio nao agenda nada')
const installSql = generated('apply')
await db.exec(installSql)
assert.deepEqual(await q(`select version,name,(statements[1] like '%crm_context_outbox%') ok from supabase_migrations.schema_migrations`), [{ version: '20261020120000', name: 'crm_context_bridge', ok: true }])
await rejects(db.exec(installSql), /ja instalada/); await db.exec('ROLLBACK')
// Gabarito: o texto ORIGINAL de crm_context_payload (do arquivo da ponte) instalado ao lado com outro nome, para provar adiante que a refatoracao
// do montador nao mudou nada no fluxo normal. Depois, a migration do preenchimento unico de leads sem cadastro na VOXEN.
await db.exec(extractFunction(MIGRATION, 'crm_context_payload').replace('public.crm_context_payload(', 'public.crm_context_payload_legacy('))
const PROSPECTS = '20261021233000_crm_context_prospects.sql'
await db.exec(read(PROSPECTS))
await db.exec(read(PROSPECTS))   // idempotente: reaplicar nao quebra nem muda nada

// ---------- estrutura, permissoes, agendamento desligado ----------
{
  const c = await one('select enabled from public.crm_context_delivery_control where singleton')
  assert.equal(c.enabled, false, 'controle nasce desligado')
  const jobs = await q(`select jobname,active,schedule from cron.job where jobname like 'crm-context-%' order by jobname`)
  assert.deepEqual(jobs, [{ jobname: 'crm-context-delivery', active: false, schedule: '* * * * *' }, { jobname: 'crm-context-reconcile', active: false, schedule: '*/5 * * * *' }], 'os dois jobs nascem pausados')
  for (const t of ['crm_context_outbox', 'crm_context_delivery_control', 'crm_context_delivery_attempts']) {
    assert.equal((await one(`select relrowsecurity r from pg_class where oid='public.${t}'::regclass`)).r, true, 'RLS ligado em ' + t)
    for (const role of ['anon', 'authenticated', 'service_role'])
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
        assert.equal((await one(`select has_table_privilege('${role}','public.${t}','${priv}') p`)).p, false, `${role} nao pode ${priv} em ${t}`)
  }
  const exec = async (role, sig) => (await one(`select has_function_privilege('${role}','${sig}','EXECUTE') p`)).p
  for (const sig of ['public.crm_context_claim(integer,integer,uuid)', 'public.crm_context_ack(uuid,uuid,jsonb)', 'public.crm_context_fail(uuid,uuid,text,timestamptz,boolean)',
    'public.crm_context_backfill(uuid,integer,boolean)', 'public.crm_context_requeue_blocked(uuid)', 'public.crm_context_enqueue_synthetic(uuid)',
    'public.crm_context_reconcile(integer)', 'public.crm_context_delivery_invoke()', 'public.crm_context_delivery_set_enabled(boolean)', 'public.crm_context_reconcile_set_enabled(boolean)']) {
    assert.equal(await exec('service_role', sig), true, 'service_role executa ' + sig)
    assert.equal(await exec('anon', sig) || await exec('authenticated', sig), false, 'anon/authenticated nao executam ' + sig)
  }
  for (const sig of ['public.crm_context_payload(uuid)', 'public.crm_context_enqueue(uuid,boolean)', 'public.crm_context_on_answer_link()', 'public.crm_context_on_crm_lead()', 'public.crm_context_on_form_lead()',
    'public.crm_context_on_lead_context()', 'public.crm_context_on_crm_lead_delete()', 'public.crm_context_build(uuid,uuid,uuid,text,boolean)', 'public.crm_context_strip_auto_observations(text)', 'public.crm_context_lead_has_voxen(uuid)',
    'public.crm_context_payload_prospect(uuid)', 'public.crm_context_prospect_candidates()', 'public.crm_context_enqueue_prospect(uuid,boolean,boolean)', 'public.crm_context_rehearsal_accepted()', 'public.crm_context_is_contact_field(text)',
    'public.crm_context_touch_prospect(uuid)', 'public.crm_context_on_prospect_lead()', 'public.crm_context_on_prospect_note()', 'public.crm_context_on_prospect_link()', 'public.crm_context_on_prospect_form()', 'public.crm_context_scrub(text)', 'public.crm_context_candidate_sites()', 'public.crm_context_sites_of_lead(uuid)', 'public.crm_context_touch(uuid)', 'public.crm_context_log_error(text,text)'])
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal(await exec(role, sig), false, `${role} nao executa a funcao interna ${sig}`)
  for (const sig of ['public.crm_context_health()', 'public.crm_context_alignment()']) {
    assert.equal(await exec('authenticated', sig), true, 'o Executive chama pela sessao autenticada: ' + sig)
    assert.equal(await exec('service_role', sig), true)
    assert.equal(await exec('anon', sig), false)
  }
  const src = read(MIGRATION)
  assert.match(src, /FOR UPDATE SKIP LOCKED/, 'claim concorrente usa SKIP LOCKED')
  assert.match(src, /EXCEPTION WHEN OTHERS/, 'gatilhos capturam falhas')
  for (const fn of ['crm_context_claim', 'crm_context_ack', 'crm_context_fail', 'crm_context_backfill', 'crm_context_health', 'crm_context_payload', 'crm_context_enqueue', 'crm_context_reconcile', 'crm_context_alignment', 'crm_context_on_answer_link',
    'crm_context_on_lead_context', 'crm_context_candidate_sites', 'crm_context_sites_of_lead'])
    assert.match((await one(`select pg_get_functiondef(p.oid) d from pg_proc p where p.proname='${fn}' limit 1`)).d, /SECURITY DEFINER/, fn + ' e SECURITY DEFINER')
}

// ---------- dados sinteticos ----------
const EXEC = U(800), PLAIN = U(801)
await db.exec(`insert into public.user_roles values('${EXEC}','executive'),('${PLAIN}','sdr')`)
// O que NUNCA sai (decisao do dono em 21/10 liberou: nome do responsavel, observacoes, qualificacao qualitativa e notas de atendimento).
const SECRETS = ['11948173104', '5511948173104', 'segredo.pessoa@example.invalid', 'CAMPANHA SEGREDO', 'AD-SEGREDO-77',
  'QUALIFICACAO SEGREDO', 'FOLLOWUP SEGREDO', 'SNAPSHOT SEGREDO', 'utm-segredo', 'NOTA INTERNA SEGREDO', 'Nome CRM Secreto', 'TEMPERATURA SEGREDO',
  'CONSENTIMENTO SEGREDO', 'Cidade Secreta', '21977776666', 'AUTOR SEGREDO']
const FILLER = 'Fulano Preenchedor'   // nome de quem preencheu o formulario: vai como responsavel (ou como nome do atleta, se o atleta preencheu)
const COMMITMENT_Q = 'de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10'
const QUESTIONS = [
  ['quem_está_preenchendo_este_formulário?', 'sou_o_atleta'],
  ['atualmente,_o_atleta_está_vinculado_a_algum_clube?', 'Sim, jogo no Clube Alfa'],
  ['o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?', 'sim'],
  ['o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?', 'sim,_convite_ou_proposta'],
  ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', 'tornar-se_jogador_profissional'],
  ['o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?', 'falta_de_oportunidades'],
  ['qual_é_a_posição_e_a_categoria_atual_do_atleta?', 'Meia, sub-17'],
  ['quais_são_os_principais_clubes_que_o_atleta_já_representou?', 'Clube Alfa e Clube Beta'],
  ['quais_clubes_avaliou_e_qual_foi_o_resultado?', 'Passei 2 semanas no Clube Gama, "aprovado" 😀'],
  ['quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?', 'Velocidade, passe e visão. Preciso melhorar a força.'],
  [COMMITMENT_Q, 'Acho que us 8/10'],
]
const fieldData = (overrides = {}, extra = [], contact = {}) => JSON.stringify([
  ...QUESTIONS.map(([n, v]) => ({ name: n, values: [overrides[n] ?? v] })),
  { name: 'full_name', values: [FILLER] }, { name: 'phone_number', values: ['+5511948173104'] },
  { name: 'date_of_birth', values: [contact.dob ?? '2008-09-06'] }, { name: 'state', values: [contact.state ?? 'SP'] },
  { name: 'email', values: ['segredo.pessoa@example.invalid'] }, { name: 'city', values: ['Cidade Secreta'] },
  ...extra])
let seq = 0
async function seed({ link = 'insert', basis = 'mesmo anúncio, nome completo igual, 61 s depois do formulário', overrides = {}, formId = 'f', extra = [] } = {}) {
  const n = ++seq, sid = U(100 + n), form = U(1000 + n), site = U(2000 + n)
  await db.query(`insert into public.meta_form_leads(id,meta_lead_id,form_id,form_name,campaign_name,ad_id,field_data,full_name,phone,email,entry_channel)
   values($1,$2,$3,'FORMULARIO','CAMPANHA SEGREDO','AD-SEGREDO-77',$4::jsonb,'Fulano Preenchedor','+5511948173104','segredo.pessoa@example.invalid','form')`, [form, 'form:' + n, formId, fieldData(overrides, extra)])
  await db.query(`insert into public.meta_form_leads(id,meta_lead_id,form_id,campaign_name,ad_id,field_data,full_name,phone,email,entry_channel,answers_form_lead_id,answers_link_basis,answers_linked_at,source_snapshot,review_note,import_contact)
   values($1,$2,'site:avaliacao','CAMPANHA SEGREDO','AD-SEGREDO-77','[]'::jsonb,'Fulano Preenchedor','11948173104','segredo.pessoa@example.invalid','website',$3,$4,now(),$5::jsonb,'NOTA INTERNA SEGREDO',$6::jsonb)`,
  [site, 'site:zyron:' + sid, link === 'insert' ? form : null, link === 'insert' ? basis : null,
    JSON.stringify({ site_event: { payload: { attribution: { utm_content: 'utm-segredo' }, consent: 'CONSENTIMENTO SEGREDO' } } }),
    JSON.stringify({ phone: '21977776666', name: 'Nome CRM Secreto' })])
  return { n, sid, form, site }
}
const crmFor = async (metaFormLeadId, extra = {}) => (await one(`insert into public.crm_leads(name,phone,email,athlete_name,athlete_birth_date,athlete_position,athlete_age,athlete_height_cm,athlete_weight_kg,city_state,observations,temperature,qualification_notes,followup_note,import_snapshot,meta_form_lead_id,
  qualification_goal,qualification_decision_maker,qualification_timeline,qualification_summary)
  values('Nome CRM Secreto','21977776666','segredo.pessoa@example.invalid',$1,$2,$3,$4,$5,$6,$7,'OBSERVACAO DO SDR','TEMPERATURA SEGREDO','QUALIFICACAO SEGREDO','FOLLOWUP SEGREDO','{"x":"SNAPSHOT SEGREDO"}'::jsonb,$8,
  'META DO ATLETA','pai','curto prazo','RESUMO DA QUALIFICACAO') returning id`,
  [extra.athlete_name ?? 'Joao Atleta', extra.birth ?? '2008-09-06', extra.position ?? 'Meia', extra.age ?? 17, extra.height ?? 178.5, extra.weight ?? 68, extra.city ?? 'Santos / SP', metaFormLeadId])).id
const outboxOf = sid => q('select * from public.crm_context_outbox where source_lead_id=$1 order by source_revision', [sid])
const claim = async (limit = 20, lease = 60, ev = null) => (await one('select public.crm_context_claim($1,$2,$3) r', [limit, lease, ev])).r
const makeDue = () => db.exec(`update public.crm_context_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where state='pending'`)
const receiptFor = (row, status = 'applied', i = 1) => JSON.stringify({ ok: true, receipt_id: U(7000 + i), event_id: row.event_id, status })
const ack = (row, status, i) => q('select public.crm_context_ack($1,$2,$3::jsonb)', [row.event_id, row.claim_token, receiptFor(row, status, i)])
const keysDeep = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach(x => keysDeep(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out) } return out }
const ALLOWED_TOP = ['schema_version', 'kind', 'event_id', 'source_project', 'source_lead_id', 'source_revision', 'generated_at', 'link', 'profile', 'context', 'structured', 'answers',
  'guardian', 'crm', 'notes']
const ALLOWED = {
  guardian: ['name', 'filled_by_raw'],
  crm: ['observations', 'qualification'],
  qualification: ['goal', 'decision_maker', 'timeline', 'summary'],
  notes: ['type', 'content', 'created_at', 'truncated'],
  link: ['basis', 'form_lead_id', 'crm_lead_id'],
  profile: ['birth_date_raw', 'state_raw', 'position_category_raw', 'current_club_raw', 'filled_by_raw'],
  context: ['past_clubs', 'trials', 'opportunities_received', 'goal', 'blocker', 'evaluated_clubs', 'strengths_and_improvements', 'commitment_score_raw'],
  structured: ['athlete_name', 'athlete_birth_date', 'athlete_position', 'athlete_height_cm', 'athlete_weight_kg', 'athlete_age', 'city_state'],
  answers: ['question', 'answer'],
}

// ---------- payload: lista fechada, mapeamento e nada que "nunca sai" ----------
const A = await seed()
{
  const body = (await one('select public.crm_context_payload($1) p', [A.site])).p
  assert(body, 'payload existe quando ha formulario ligado')
  // Sem lead no CRM: quem preencheu como atleta e o nome do atleta; nao ha responsavel, observacoes, qualificacao nem notas.
  assert.deepEqual(Object.keys(body).sort(), ['answers', 'context', 'link', 'profile', 'structured'])
  assert.deepEqual(body.structured, { athlete_name: FILLER })
  for (const part of ['link', 'profile', 'context']) for (const k of Object.keys(body[part])) assert(ALLOWED[part].includes(k), `chave fora da lista: ${part}.${k}`)
  assert.deepEqual(body.profile, { filled_by_raw: 'sou_o_atleta', current_club_raw: 'Sim, jogo no Clube Alfa', position_category_raw: 'Meia, sub-17', birth_date_raw: '2008-09-06', state_raw: 'SP' })
  assert.deepEqual(body.context, {
    trials: 'sim', opportunities_received: 'sim,_convite_ou_proposta', goal: 'tornar-se_jogador_profissional', blocker: 'falta_de_oportunidades', past_clubs: 'Clube Alfa e Clube Beta',
    evaluated_clubs: 'Passei 2 semanas no Clube Gama, "aprovado" 😀', strengths_and_improvements: 'Velocidade, passe e visão. Preciso melhorar a força.', commitment_score_raw: 'Acho que us 8/10' })
  assert.deepEqual(body.link, { basis: 'mesmo anúncio, nome completo igual, 61 s depois do formulário', form_lead_id: A.form, crm_lead_id: null })
  assert.equal(body.answers.length, 11, 'as 11 perguntas, na ordem do formulario')
  assert.equal(body.answers[10].answer, 'Acho que us 8/10', 'a nota de compromisso vai (autorizada pelo dono)')
  assert.equal(body.answers[0].question, 'Quem está preenchendo este formulário?')
  const text = JSON.stringify(body)
  for (const s of SECRETS) assert(!text.includes(s), 'vazou dado que nunca sai: ' + s)
  const forbidden = /phone|email|utm|temperatur|follow|consent|campaign|snapshot|full_name|^ad_|(^|_)ad_id($|_)|meta_lead|city$|author|import_|review_|cpf/i
  for (const k of keysDeep(body)) assert(!forbidden.test(k) || ALLOWED.structured.includes(k), 'chave proibida: ' + k)
  assert(!body.answers.some(a => /nome|telefone|cpf|full|phone|email/i.test(a.question)), 'contato e perguntas desconhecidas ficam de fora')
}

// ---------- payload com lead no CRM: structured so com valor, e so as chaves permitidas ----------
{
  const crm = await crmFor(A.site)
  const body = (await one('select public.crm_context_payload($1) p', [A.site])).p
  assert.deepEqual(body.structured, { athlete_name: 'Joao Atleta', athlete_birth_date: '2008-09-06', athlete_position: 'Meia', athlete_height_cm: 178.5, athlete_weight_kg: 68, athlete_age: 17, city_state: 'Santos / SP' })
  assert.equal(body.link.crm_lead_id, crm)
  for (const k of Object.keys(body.structured)) assert(ALLOWED.structured.includes(k))
  // decisao do dono (21/10): observacoes e qualificacao qualitativa saem; quem preencheu como atleta nao gera "responsavel"
  assert.deepEqual(body.crm, { observations: 'OBSERVACAO DO SDR', qualification: { goal: 'META DO ATLETA', decision_maker: 'pai', timeline: 'curto prazo', summary: 'RESUMO DA QUALIFICACAO' } })
  for (const [k, allowed] of [['crm', ALLOWED.crm], ['qualification', ALLOWED.qualification]]) for (const key of Object.keys(k === 'crm' ? body.crm : body.crm.qualification)) assert(allowed.includes(key), `chave fora da lista: ${k}.${key}`)
  assert(!('guardian' in body) && !('notes' in body), 'sem responsavel nem notas aqui')
  assert.equal(body.structured.athlete_name, 'Joao Atleta', 'o que o SDR corrigiu vale mais que o texto livre')
  const text = JSON.stringify(body)
  for (const s of SECRETS) assert(!text.includes(s), 'vazou com lead no CRM: ' + s)
  // texto livre do SDR tambem passa pelo filtro de contato; texto vazio nao gera chave
  await db.query(`update public.crm_leads set observations='Pai: (11) 94817-3104 ou a@b.co',qualification_goal='  ',qualification_summary=null,qualification_decision_maker=null,qualification_timeline=null where id=$1`, [crm])
  assert.deepEqual((await one('select public.crm_context_payload($1) p', [A.site])).p.crm, { observations: 'Pai: [contato removido] ou [contato removido]' })
  await db.query(`update public.crm_leads set observations=null where id=$1`, [crm])
  assert(!('crm' in (await one('select public.crm_context_payload($1) p', [A.site])).p), 'sem observacoes nem qualificacao nao ha bloco crm')
  await db.query(`update public.crm_leads set observations='OBSERVACAO DO SDR',qualification_goal='META DO ATLETA',qualification_decision_maker='pai',qualification_timeline='curto prazo',qualification_summary='RESUMO DA QUALIFICACAO' where id=$1`, [crm])
  await db.query('update public.crm_leads set athlete_height_cm=null,athlete_weight_kg=null,athlete_age=null,city_state=null,athlete_birth_date=null where id=$1', [crm])
  assert.deepEqual(Object.keys((await one('select public.crm_context_payload($1) p', [A.site])).p.structured), ['athlete_name', 'athlete_position'], 'so chaves com valor')
  await db.query('delete from public.crm_leads where id=$1', [crm])
}

// ---------- vinculo do CRM pelo formulario (nao pelo site) tambem e encontrado ----------
{
  const B = await seed()
  const crm = await crmFor(B.form)
  assert.equal((await one('select public.crm_context_payload($1) p', [B.site])).p.link.crm_lead_id, crm)
  await db.query('delete from public.crm_leads where id=$1', [crm])
}

// ---------- responsavel: so quem preencheu como pai/mae/responsavel; sem formulario, o contato do lead quando e outra pessoa que o atleta ----------
{
  const Q1 = 'quem_está_preenchendo_este_formulário?'
  const G1 = await seed({ overrides: { [Q1]: 'sou_pai,_mãe_ou_responsável' } })
  const g1 = (await one('select public.crm_context_payload($1) p', [G1.site])).p
  assert.deepEqual(g1.guardian, { name: FILLER, filled_by_raw: 'sou_pai,_mãe_ou_responsável' }, 'quem preencheu como responsavel vai como responsavel')
  assert(!('structured' in g1), 'o nome do responsavel nunca vira nome do atleta')
  const crm1 = await crmFor(G1.site)
  const g2 = (await one('select public.crm_context_payload($1) p', [G1.site])).p
  assert.equal(g2.structured.athlete_name, 'Joao Atleta'); assert.equal(g2.guardian.name, FILLER)
  assert(!JSON.stringify(g2).includes('Nome CRM Secreto'), 'com formulario, o nome do contato do CRM nao sai')
  await db.query('delete from public.crm_leads where id=$1', [crm1])
  const G3 = await seed({ overrides: { [Q1]: 'teste de lead' } })
  const g3 = (await one('select public.crm_context_payload($1) p', [G3.site])).p
  assert(!('guardian' in g3) && !('structured' in g3), 'resposta desconhecida de "quem preencheu" nao classifica ninguem')
  // sem formulario ligado (so o CRM): o contato do lead e o responsavel quando difere do atleta; igual ao atleta, nao
  const S = await seed({ link: 'later' })
  const lonely = (await one(`insert into public.crm_leads(name,athlete_name,meta_form_lead_id,observations) values('Maria Responsavel','Joao Atleta',$1,'so observacao') returning id`, [S.site])).id
  const g4 = (await one('select public.crm_context_payload($1) p', [S.site])).p
  assert.deepEqual(g4.guardian, { name: 'Maria Responsavel' }); assert.equal(g4.link.basis, 'registro do site, sem formulário ligado'); assert.equal(g4.crm.observations, 'so observacao')
  await db.query(`update public.crm_leads set name='joao atleta' where id=$1`, [lonely])
  assert(!('guardian' in (await one('select public.crm_context_payload($1) p', [S.site])).p), 'contato com o mesmo nome do atleta nao e responsavel')
  await db.query('delete from public.crm_leads where id=$1', [lonely])
}

// ---------- notas de atendimento: 3 tipos, ordem, filtro de contato, teto, gatilho e nada de autor ----------
{
  const T = await seed()
  const crm = await crmFor(T.site)
  const note = (type, content, at) => one(`insert into public.crm_lead_contexts(lead_id,context_type,content,created_at) values($1,$2,$3,$4) returning id`, [crm, type, content, at ?? new Date().toISOString()])
  const notesOf = async () => (await outboxOf(T.sid)).at(-1).payload.notes
  assert.equal(await notesOf(), undefined, 'sem notas nao ha chave notes')
  const n1 = await note('whatsapp_summary', 'Conversou com o pai. Ligar no (11) 94817-3104 amanha.', '2026-10-01T10:00:00Z')
  await note('manual_note', 'Atleta quer testar no Clube Delta.', '2026-10-02T10:00:00Z')
  await note('call_transcript', 'Transcricao da call com o responsavel.', '2026-10-03T10:00:00Z')
  await note('anexo', 'tipo que nao e nota de atendimento', '2026-10-04T10:00:00Z')
  await note('manual_note', '   ', '2026-10-05T10:00:00Z')
  let notes = await notesOf()
  assert.deepEqual(notes.map(n => n.type), ['whatsapp_summary', 'manual_note', 'call_transcript'], 'so os 3 tipos, em ordem de criacao, sem nota vazia')
  assert.equal(notes[0].content, 'Conversou com o pai. Ligar no [contato removido] amanha.', 'contato digitado na nota e removido')
  assert.deepEqual(Object.keys(notes[0]).sort(), ['content', 'created_at', 'type'], 'so texto, tipo e data: nada de autor')
  assert.equal(notes[0].created_at, '2026-10-01T10:00:00Z')
  const flat = JSON.stringify((await outboxOf(T.sid)).at(-1).payload)
  for (const s of SECRETS) assert(!flat.includes(s), 'vazou junto das notas: ' + s)
  assert.equal((await outboxOf(T.sid)).length, 1, 'notas novas dentro da janela entram na mesma revisao')
  // editar, trocar de tipo e apagar a nota chegam na fila
  await db.query(`update public.crm_lead_contexts set content='Conversa atualizada' where id=$1`, [n1.id])
  assert.equal((await notesOf())[0].content, 'Conversa atualizada')
  await db.query(`update public.crm_lead_contexts set context_type='anexo' where id=$1`, [n1.id])
  assert.deepEqual((await notesOf()).map(n => n.type), ['manual_note', 'call_transcript'])
  await db.query('delete from public.crm_lead_contexts where lead_id=$1', [crm])
  assert.equal(await notesOf(), undefined, 'sem notas a chave some')
  // teto: as 25 notas mais recentes (em ordem cronologica), 6000 caracteres por nota (limite de 1 MiB do corpo)
  for (let i = 0; i < 27; i++) await note('manual_note', i === 26 ? 'x'.repeat(6500) : 'nota ' + i, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString())
  notes = await notesOf()
  assert.equal(notes.length, 25); assert.equal(notes[0].content, 'nota 2', 'as 2 mais antigas ficam de fora'); assert(!('truncated' in notes[0]))
  assert.equal(notes[24].content.length, 6000); assert.equal(notes[24].truncated, true)
  assert(Buffer.byteLength(JSON.stringify((await outboxOf(T.sid)).at(-1).payload)) < 1048576 / 4, 'o pior caso cabe com folga no limite de 1 MiB')
  // mudar a nota depois de enviada e a revisao seguinte; apagar o lead leva as notas junto sem erro
  await makeDue(); const [c] = await claim(20, 60, (await outboxOf(T.sid))[0].event_id); await ack(c, 'applied', 95)
  await note('manual_note', 'nota depois do envio', '2026-11-01T00:00:00Z')
  assert.deepEqual((await outboxOf(T.sid)).map(r => Number(r.source_revision)), [1, 2])
  const errorsBefore = await N('select trigger_error_count n from public.crm_context_delivery_control')
  await db.query('delete from public.crm_leads where id=$1', [crm])
  assert.equal(await N('select trigger_error_count n from public.crm_context_delivery_control'), errorsBefore, 'apagar o lead com notas nao gera erro no gatilho das notas')
  assert.equal((await outboxOf(T.sid)).at(-1).payload.link.crm_lead_id, null, 'lead apagado: as notas saem do contexto')
  assert(!('notes' in (await outboxOf(T.sid)).at(-1).payload))
}

// ---------- dados reais sujos: "state" e nascimento so saem no formato esperado; contato dentro de texto livre e removido ----------
{
  const stateOf = async state => {
    const s = await seed(); await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [s.form, fieldData({}, [], { state })])
    return (await one('select public.crm_context_payload($1) p', [s.site])).p.profile.state_raw
  }
  const dobOf = async dob => {
    const s = await seed(); await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [s.form, fieldData({}, [], { dob })])
    return (await one('select public.crm_context_payload($1) p', [s.site])).p.profile.birth_date_raw
  }
  for (const ok of ['SP', 'São Paulo', 'Rio Grande do Sul', 'sp ', 'Minas Gerais']) assert.equal(await stateOf(ok), ok.trim(), 'estado legitimo fica: ' + ok)
  for (const bad of ['11948173104', '(11) 94817-3104', '+55 11 94817 3104', 'segredo.pessoa@example.invalid', 'Fulano Preenchedor', 'fulano preenchedor - SP',
    'Rua 5, Santos', 'x'.repeat(61), '21977776666'])
    assert.equal(await stateOf(bad), undefined, 'state_raw com contato, nome ou digitos nao sai: ' + bad)
  for (const ok of ['2008-09-06', '06/09/2008', '6/9/2008']) assert.equal(await dobOf(ok), ok, 'nascimento no formato esperado fica: ' + ok)
  for (const bad of ['nao sei', '11948173104', 'segredo.pessoa@example.invalid', '2008-09-06 e 11948173104']) assert.equal(await dobOf(bad), undefined, 'nascimento fora do formato nao sai: ' + bad)
  // texto livre: so o trecho de contato e trocado; o resto fica exatamente como escrito
  const free = await seed()
  const text = 'Jogo de ala. Me chama no (11) 94817-3104 ou +55 11 94817 3104 ou 11948173104 ou fulano.silva+x@example.invalid, obrigado! 😀'
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [free.form, fieldData({ 'quais_clubes_avaliou_e_qual_foi_o_resultado?': text,
    'quais_são_os_principais_clubes_que_o_atleta_já_representou?': 'Santos 2019 2020 2021, Palmeiras 2022 / sub-17 (2023)' })])
  const fp = (await one('select public.crm_context_payload($1) p', [free.site])).p
  assert.equal(fp.context.evaluated_clubs, 'Jogo de ala. Me chama no [contato removido] ou [contato removido] ou [contato removido] ou [contato removido], obrigado! 😀')
  assert.equal(fp.answers.find(a => /avaliou/.test(a.question)).answer, fp.context.evaluated_clubs, 'answers e context recebem o mesmo texto limpo')
  assert.equal(fp.context.past_clubs, 'Santos 2019 2020 2021, Palmeiras 2022 / sub-17 (2023)', 'anos e numeros que nao sao telefone ficam intactos')
  const flat = JSON.stringify(fp)
  for (const s of ['94817', '11948173104', 'fulano.silva', 'example.invalid']) assert(!flat.includes(s), 'contato vazou: ' + s)
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [free.form, fieldData({}, [], {})])
}

// ---------- vinculo (basis): regra automatica segue; texto digitado por pessoa nunca sai ----------
{
  const C = await seed({ basis: 'confirmado manualmente (pai Fulano ligou: telefone 11 90000-0000), 120 s depois do formulário' })
  assert.equal((await one('select public.crm_context_payload($1) p', [C.site])).p.link.basis, 'confirmado manualmente')
  const D = await seed({ basis: 'mesmo WhatsApp e mesmo anúncio, nome diferente, 120 s depois do formulário' })
  assert.equal((await one('select public.crm_context_payload($1) p', [D.site])).p.link.basis, 'mesmo WhatsApp e mesmo anúncio, nome diferente, 120 s depois do formulário')
}

// ---------- definicao do formulario: texto exato da pergunta e da opcao ----------
{
  const E = await seed({ formId: 'F-DEF' })
  await db.query(`insert into public.meta_form_definitions(form_id,page_id,name,questions,raw) values('F-DEF','p','x',$1::jsonb,'{}')`, [JSON.stringify([
    { key: 'quem_está_preenchendo_este_formulário?', label: 'Quem está preenchendo este formulário? (rótulo exato)', options: [{ key: 'sou_o_atleta', value: 'Sou o atleta' }] }])])
  const body = (await one('select public.crm_context_payload($1) p', [E.site])).p
  assert.equal(body.answers[0].question, 'Quem está preenchendo este formulário? (rótulo exato)')
  assert.equal(body.answers[0].answer, 'Sou o atleta'); assert.equal(body.profile.filled_by_raw, 'Sou o atleta')
  assert.equal(body.answers[1].answer, 'Sim, jogo no Clube Alfa', 'texto digitado pelo atleta fica exatamente como veio')
}

// ---------- nada a enviar: nao e site, sem formulario ligado, id malformado ----------
{
  const S = await seed({ link: 'later' })
  assert.equal((await one('select public.crm_context_payload($1) p', [S.site])).p, null, 'sem formulario ligado nao ha payload')
  assert.equal((await one('select public.crm_context_enqueue($1,false) r', [S.site])).r, 'skipped')
  assert.equal((await one('select public.crm_context_enqueue($1,false) r', [S.form])).r, 'skipped', 'registro do formulario nao e enfileirado por si')
  assert.equal((await one('select public.crm_context_enqueue($1,false) r', [U(424242)])).r, 'skipped', 'id inexistente')
  await db.query(`update public.meta_form_leads set meta_lead_id='site:zyron:nao-e-uuid',answers_form_lead_id=$2 where id=$1`, [S.site, S.form])
  assert.equal((await outboxOf(S.sid)).length, 0)
  assert.equal((await one('select public.crm_context_enqueue($1,false) r', [S.site])).r, 'skipped', 'meta_lead_id malformado')
}

// ---------- gatilho: vinculo criado depois enfileira a revisao 1; formulario sem respostas conhecidas nao ----------
const F = await seed({ link: 'later' })
assert.equal((await outboxOf(F.sid)).length, 0, 'site sem formulario ligado nao enfileira')
await db.query('update public.meta_form_leads set answers_form_lead_id=$2,answers_link_basis=$3,answers_linked_at=now() where id=$1', [F.site, F.form, 'mesmo anúncio, nome completo igual, 61 s depois do formulário'])
const [f1] = await outboxOf(F.sid)
assert.equal((await outboxOf(F.sid)).length, 1)
assert.equal(Number(f1.source_revision), 1); assert.equal(f1.state, 'pending'); assert.equal(f1.attempts, 0)
assert.deepEqual(Object.keys(f1.payload).sort(), [...ALLOWED_TOP.filter(k => !['guardian', 'crm', 'notes'].includes(k))].sort(), 'sem lead no CRM: sem responsavel, observacoes nem notas')
assert.equal(f1.payload.schema_version, 1); assert.equal(f1.payload.kind, 'athlete_context'); assert.equal(f1.payload.source_project, 'mbzwchnxtskysqplqiyy')
assert.equal(f1.payload.source_lead_id, F.sid); assert.equal(f1.payload.source_revision, 1); assert.equal(f1.payload.event_id, f1.event_id)
assert.match(f1.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'uuid v4')
assert.match(f1.payload.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
{
  const wait = (await one(`select extract(epoch from (next_attempt_at-created_at)) s from public.crm_context_outbox where event_id=$1`, [f1.event_id])).s
  assert(wait >= 40 && wait <= 50, 'espera de ~45 s para juntar mudancas, deu ' + wait)
}

// ---------- junção de mudancas (30 a 60 s): reescreve a pendente que nunca foi enviada ----------
{
  const crm = await crmFor(F.site)                                    // lead aprovado: ganha structured, mesma revisao
  let rows = await outboxOf(F.sid)
  assert.equal(rows.length, 1, 'mudanca dentro da janela nao cria nova revisao'); assert.equal(Number(rows[0].source_revision), 1)
  assert.equal(rows[0].payload.structured.athlete_position, 'Meia'); assert.equal(rows[0].payload.link.crm_lead_id, crm)
  await db.query(`update public.crm_leads set athlete_position='Zagueiro' where id=$1`, [crm])
  rows = await outboxOf(F.sid)
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.structured.athlete_position, 'Zagueiro')
  assert.equal(rows[0].payload.source_revision, 1)
  await db.query(`update public.meta_form_leads set field_data=$2::jsonb where id=$1`, [F.form, fieldData({ [COMMITMENT_Q]: 'dez' })])
  rows = await outboxOf(F.sid)
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.context.commitment_score_raw, 'dez', 'respostas atualizadas entram na mesma revisao')
  // observacoes e qualificacao qualitativa fazem parte do contexto: a mudanca entra na mesma revisao
  await db.query(`update public.crm_leads set observations='nova observacao',qualification_goal='nova meta' where id=$1`, [crm])
  rows = await outboxOf(F.sid)
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.crm.observations, 'nova observacao'); assert.equal(rows[0].payload.crm.qualification.goal, 'nova meta')
  await db.query(`update public.crm_leads set name='Outro Nome Do Contato' where id=$1`, [crm])
  assert.equal((await outboxOf(F.sid)).length, 1, 'trocar o nome do contato com formulario ligado nao muda o contexto')
  // mudancas sem relacao com o contrato nao tocam nada
  const before = (await outboxOf(F.sid))[0]
  await db.query(`update public.crm_leads set temperature='x',qualification_notes='y',followup_note='z',updated_at=now() where id=$1`, [crm])
  await db.query(`update public.meta_form_leads set review_note='n',approval_status='aprovado' where id=$1`, [F.site])
  const after = await outboxOf(F.sid)
  assert.equal(after.length, 1); assert.equal(after[0].event_id, before.event_id); assert.equal(after[0].content_hash, before.content_hash)
  // teto de 5 min: a espera nao e empurrada para sempre
  await db.query(`update public.crm_context_outbox set created_at=clock_timestamp()-interval '10 minutes' where source_lead_id=$1`, [F.sid])
  await db.query(`update public.crm_leads set athlete_position='Lateral' where id=$1`, [crm])
  const capped = (await outboxOf(F.sid))[0]
  assert.equal(capped.payload.structured.athlete_position, 'Lateral')
  assert(new Date(capped.next_attempt_at) <= new Date(), 'passou do teto: fica elegivel ja')
  // CRM encontrado pelo registro do formulario tambem toca o site certo
  await db.query('delete from public.crm_leads where id=$1', [crm])
}

// ---------- revisoes: crescem, nunca repetem, idempotencia e ordem ----------
{
  const G = await seed()
  let rows = await outboxOf(G.sid); assert.equal(rows.length, 1)
  assert.equal((await one('select public.crm_context_enqueue($1,false) r', [G.site])).r, 'unchanged', 'mesmo conteudo nao gera revisao')
  assert.equal((await outboxOf(G.sid)).length, 1)
  await makeDue()
  assert.equal((await claim(20, 60, rows[0].event_id)).length, 1, 'a revisao 1 fica em processamento')
  // alteracao com a revisao 1 ja "em processamento": cria a 2
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [G.form, fieldData({ 'qual_é_a_posição_e_a_categoria_atual_do_atleta?': 'Goleiro, sub-20' })])
  rows = await outboxOf(G.sid)
  assert.deepEqual(rows.map(r => Number(r.source_revision)), [1, 2])
  assert.notEqual(rows[0].event_id, rows[1].event_id, 'event_id novo a cada revisao')
  assert.equal(rows[1].payload.source_revision, 2); assert.equal(rows[1].payload.profile.position_category_raw, 'Goleiro, sub-20')
  assert.equal(rows[0].payload.profile.position_category_raw, 'Meia, sub-17', 'a revisao ja reservada nao muda')
  await rejects(db.query(`insert into public.crm_context_outbox(source_lead_id,source_revision,payload,content_hash) values($1,2,'{}'::jsonb,'x')`, [G.sid]), /duplicate key|unique/i, '(lead, revisao) e unico')
  // entregue + mesmo conteudo = nada; entregue + mudanca = proxima revisao
  const first = (await q('select * from public.crm_context_outbox where source_lead_id=$1 and source_revision=1', [G.sid]))[0]
  await ack({ event_id: first.event_id, claim_token: first.claim_token }, 'applied', 1)
  assert.equal((await one('select state s from public.crm_context_outbox where event_id=$1', [first.event_id])).s, 'delivered')
  assert.equal((await one('select public.crm_context_enqueue($1,false) r', [G.site])).r, 'unchanged')
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [G.form, fieldData({ 'qual_é_a_posição_e_a_categoria_atual_do_atleta?': 'Volante, sub-20' })])
  assert.deepEqual((await outboxOf(G.sid)).map(r => Number(r.source_revision)), [1, 2], 'a 2 ainda pendente absorve a mudanca (nunca enviada)')
}

// ---------- lead criado a mao (crm_form_answer_links): crm_lead_id e structured, e os gatilhos do vinculo e dos dados do atleta ----------
{
  const M = await seed()
  const before = (await outboxOf(M.sid))[0]
  assert.equal(before.payload.link.crm_lead_id, null); assert.deepEqual(before.payload.structured, { athlete_name: FILLER }, 'sem lead no CRM, so o nome de quem preencheu como atleta')
  const manual = (await one(`insert into public.crm_leads(name,phone,athlete_name,athlete_position,athlete_age) values('Nome CRM Secreto','21977776666','Atleta Manual','Lateral',16) returning id`)).id
  assert.equal((await outboxOf(M.sid))[0].payload.link.crm_lead_id, null, 'lead manual ainda sem vinculo nao muda nada')
  await db.query('insert into public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) values($1,$2,$3)', [manual, M.form, 'mesmo WhatsApp'])
  let rows = await outboxOf(M.sid)
  assert.equal(rows.length, 1, 'dentro da janela de juncao: mesma revisao')
  assert.equal(rows[0].payload.link.crm_lead_id, manual)
  assert.deepEqual(rows[0].payload.structured, { athlete_name: 'Atleta Manual', athlete_position: 'Lateral', athlete_age: 16 })
  const flat = JSON.stringify(rows[0].payload)
  for (const s of ['21977776666', 'Nome CRM Secreto', 'mesmo WhatsApp\'']) assert(!flat.includes(s), 'dado do lead manual vazou: ' + s)
  await db.query(`update public.crm_leads set athlete_position='Zagueiro' where id=$1`, [manual])
  assert.equal((await outboxOf(M.sid))[0].payload.structured.athlete_position, 'Zagueiro', 'edicao do SDR no lead manual chega na fila')
  await makeDue(); const [claimed] = await claim(20, 60, rows[0].event_id); await ack(claimed, 'applied', 90)
  await db.query(`update public.crm_leads set athlete_position='Volante' where id=$1`, [manual])
  rows = await outboxOf(M.sid)
  assert.deepEqual(rows.map(r => Number(r.source_revision)), [1, 2], 'depois de entregue, a mudanca e a revisao 2')
  assert.equal(rows[1].payload.structured.athlete_position, 'Volante')
  await db.query('delete from public.crm_form_answer_links where crm_lead_id=$1', [manual])
  rows = await outboxOf(M.sid)
  assert.equal(rows.at(-1).payload.link.crm_lead_id, null, 'vinculo removido: o lead sai do contexto'); assert.deepEqual(rows.at(-1).payload.structured, { athlete_name: FILLER }, 'volta ao que o formulario diz')
  // dois leads para o mesmo formulario: o lead ligado pelo registro do site vence; entre manuais, o mais antigo (escolha estavel)
  const older = (await one(`insert into public.crm_leads(name,athlete_name,created_at) values('x','Mais Antigo',now()-interval '2 hours') returning id`)).id
  const newer = (await one(`insert into public.crm_leads(name,athlete_name,created_at) values('x','Mais Novo',now()-interval '1 hour') returning id`)).id
  await db.query('insert into public.crm_form_answer_links(crm_lead_id,form_lead_id) values($1,$3),($2,$3)', [newer, older, M.form])
  assert.equal((await outboxOf(M.sid)).at(-1).payload.link.crm_lead_id, older)
  const bySite = (await one(`insert into public.crm_leads(name,athlete_name,meta_form_lead_id) values('x','Ligado ao Site',$1) returning id`, [M.site])).id
  assert.equal((await outboxOf(M.sid)).at(-1).payload.link.crm_lead_id, bySite, 'lead ligado pelo site tem precedencia sobre os manuais')
  assert.equal((await outboxOf(M.sid)).at(-1).payload.structured.athlete_name, 'Ligado ao Site')
  // apagar o lead (cascata remove o vinculo) tambem atualiza a fila
  await db.query('delete from public.crm_leads where id=any($1::uuid[])', [[older, newer, bySite]])
  assert.equal((await outboxOf(M.sid)).at(-1).payload.link.crm_lead_id, null, 'lead apagado: sai do contexto')
}

// ---------- varredura de alinhamento (rede de seguranca dos gatilhos) e relatorio de alinhamento ----------
{
  const asService = role => db.query(`select set_config('request.jwt.claim.role',$1,false)`, [role])
  const R = await seed()
  await db.exec('alter table public.meta_form_leads disable trigger zz_crm_context_form_lead')   // simula um gatilho que nao rodou
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [R.form, fieldData({ [COMMITMENT_Q]: '3' })])
  await db.exec('alter table public.meta_form_leads enable trigger zz_crm_context_form_lead')
  assert.equal((await outboxOf(R.sid))[0].payload.context.commitment_score_raw, 'Acho que us 8/10', 'sem o gatilho a fila ficou desatualizada')
  await asService('service_role')
  const a1 = (await one('select public.crm_context_alignment() a')).a
  assert(a1.to_enqueue >= 1 && a1.in_sync >= 1, 'o alinhamento enxerga o atleta desatualizado: ' + JSON.stringify(a1))
  assert.equal(a1.linked_sites, a1.in_sync + a1.to_enqueue + a1.skipped)
  assert.equal(await N('select count(*) n from public.crm_context_outbox where source_lead_id=$1 and source_revision>1', [R.sid]), 0, 'o alinhamento so conta, nao grava')
  await rejects(q('select public.crm_context_reconcile(0)'), /Invalid reconcile bounds/); await rejects(q('select public.crm_context_reconcile(501)'), /Invalid reconcile bounds/)
  const total = a1.linked_sites
  let examined = 0, changed = 0, cycles = 0
  for (let i = 0; i < 100; i++) {
    const s = (await one('select public.crm_context_reconcile(2) s')).s
    examined += s.examined; changed += s.changed; cycles++
    assert.equal(s.errors, 0)
    const cur = (await one('select reconcile_cursor c from public.crm_context_delivery_control')).c
    if (s.cycle_complete) { assert.equal(cur, null, 'ciclo completo zera o cursor'); break }
    assert.notEqual(cur, null, 'ciclo incompleto guarda o cursor')
  }
  assert.equal(examined, total, 'o ciclo percorre cada atleta ligado exatamente uma vez'); assert(cycles > 1, 'lotes pequenos retomam pelo cursor'); assert(changed >= 1)
  assert.equal((await outboxOf(R.sid))[0].payload.context.commitment_score_raw, '3', 'a varredura trouxe a fila de volta ao alinhamento')
  const a2 = (await one('select public.crm_context_alignment() a')).a
  assert.equal(a2.to_enqueue, 0, 'depois da varredura nada fica por enfileirar'); assert.equal(a2.in_sync + a2.skipped, a2.linked_sites)
  assert.equal((await one('select public.crm_context_reconcile(500) s')).s.changed, 0, 'segunda varredura: idempotente')
  const ctl = await one('select last_reconcile_at t,last_reconcile_summary s from public.crm_context_delivery_control')
  assert(ctl.t); assert.deepEqual(Object.keys(ctl.s).sort(), ['changed', 'cycle_complete', 'errors', 'examined', 'prospects_changed', 'prospects_examined'])
  // um erro nao derruba a varredura: tudo vira contagem e registro, o cursor segue e nada levanta
  const errBefore = await N('select trigger_error_count n from public.crm_context_delivery_control')
  await db.exec('alter function public.meta_form_field_rank(text) rename to meta_form_field_rank_bak')
  try {
    const bad = (await one('select public.crm_context_reconcile(500) s')).s
    const valid = await N(`select count(*) n from public.meta_form_leads where entry_channel='website' and answers_form_lead_id is not null and meta_lead_id ~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`)
    assert.equal(bad.errors, valid, 'cada atleta valido falha e e contado (o de id malformado e descartado antes do calculo)'); assert.equal(bad.examined, total); assert.equal(bad.cycle_complete, true)
  } finally { await db.exec('alter function public.meta_form_field_rank_bak(text) rename to meta_form_field_rank') }
  assert((await N('select trigger_error_count n from public.crm_context_delivery_control')) > errBefore, 'a falha da varredura foi registrada')

  // alinhamento do CRM: contexto marcado x respostas x ID da VOXEN, e perguntas que a ponte nao conhece
  const base = (await one('select public.crm_context_alignment() a')).a
  const P = await seed()
  const viaSite = (await one(`insert into public.crm_leads(name,meta_form_lead_id) values('a',$1) returning id`, [P.site])).id
  const P2 = await seed()
  const manual = (await one(`insert into public.crm_leads(name) values('b') returning id`)).id
  await db.query('insert into public.crm_form_answer_links(crm_lead_id,form_lead_id) values($1,$2)', [manual, P2.form])
  const formOnly = (await one(`insert into public.meta_form_leads(meta_lead_id,field_data,entry_channel) values('form:solo',$1::jsonb,'form') returning id`, [fieldData()])).id
  const orphan = (await one(`insert into public.crm_leads(name,meta_form_lead_id) values('c',$1) returning id`, [formOnly])).id
  const noteOnly = (await one(`insert into public.crm_leads(name) values('d') returning id`)).id
  await db.query(`insert into public.crm_lead_contexts(lead_id,context_type,content) values($1,'whatsapp_summary','NOTA DE ATENDIMENTO')`, [noteOnly])
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [P.form, fieldData({}, [{ name: 'qual_o_seu_time_do_coracao?', values: ['Segredo FC'] }])])
  const a3 = (await one('select public.crm_context_alignment() a')).a
  const d = k => a3[k] - base[k]
  assert.deepEqual([d('crm_leads_with_context'), d('with_answers'), d('with_answers_addressable'), d('with_answers_without_voxen_id'), d('context_without_answers')], [4, 3, 2, 1, 1],
    'contagens do CRM: via site, manual ligado, so formulario (sem ID da VOXEN) e so nota')
  assert(a3.unmapped_questions.includes('qual_o_seu_time_do_coracao?'), 'pergunta nova aparece no alinhamento')
  assert(!JSON.stringify(a3).includes('Segredo FC') && !JSON.stringify(a3).includes('NOTA DE ATENDIMENTO'), 'o alinhamento nunca traz respostas nem notas')
  const pay = (await one('select public.crm_context_payload($1) p', [P.site])).p
  assert.deepEqual(pay.answers.at(-1), { question: 'Qual o seu time do coracao?', answer: 'Segredo FC' }, 'pergunta nova vai sozinha, como resposta, sem filtro de assunto (decisao do dono em 22/10)')
  assert(!('time_do_coracao' in (pay.context ?? {})) && !('time_do_coracao' in (pay.profile ?? {})), 'e so resposta: nao vira campo mapeado')
  await asService('authenticated'); await rejects(q('select public.crm_context_alignment()'), /Executive|42501/)
  await asService('')
  await db.query('delete from public.crm_leads where id=any($1::uuid[])', [[viaSite, manual, orphan, noteOnly]])
}

// ---------- falha do gatilho nao derruba quem salvou o lead ----------
{
  const H = await seed()
  const before = await N('select trigger_error_count n from public.crm_context_delivery_control')
  await db.exec('alter function public.meta_form_field_rank(text) rename to meta_form_field_rank_bak')
  try {
    await db.query(`update public.meta_form_leads set field_data=$2::jsonb where id=$1`, [H.form, fieldData({ [COMMITMENT_Q]: '7' })])
    const crm = await crmFor(H.site)
    await db.query(`update public.crm_leads set athlete_position='Ala' where id=$1`, [crm])
    assert.equal((await one('select athlete_position p from public.crm_leads where id=$1', [crm])).p, 'Ala', 'o lead foi salvo mesmo com a ponte quebrada')
    assert.equal((await one('select field_data->10->>\'values\' v from public.meta_form_leads where id=$1', [H.form])).v, '["7"]', 'o formulario foi salvo')
    await db.query('delete from public.crm_leads where id=$1', [crm])
  } finally { await db.exec('alter function public.meta_form_field_rank_bak(text) rename to meta_form_field_rank') }
  const control = await one('select trigger_error_count n, last_trigger_error_at t, last_trigger_error e from public.crm_context_delivery_control')
  assert(Number(control.n) > before, 'a falha foi registrada'); assert(control.t); assert.match(control.e, /42883/, 'registra so o codigo, sem texto do dado')
  assert(!SECRETS.some(s => String(control.e).includes(s)))
  // com a ponte consertada tudo volta ao normal
  await db.query(`update public.meta_form_leads set field_data=$2::jsonb where id=$1`, [H.form, fieldData({ [COMMITMENT_Q]: '9' })])
  assert.equal((await outboxOf(H.sid))[0].payload.context.commitment_score_raw, '9')
}

// ---------- claim: so o que venceu, limites, lease, sem sobreposicao, evento unico ----------
await db.exec('truncate public.crm_context_outbox cascade')
const claimSites = []
for (let i = 0; i < 5; i++) claimSites.push(await seed())
{
  assert.equal(Number((await q('select count(*) n from public.crm_context_outbox'))[0].n), 5)
  assert.deepEqual(await claim(20, 60), [], 'recem-enfileirados esperam a janela de juncao')
  await makeDue()
  await rejects(claim(0, 60), /Invalid claim bounds|22023/); await rejects(claim(21, 60), /Invalid claim bounds/)
  await rejects(claim(5, 29), /Invalid claim bounds/); await rejects(claim(5, 301), /Invalid claim bounds/)
  const a = await claim(2, 60), b = await claim(2, 60), c = await claim(2, 60), d = await claim(2, 60)
  assert.deepEqual([a.length, b.length, c.length, d.length], [2, 2, 1, 0], 'lotes disjuntos')
  const ids = [...a, ...b, ...c].map(r => r.event_id); assert.equal(new Set(ids).size, 5, 'nenhum evento entregue a dois claims')
  for (const r of [...a, ...b, ...c]) { assert.equal(r.state, 'processing'); assert(r.claim_token); assert(r.lease_until); assert.equal(r.attempts, 1); assert(r.payload.event_id === r.event_id) }
  assert.deepEqual(a.map(r => r.created_at), [...a.map(r => r.created_at)].sort(), 'mais antigos primeiro')
  await db.query(`update public.crm_context_outbox set lease_until=clock_timestamp()-interval '1 second' where event_id=$1`, [a[0].event_id])
  const re = await claim(20, 60)
  assert.deepEqual(re.map(r => r.event_id), [a[0].event_id], 'lease vencido volta para a fila'); assert.equal(re[0].attempts, 2); assert.notEqual(re[0].claim_token, a[0].claim_token)
  // evento unico (ensaio): so aquele
  await makeDue()
  await db.exec(`update public.crm_context_outbox set state='pending',claim_token=null,lease_until=null where state='processing'`)
  const only = await claim(20, 60, claimSites[2].n ? (await outboxOf(claimSites[2].sid))[0].event_id : null)
  assert.equal(only.length, 1); assert.equal(only[0].source_lead_id, claimSites[2].sid)
  // ack: claim vencido, evento diferente, estado invalido
  const row = only[0]
  await rejects(q('select public.crm_context_ack($1,$2,$3::jsonb)', [row.event_id, U(9), receiptFor(row)]), /Stale claim/, 'claim errado')
  await rejects(q('select public.crm_context_ack($1,$2,$3::jsonb)', [row.event_id, row.claim_token, JSON.stringify({ ok: true, receipt_id: U(7), event_id: U(8), status: 'applied' })]), /Invalid receipt/)
  await rejects(q('select public.crm_context_ack($1,$2,$3::jsonb)', [row.event_id, row.claim_token, JSON.stringify({ ok: true, receipt_id: U(7), event_id: row.event_id, status: 'bogus' })]), /Invalid receipt/)
  await rejects(q('select public.crm_context_ack($1,$2,$3::jsonb)', [row.event_id, row.claim_token, JSON.stringify({ ok: false, receipt_id: U(7), event_id: row.event_id, status: 'applied' })]), /Invalid receipt/)
  await rejects(q('select public.crm_context_ack($1,$2,$3::jsonb)', [row.event_id, row.claim_token, JSON.stringify({ ok: true, receipt_id: 'x', event_id: row.event_id, status: 'applied' })]), /invalid input|Invalid receipt/)
  await db.query(`update public.crm_context_outbox set lease_until=clock_timestamp()-interval '1 second' where event_id=$1`, [row.event_id])
  await rejects(ack(row), /Stale claim/, 'lease vencido nao pode confirmar')
  await db.query(`update public.crm_context_outbox set lease_until=clock_timestamp()+interval '60 seconds' where event_id=$1`, [row.event_id])
  // os cinco estados de recibo
  let i = 0
  for (const status of ['applied', 'waiting_member', 'superseded', 'duplicate', 'quarantined']) {
    const s = await seed(); await makeDue()
    const [r] = (await claim(20, 60, (await outboxOf(s.sid))[0].event_id))
    await ack(r, status, ++i)
    const done = (await outboxOf(s.sid))[0]
    assert.equal(done.state, 'delivered'); assert.equal(done.receipt.status, status); assert(done.delivered_at); assert.equal(done.claim_token, null)
    await rejects(ack(r, status, i), /Stale claim/, 'nao confirma duas vezes')
  }
  const attempts = await q(`select outcome from public.crm_context_delivery_attempts where outcome='delivered'`)
  assert(attempts.length >= 5, 'cada recibo e guardado')
}

// ---------- fail: repeticao com recuo limitado a 6 h; bloqueio nao repete; requeue ----------
{
  const S = await seed(); await makeDue()
  let [r] = await claim(20, 60, (await outboxOf(S.sid))[0].event_id)
  await rejects(q(`select public.crm_context_fail($1,$2,'http_503',null,false)`, [r.event_id, U(9)]), /Stale claim/)
  await q(`select public.crm_context_fail($1,$2,'http_503',now()+interval '30 days',false)`, [r.event_id, r.claim_token])
  let row = (await outboxOf(S.sid))[0]
  assert.equal(row.state, 'pending'); assert.equal(row.last_error_code, 'http_503'); assert.equal(row.claim_token, null); assert.equal(row.lease_until, null)
  const wait = (await one('select extract(epoch from (next_attempt_at-clock_timestamp())) s from public.crm_context_outbox where event_id=$1', [row.event_id])).s
  assert(wait > 21500 && wait <= 21600, 'recuo maximo de 6 h, deu ' + wait)
  assert.equal(row.payload.event_id, r.payload.event_id); assert.equal(row.event_id, r.event_id, 'mesmo event_id e mesmo corpo na repeticao')
  assert.deepEqual(row.payload, r.payload)
  await q(`update public.crm_context_outbox set next_attempt_at=clock_timestamp()-interval '1 s' where event_id=$1`, [row.event_id])
  ;[r] = await claim(20, 60, row.event_id); assert.equal(r.attempts, 2)
  await q(`select public.crm_context_fail($1,$2,'CODIGO RUIM; drop table x',null,false)`, [r.event_id, r.claim_token])
  assert.equal((await outboxOf(S.sid))[0].last_error_code, 'delivery_failed', 'codigo fora do padrao e substituido')
  await q(`update public.crm_context_outbox set next_attempt_at=clock_timestamp()-interval '1 s' where event_id=$1`, [row.event_id])
  ;[r] = await claim(20, 60, row.event_id)
  await q(`select public.crm_context_fail($1,$2,'http_403',null,true)`, [r.event_id, r.claim_token])
  row = (await outboxOf(S.sid))[0]
  assert.equal(row.state, 'blocked'); assert.equal(row.last_error_code, 'http_403')
  await makeDue(); assert.deepEqual(await claim(20, 60, row.event_id), [], 'bloqueado nao e repetido sozinho')
  assert.deepEqual((await q(`select outcome,code from public.crm_context_delivery_attempts where event_id=$1 order by id`, [row.event_id])).map(a => a.outcome), ['retry', 'retry', 'blocked'])
  assert.equal((await one('select public.crm_context_requeue_blocked($1) n', [row.event_id])).n, 1)
  row = (await outboxOf(S.sid))[0]; assert.equal(row.state, 'pending'); assert.equal(row.claim_token, null)
  assert.deepEqual(row.payload.event_id, r.payload.event_id, 'reenfileirar nao muda o corpo')
  assert.equal((await one('select public.crm_context_requeue_blocked(null) n')).n, 0)
}

// ---------- backfill: so contagem por padrao, retomavel, idempotente ----------
{
  // Atleta que o CRM conhece pelo site mas sem formulario ligado: tambem e candidato (tem observacoes/notas a enviar).
  const cand = await seed({ link: 'later' })
  await db.query(`insert into public.crm_leads(name,athlete_name,meta_form_lead_id,observations) values('x','Sem Formulario',$1,'so observacao do SDR')`, [cand.site])
  await db.exec('truncate public.crm_context_outbox cascade')
  const all = (await q(`select s id from public.crm_context_candidate_sites() s order by s`)).map(r => r.id)
  const ids = (await q(`select s id from public.crm_context_candidate_sites() s where (select meta_lead_id from public.meta_form_leads where id=s) ~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' order by s`)).map(r => r.id)
  assert(ids.length >= 6 && all.length === ids.length + 1, 'ha locais ligados para o teste (um deles com id malformado, que e ignorado)')
  assert(ids.includes(cand.site), 'o atleta so com lead no CRM (sem formulario) entra no backfill')
  const dry = (await one('select public.crm_context_backfill(null,200) r')).r
  assert.equal(dry.dry_run, true, 'o padrao e so contar'); assert.equal(dry.would_enqueue, ids.length); assert.equal(dry.enqueued, 0); assert.equal(dry.done, true)
  assert.deepEqual([dry.examined, dry.skipped], [all.length, 1])
  assert.equal(await N('select count(*) n from public.crm_context_outbox'), 0, 'modo so contagem nao enfileira nada')
  // retomavel por cursor: lotes pequenos somam o total, sem repetir
  let after = null, seen = 0, rounds = 0
  for (;;) {
    const r = (await one('select public.crm_context_backfill($1,2,false) r', [after])).r
    assert.equal(r.dry_run, false); seen += r.enqueued; after = r.last_id; rounds++
    if (r.done) break
    assert(rounds < 50)
  }
  assert.equal(seen, ids.length); assert(rounds > 1)
  assert.equal(await N('select count(*) n from public.crm_context_outbox'), ids.length)
  const again = (await one('select public.crm_context_backfill(null,200,false) r')).r
  assert.equal(again.enqueued, 0); assert.equal(again.unchanged, ids.length, 'rodar de novo nao duplica')
  assert.equal(await N('select count(*) n from public.crm_context_outbox'), ids.length)
  await rejects(q('select public.crm_context_backfill(null,0)'), /Invalid backfill bounds/); await rejects(q('select public.crm_context_backfill(null,201)'), /Invalid backfill bounds/)
  assert.equal((await one('select public.crm_context_backfill($1,200) r', [all.at(-1)])).r.examined, 0, 'cursor no fim: nada a examinar')
  assert.equal((await one('select public.crm_context_backfill(null,200) r')).r.unchanged, ids.length, 'contagem ve que ja esta tudo na fila')
}

// ---------- saude: Executive e sistema leem; outros nao; sem dados pessoais ----------
{
  const as = async (sub, role) => { await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)`, [sub ?? '', role ?? '']) }
  await as(EXEC, 'authenticated')
  const h = (await one('select public.crm_context_health() h')).h
  for (const k of ['enabled', 'pending_count', 'processing_count', 'blocked_count', 'delivered_count', 'oldest_pending_at', 'last_delivered_at', 'error_codes', 'quarantined_receipts', 'trigger_error_count', 'last_trigger_error_at', 'last_reconcile_at', 'last_reconcile_summary', 'recent_attempts'])
    assert(k in h, 'saude traz ' + k)
  assert.equal(h.enabled, false); assert.equal(h.blocked_count + h.pending_count + h.processing_count + h.delivered_count, await N('select count(*) n from public.crm_context_outbox'))
  const text = JSON.stringify(h)
  for (const s of SECRETS) assert(!text.includes(s), 'a saude nao pode conter dado pessoal: ' + s)
  assert(!('payload' in h) && !text.includes('"payload"'))
  await as(PLAIN, 'authenticated'); await rejects(q('select public.crm_context_health()'), /Executive|42501/)
  await as(null, 'anon'); await rejects(q('select public.crm_context_health()'), /Executive|42501/)
  await as(null, 'service_role'); assert((await one('select public.crm_context_health() h')).h)
  await as(null, '')
}

// ---------- agendamento: desligado, so liga por passo manual, nunca vaza o segredo ----------
{
  await db.exec('delete from net.calls')
  assert.equal((await one('select public.crm_context_delivery_invoke() r')).r, null, 'desligado: nao chama nada'); assert.equal(await N('select count(*) n from net.calls'), 0)
  await rejects(q('select public.crm_context_delivery_set_enabled(null)'), /Activation state required/)
  const jobState = () => q(`select jobname,active from cron.job where jobname like 'crm-context-%' order by jobname`)
  await rejects(q('select public.crm_context_reconcile_set_enabled(true)'), /Ative a entrega antes da varredura/); await rejects(q('select public.crm_context_reconcile_set_enabled(null)'), /Activation state required/)
  await q('select public.crm_context_delivery_set_enabled(true)')
  assert.deepEqual(await jobState(), [{ jobname: 'crm-context-delivery', active: true }, { jobname: 'crm-context-reconcile', active: false }], 'ligar a entrega NAO liga a varredura (o backfill em lotes vem antes)')
  await q('select public.crm_context_reconcile_set_enabled(true)')
  assert.deepEqual(await jobState(), [{ jobname: 'crm-context-delivery', active: true }, { jobname: 'crm-context-reconcile', active: true }])
  assert.equal((await one('select public.crm_context_delivery_invoke() r')).r, null, 'ligado mas sem segredo no Vault: nao chama'); assert.equal(await N('select count(*) n from net.calls'), 0)
  await db.exec(`insert into vault.decrypted_secrets values('crm_context_delivery_cron_secret','segredo-do-cron-de-teste')`)
  // fila sem nada vencido: nao chama a Edge Function (poupa HTTP e IO a cada minuto); com evento vencido, chama
  const parked = await q(`update public.crm_context_outbox set next_attempt_at=clock_timestamp()+interval '1 hour' where state='pending' returning event_id`)
  await db.exec(`update public.crm_context_outbox set lease_until=clock_timestamp()+interval '1 hour' where state='processing'`)
  assert.equal((await one('select public.crm_context_delivery_invoke() r')).r, null, 'nada vencido na fila: nao chama'); assert.equal(await N('select count(*) n from net.calls'), 0)
  assert(parked.length > 0, 'ha eventos pendentes para o teste'); await makeDue()
  assert.notEqual((await one('select public.crm_context_delivery_invoke() r')).r, null)
  const call = await one('select * from net.calls')
  assert.equal(call.url, 'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/voxen-context-delivery')
  assert.equal(call.headers['x-crm-cron-secret'], 'segredo-do-cron-de-teste'); assert.equal(call.timeout_ms, 50000, 'mesmo prazo de 45 s da funcao, para a chamada nao expirar antes dela')
  assert.equal(call.headers['x-crm-signature'], undefined, 'assinatura do receptor nunca passa pelo banco')
  assert(!JSON.stringify(call.body).includes('segredo'))
  await db.exec('drop table net.calls cascade')           // a chamada de rede falha: o agendador nunca levanta erro
  assert.equal((await one('select public.crm_context_delivery_invoke() r')).r, null)
  await q('select public.crm_context_delivery_set_enabled(false)')
  assert.deepEqual(await jobState(), [{ jobname: 'crm-context-delivery', active: false }, { jobname: 'crm-context-reconcile', active: false }], 'desligar a entrega desliga tudo')
  await q('select public.crm_context_delivery_set_enabled(true)'); await q('select public.crm_context_reconcile_set_enabled(true)'); await q('select public.crm_context_reconcile_set_enabled(false)')
  assert.deepEqual(await jobState(), [{ jobname: 'crm-context-delivery', active: true }, { jobname: 'crm-context-reconcile', active: false }], 'a varredura desliga sozinha, sem mexer na entrega')
  await q('select public.crm_context_delivery_set_enabled(false)')
  assert.equal((await one('select enabled e from public.crm_context_delivery_control')).e, false)
  const cmd = (await one(`select command c from cron.job where jobname='crm-context-delivery'`)).c
  assert(!/secret|segredo/i.test(cmd.replace('crm_context_delivery_invoke', '')), 'o comando agendado nao carrega segredo')
}

const setAuth = (sub, role) => db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)`, [sub ?? '', role ?? ''])
// Observacao que o proprio CRM grava ao criar o lead a partir do formulario da Meta: traz o NOME DA CAMPANHA e IDs da Meta (migration 20261015032000).
const TPL_AUTO = (campaign, formId, leadId) => `Formulário Meta ${formId} · campanha ${campaign}\nMeta lead ID: ${leadId}\nRespostas do formulário no painel Contexto deste lead.`
const TPL_X = TPL_AUTO('CAMPANHA-ESCONDIDA-X', '9988776655443322', '1122334455667788')
const TPL_LEAK = ['CAMPANHA-ESCONDIDA-X', '9988776655443322', '1122334455667788', 'Meta lead ID', 'Formulário Meta']

// ---------- GABARITO: o fluxo normal so mudou onde o dono mandou (observacao gerada pelo sistema sai); o resto e identico ao texto antigo ----------
{
  const sites = (await q(`select id from public.meta_form_leads where entry_channel='website'`)).map(r => r.id)
  assert(sites.length >= 20, 'ha cadastros suficientes para comparar: ' + sites.length)
  let withCrm = 0, withGuardian = 0, withoutForm = 0, firstCrm = null, withNewQuestions = 0
  // Pergunta nova (que o texto antigo nao conhecia) agora vai em answers: o gabarito compara sem elas e conta quantos cadastros as tinham.
  const dropNewQuestions = (novo, antigo) => {
    if (!novo?.answers) return novo
    const known = new Set((antigo?.answers ?? []).map(a => a.question)), kept = novo.answers.filter(a => known.has(a.question))
    const { answers, ...rest } = novo
    return kept.length ? { ...rest, answers: kept } : rest
  }
  for (const id of sites) {
    const novo = (await one('select public.crm_context_payload($1) p', [id])).p, antigo = (await one('select public.crm_context_payload_legacy($1) p', [id])).p
    if (novo?.answers && novo.answers.length > (antigo?.answers?.length ?? 0)) withNewQuestions++
    assert.deepEqual(dropNewQuestions(novo, antigo), antigo, 'o payload do fluxo normal mudou na refatoracao: ' + id)
    if (novo?.link?.crm_lead_id) { withCrm++; firstCrm ??= { site: id, crm: novo.link.crm_lead_id } } if (novo?.guardian) withGuardian++; if (novo && !novo.link.form_lead_id) withoutForm++
  }
  assert(withCrm > 0 && withoutForm > 0 && withNewQuestions > 0, 'o gabarito cobre cadastro com lead no CRM, sem formulario e com pergunta nova: ' + JSON.stringify({ withCrm, withGuardian, withoutForm, withNewQuestions }))
  // Observacao gerada pelo sistema (campanha e IDs da Meta): sai nos dois fluxos (decisao do dono em 22/10). Fora de crm.observations nada muda.
  const pay = async (fn, site) => (await one(`select public.${fn}($1) p`, [site])).p
  const setObs = text => db.query('update public.crm_leads set observations=$2 where id=$1', [firstCrm.crm, text])
  await setObs(TPL_X + '\nPai pediu retorno.')
  let nTpl = await pay('crm_context_payload', firstCrm.site), aTpl = await pay('crm_context_payload_legacy', firstCrm.site)
  assert.match(aTpl.crm.observations, /CAMPANHA-ESCONDIDA-X/, 'o texto antigo levava a campanha')
  assert.equal(nTpl.crm.observations, 'Pai pediu retorno.', 'o fluxo normal tira as 3 linhas do sistema e mantem o texto da pessoa')
  assert.deepEqual({ ...dropNewQuestions(nTpl, aTpl), crm: undefined }, { ...aTpl, crm: undefined }, 'fora de crm nada mudou')
  assert.deepEqual({ ...nTpl.crm, observations: undefined }, { ...aTpl.crm, observations: undefined }, 'a qualificacao continua igual')
  for (const x of TPL_LEAK) assert(!JSON.stringify(nTpl).includes(x), 'vazou no fluxo normal: ' + x)
  await setObs(TPL_X)
  nTpl = await pay('crm_context_payload', firstCrm.site)
  assert(!nTpl.crm || !('observations' in nTpl.crm), 'so observacao do sistema: a chave some (e o bloco crm inteiro, se nao ha mais nada nele)')
  await setObs('OBSERVACAO DO SDR')
  const nOld = await pay('crm_context_payload', firstCrm.site), aOld = await pay('crm_context_payload_legacy', firstCrm.site)
  assert.deepEqual(dropNewQuestions(nOld, aOld), aOld, 'sem observacao automatica, identico ao texto antigo')
  assert.equal((await one('select public.crm_context_payload($1) p', [U(777777)])).p, null); assert.equal((await one('select public.crm_context_payload_legacy($1) p', [U(777777)])).p, null)
  const formId = (await one(`select id from public.meta_form_leads where entry_channel='form' limit 1`)).id
  assert.equal((await one('select public.crm_context_payload($1) p', [formId])).p, null, 'registro de formulario nao e atleta da VOXEN')
}

// ---------- pergunta nova de formulario: vai sozinha, como resposta, sem filtro de assunto; contato fica fora e o texto passa pela limpeza de contato ----------
const EXTRA_Q = [
  { name: 'qual_o_seu_cpf?', values: ['123.456.789-00'] },                                    // assunto sensivel: vai (decisao do dono: sem filtro)
  { name: 'qual_o_time_do_coracao?', values: ['Segredo FC'] },
  { name: 'comentario_livre', values: ['me ligue 11 94817-3104 ou escreva a@b.com'] },         // contato digitado no texto e removido
  { name: 'work_email', values: ['trabalho.segredo@example.invalid'] },                       // campo de contato: nunca sai
  { name: 'telefone_do_pai', values: ['(11) 94817-3104'] },
  { name: 'first_name', values: ['PrimeiroNomeSecreto'] },
  { name: 'qual_o_whatsapp_do_responsavel?', values: ['11948173104'] },
  { name: 'resposta_longa', values: ['x'.repeat(5000)] },
]
const EXTRA_EXPECTED = [
  { question: 'Qual o seu cpf?', answer: '123.456.789-00' }, { question: 'Qual o time do coracao?', answer: 'Segredo FC' },
  { question: 'Comentario livre', answer: 'me ligue [contato removido] ou escreva [contato removido]' }, { question: 'Resposta longa', answer: 'x'.repeat(4000) }]
const EXTRA_LEAK = ['trabalho.segredo@example.invalid', 'PrimeiroNomeSecreto', '11948173104', '94817-3104', 'a@b.com']
{
  const X = await seed({ extra: EXTRA_Q })
  const crm = await crmFor(X.site)
  const body = (await one('select public.crm_context_payload($1) p', [X.site])).p
  assert.equal(body.answers[10].answer, 'Acho que us 8/10', 'as 11 conhecidas primeiro')
  assert.deepEqual(body.answers.slice(11), EXTRA_EXPECTED, 'perguntas novas: na ordem do formulario, contato removido do texto, resposta longa cortada em 4000')
  for (const k of ['profile', 'context', 'structured']) for (const v of Object.values(body[k])) assert(!/Segredo FC|123\.456/.test(String(v)), 'pergunta nova so entra em answers')
  const text = JSON.stringify(body)
  for (const x of [...SECRETS, ...EXTRA_LEAK]) assert(!text.includes(x), 'vazou junto das perguntas novas: ' + x)
  assert.equal(body.answers.length, 15, '11 conhecidas + 4 novas (os 4 campos de contato ficam de fora)')
  // rotulo muito longo (vem da definicao do formulario) e cortado em 500; a resposta continua inteira
  await db.query(`insert into public.meta_form_definitions(form_id,page_id,name,questions) values('fdef','p','Formulario',$1::jsonb)`, [JSON.stringify([{ key: 'pergunta_longa', label: 'L'.repeat(600) }])])
  const D = await seed({ formId: 'fdef', extra: [{ name: 'pergunta_longa', values: ['ok'] }] })
  const longo = (await one('select public.crm_context_payload($1) p', [D.site])).p.answers.at(-1)
  assert.deepEqual(longo, { question: 'L'.repeat(500), answer: 'ok' })
  // a lista do alinhamento passa a ser so informacao do que vai como resposta
  await setAuth(null, 'service_role')
  assert(((await one('select public.crm_context_alignment() a')).a.unmapped_questions).includes('qual_o_time_do_coracao?'))
  await setAuth(null, '')
  await db.query('delete from public.crm_leads where id=$1', [crm])
  // funcao de contato: nomes exatos e e-mail/telefone/WhatsApp em qualquer lugar; assunto qualquer outro nao
  const contact = async n => (await one('select public.crm_context_is_contact_field($1) c', [n])).c
  for (const n of ['first_name', 'last_name', 'full_name', 'name', 'work_email', 'email', 'phone_number', 'work_phone_number', 'telefone_do_pai', 'e-mail', 'qual_o_whatsapp_do_responsavel?', 'celular', 'Zap']) assert.equal(await contact(n), true, 'contato: ' + n)
  for (const n of ['qual_o_seu_cpf?', 'qual_o_nome_do_clube?', 'renda_familiar', 'endereco', 'cep', 'qual_o_time_do_coracao?', null]) assert.equal(await contact(n), false, 'nao e contato: ' + n)
}

// ---------- leads sem cadastro na VOXEN: envio por escolha do time (kind prospect_context) ----------
{
  await db.exec('truncate public.crm_context_outbox cascade')
  await db.exec('truncate public.crm_voxen_prospects')
  const errBase = await N('select trigger_error_count n from public.crm_context_delivery_control')   // erros ja provocados de proposito por testes anteriores
  const auth = setAuth
  const exec = async (role, sig) => (await one(`select has_function_privilege('${role}','${sig}','EXECUTE') p`)).p
  const NOBODY = U(802)
  // O evento de ensaio tem o mesmo tipo, mas nao e um lead do CRM: fica fora das contagens de prospects.
  const ONLY_PROSPECTS = `payload->>'kind'='prospect_context' and coalesce(payload->'link'->>'basis','')<>'teste de integração'`
  const prospectRows = lead => lead ? q(`select * from public.crm_context_outbox where ${ONLY_PROSPECTS} and source_lead_id=$1 order by source_revision`, [lead])
    : q(`select * from public.crm_context_outbox where ${ONLY_PROSPECTS} order by source_lead_id,source_revision`)
  const synRows = () => q(`select * from public.crm_context_outbox where payload->>'kind'='prospect_context' and payload->'link'->>'basis'='teste de integração' order by created_at`)
  const accepted = async () => (await one('select public.crm_context_rehearsal_accepted() a')).a
  const as = async (user, role, fn) => { await auth(user, role); try { return await fn() } finally { await auth(null, '') } }
  const send = (leads, user = PLAIN) => as(user, 'authenticated', async () => (await one('select public.crm_voxen_send($1::uuid[]) r', [leads])).r)
  const stop = (leads, user = PLAIN) => as(user, 'authenticated', async () => (await one('select public.crm_voxen_stop($1::uuid[]) r', [leads])).r)
  const states = (user = PLAIN) => as(user, 'authenticated', async () => (await one('select public.crm_voxen_sync_states() s')).s)
  const status = () => as(null, 'service_role', async () => (await one('select public.crm_context_prospects_status() s')).s)
  const stateOf = async lead => (await states()).rows.find(r => r.lead_id === lead)?.state ?? 'available'
  const resultOf = (r, lead) => r.find(x => x.lead_id === lead)?.result
  let pseq = 0
  const formOnly = async (overrides = {}, extra = []) => {
    const id = U(9000 + ++pseq)
    await db.query(`insert into public.meta_form_leads(id,meta_lead_id,form_id,field_data,full_name,phone,email,entry_channel,campaign_name)
      values($1,$2,'f',$3::jsonb,$4,'+5511948173104','segredo.pessoa@example.invalid','form','CAMPANHA SEGREDO')`, [id, 'form:prospect:' + pseq, fieldData(overrides, extra), FILLER])
    return id
  }
  const bare = async (name, athlete) => (await one(`insert into public.crm_leads(name,phone,email,athlete_name,athlete_position,observations,temperature)
    values($1,'21977776666','segredo.pessoa@example.invalid',$2,'Meia','OBSERVACAO DO SDR','TEMPERATURA SEGREDO') returning id`, [name, athlete])).id
  const note = (lead, text, type = 'whatsapp_summary') => db.query('insert into public.crm_lead_contexts(lead_id,context_type,content) values($1,$2,$3)', [lead, type, text])
  const enq = (lead, dry = false, now = false) => one('select public.crm_context_enqueue_prospect($1,$2,$3) r', [lead, dry, now]).then(x => x.r)
  const deliver = async (eventId, status = 'applied', i = 90) => { await makeDue(); const [c] = await claim(20, 60, eventId); assert.equal(c.event_id, eventId); await ack(c, status, i); return c }

  // P1: so do formulario da Meta (aprovado no CRM, nunca se cadastrou na VOXEN). P5 idem, com perguntas novas. P2: criado a mao e ligado a um formulario. P3: so notas.
  const f1 = await formOnly(), f2 = await formOnly({ 'qual_é_a_posição_e_a_categoria_atual_do_atleta?': 'Goleiro, sub-15' }), f5 = await formOnly({}, EXTRA_Q)
  const p1 = await crmFor(f1), p5 = await crmFor(f5)
  const p2 = await bare('Nome CRM Secreto', 'Atleta Manual'); await db.query('insert into public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) values($1,$2,$3)', [p2, f2, 'mesmo WhatsApp'])
  const p3 = await bare('Maria Responsavel', 'Joao Prospect'); await note(p3, 'Conversou com o pai (11) 94817-3104 sobre a peneira.')
  const p4 = await bare('Sem Contexto', 'Sem Contexto')                                   // sem nada: nem entra na lista de leads com contexto
  const pe = (await one(`insert into public.crm_leads(name) values('Lead Vazio') returning id`)).id   // sem nenhum dado que possa sair
  // V1: JA tem cadastro valido na VOXEN (fluxo normal). V2: ligado a um registro do site com ID malformado: para a VOXEN e como se nao tivesse cadastro.
  const V1 = await seed(), v1 = await crmFor(V1.site)
  const bad = U(9500); await db.query(`insert into public.meta_form_leads(id,meta_lead_id,field_data,full_name,entry_channel) values($1,'site:zyron:malformado-prospect','[]'::jsonb,'Fulano','website')`, [bad])
  const v2 = await bare('Contato V2', 'Atleta V2'); await note(v2, 'Nota do lead com cadastro malformado.'); await db.query('update public.crm_leads set meta_form_lead_id=$2 where id=$1', [v2, bad])
  // Observacao gerada pelo sistema: P1 = sistema + texto da pessoa; P2 = so sistema (nada sobra); P3, P5 e V2 = so texto da pessoa (nao muda).
  await db.query('update public.crm_leads set observations=$2 where id=$1', [p1, TPL_X + '\nOBSERVACAO DO SDR'])
  await db.query('update public.crm_leads set observations=$2 where id=$1', [p2, TPL_X])
  const cand = async () => (await q('select c from public.crm_context_prospect_candidates() c order by c')).map(r => r.c)
  const expected = [p1, p2, p3, p5, v2].sort()
  assert.deepEqual(await cand(), expected, 'candidatos: tem contexto e nao tem cadastro valido na VOXEN (fora: P4 e o lead vazio sem contexto, e V1 ja cadastrado)')
  assert.equal(await N(`select count(*) n from public.crm_context_outbox where ${ONLY_PROSPECTS}`), 0, 'nada vai sozinho: so quem for escolhido')

  // --- o corpo do evento: mesma lista fechada, base propria, nada que nunca sai ---
  const body = async id => (await one('select public.crm_context_payload_prospect($1) p', [id])).p
  const b1 = await body(p1)
  assert.deepEqual(b1.link, { basis: 'lead do CRM sem cadastro na VOXEN', form_lead_id: f1, crm_lead_id: p1 })
  assert.equal(b1.answers.length, 11); assert.equal(b1.structured.athlete_name, 'Joao Atleta'); assert(!('kind' in b1))
  assert.equal(b1.crm.observations, 'OBSERVACAO DO SDR', 'a observacao gerada pelo sistema (campanha e IDs da Meta) nao sai; o texto da pessoa sim')
  for (const k of Object.keys(b1)) assert(ALLOWED_TOP.includes(k), 'chave fora da lista: ' + k)
  for (const k of Object.keys(b1.link)) assert(ALLOWED.link.includes(k))
  for (const id of [p1, p2, p3, v2]) { const text = JSON.stringify(await body(id)); for (const x of [...SECRETS, ...TPL_LEAK]) assert(!text.includes(x), 'vazou no envio: ' + x) }
  const b5 = await body(p5)
  assert.deepEqual(b5.answers.slice(11), EXTRA_EXPECTED, 'perguntas novas tambem vao nos leads sem cadastro')
  for (const x of [...SECRETS, ...TPL_LEAK, ...EXTRA_LEAK]) assert(!JSON.stringify(b5).includes(x), 'vazou no envio do P5: ' + x)
  const b2 = await body(p2); assert.equal(b2.link.form_lead_id, f2, 'lead criado a mao: o formulario vem de crm_form_answer_links'); assert.equal(b2.profile.position_category_raw, 'Goleiro, sub-15')
  assert(!('observations' in (b2.crm ?? {})), 'observacao so gerada pelo sistema nao deixa nada para enviar')
  const b3 = await body(p3)
  assert.equal(b3.notes.length, 1); assert.equal(b3.notes[0].content, 'Conversou com o pai [contato removido] sobre a peneira.'); assert(!('answers' in b3) && !('context' in b3))
  assert.equal(b3.crm.observations, 'OBSERVACAO DO SDR', 'texto digitado por pessoa segue como estava')
  assert.deepEqual(b3.guardian, { name: 'Maria Responsavel' }); assert.equal(b3.structured.athlete_name, 'Joao Prospect'); assert.equal(b3.link.form_lead_id, null)
  assert.equal(await body(v1), null, 'quem ja tem cadastro na VOXEN segue o fluxo normal e nao e prospect'); assert(!(await cand()).includes(p4), 'sem o icone de contexto aceso o lead nao e candidato')
  assert.equal(await body(pe), null, 'lead sem nada a enviar'); assert.equal(await body(U(888888)), null)
  // a funcao de limpeza: so as 3 linhas do sistema saem; texto de pessoa fica, inclusive o que cita as mesmas palavras no meio de uma frase
  const strip = async t => (await one('select public.crm_context_strip_auto_observations($1) s', [t])).s
  assert.equal(await strip(null), null); assert.equal(await strip(''), null); assert.equal(await strip('   \n  '), null)
  assert.equal(await strip(TPL_AUTO('C', '1', '2')), null, 'so o texto do sistema: nada a enviar')
  assert.equal(await strip(TPL_AUTO('C', '1', '2') + '\nPai pediu retorno.'), 'Pai pediu retorno.')
  assert.equal(await strip('Antes\n' + TPL_AUTO('C', '1', '2') + '\nDepois'), 'Antes\n\nDepois')
  assert.equal(await strip(TPL_AUTO('C', '1', '2').replace(/\n/g, '\r\n') + '\r\nTexto'), 'Texto', 'quebra de linha do Windows')
  assert.equal(await strip('  Formulário Meta 1 · campanha C'), null, 'espaco antes da linha'); assert.equal(await strip('Meta lead ID: 55'), null)
  assert.equal(await strip('Respostas do formulário no painel Contexto deste lead'), null, 'rodape sem ponto final')
  for (const humano of ['OBSERVACAO DO SDR', 'Formulário preenchido pelo pai', 'Falei da campanha ontem. Meta lead ID: 123 foi o do filho.', 'Linha 1\n\nLinha 2']) assert.equal(await strip(humano), humano, 'texto de pessoa nao muda: ' + humano)

  // --- quem pode usar: so quem enxerga leads no CRM; o ensaio com a VOXEN libera o envio ---
  for (const [who, role] of [[NOBODY, 'authenticated'], [null, 'anon']]) {
    await as(who, role, async () => {
      await rejects(q('select public.crm_voxen_send($1::uuid[])', [[p1]]), /Acesso ao CRM|42501/); await rejects(q('select public.crm_voxen_stop($1::uuid[])', [[p1]]), /Acesso ao CRM|42501/)
      await rejects(q('select public.crm_voxen_sync_states()'), /Acesso ao CRM|42501/)
    })
  }
  const s0 = await states(); assert.equal(s0.ready, false); assert(s0.rows.some(r => r.lead_id === v1 && r.state === 'registered'), 'quem ja esta na VOXEN aparece como cadastrado')
  await rejects(send([p1]), /ainda não confirmou/, 'sem o ensaio aceito nao ha envio')
  assert.equal(await N('select count(*) n from public.crm_voxen_prospects'), 0, 'a recusa nao escolheu ninguem'); assert.equal((await prospectRows()).length, 0)
  assert.deepEqual((await status()).rehearsal, { accepted: false, state: null, receipt_status: null })
  // um evento de lead de verdade (base normal do vinculo), entregue com applied, NAO libera o envio: so o evento de ensaio vale
  // (defesa em profundidade: pelo app isso nem seria possivel, porque o envio e travado antes)
  const fakeEvent = U(960002)
  await db.query(`insert into public.crm_context_outbox(event_id,source_lead_id,source_revision,payload,content_hash,state,receipt,delivered_at)
    values($1,$2,1,$3::jsonb,'x','delivered',$4::jsonb,now())`, [fakeEvent, U(960001), JSON.stringify({ kind: 'prospect_context', link: { basis: 'lead do CRM sem cadastro na VOXEN' } }), JSON.stringify({ ok: true, status: 'applied' })])
  assert.equal(await accepted(), false, 'um lead de verdade entregue com applied nao vale como ensaio')
  await db.query('delete from public.crm_context_outbox where event_id=$1', [fakeEvent])
  assert.equal(await accepted(), false)
  const ev1 = (await one('select public.crm_context_enqueue_synthetic_prospect() id')).id
  const [s1] = await synRows()
  assert.equal(s1.event_id, ev1); assert.equal(s1.payload.kind, 'prospect_context'); assert.equal(s1.payload.schema_version, 1); assert.equal(s1.payload.event_id, ev1)
  assert.equal(Number(s1.source_revision), 1); assert.equal(s1.state, 'pending'); assert.equal(s1.payload.source_project, 'mbzwchnxtskysqplqiyy')
  assert.equal(s1.payload.source_lead_id, s1.source_lead_id); assert.equal(s1.payload.link.crm_lead_id, s1.source_lead_id, 'mesma regra dos leads de verdade')
  assert.equal(s1.payload.link.basis, 'teste de integração'); assert.equal(s1.payload.link.form_lead_id, null); assert.equal(s1.payload.profile.filled_by_raw, 'Teste de integração — não abordar')
  for (const k of Object.keys(s1.payload)) assert(ALLOWED_TOP.includes(k), 'chave fora da lista no ensaio: ' + k)
  for (const x of SECRETS) assert(!JSON.stringify(s1.payload).includes(x), 'vazou no ensaio: ' + x)
  assert.equal(await N('select count(*) n from public.crm_leads where id=$1', [s1.source_lead_id]), 0, 'o ensaio nao e um lead do CRM')
  assert.equal((await prospectRows()).length, 0, 'o ensaio nao entra nas contagens de leads')
  await rejects(q('select public.crm_context_enqueue_synthetic_prospect()'), /aguardando entrega/, 'um ensaio de cada vez')
  assert.equal(await accepted(), false, 'ensaio ainda nao entregue nao vale')
  const [c1] = await claim(20, 60, ev1); assert.equal(c1.payload.kind, 'prospect_context'); await ack(c1, 'quarantined', 81)
  assert.equal(await accepted(), false, 'quarantined nao vale como ensaio aceito'); await rejects(send([p1]), /ainda não confirmou/)
  assert.deepEqual((await status()).rehearsal, { accepted: false, state: 'delivered', receipt_status: 'quarantined' })
  const ev2 = (await one('select public.crm_context_enqueue_synthetic_prospect() id')).id; assert.notEqual(ev2, ev1)
  const [c2] = await claim(20, 60, ev2); await q(`select public.crm_context_fail($1,$2,'http_400',now(),true)`, [c2.event_id, c2.claim_token])
  assert.equal((await synRows()).at(-1).state, 'blocked'); assert.equal(await accepted(), false)
  await rejects(q('select public.crm_context_enqueue_synthetic_prospect()'), /aguardando entrega/, 'bloqueado tambem conta como aguardando: reenfileire o mesmo')
  assert.equal((await one('select public.crm_context_requeue_blocked($1) n', [ev2])).n, 1)
  // um evento de ensaio do tipo NORMAL (athlete_context), entregue com applied, tambem nao libera o envio
  const ath = (await one('select public.crm_context_enqueue_synthetic($1) id', [U(556)])).id; const [ca] = await claim(20, 60, ath); await ack(ca, 'applied', 82)
  assert.equal(await accepted(), false, 'o ensaio do fluxo normal nao vale para os leads')
  const [c3] = await claim(20, 60, ev2); assert.equal(c3.event_id, ev2); await ack(c3, 'applied', 83)
  assert.equal(await accepted(), true, 'recibo applied do ensaio libera')
  const setStatus = s => db.query(`update public.crm_context_outbox set receipt=jsonb_set(receipt,'{status}',to_jsonb($2::text)) where event_id=$1`, [ev2, s])
  for (const [s, ok] of [['waiting_member', true], ['duplicate', false], ['superseded', false], ['quarantined', false], ['applied', true]]) { await setStatus(s); assert.equal(await accepted(), ok, 'status ' + s) }
  assert.deepEqual((await status()).rehearsal, { accepted: true, state: 'delivered', receipt_status: 'applied' })
  assert.equal((await states()).ready, true)

  // --- "Enviar para a VOXEN": sem confirmacao, o clique escolhe o lead e a primeira versao sai na hora ---
  await rejects(send([]), /1 a 25/); await rejects(send(Array.from({ length: 26 }, (_, i) => U(970000 + i))), /1 a 25/); await rejects(send(null), /1 a 25/)
  const r1 = await send([p1, p2, p3, pe, v1, U(999999), p1])
  assert.equal(r1.length, 6, 'repetido conta uma vez')
  assert.deepEqual([p1, p2, p3, pe, v1, U(999999)].map(id => resultOf(r1, id)), ['sent', 'sent', 'sent', 'nothing_to_send', 'registered', 'not_found'])
  assert.deepEqual((await q('select lead_id from public.crm_voxen_prospects order by lead_id')).map(r => r.lead_id), [p1, p2, p3, pe].sort(), 'so quem foi escolhido (e e lead de verdade, sem cadastro)')
  const chosen = await one('select * from public.crm_voxen_prospects where lead_id=$1', [p1]); assert.equal(chosen.enabled_by, PLAIN); assert.equal(chosen.enabled, true); assert.equal(chosen.stopped_at, null)
  const [e1] = await prospectRows(p1)
  assert.equal(Number(e1.source_revision), 1); assert.equal(e1.state, 'pending'); assert(new Date(e1.next_attempt_at) <= new Date(), 'a primeira versao sai na hora, sem janela de espera')
  assert.equal(e1.payload.kind, 'prospect_context'); assert.equal(e1.payload.schema_version, 1); assert.equal(e1.payload.source_lead_id, p1); assert.equal(e1.payload.source_revision, 1)
  assert.equal(e1.payload.event_id, e1.event_id); assert.equal(e1.payload.source_project, 'mbzwchnxtskysqplqiyy'); assert.match(e1.payload.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  assert.deepEqual(e1.payload.link, b1.link); assert.equal(e1.payload.link.crm_lead_id, e1.payload.source_lead_id)
  for (const k of Object.keys(e1.payload)) assert(ALLOWED_TOP.includes(k), 'chave fora da lista no evento: ' + k)
  assert.equal((await prospectRows(pe)).length, 0, 'escolhido sem nada a enviar: fica marcado, mas nao gera evento vazio')
  assert.equal((await prospectRows(v1)).length, 0)
  assert.equal(await stateOf(p1), 'pending'); assert.equal(await stateOf(pe), 'waiting'); assert.equal(await stateOf(v1), 'registered'); assert.equal(await stateOf(p5), 'available')
  assert.deepEqual(Object.keys((await states()).rows[0]).sort(), ['at', 'lead_id', 'state'], 'so id, estado e hora: nenhum dado pessoal')
  assert.equal(await enq(p1, true), 'unchanged', 'so contar: igual ao que ja esta na fila'); assert.equal(await enq(p2, true), 'unchanged')
  await db.query(`update public.crm_leads set athlete_position='Goleiro' where id=$1`, [p1]); assert.equal((await prospectRows(p1)).length, 1, 'versao ainda nao entregue junta a mudanca')
  await db.query(`update public.crm_leads set athlete_position='Meia' where id=$1`, [p1])
  const r2 = await send([p1]); assert.equal(resultOf(r2, p1), 'sent', 'clicar de novo e inofensivo'); assert.equal((await prospectRows(p1)).length, 1, 'conteudo igual nao gera versao nova')
  // a entrega a pega como qualquer outro evento
  const cp = await deliver(e1.event_id, 'applied', 71); assert.equal(cp.payload.kind, 'prospect_context')
  assert.equal(await stateOf(p1), 'sent')

  // --- sincronia: cada mudanca que entra no corpo vira versao nova; antes de reservada para envio, mudancas na janela se juntam ---
  await db.query(`update public.crm_leads set athlete_position='Zagueiro' where id=$1`, [p1])
  let rows1 = await prospectRows(p1); assert.deepEqual(rows1.map(r => Number(r.source_revision)), [1, 2], 'depois de entregue, a mudanca e a versao 2')
  assert.equal(rows1[1].state, 'pending'); assert.equal(rows1[1].payload.structured.athlete_position, 'Zagueiro'); assert.equal(rows1[1].payload.source_revision, 2)
  assert(new Date(rows1[1].next_attempt_at) > new Date(), 'versao nova espera a janela de juncao (45 s)')
  await db.query(`update public.crm_leads set athlete_position='Lateral' where id=$1`, [p1])
  rows1 = await prospectRows(p1); assert.equal(rows1.length, 2, 'outra mudanca na janela entra na mesma versao'); assert.equal(rows1[1].payload.structured.athlete_position, 'Lateral')
  await db.query(`update public.crm_leads set athlete_position='Lateral' where id=$1`, [p1]); assert.equal((await prospectRows(p1)).length, 2, 'salvar o mesmo valor nao gera nada')
  await db.query(`update public.crm_leads set observations=$2 where id=$1`, [p1, TPL_X + '\nNova observacao da pessoa.'])
  assert.equal((await prospectRows(p1))[1].payload.crm.observations, 'Nova observacao da pessoa.'); for (const x of TPL_LEAK) assert(!JSON.stringify((await prospectRows(p1))[1].payload).includes(x))
  await note(p1, 'nota nova depois do envio'); assert.equal((await prospectRows(p1))[1].payload.notes.at(-1).content, 'nota nova depois do envio', 'nota nova chega na fila')
  await db.query(`update public.crm_lead_contexts set content='nota editada' where lead_id=$1 and context_type='whatsapp_summary'`, [p1]); assert.equal((await prospectRows(p1))[1].payload.notes.at(-1).content, 'nota editada')
  await db.query(`delete from public.crm_lead_contexts where lead_id=$1`, [p1]); assert(!('notes' in (await prospectRows(p1))[1].payload), 'nota apagada sai do contexto')
  // respostas do formulario editadas e vinculo manual: P2 (criado a mao)
  await deliver((await prospectRows(p2))[0].event_id, 'applied', 72)
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [f2, fieldData({ 'qual_é_a_posição_e_a_categoria_atual_do_atleta?': 'Lateral, sub-17' })])
  let rows2 = await prospectRows(p2); assert.equal(rows2.length, 2, 'respostas do formulario editadas'); assert.equal(rows2[1].payload.profile.position_category_raw, 'Lateral, sub-17')
  await deliver(rows2[1].event_id, 'applied', 73)
  await db.query('delete from public.crm_form_answer_links where crm_lead_id=$1', [p2])
  rows2 = await prospectRows(p2); assert.equal(rows2.length, 3, 'vinculo manual removido muda o corpo'); assert(!('answers' in rows2[2].payload)); assert.equal(rows2[2].payload.link.form_lead_id, null)
  await deliver(rows2[2].event_id, 'applied', 77)
  await db.query('insert into public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) values($1,$2,$3)', [p2, f2, 'mesmo WhatsApp'])
  rows2 = await prospectRows(p2); assert.equal(rows2.length, 4, 'vinculo manual criado de novo traz as respostas de volta'); assert.equal(rows2[3].payload.answers.length, 11)
  // lead ligado DIRETO ao formulario da Meta (o caso mais comum: aprovado da leva): editar o formulario chega no lead escolhido
  assert.equal((await prospectRows(p1)).at(-1).payload.profile.position_category_raw, 'Meia, sub-17')
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [f1, fieldData({ 'qual_é_a_posição_e_a_categoria_atual_do_atleta?': 'Volante, sub-19' })])
  assert.equal((await prospectRows(p1)).at(-1).payload.profile.position_category_raw, 'Volante, sub-19', 'formulario editado chega pelo vinculo direto do lead com o formulario')
  // lead ligado a um registro do site de ID malformado (para a VOXEN e como sem cadastro) cujo registro aponta para um formulario: editar o formulario avisa
  const fv = await formOnly()
  await db.query('update public.meta_form_leads set answers_form_lead_id=$2 where id=$1', [bad, fv])
  assert.equal(resultOf(await send([v2]), v2), 'sent'); await deliver((await prospectRows(v2))[0].event_id, 'applied', 76)
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [fv, fieldData({ 'qual_é_a_posição_e_a_categoria_atual_do_atleta?': 'Ala, sub-20' })])
  assert.equal((await prospectRows(v2)).at(-1).payload.profile.position_category_raw, 'Ala, sub-20', 'formulario editado chega pelo registro do site ligado ao lead')
  // quem nao foi escolhido nao gera nada, por mais que mude
  await db.query(`update public.crm_leads set athlete_position='Goleiro',observations='mudou' where id=$1`, [p5]); await note(p5, 'nota de lead nao escolhido')
  await db.query('update public.meta_form_leads set field_data=$2::jsonb where id=$1', [f5, fieldData({}, EXTRA_Q)])
  assert.equal((await prospectRows(p5)).length, 0, 'lead que ninguem escolheu nunca sai')
  // a funcao interna tambem recusa sozinha (nao depende de quem a chama): lead nao escolhido, cadastrado ou inexistente
  assert.equal(await enq(p5), 'skipped', 'lead nao escolhido, mesmo chamando a funcao direto'); assert.equal(await enq(p5, true), 'skipped'); assert.equal(await enq(p5, false, true), 'skipped'); assert.equal(await enq(null), 'skipped'); assert.equal(await enq(U(999997)), 'skipped')
  assert.equal((await prospectRows(p5)).length, 0)
  assert.equal(await N('select trigger_error_count n from public.crm_context_delivery_control'), errBase, 'nenhum erro de gatilho')

  // --- parar de sincronizar e voltar ---
  const st1 = await stop([p1, p5, U(999998)])
  assert.deepEqual([p1, p5, U(999998)].map(id => resultOf(st1, id)), ['stopped', 'not_enabled', 'not_enabled'])
  assert.equal(await stateOf(p1), 'stopped'); const n1 = (await prospectRows(p1)).length
  await db.query(`update public.crm_leads set athlete_position='Volante' where id=$1`, [p1]); await note(p1, 'durante a pausa')
  assert.equal((await prospectRows(p1)).length, n1, 'parado: nada novo sai'); assert.equal(resultOf(await stop([p1]), p1), 'not_enabled')
  assert.equal(await enq(p1), 'skipped', 'parado: a funcao interna tambem recusa'); assert.equal(await enq(p1, false, true), 'skipped'); assert.equal((await prospectRows(p1)).length, n1)
  const back = await send([p1]); assert.equal(resultOf(back, p1), 'sent')
  const again = await one('select * from public.crm_voxen_prospects where lead_id=$1', [p1]); assert.equal(again.enabled, true); assert.equal(again.stopped_at, null)
  const rowsBack = await prospectRows(p1); assert.equal(rowsBack.at(-1).payload.structured.athlete_position, 'Volante', 'ao voltar, vai o que mudou durante a pausa'); assert(rowsBack.length > n1 || rowsBack.at(-1).payload.notes.at(-1).content === 'durante a pausa')
  assert(new Date(rowsBack.at(-1).next_attempt_at) <= new Date(), 'o clique em Enviar sempre sai na hora, mesmo ao voltar')

  // --- estados da entrega: na fila, entregue, quarentena da VOXEN, bloqueado ---
  const lastEvent = async lead => (await prospectRows(lead)).at(-1)
  await deliver((await lastEvent(p1)).event_id, 'applied', 74); assert.equal(await stateOf(p1), 'sent')
  await db.query(`update public.crm_leads set athlete_position='Meia' where id=$1`, [p2]); await db.query(`update public.crm_leads set athlete_position='Atacante' where id=$1`, [p3])
  await deliver((await lastEvent(p2)).event_id, 'quarantined', 75); assert.equal(await stateOf(p2), 'quarantined')
  const eb = await lastEvent(p3); await makeDue(); const [cb] = await claim(20, 60, eb.event_id); await q(`select public.crm_context_fail($1,$2,'http_400',now(),true)`, [cb.event_id, cb.claim_token])
  assert.equal(await stateOf(p3), 'blocked')
  { // a situacao do Executivo mostra quarentena e bloqueio (a fila conta quarantined como entregue; so este numero avisa)
    const s = await status()
    assert.equal(s.quarantined, 1, 'quarentena aparece na situacao do Executivo'); assert.equal(s.blocked, 1, 'bloqueio aparece na situacao do Executivo')
    assert.equal(s.enabled, s.waiting + s.pending + s.delivered + s.blocked + s.quarantined, 'cada lead escolhido cai em um estado so')
    assert(s.delivered >= 1 && s.waiting >= 1, 'enviado e aguardando conteudo tambem aparecem: ' + JSON.stringify(s))
  }
  assert.equal((await one('select public.crm_context_requeue_blocked($1) n', [eb.event_id])).n, 1); assert.equal(await stateOf(p3), 'pending')

  // --- quando o lead se cadastra na VOXEN, o fluxo normal assume pelo ID da VOXEN, ligado pelo mesmo crm_lead_id ---
  const newVoxen = U(9900), site = U(9901)
  await db.query(`insert into public.meta_form_leads(id,meta_lead_id,field_data,full_name,entry_channel) values($1,$2,'[]'::jsonb,'Fulano','website')`, [site, 'site:zyron:' + newVoxen])
  const before3 = (await prospectRows(p3)).length
  await db.query('update public.crm_leads set meta_form_lead_id=$2 where id=$1', [p3, site])
  const [funnel] = await outboxOf(newVoxen)
  assert(funnel, 'o cadastro novo gerou o evento normal'); assert.equal(funnel.payload.kind, 'athlete_context'); assert.equal(funnel.payload.source_lead_id, newVoxen); assert.equal(funnel.payload.link.crm_lead_id, p3, 'mesmo crm_lead_id do lead enviado antes: a chave para a VOXEN juntar os dois')
  await db.query(`update public.crm_leads set athlete_position='Zagueiro' where id=$1`, [p3])
  assert.equal((await prospectRows(p3)).length, before3, 'depois de cadastrado o lead nao gera mais versao de lead sem cadastro')
  assert.equal(await stateOf(p3), 'registered'); assert.equal(resultOf(await send([p3]), p3), 'registered'); assert(!(await cand()).includes(p3))
  { const st = await states(); assert.equal(new Set(st.rows.map(r => r.lead_id)).size, st.rows.length, 'cada lead aparece uma vez so, e cadastrado vale mais que escolhido') }

  // --- varredura de seguranca: pega o que o gatilho perdeu, com cursor, e um erro nao derruba as outras ---
  await auth(null, 'service_role')
  await db.exec('alter table public.crm_leads disable trigger zz_crm_context_prospect_lead')
  await db.query(`update public.crm_leads set observations='so a varredura enxerga isto' where id=$1`, [p1])
  await db.exec('alter table public.crm_leads enable trigger zz_crm_context_prospect_lead')
  const nBeforeSweep = (await prospectRows(p1)).length
  assert.notEqual((await lastEvent(p1)).payload.crm?.observations, 'so a varredura enxerga isto', 'sem o gatilho a fila ficou desatualizada')
  const enabledNow = await N('select count(*) n from public.crm_voxen_prospects where enabled')
  let pex = 0, pch = 0, cycles = 0, pdone = false
  for (let i = 0; i < 300 && !pdone; i++) {
    const s = (await one('select public.crm_context_reconcile(1) s')).s
    pex += s.prospects_examined; pch += s.prospects_changed; cycles++; assert.equal(s.errors, 0)
    const cur = (await one('select prospects_cursor c from public.crm_context_delivery_control')).c
    if (cur === null) pdone = true; else assert.notEqual(cur, null, 'ciclo incompleto guarda o cursor')
  }
  assert(pdone, 'o ciclo dos leads escolhidos termina'); assert.equal(pex, enabledNow, 'o ciclo percorre cada lead escolhido exatamente uma vez'); assert(pch >= 1); assert(cycles > 1, 'lotes pequenos retomam pelo cursor')
  assert((await prospectRows(p1)).length > nBeforeSweep || (await lastEvent(p1)).payload.crm.observations === 'so a varredura enxerga isto')
  assert.equal((await lastEvent(p1)).payload.crm.observations, 'so a varredura enxerga isto', 'a varredura trouxe a fila de volta ao alinhamento')
  await one('select public.crm_context_reconcile(500) s')   // termina o ciclo dos registros do site (a fila foi esvaziada no inicio deste bloco)
  const sweep2 = (await one('select public.crm_context_reconcile(500) s')).s; assert.equal(sweep2.prospects_changed, 0, 'segunda varredura: idempotente'); assert.equal(sweep2.changed, 0)
  const errBefore = await N('select trigger_error_count n from public.crm_context_delivery_control')
  await db.exec('alter function public.meta_form_field_rank(text) rename to meta_form_field_rank_bak')
  try {
    const bad2 = (await one('select public.crm_context_reconcile(500) s')).s
    assert(bad2.errors >= 1, 'a falha da varredura de leads vira contagem, nunca excecao: ' + JSON.stringify(bad2))
  } finally { await db.exec('alter function public.meta_form_field_rank_bak(text) rename to meta_form_field_rank') }
  assert((await N('select trigger_error_count n from public.crm_context_delivery_control')) >= errBefore, 'falhas registradas')
  await db.exec('update public.crm_context_delivery_control set trigger_error_count=0')
  await auth(null, '')

  // --- lead apagado: a escolha some junto (o historico de eventos fica) ---
  const evCount = (await prospectRows(p2)).length
  await db.query('delete from public.crm_leads where id=$1', [p2])
  assert.equal(await N('select count(*) n from public.crm_voxen_prospects where lead_id=$1', [p2]), 0); assert.equal((await prospectRows(p2)).length, evCount)
  assert.equal(await stateOf(p2), 'available', 'lead que nao existe mais nao tem estado')

  // --- situacao para o Executivo ---
  assert.equal(resultOf(await stop([p1]), p1), 'stopped')   // um lead parado: a situacao conta escolhidos e parados em separado
  assert.equal(await stateOf(p1), 'stopped')
  await auth(null, 'service_role')
  const stt = (await one('select public.crm_context_prospects_status() s')).s
  const chosenNow = await N('select count(*) n from public.crm_voxen_prospects where enabled')
  assert.equal(stt.ready, true); assert.equal(stt.enabled, chosenNow); assert.equal(stt.stopped, await N('select count(*) n from public.crm_voxen_prospects where not enabled'))
  assert(stt.stopped >= 1, 'o lead parado aparece em parados'); assert.equal(stt.enabled + stt.stopped, await N('select count(*) n from public.crm_voxen_prospects'), 'parado nao conta como escolhido')
  assert.equal(stt.enabled, stt.waiting + stt.pending + stt.delivered + stt.blocked + stt.quarantined, 'cada lead escolhido cai em um estado só')
  const anyChosen = new Set((await q('select lead_id from public.crm_voxen_prospects')).map(r => r.lead_id))
  assert.equal(stt.available, (await cand()).filter(c => !anyChosen.has(c)).length, 'disponiveis: com contexto, sem cadastro e ainda nao escolhidos')
  assert.deepEqual(stt.rehearsal, { accepted: true, state: 'delivered', receipt_status: 'applied' })
  await auth(PLAIN, 'authenticated'); await rejects(q('select public.crm_context_prospects_status()'), /Executive|42501/)
  await auth(EXEC, 'authenticated'); assert.equal((await one('select public.crm_context_prospects_status() s')).s.enabled, chosenNow)
  await auth(null, '')
  const flat = JSON.stringify([await states(), stt])
  for (const x of [...SECRETS, 'Maria Responsavel', 'Joao Prospect', 'OBSERVACAO DO SDR', 'nota editada', 'Atleta Manual']) assert(!flat.includes(x), 'estado e situacao nao trazem dado de lead: ' + x)

  // --- permissoes: o app so chama as 3 acoes; o resto e interno; nenhuma tabela e acessivel ---
  for (const sig of ['public.crm_voxen_send(uuid[])', 'public.crm_voxen_stop(uuid[])', 'public.crm_voxen_sync_states()']) {
    assert.equal(await exec('authenticated', sig), true, sig); assert.equal(await exec('anon', sig), false, sig)
  }
  assert.equal(await exec('service_role', 'public.crm_context_enqueue_synthetic_prospect()'), true); assert.equal(await exec('anon', 'public.crm_context_enqueue_synthetic_prospect()') || await exec('authenticated', 'public.crm_context_enqueue_synthetic_prospect()'), false)
  assert.equal(await exec('authenticated', 'public.crm_context_prospects_status()'), true); assert.equal(await exec('anon', 'public.crm_context_prospects_status()'), false)
  assert.equal((await one(`select relrowsecurity r from pg_class where oid='public.crm_voxen_prospects'::regclass`)).r, true, 'RLS ligado')
  for (const role of ['anon', 'authenticated', 'service_role']) for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
    assert.equal((await one(`select has_table_privilege('${role}','public.crm_voxen_prospects','${priv}') p`)).p, false, `${role} nao pode ${priv} em crm_voxen_prospects`)
}

// ---------- evento sintetico de ensaio ----------
{
  const lead = U(555)
  const id1 = (await one('select public.crm_context_enqueue_synthetic($1) id', [lead])).id
  const id2 = (await one('select public.crm_context_enqueue_synthetic($1) id', [lead])).id
  const rows = await outboxOf(lead)
  assert.deepEqual(rows.map(r => Number(r.source_revision)), [1, 2]); assert.deepEqual(rows.map(r => r.event_id), [id1, id2])
  const p = rows[0].payload
  assert.equal(p.profile.filled_by_raw, 'Teste de integração — não abordar'); assert.equal(p.kind, 'athlete_context'); assert.equal(p.source_lead_id, lead)
  assert.equal(p.source_project, 'mbzwchnxtskysqplqiyy'); assert.equal(p.schema_version, 1); assert.equal(p.event_id, id1)
  for (const k of Object.keys(p)) assert(ALLOWED_TOP.includes(k), 'chave fora da lista no evento sintetico: ' + k)
  assert.equal(await N(`select count(*) n from public.meta_form_leads where meta_lead_id like '%555%' and entry_channel='website'`), 0, 'o sintetico nao toca em leads reais')
}

console.log('verify-crm-context-bridge-db: OK')
