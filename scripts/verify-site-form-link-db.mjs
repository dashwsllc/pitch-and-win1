// Banco descartavel (PGlite) com as funcoes REAIS extraidas das migrations. Nada toca producao.
// Cobre: vinculo site<->formulario, contexto no CRM, aprovacao sem duplicar, indicador e permissoes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const dir = 'supabase/migrations/'
const read = file => readFileSync(dir + file, 'utf8').replace(/\r\n/g, '\n')
// Ultima definicao de uma funcao dentro de um arquivo de migration.
function extractFunction(file, name) {
  const src = read(file), starts = [...src.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g'))]
  assert(starts.length, `${name} nao encontrada em ${file}`)
  const start = starts.at(-1).index, tag = src.slice(start).match(/\bAS\s+(\$[A-Za-z_]*\$)/)
  const bodyStart = start + tag.index + tag[0].length, end = src.indexOf(tag[1], bodyStart)
  return src.slice(start, src.indexOf(';', end + tag[1].length) + 1)
}
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const norm0 = s => s.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean)
const db = new PGlite()
const q = async (sql, params) => (await db.query(sql, params)).rows

await db.exec(`
create role authenticated; create role anon; create role service_role; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(user_id uuid primary key,display_name text);
create table public.meta_lead_import_batches(id uuid primary key,filename text);
create table public.crm_leads(id uuid primary key default gen_random_uuid(),name text,phone text,email text,athlete_name text,athlete_birth_date date,
 athlete_position text,athlete_age smallint,athlete_height_cm numeric,athlete_weight_kg numeric,performance_report_url text,city_state text,lead_source text,
 observations text,sdr_id uuid,meta_form_lead_id uuid unique,lead_generated_at timestamptz,lead_received_at timestamptz,import_channel text,import_method text,
 import_snapshot jsonb,created_at timestamptz default now(),created_by uuid,temperature text not null default 'frio' check(temperature in('frio','morno','quente')),
 approach_stage text not null default 'nao_abordado',pipeline_stage text not null default 'novo',approach_count integer not null default 0,closer_id uuid);
create table public.meta_form_leads(id uuid primary key default gen_random_uuid(),meta_lead_id text unique not null,page_id text default 'p',form_id text default 'f',
 campaign_id text,campaign_name text,ad_id text,form_name text,created_time timestamptz,field_data jsonb not null default '[]',custom_disclaimer_responses jsonb default '[]',
 full_name text,phone text,email text,status text default 'novo',crm_lead_id uuid unique references public.crm_leads(id),imported_by uuid references auth.users(id),
 imported_at timestamptz,ignored_reason text,received_at timestamptz default now(),updated_at timestamptz default now(),
 lead_import_batch_id uuid references public.meta_lead_import_batches(id),import_contact jsonb not null default '{}',import_warning text,
 approval_status text default 'pendente' check(approval_status in('pendente','aprovado','rejeitado')),reviewed_by uuid references auth.users(id),reviewed_at timestamptz,
 review_note text,traffic_edited_at timestamptz,source_snapshot jsonb,wave_id uuid,crm_sync_status text,crm_sync_error text,crm_sync_attempts integer default 0,
 crm_sync_last_at timestamptz,first_received_at timestamptz,entry_channel text default 'form' check(entry_channel in('form','website')));
create table public.crm_lead_contexts(id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.crm_leads(id) on delete cascade,
 author_id uuid not null references auth.users(id),author_name text not null,author_role text not null check(author_role in('sdr','closer','trafego')),
 context_type text not null check(context_type in('whatsapp_summary','call_transcript','manual_note','meta_form')),
 content text not null check(char_length(content) between 1 and 50000),created_at timestamptz default now(),updated_at timestamptz default now(),updated_by uuid,version bigint default 1);
create unique index crm_lead_contexts_meta_form_once on public.crm_lead_contexts(lead_id) where context_type='meta_form';
create table public.site_import_events(meta_form_lead_id uuid,event jsonb,status text,source_revision bigint);
create table public.meta_lead_waves(id uuid primary key default gen_random_uuid(),number integer,status text default 'pendente');
create function public.traffic_has_access() returns boolean language sql stable as $$select true$$;
create function public.meta_wave_summary(p uuid) returns jsonb language sql stable as $$select jsonb_build_object('id',p)$$;
grant usage on schema auth to authenticated; grant select on all tables in schema public to authenticated;
create function public.crm_can(p text) returns boolean language sql stable as $$select auth.uid() is not null$$;
-- Trava real do CRM (producao): qualquer insert/update em crm_leads exige usuario autenticado.
create function public.security_guard_crm_lead() returns trigger language plpgsql set search_path to 'pg_catalog','public' as $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); NEW.created_at := clock_timestamp();
  ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Identificadores e autoria são imutáveis' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END; $$;
create trigger security_guard_crm_lead before insert or update on public.crm_leads for each row execute function public.security_guard_crm_lead();`)

// Funcoes reais (as mesmas que rodam em producao, na ordem das migrations).
for (const [file, names] of [
  ['20261009160000_meta_traffic_manual_approval.sql', ['meta_answer_text', 'meta_contact_from_form', 'meta_crm_approval_guard', 'meta_crm_link_form']],
  ['20261012150000_meta_lead_waves_crm_sync_auto_publish.sql', ['meta_form_context_text', 'crm_protect_meta_form_context', 'meta_crm_approval_guard']],
  ['20261013165410_crm_import_integrity.sql', ['crm_preserve_import_origin', 'crm_check_import_phone', 'meta_wave_leads']],
]) for (const name of names) await db.exec(extractFunction(file, name))
await db.exec(read('20261014141350_crm_import_context_summary.sql'))
await db.exec(read('20261014154738_crm_form_context_integrity.sql'))
await db.exec(extractFunction('20261012150000_meta_lead_waves_crm_sync_auto_publish.sql', 'meta_sync_form_lead_to_crm'))
await db.exec(`
create trigger aa_crm_preserve_import_origin before insert or update on public.crm_leads for each row execute function public.crm_preserve_import_origin();
create trigger aa_crm_check_import_phone before insert on public.crm_leads for each row execute function public.crm_check_import_phone();
create trigger zz_meta_crm_approval_guard before insert or update on public.crm_leads for each row execute function public.meta_crm_approval_guard();
create trigger meta_crm_link_form after insert or update of meta_form_lead_id on public.crm_leads for each row execute function public.meta_crm_link_form();
create trigger crm_lead_contexts_protect_meta_form before update on public.crm_lead_contexts for each row execute function public.crm_protect_meta_form_context();`)

// Migration nova: o "guard" de md5 e validado de verdade (primeiro com md5 errado, depois com o do banco de teste).
const migration = read('20261015021500_site_form_answers_link.sql')
const md5 = async sig => (await q(`select md5(pg_get_functiondef('${sig}'::regprocedure)) m`))[0].m
const expected = { sync: '802879125215ace732d8240913d3f531', summary: 'd796186737091641ece778e250786b95' }
await assert.rejects(db.exec(migration), /mudou desde a auditoria/, 'o guard deve barrar funcoes diferentes das auditadas')
await db.exec('ROLLBACK')
assert.equal((await q(`select count(*) n from pg_proc where proname='meta_link_site_answers'`))[0].n, 0, 'o guard nao deixa nada instalado')
const original = await q(`select pg_get_functiondef('public.meta_sync_form_lead_to_crm(uuid,uuid)'::regprocedure) d`)
const m1 = await md5('public.meta_sync_form_lead_to_crm(uuid,uuid)'), m2 = await md5('public.crm_context_summary(integer,integer)')
const withMd5 = sql => sql.replace(expected.sync, m1).replace(expected.summary, m2)
// O SQL abaixo e gerado pelo MESMO script que o usuario executara (apply-site-form-answers-link-migration.mjs --print).
const generated = mode => { const r = spawnSync(process.execPath, ['scripts/apply-site-form-answers-link-migration.mjs', mode, '--print'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return readFileSync(r.stdout.trim(), 'utf8').replace(/\r\n/g, '\n') }
await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
 create schema cron; create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text);
 create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid$$;
 create function cron.unschedule(j bigint) returns boolean language sql as $$delete from cron.job where jobid=j returning true$$;`)
// Ensaio: roda tudo no banco, termina com PREFLIGHT_OK e nao deixa NADA instalado.
await assert.rejects(db.exec(withMd5(generated('preflight'))), /PREFLIGHT_OK pares_inequivocos=0 ambiguos=0 leads_do_crm_que_ganham_contexto=0 leads_manuais_com_formulario_do_mesmo_whatsapp=0 \| aquecimento nos formularios: quente=0 morno=0 frio=0 sem_classificacao=0/)
await db.exec('ROLLBACK')
assert.equal((await q(`select count(*) n from pg_proc where proname='meta_link_site_answers'`))[0].n, 0, 'o ensaio nao instala nada')
assert.equal((await q(`select count(*) n from information_schema.columns where table_name='meta_form_leads' and column_name='answers_form_lead_id'`))[0].n, 0, 'o ensaio nao altera a tabela')
assert.equal((await q(`select to_regclass('public.crm_lead_temperature_hints') r`))[0].r, null, 'o ensaio nao cria a tabela de sugestoes')
// Instalacao: aplica + registra em schema_migrations; reaplicar e barrado.
const installSql = withMd5(generated('apply'))
await db.exec(installSql)
assert.deepEqual((await q(`select version,name,(statements[1] like '%meta_link_site_answers%' or statements[1] like '%meta_form_temperature%' or statements[1] like '%meta_names_compatible%') ok from supabase_migrations.schema_migrations order by version`)),
  [{ version: '20261015021500', name: 'site_form_answers_link', ok: true }, { version: '20261015030000', name: 'form_temperature', ok: true }, { version: '20261015031000', name: 'site_form_pairs_name_compat', ok: true }])
await assert.rejects(db.exec(installSql), /ja instalada/); await db.exec('ROLLBACK')
// Migration 4 (regra 4 por WhatsApp + leads criados a mao): o guard barra aprovacao diferente da auditada; o ensaio nao instala; a instalacao registra e nao repete.
const SYNC_MD5_PROD = '859776b0667bb818db018d026e04475c'
const syncDef = async () => (await q(`select pg_get_functiondef('public.meta_sync_form_lead_to_crm(uuid,uuid)'::regprocedure) d`))[0].d
const syncBeforeWa = await syncDef(), m3 = await md5('public.meta_sync_form_lead_to_crm(uuid,uuid)')
assert.equal(m3, SYNC_MD5_PROD, 'a aprovacao instalada no teste e identica (md5) a que esta em producao')
await db.exec(syncBeforeWa.replace('\nBEGIN\n', '\nBEGIN\n  -- alterada\n'))
await assert.rejects(db.exec(generated('whatsapp')), /mudou desde a auditoria/, 'o guard deve barrar a aprovacao diferente da auditada'); await db.exec('ROLLBACK')
assert.notEqual(await md5('public.meta_sync_form_lead_to_crm(uuid,uuid)'), m3); await db.exec(syncBeforeWa)
assert.equal(await md5('public.meta_sync_form_lead_to_crm(uuid,uuid)'), m3, 'funcao restaurada')
const withSyncMd5 = sql => sql.replaceAll(SYNC_MD5_PROD, m3)
await assert.rejects(db.exec(withSyncMd5(generated('whatsapp-preflight'))), /PREFLIGHT_OK site_x_formulario: inequivocos=0 \(pela regra do WhatsApp=0\) para_revisar=0 leads_do_crm_que_ganham_contexto=0 \| leads_manuais_x_formulario: inequivocos=0 para_revisar=0/); await db.exec('ROLLBACK')
assert.equal((await q(`select count(*) n from supabase_migrations.schema_migrations where version='20261015032000'`))[0].n, 0, 'o ensaio da migration 4 nao registra nada')
assert.equal((await q(`select to_regclass('public.crm_form_answer_links') r`))[0].r, null, 'o ensaio nao cria a tabela de vinculos')
const whatsappSql = withSyncMd5(generated('whatsapp'))
await db.exec(whatsappSql)
assert.deepEqual(await q(`select version,name,(statements[1] like '%crm_form_answer_links%') ok from supabase_migrations.schema_migrations where version='20261015032000'`), [{ version: '20261015032000', name: 'whatsapp_answer_links', ok: true }])
await assert.rejects(db.exec(whatsappSql), /ja instalada/); await db.exec('ROLLBACK')
{ // a aprovacao so ganha os trechos NOVO da migration 4
  const prev = new Set(norm0(syncBeforeWa)), now = norm0(await syncDef())
  const removed = [...prev].filter(l => !now.includes(l)), added = now.filter(l => !prev.has(l))
  assert.deepEqual(removed, [], 'a migration 4 nao pode perder nenhuma linha da aprovacao: ' + removed.join(' | '))
  assert(added.length >= 4 && added.length <= 12 && added.some(l => /crm_form_answer_links/.test(l)), 'diff inesperado na aprovacao: ' + added.join(' | '))
}

// A funcao de aprovacao so pode diferir da original nos trechos marcados NOVO.
const norm = norm0
const before = new Set(norm(original[0].d)), after = norm((await q(`select pg_get_functiondef('public.meta_sync_form_lead_to_crm(uuid,uuid)'::regprocedure) d`))[0].d)
const removed = [...before].filter(l => !after.includes(l)), added = after.filter(l => !before.has(l))
assert.deepEqual(removed.filter(l => !/^(IF crm IS NULL THEN|BEGIN|DECLARE|v_age smallint)/.test(l)), [], 'a aprovacao nao pode perder nenhuma linha original: ' + removed.join(' | '))
assert(added.length > 8 && added.length < 40, 'diff inesperado: ' + added.length)

// ---------- dados sinteticos ----------
const TRAFEGO = U(900), APROVADOR = U(901), ATOR = U(902)
await db.exec(`insert into auth.users values('${TRAFEGO}'),('${APROVADOR}'),('${ATOR}');
 insert into public.profiles values('${APROVADOR}','Aprovador Teste'),('${ATOR}','Ator Teste');`)
const QUESTIONS = [
  ['quem_está_preenchendo_este_formulário?', 'sou_o_atleta'], ['atualmente,_o_atleta_está_vinculado_a_algum_clube?', 'não'],
  ['o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?', 'sim'], ['o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?', 'sim,_convite_ou_proposta'],
  ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', 'tornar-se_jogador_profissional'], ['o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?', 'falta_de_oportunidades'],
  ['qual_é_a_posição_e_a_categoria_atual_do_atleta?', 'Eu jogo mais na quadra então sou ala'], ['quais_são_os_principais_clubes_que_o_atleta_já_representou?', 'nenhum mn'],
  ['quais_clubes_avaliou_e_qual_foi_o_resultado?', 'Esse mlk e muito craque Zé, até me deram um apelido "franginha*"'],
  ['quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?', 'Só a condição física sou muito magro. ' + 'Texto longo preservado. '.repeat(120) + 'FIM'],
  ['de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10', 'Acho que us 8/10'],
]
const LONG = QUESTIONS[9][1]
const fieldData = (name, phone, commitment = 'Acho que us 8/10', order) => {
  const all = [...QUESTIONS.map(([n, v], i) => ({ name: n, values: [i === 10 ? commitment : v] })),
    { name: 'full_name', values: [name] }, { name: 'phone_number', values: [phone] }, { name: 'date_of_birth', values: ['2008-09-06'] }, { name: 'state', values: ['SP'] }]
  const contact = all.slice(-4), questions = all.slice(0, -4)
  return JSON.stringify(order === 'contact-first' ? [...contact, ...questions] : order === 'reverse' ? [...all].reverse() : all)
}
let seq = 0
async function form(key, { name, phone, ad, at, approved = false, answers = true, commitment, order }) {
  const id = U(1000 + ++seq)
  await db.query(`insert into public.meta_form_leads(id,meta_lead_id,campaign_name,ad_id,form_name,created_time,field_data,full_name,phone,entry_channel,approval_status,reviewed_by,first_received_at)
   values($1,$2,'FORMULARIO ZYRON TST 04',$3,'FORMULÁRIO ZYRON',$4,$5::jsonb,$6,$7,'form',$8,$9,$4)`,
  [id, 'form:' + key, ad, at, answers ? fieldData(name, phone, commitment, order) : '[]', name, phone, approved ? 'aprovado' : 'pendente', approved ? APROVADOR : null])
  return id
}
async function site(key, { name, phone, ad, at, approved = false, profile = null }) {
  const id = U(2000 + ++seq)
  const snapshot = { site_event: { payload: { contact: { name, phone, email: key + '@example.invalid' }, attribution: { utm_content: ad ? 'JOGADOR JA PERDI AS CONTAS|' + ad : null }, ...(profile ? { profile } : {}) } } }
  await db.query(`insert into public.meta_form_leads(id,meta_lead_id,campaign_name,created_time,field_data,full_name,phone,email,entry_channel,approval_status,reviewed_by,source_snapshot,first_received_at)
   values($1,$2,'',$3,$4::jsonb,$5,$6,$7,'website',$8,$9,$10::jsonb,$3)`,
  [id, 'site:zyron:' + key, at, profile ? JSON.stringify(Object.entries(profile).map(([n, v]) => ({ name: n, values: [String(v)] }))) : '[]', name, phone, key + '@example.invalid', approved ? 'aprovado' : 'pendente', approved ? APROVADOR : null, JSON.stringify(snapshot)])
  return id
}
const asUser = id => db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id])
const link = async apply => { await asUser(''); try { return await q('select * from public.meta_link_site_answers($1)', [apply]) } finally { await asUser(ATOR) } }
await asUser(ATOR) // sessao do usuario que aprova (os gatilhos do CRM exigem usuario); o vinculo em lote roda como sistema (link)
const temperatureOf = async crm => (await q('select temperature t from public.crm_leads where id=$1', [crm]))[0].t
const hintOf = async crm => (await q('select temperature,reasons,applied from public.crm_lead_temperature_hints where lead_id=$1', [crm]))[0]
const sync = async id => (await q('select public.meta_sync_form_lead_to_crm($1,$2) r', [id, ATOR]))[0].r
const approve = id => db.query(`update public.meta_form_leads set approval_status='aprovado',reviewed_by=$2 where id=$1`, [id, APROVADOR])
const ctx = async crm => q(`select context_type,content,author_id,author_name,author_role from public.crm_lead_contexts where lead_id=$1 order by created_at,id`, [crm])
const crmOf = async id => (await q('select crm_lead_id from public.meta_form_leads where id=$1', [id]))[0].crm_lead_id
const countCrm = async () => Number((await q('select count(*) n from public.crm_leads'))[0].n)

// 1) Caso real: o telefone digitado no site difere de um digito do formulario; o site chega 61 s depois.
const F1 = await form('f1', { name: 'João Pedro de Andrade Santana', phone: '+5511948173104', ad: 'AD1', at: '2026-10-09T16:09:32Z' })
const S1 = await site('s1', { name: 'Joao Pedro de Andrade Santana', phone: '11918173104', ad: 'AD1', at: '2026-10-09T16:10:33Z', approved: true })
// 2) Segundo nome diferente, mesmo anuncio, 5 min.
const F2 = await form('f2', { name: 'Maria Clara Souza', phone: '+5521911110000', ad: 'AD2', at: '2026-10-09T17:00:00Z' })
const S2 = await site('s2', { name: 'Maria', phone: '21999990001', ad: 'AD2', at: '2026-10-09T17:05:00Z', approved: true })
// 3) Outro anuncio, mesmo telefone e primeiro nome, 2 h depois.
const F3 = await form('f3', { name: 'Carlos Eduardo', phone: '+5531988887777', ad: 'AD3', at: '2026-10-09T18:00:00Z' })
const S3 = await site('s3', { name: 'Carlos E.', phone: '31988887777', ad: 'AD9', at: '2026-10-09T20:00:00Z', approved: true })
// 4) Ambiguo: dois registros do site, mesmo nome, mesmo anuncio, para um unico formulario.
const F4 = await form('f4', { name: 'Pedro Henrique', phone: '+5541900000001', ad: 'AD4', at: '2026-10-09T19:00:00Z' })
const S4a = await site('s4a', { name: 'Pedro Henrique', phone: '41900000001', ad: 'AD4', at: '2026-10-09T19:01:00Z' })
const S4b = await site('s4b', { name: 'Pedro Henrique', phone: '41900000002', ad: 'AD4', at: '2026-10-09T19:02:00Z' })
// 5) Sem par: anuncio e nome diferentes.
const S5 = await site('s5', { name: 'Fulano Sem Formulario', phone: '51900000005', ad: 'ADX', at: '2026-10-09T21:00:00Z', approved: true })
// 6) Site pendente com formulario pendente (sera aprovado depois do vinculo).
const F6 = await form('f6', { name: 'Lucas Gabriel', phone: '+5561900000006', ad: 'AD6', at: '2026-10-10T10:00:00Z' })
const S6 = await site('s6', { name: 'Lucas Gabriel', phone: '61900000006', ad: 'AD6', at: '2026-10-10T10:02:00Z' })
// 7) Formulario aprovado primeiro, site depois.
const F7 = await form('f7', { name: 'Rafael Lima', phone: '+5571900000007', ad: 'AD7', at: '2026-10-10T11:00:00Z', approved: true })
const S7 = await site('s7', { name: 'Rafael Lima', phone: '71900000007', ad: 'AD7', at: '2026-10-10T11:01:00Z' })
// 8) Site ja no CRM com contexto do proprio site (perfil); o formulario chega depois (mescla).
const F8 = await form('f8', { name: 'Bruno Costa', phone: '+5512900000008', ad: 'AD8', at: '2026-10-10T12:00:00Z' })
const S8 = await site('s8', { name: 'Bruno Costa', phone: '12900000008', ad: 'AD8', at: '2026-10-10T12:03:00Z', approved: true, profile: { position: 'Atacante', age: 17 } })
// 9) Formulario sem respostas nunca vira par.
const F9 = await form('f9', { name: 'Vazio Silva', phone: '+5591900000009', ad: 'AD9Z', at: '2026-10-10T13:00:00Z', answers: false })
const S9 = await site('s9', { name: 'Vazio Silva', phone: '91900000009', ad: 'AD9Z', at: '2026-10-10T13:01:00Z' })

// Antes do vinculo, S1/S2/S3/S5/S8 entram no CRM como sempre entraram (sem respostas).
for (const id of [S1, S2, S3, S5, S8]) assert.equal((await sync(id)).ok, true)
const [crm1, crm2, crm3, crm5, crm8] = await Promise.all([S1, S2, S3, S5, S8].map(crmOf))
await db.query(`update public.crm_leads set approach_stage='em_abordagem',approach_count=1,pipeline_stage='em_qualificacao' where id=$1`, [crm8]) // o SDR ja trabalhou este lead
assert.equal(await temperatureOf(crm1), 'frio'); assert.equal(await hintOf(crm1), undefined, 'sem formulario ligado nao ha classificacao')
assert.equal((await ctx(crm1)).length, 0, 'antes da correcao o lead do site nao tem contexto (o defeito original)')
assert.equal((await ctx(crm8)).length, 1, 'o lead com perfil do site tem so o contexto do proprio site')
const summaryBefore = (await q('select lead_id from public.crm_context_summary()')).map(r => r.lead_id)
assert(!summaryBefore.includes(crm1))

// ---------- simulacao ----------
const dry = await q('select * from public.meta_link_site_answers(false) order by site_id')
const bySite = Object.fromEntries(dry.map(r => [r.site_id, r]))
assert.equal(bySite[S1].form_id, F1); assert.equal(bySite[S1].rule, 1); assert.equal(Number(bySite[S1].delta_seconds), 61); assert.equal(bySite[S1].situacao, 'previsto')
assert.equal(bySite[S2].rule, 2); assert.equal(bySite[S3].rule, 3); assert.equal(bySite[S6].rule, 1); assert.equal(bySite[S7].rule, 1); assert.equal(bySite[S8].rule, 1)
assert.equal(bySite[S4a].ambiguous, true); assert.equal(bySite[S4b].ambiguous, true); assert.match(bySite[S4a].situacao, /revisar/)
assert(!bySite[S5] && !bySite[S9], 'sem par e formulario sem respostas nao aparecem')
assert.equal((await q('select count(*) n from public.meta_form_leads where answers_form_lead_id is not null'))[0].n, 0, 'a simulacao nao altera nada')
assert.equal((await ctx(crm1)).length, 0)

// ---------- aplicacao ----------
const applied = await link(true)
const appliedBy = Object.fromEntries(applied.map(r => [r.site_id, r]))
assert.match(appliedBy[S1].situacao, /vinculado; contexto inserido/); assert.match(appliedBy[S8].situacao, /vinculado; contexto mesclado/)
assert.equal(appliedBy[S6].situacao, 'vinculado', 'site pendente so e vinculado; o contexto vem na aprovacao')
assert.match(appliedBy[S4a].situacao, /revisar/)
const links = await q('select id,answers_form_lead_id,answers_link_basis,answers_linked_at from public.meta_form_leads where answers_form_lead_id is not null')
assert.deepEqual(links.map(l => l.id).sort(), [S1, S2, S3, S6, S7, S8].sort())
assert.match(links.find(l => l.id === S1).answers_link_basis, /mesmo anúncio, nome completo igual, 61 s depois do formulário/)

const c1 = (await ctx(crm1))
assert.equal(c1.length, 1); assert.equal(c1[0].context_type, 'meta_form'); assert.equal(c1[0].author_id, APROVADOR); assert.equal(c1[0].author_role, 'trafego'); assert.equal(c1[0].author_name, 'Aprovador Teste')
const text = c1[0].content
for (const [question, answer] of QUESTIONS.slice(0, 9).concat([QUESTIONS[10]])) {
  const label = question.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim(), cap = label[0].toUpperCase() + label.slice(1)
  assert(text.includes(cap + '\n→ '), 'pergunta ausente: ' + cap)
  const shown = /^\S+$/.test(answer) && answer === answer.toLowerCase() && answer.includes('_') ? answer.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : answer
  assert(text.includes('→ ' + shown), 'resposta ausente: ' + shown)
}
assert(text.includes(LONG), 'a resposta longa deve vir inteira, sem corte')
assert(text.includes('→ Sou o atleta') && text.includes('→ Tornar-se jogador profissional') && text.includes('→ Sim, convite ou proposta'))
assert(text.includes('Nome completo\n→ João Pedro de Andrade Santana') && text.includes('Telefone\n→ +5511948173104'), 'dados informados no formulario, inclusive o telefone digitado la')
assert(text.includes('Preenchido em: 09/10/2026 13:09:32 (Brasília)') && text.includes('Ligado ao envio do site de 09/10/2026 13:10:33'))
assert(text.indexOf('Quem está preenchendo') < text.indexOf('Qual é o principal objetivo') && text.indexOf('Qual é o principal objetivo') < text.indexOf('De 0 a 10'), 'ordem do formulario preservada')
const c8 = await ctx(crm8)
assert.equal(c8.length, 1); assert(c8[0].content.includes('Respostas do formulário Meta') && c8[0].content.includes('Bruno Costa'), 'mescla mantem a linha unica')
assert((await ctx(crm2))[0].content.includes('Maria Clara Souza') && (await ctx(crm3))[0].content.includes('Carlos Eduardo'))
assert.equal((await ctx(crm5)).length, 0, 'lead sem par continua sem inventar contexto')
assert.equal((await ctx(await crmOf(S4a))).length ?? 0, 0)

// Idempotencia: rodar de novo nao muda nada nem duplica.
const again = await link(true)
assert.deepEqual(again.filter(r => !r.ambiguous), [], 'segunda execucao nao encontra mais nada a vincular')
assert.equal((await ctx(crm1)).length, 1)
assert.equal((await q(`select public.meta_attach_form_answers($1,$2,$3,$4) r`, [crm1, F1, APROVADOR, S1]))[0].r, 'igual')

// Indicador de contexto (a "bolinha"): agora o lead do site com respostas aparece; o sem contexto continua fora.
const summary = (await q('select lead_id from public.crm_context_summary()')).map(r => r.lead_id)
assert(summary.includes(crm1) && summary.includes(crm2) && summary.includes(crm3) && summary.includes(crm8))
assert(!summary.includes(crm5))

// ---------- aprovacao sem duplicar ----------
const leadsBefore = await countCrm()
// 6) site pendente ligado a formulario: ao aprovar, o lead nasce com as respostas.
await approve(S6); assert.equal((await sync(S6)).ok, true)
const crm6 = await crmOf(S6), c6 = await ctx(crm6)
assert.equal(c6.length, 1); assert(c6[0].content.includes('→ Sou o atleta') && c6[0].content.includes('Lucas Gabriel'))
assert.equal(await countCrm(), leadsBefore + 1)
//    ...e depois o formulario: reaproveita o mesmo lead (nada de duplicata) e continua com 1 contexto.
await approve(F6); const r6 = await sync(F6)
assert.deepEqual([r6.ok, r6.crm_lead_id, await countCrm()], [true, crm6, leadsBefore + 1])
assert.equal((await q('select crm_sync_status s from public.meta_form_leads where id=$1', [F6]))[0].s, 'enviado')
assert.equal((await ctx(crm6)).length, 1)
assert.equal((await sync(F6)).crm_lead_id, crm6, 'reexecutar a aprovacao e idempotente')
// 7) formulario ja aprovado cria o lead com o snapshot completo; o site depois reaproveita esse lead.
assert.equal((await sync(F7)).ok, true); const crm7 = await crmOf(F7), total7 = await countCrm()
await approve(S7); const r7 = await sync(S7)
assert.deepEqual([r7.ok, r7.crm_lead_id, await countCrm()], [true, crm7, total7])
assert.equal((await q('select import_channel c from public.crm_leads where id=$1', [crm7]))[0].c, 'form')
// 8) lead do site ja no CRM + formulario aprovado depois: anexa ao lead existente.
await approve(F8); const r8 = await sync(F8); assert.deepEqual([r8.ok, r8.crm_lead_id], [true, crm8])
assert.equal((await ctx(crm8)).length, 1)

// Aprovacao de lead SEM vinculo continua exatamente como antes.
const F10 = await form('f10', { name: 'Normal Teste', phone: '+5511900001010', ad: 'AD10', at: '2026-10-11T10:00:00Z', approved: true })
assert.equal((await sync(F10)).ok, true)
const c10 = await ctx(await crmOf(F10)); assert.equal(c10.length, 1); assert(c10[0].content.startsWith('Respostas do formulário Meta · FORMULÁRIO ZYRON'))

// Falha visivel: se nao ha autor para gravar o contexto, a aprovacao falha com mensagem e nao some em silencio.
const F11 = await form('f11', { name: 'Sem Autor', phone: '+5511900001111', ad: 'AD11', at: '2026-10-11T11:00:00Z' })
const S11 = await site('s11', { name: 'Sem Autor', phone: '11900001111', ad: 'AD11', at: '2026-10-11T11:01:00Z' })
await approve(S11); await db.query(`update public.meta_form_leads set reviewed_by=null where id=$1`, [S11]); assert.equal((await sync(S11)).ok, true)
await db.query(`update public.meta_form_leads set imported_by=null where id=$1`, [S11]) // sem nenhum autor conhecido
const l11 = await link(true)
assert.equal((await q('select answers_form_lead_id a from public.meta_form_leads where id=$1', [S11]))[0].a, F11, 'S11 deveria estar ligado a F11: ' + JSON.stringify(l11.filter(r => r.site_id === S11)))
await approve(F11)
const crm11 = await crmOf(S11), leads11 = await countCrm()
const bad = await q('select public.meta_sync_form_lead_to_crm($1,null) r', [F11])
assert.equal(bad[0].r.ok, false, JSON.stringify(bad[0].r)); assert.match(bad[0].r.error, /sem_autor/); assert.equal(await countCrm(), leads11, 'falhou sem criar duplicata')
assert.equal((await q('select crm_sync_status s from public.meta_form_leads where id=$1', [F11]))[0].s, 'falhou')
assert.equal((await ctx(crm11)).length, 0)
assert.equal((await sync(F11)).ok, true, 'com autor valido a nova tentativa conclui'); assert.equal((await ctx(crm11)).length, 1)

// ---------- nomes compativeis nas regras por primeiro nome ----------
for (const [a, b, expected] of [['Carlos Alberto', 'Carlos Daniel dos Anjos Chaves', false], ['Maria', 'Maria Clara Souza', true],
  ['Pedro vitor sousa gomes dos santos', 'Pedro vitor sousa games dos santos', true], ['Joao Pedro', 'Joao Paulo', false], ['', 'Maria', false],
  ['João Pedro de Andrade Santana', 'Joao Pedro de Andrade Santana', true], ['Jarmeson Santos', 'Jarmeson Costa dos santos', true], ['Carlos E.', 'Carlos Eduardo', true]])
  assert.equal((await q('select public.meta_names_compatible($1,$2) r', [a, b]))[0].r, expected, a + ' x ' + b)
let adN = 200
const compatCases = []
for (const [formName, siteName, shouldLink] of [
  ['Carlos Alberto', 'Carlos Daniel dos Anjos Chaves', false], // so o primeiro nome coincide: pode ser outra pessoa
  ['Joao Pedro', 'Joao Paulo', false],
  ['Pedro vitor sousa gomes dos santos', 'Pedro vitor sousa games dos santos', true], // 4+ nomes, 1 letra diferente
  ['Luiz Henrique', 'Luiz Henrique blam dos Santos', true], // menor contido no maior
  ['kaio_xz123', 'Kaio Mateus da Silva Morais', true], // apelido/usuario no formulario
  ['@carlos.X7', 'Carlos Antonio Monteiro', true],
]) {
  const ad = 'ADC' + (++adN)
  const fid = await form('c' + adN, { name: formName, phone: '+55119' + String(10000000 + adN), ad, at: '2026-10-13T10:00:00Z' })
  const sid = await site('c' + adN, { name: siteName, phone: '1190000' + adN, ad, at: '2026-10-13T10:02:00Z' })
  const row = (await q('select * from public.meta_site_form_pairs() where site_id=$1', [sid]))[0]
  assert(row && row.form_id === fid, formName + ' x ' + siteName + ' deve aparecer como candidato')
  assert.equal(row.ambiguous, !shouldLink, formName + ' x ' + siteName)
  compatCases.push([sid, fid, shouldLink, formName])
}
await link(true)
for (const [sid, fid, shouldLink, label] of compatCases)
  assert.equal((await q('select answers_form_lead_id a from public.meta_form_leads where id=$1', [sid]))[0].a, shouldLink ? fid : null, 'vinculo de ' + label)
const dry2 = await q('select * from public.meta_link_site_answers(false)')
assert(dry2.some(r => r.nome_formulario === 'Carlos Alberto' && r.situacao === 'revisar (ambíguo)'), 'nomes incompativeis ficam para revisao')

// ---------- regra 4: mesmo WhatsApp + mesmo anuncio, nome do perfil diferente ----------
let adW = 300
const waCases = []
for (const [label, formName, siteName, o] of [
  ['apelido de usuario', 'Silvazs', 'Davi Silva', {}],
  ['letras estilizadas', '𝒩𝒾𝒸ℴ𝓁𝒶𝓈', 'Nicolas Vicente Vieira da Silva', {}],
  ['nome de um parente no perfil', 'Cledson Barretto', 'Cauã Jesus Barretto', {}],
  ['site sem anuncio identificado', 'Pousada Xandu', 'Diego Tardelli Souza Santos', { siteAd: null, minutes: 6 }],
  ['formato do telefone diferente (parenteses, 55)', 'mk calçados', 'Mikael Vinicius', { formPhone: '(11) 96736-8604', sitePhone: '5511967368604' }],
]) {
  const ad = 'ADW' + (++adW), n = adW, phone = '1196' + String(1000000 + n)
  const fid = await form('w' + n, { name: formName, phone: o.formPhone || '+55' + phone, ad, at: '2026-10-14T10:00:00Z' })
  const sid = await site('w' + n, { name: siteName, phone: o.sitePhone || phone, ad: o.siteAd === null ? null : ad, at: new Date(Date.parse('2026-10-14T10:00:00Z') + (o.minutes || 2) * 60000).toISOString() })
  waCases.push([sid, fid, label, true])
}
for (const [label, formName, siteName, o] of [
  ['anuncios diferentes dos dois lados nao ligam so pelo telefone', 'Fulano Perfil', 'Beltrano Digitado', { siteAd: 'ADOUTRO' }],
  ['site mais de 15 min depois nao liga por esta regra', 'Fulano Perfil', 'Beltrano Digitado', { minutes: 30 }],
  ['telefone diferente nao liga mesmo com anuncio igual e nome diferente', 'Fulano Perfil', 'Beltrano Digitado', { sitePhone: '11900000099' }],
]) {
  const ad = 'ADW' + (++adW), n = adW, phone = '1196' + String(1000000 + n)
  const fid = await form('w' + n, { name: formName, phone: '+55' + phone, ad, at: '2026-10-14T11:00:00Z' })
  const sid = await site('w' + n, { name: siteName, phone: o.sitePhone || phone, ad: o.siteAd === undefined ? ad : o.siteAd, at: new Date(Date.parse('2026-10-14T11:00:00Z') + (o.minutes || 2) * 60000).toISOString() })
  waCases.push([sid, fid, label, false])
}
// duas pessoas (formularios) com o mesmo WhatsApp e anuncio e um unico registro do site: ambiguo
const adAmb = 'ADW' + (++adW)
const fa1 = await form('wamb1', { name: 'Perfil Um', phone: '+5511961999999', ad: adAmb, at: '2026-10-14T12:00:00Z' })
const fa2 = await form('wamb2', { name: 'Perfil Dois', phone: '+5511961999999', ad: adAmb, at: '2026-10-14T12:01:00Z' })
const sa = await site('wamb', { name: 'Digitado Nome', phone: '11961999999', ad: adAmb, at: '2026-10-14T12:03:00Z' })
const wRows = await q('select * from public.meta_site_form_pairs() where site_id=$1', [sa])
assert.equal(wRows.length, 2); assert(wRows.every(r => r.ambiguous && Number(r.rule) === 4), 'dois formularios para o mesmo site = revisar')
const wPreview = await q('select * from public.meta_link_site_answers(false)')
for (const [sid, fid, label, shouldLink] of waCases) {
  const row = wPreview.find(r => r.site_id === sid)
  if (shouldLink) { assert(row && row.form_id === fid && !row.ambiguous && Number(row.rule) === 4 && row.situacao === 'previsto', label) } else assert(!row, label)
}
await link(true)
for (const [sid, fid, label, shouldLink] of waCases)
  assert.equal((await q('select answers_form_lead_id a from public.meta_form_leads where id=$1', [sid]))[0].a, shouldLink ? fid : null, 'vinculo: ' + label)
assert.equal((await q('select answers_form_lead_id a from public.meta_form_leads where id=$1', [sa]))[0].a, null, 'ambiguo nao e ligado')
const basis = (await q('select answers_link_basis b from public.meta_form_leads where id=$1', [waCases[0][0]]))[0].b
assert.match(basis, /^mesmo WhatsApp e mesmo anúncio, nome diferente, 120 s depois do formulário$/)
assert.match((await q('select answers_link_basis b from public.meta_form_leads where id=$1', [waCases[3][0]]))[0].b, /^mesmo WhatsApp \(site sem anúncio identificado\), nome diferente, 360 s/)
// o site do atleta que ja esta no CRM ganha as respostas (contexto) com o motivo registrado
const WCRM = await form('wcrm', { name: 'Perfil Joga', phone: '+5511961888888', ad: 'ADWCRM', at: '2026-10-14T13:00:00Z' })
const SWCRM = await site('wcrm', { name: 'Joao Digitado', phone: '11961888888', ad: 'ADWCRM', at: '2026-10-14T13:02:00Z', approved: true })
assert.equal((await sync(SWCRM)).ok, true); const crmW = await crmOf(SWCRM)
assert.equal((await ctx(crmW)).filter(c => c.context_type === 'meta_form').length, 0)
await link(true)
const wCtx = (await ctx(crmW)).filter(c => c.context_type === 'meta_form')
assert.equal(wCtx.length, 1); assert(wCtx[0].content.includes('mesmo WhatsApp e mesmo anúncio, nome diferente'), 'o motivo do vinculo aparece no Contexto'); assert(wCtx[0].content.includes('Esse mlk e muito craque'), 'resposta exata do formulario')
// as regras antigas continuam funcionando como antes
assert.equal(Number((await q('select rule from public.meta_link_site_answers(false) where nome_formulario=$1 limit 1', ['Carlos Alberto']))[0]?.rule ?? 2), 2)

// ---------- leads criados a mao com formulario do mesmo WhatsApp ----------
const manualLead = async (name, phone) => (await q(`insert into public.crm_leads(name,phone) values($1,$2) returning id`, [name, phone]))[0].id
const metaCtx = async crm => (await ctx(crm)).filter(c => c.context_type === 'meta_form')
const MF1 = await form('mf1', { name: 'Perfil Joao', phone: '+5511961000001', ad: 'ADM1', at: '2026-10-14T14:00:00Z' })
const M1 = await manualLead('Joao (pai)', '11 96100-0001') // ninguem abordou
const MF2 = await form('mf2', { name: 'Perfil Pedro', phone: '+5511961000002', ad: 'ADM2', at: '2026-10-14T14:10:00Z' })
const M2 = await manualLead('Pedro', '(11) 96100-0002')
await db.query(`update public.crm_leads set approach_stage='em_abordagem',approach_count=1,pipeline_stage='em_qualificacao' where id=$1`, [M2]) // o SDR ja trabalhou este lead
const MF3 = await form('mf3', { name: 'Perfil Tres', phone: '+5511961000003', ad: 'ADM3', at: '2026-10-14T14:20:00Z' })
const M3a = await manualLead('Tres A', '11961000003'), M3b = await manualLead('Tres B', '11 96100-0003') // dois leads, um formulario: ambiguo
const M4 = await manualLead('Sem formulario', '11961000004')
const MF5 = await form('mf5', { name: 'Sem Respostas', phone: '+5511961000005', ad: 'ADM5', at: '2026-10-14T14:30:00Z', answers: false })
const M5 = await manualLead('Sem respostas', '11961000005')
const MF6 = await form('mf6', { name: 'Perfil Seis', phone: '+5511961000006', ad: 'ADM6', at: '2026-10-14T15:00:00Z' })
const SM6 = await site('mf6', { name: 'Seis Digitado', phone: '11961000006', ad: 'ADM6', at: '2026-10-14T15:02:00Z' })
const M6 = await manualLead('Seis (mae)', '11961000006')
const mPreview = await q('select * from public.meta_link_manual_answers(false)')
const mRow = id => mPreview.filter(r => r.crm_lead_id === id)
assert.deepEqual([mRow(M1)[0].form_id, mRow(M1)[0].ambiguous, mRow(M1)[0].situacao], [MF1, false, 'previsto'])
assert.deepEqual([mRow(M2)[0].form_id, mRow(M2)[0].ambiguous], [MF2, false])
assert(mRow(M3a)[0].ambiguous && mRow(M3b)[0].ambiguous && mRow(M3a)[0].situacao === 'revisar (ambíguo)', 'dois leads manuais para um formulario = revisar')
assert.equal(mRow(M4).length + mRow(M5).length, 0, 'sem formulario ou formulario sem respostas nao entra')
assert.equal((await metaCtx(M1)).length, 0, 'a simulacao nao grava')
assert.equal(await temperatureOf(M1), 'frio')
const countBeforeManual = await countCrm()
await link(true)
assert.equal(await countCrm(), countBeforeManual, 'vincular nao cria lead')
const mc1 = await metaCtx(M1)
assert.equal(mc1.length, 1); assert(mc1[0].content.startsWith('Respostas do formulário Meta · FORMULÁRIO ZYRON'), mc1[0].content.slice(0, 80))
assert(mc1[0].content.includes('Esse mlk e muito craque Zé, até me deram um apelido "franginha*"') && mc1[0].content.includes(LONG), 'resposta exata e sem corte')
assert.deepEqual([mc1[0].author_id, mc1[0].author_role], [ATOR, 'trafego'], 'o autor e quem criou o lead manual')
assert.equal((await metaCtx(M2)).length, 1)
assert.equal(await temperatureOf(M1), 'morno', 'lead manual que ninguem abordou recebe o aquecimento'); assert.equal((await hintOf(M1)).applied, true)
assert.equal(await temperatureOf(M2), 'frio', 'lead manual que o SDR ja abordou so recebe a sugestao'); assert.deepEqual([(await hintOf(M2)).temperature, (await hintOf(M2)).applied], ['morno', false])
for (const id of [M3a, M3b, M4, M5]) assert.equal((await metaCtx(id)).length, 0)
assert.deepEqual((await q('select crm_lead_id from public.crm_form_answer_links order by crm_lead_id')).map(r => r.crm_lead_id).sort(), [M1, M2, M6].sort())
// idempotente; e o vinculo persiste mesmo se o SDR apagar o contexto (nao reaparece a cada ciclo)
await link(true); await link(true)
assert.equal((await metaCtx(M1)).length, 1)
await db.query(`delete from public.crm_lead_contexts where lead_id=$1 and context_type='meta_form'`, [M2]); await link(true)
assert.equal((await metaCtx(M2)).length, 0, 'o que o SDR apagou nao volta sozinho')
// o contexto vira indicador (icone laranja)
assert((await q('select lead_id from public.crm_context_summary()')).some(r => r.lead_id === M1), 'o icone de contexto acende para o lead manual')
// Aprovacao: o formulario REAPROVEITA o lead manual, sem criar outro.
await approve(MF1); const leadsBeforeApproval = await countCrm()
const ok1 = await sync(MF1)
assert.deepEqual([ok1.ok, ok1.crm_lead_id, ok1.already], [true, M1, false]); assert.equal(await countCrm(), leadsBeforeApproval, 'aprovar nao duplica o lead manual')
assert.equal((await q('select crm_sync_status s from public.meta_form_leads where id=$1', [MF1]))[0].s, 'enviado')
assert.equal((await q('select count(*) n from public.crm_leads where meta_form_lead_id=$1', [MF1]))[0].n, 0, 'o lead manual continua sem vinculo de origem Meta')
assert.equal((await metaCtx(M1)).length, 1, 'aprovar de novo nao duplica o contexto'); assert.equal((await sync(MF1)).crm_lead_id, M1)
// O registro do SITE do mesmo atleta tambem reaproveita o lead manual.
await approve(SM6); const ok6 = await sync(SM6)
assert.deepEqual([ok6.ok, ok6.crm_lead_id], [true, M6]); assert.equal(await countCrm(), leadsBeforeApproval, 'aprovar o registro do site tambem nao duplica')
assert.equal((await metaCtx(M6)).length, 1)
// Sem vinculo (ambiguo), a aprovacao continua criando o lead como antes.
await approve(MF3); assert.equal((await sync(MF3)).ok, true); assert.equal(await countCrm(), leadsBeforeApproval + 1)
// Permissoes
await db.exec('set role authenticated')
await assert.rejects(db.query('select * from public.meta_link_manual_answers(false)'), /permission denied/)
await assert.rejects(db.query('select * from public.meta_manual_twin_pairs()'), /permission denied/)
await assert.rejects(db.query('select * from public.crm_form_answer_links'), /permission denied/)
await db.exec('reset role; set role anon')
await assert.rejects(db.query('select * from public.crm_form_answer_links'), /permission denied/)
await db.exec('reset role')

// ---------- migration 5: ordem das perguntas, respostas na linha do site, leads duplicados, confirmacao humana ----------
const FQ = ['Quem está preenchendo este formulário?', 'Atualmente, o atleta está vinculado a algum clube?', 'O atleta já participou de avaliações ou peneiras em clubes?',
  'O atleta já recebeu alguma oportunidade relevante de um clube?', 'Qual é o principal objetivo do atleta no futebol hoje?', 'O que mais está impedindo o atleta de chegar onde deseja hoje?',
  'Qual é a posição e a categoria atual do atleta?', 'Quais são os principais clubes que o atleta já representou?', 'Quais clubes avaliou e qual foi o resultado?',
  'Quais são as 3 principais características do atleta como jogador e o que ele mais precisa melhorar?', 'De 0 a 10, quanto o atleta está comprometido em buscar seu objetivo no futebol? escala de 0 a 10',
  'Nome completo', 'Telefone', 'Data de nascimento', 'Estado']
const inOrder = text => { const pos = FQ.map(q => text.indexOf(q + '\n→ ')); return pos.every((x, i) => x >= 0 && (i === 0 || x > pos[i - 1])) }
const sortedChars = t => [...t].sort().join('')
// Contextos gravados ANTES da migration, na ordem em que a Meta entregou os campos.
const FO1 = await form('fo1', { name: 'Ordem Site', phone: '+5511961222001', ad: 'ADO1', at: '2026-10-14T16:00:00Z', order: 'contact-first' })
const SO1 = await site('fo1', { name: 'Ordem Site', phone: '11961222001', ad: 'ADO1', at: '2026-10-14T16:02:00Z', approved: true })
assert.equal((await sync(SO1)).ok, true); const crmO1 = await crmOf(SO1)
const FO2 = await form('fo2', { name: 'Ordem Manual', phone: '+5511961222002', ad: 'ADO2', at: '2026-10-14T16:10:00Z', order: 'reverse' }); const MO2 = await manualLead('Ordem Manual (pai)', '11961222002')
const FO3 = await form('fo3', { name: 'Ordem Certa', phone: '+5511961222003', ad: 'ADO3', at: '2026-10-14T16:20:00Z' }); const MO3 = await manualLead('Ordem Certa', '11961222003')
const FO4 = await form('fo4', { name: 'Ordem Ignorada', phone: '+5511961222004', ad: 'ADO4', at: '2026-10-14T16:30:00Z', order: 'reverse' }); const MO4 = await manualLead('Ordem Ignorada', '11961222004')
await db.query(`insert into public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content) values($1,$2,'QA','trafego','meta_form','Texto que o SDR já tinha')`, [MO4, ATOR])
await db.query(`insert into public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) values($1,$2,'teste')`, [MO4, FO4])
await link(true)
const idsO = [crmO1, MO2, MO3, MO4]
const ctxRows = async () => q(`select * from public.crm_lead_contexts where context_type='meta_form' and lead_id=any($1) order by lead_id`, [idsO])
const ctxBefore = await ctxRows(), ctxOf = (rows, lead) => rows.find(r => r.lead_id === lead)
assert.equal(ctxBefore.length, 4)
assert(!inOrder(ctxOf(ctxBefore, crmO1).content) && !inOrder(ctxOf(ctxBefore, MO2).content), 'antes da migration o contexto segue a ordem recebida')
assert(inOrder(ctxOf(ctxBefore, MO3).content), 'formulario ja na ordem')
assert.match(ctxOf(ctxBefore, crmO1).content, /Ligado ao envio do site de/, 'contexto do site: texto do site + respostas ligadas')

await assert.rejects(q('select public.meta_form_field_rank($1)', ['x']), /does not exist/, 'a funcao de posicao so existe depois da migration 5')

// Guard: as duas funcoes substituidas precisam ser as auditadas.
const PROD = { answersText: '97a5df974c5f85d7a9de99d897595b37', waveLeads: '85e899b9ea495e80214333e25257352e', manual: '61616422495140f24959903b9215419c' }
const mdA = await md5('public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads)'), mdW = await md5('public.meta_wave_leads(uuid)'), mdM = await md5('public.meta_link_manual_answers(boolean)')
assert.equal(mdA, PROD.answersText, 'meta_form_answers_text do teste e identica (md5) a de producao'); // meta_wave_leads: em producao a migration antiga ficou com quebras de linha mistas (CRLF), entao o md5 de la nao e comparavel com o texto normalizado; o guard usa o md5 real.
assert.equal(mdM, PROD.manual, 'meta_link_manual_answers do teste e identica (md5) a de producao')
const withOrderMd5 = sql => sql.replaceAll(PROD.answersText, mdA).replaceAll(PROD.waveLeads, mdW).replaceAll(PROD.manual, mdM)
const defA = (await q(`select pg_get_functiondef('public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads)'::regprocedure) d`))[0].d
await db.exec(defA.replace('\nAS $function$', '\nAS $function$ -- alterada'))
await assert.rejects(db.exec(generated('order')), /meta_form_answers_text mudou desde a auditoria/); await db.exec('ROLLBACK'); await db.exec(defA)
const defW = (await q(`select pg_get_functiondef('public.meta_wave_leads(uuid)'::regprocedure) d`))[0].d
await db.exec(defW.replace('\nBEGIN\n', '\nBEGIN\n  -- alterada\n'))
await assert.rejects(db.exec(generated('order')), /meta_wave_leads mudou desde a auditoria/); await db.exec('ROLLBACK'); await db.exec(defW)

// Ensaio: relata o que faria e nao deixa nada.
const pre = await db.exec(withOrderMd5(generated('order-preflight'))).then(() => '', e => e.message); await db.exec('ROLLBACK')
const rep = pre.match(/PREFLIGHT_OK contextos_do_formulario=(\d+) reescritos_na_nova_ordem=(\d+) ja_na_ordem=(\d+) ignorados=(\d+) \| leads_manuais_a_vincular=(\d+) para_revisar=(\d+)/)
assert(rep, 'relatorio do ensaio: ' + pre)
assert.equal(Number(rep[2]), 2, 'dois contextos mudam de ordem (site e manual)'); assert(Number(rep[4]) >= 1, 'o contexto de texto diferente e ignorado')
assert.equal(Number(rep[2]) + Number(rep[3]) + Number(rep[4]), Number(rep[1]), 'todo contexto do formulario e reescrito, ja esta na ordem ou e ignorado')
assert.equal((await q(`select to_regprocedure('public.meta_form_field_rank(text)') r`))[0].r, null, 'o ensaio nao instala nada')
assert.deepEqual((await ctxRows()).map(r => r.content), ctxBefore.map(r => r.content), 'o ensaio nao reescreve contexto')

// Instalacao.
const orderSql = withOrderMd5(generated('order'))
await db.exec(orderSql)
assert.deepEqual(await q(`select version,name from supabase_migrations.schema_migrations where version='20261015040000'`), [{ version: '20261015040000', name: 'form_answers_order_and_traffic_link' }])
await assert.rejects(db.exec(orderSql), /ja instalada/); await db.exec('ROLLBACK')
for (const [name, rank] of [['quem_está_preenchendo_este_formulário?', 1], ['Quem está preenchendo este formulário?', 1], ['atualmente,_o_atleta_está_vinculado_a_algum_clube?', 2],
  ['o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?', 3], ['o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?', 4], ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', 5],
  ['o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?', 6], ['qual_é_a_posição_e_a_categoria_atual_do_atleta?', 7], ['quais_são_os_principais_clubes_que_o_atleta_já_representou?', 8],
  ['quais_clubes_avaliou_e_qual_foi_o_resultado?', 9], ['quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?', 10],
  ['de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10', 11], ['full_name', 20], ['phone_number', 21], ['date_of_birth', 22], ['state', 23], ['campo_novo_da_meta', 100], ['', 100]])
  assert.equal((await q('select public.meta_form_field_rank($1) r', [name]))[0].r, rank, name)
const ctxAfter = await ctxRows()
for (const lead of [crmO1, MO2, MO3]) {
  const b = ctxOf(ctxBefore, lead), a = ctxOf(ctxAfter, lead)
  assert.deepEqual([a.id, a.created_at, a.author_id, a.author_name, a.author_role, a.version, a.context_type], [b.id, b.created_at, b.author_id, b.author_name, b.author_role, b.version, b.context_type], 'identidade do contexto preservada')
  assert(inOrder(a.content), 'na ordem do formulario'); assert.equal(sortedChars(a.content), sortedChars(b.content), 'mesmos caracteres: nada perdido, nada acrescentado')
}
assert.notEqual(ctxOf(ctxAfter, crmO1).content, ctxOf(ctxBefore, crmO1).content); assert.notEqual(ctxOf(ctxAfter, MO2).content, ctxOf(ctxBefore, MO2).content)
assert.equal(ctxOf(ctxAfter, MO3).content, ctxOf(ctxBefore, MO3).content, 'o que ja estava na ordem nao e mexido')
assert.equal(ctxOf(ctxAfter, MO4).content, 'Texto que o SDR já tinha', 'contexto com texto diferente do gerado nao e tocado')
assert(ctxOf(ctxAfter, crmO1).content.includes('Ligado ao envio do site de'), 'o resto do texto do contexto do site continua')
assert.equal((await q(`select public.meta_attach_form_answers($1,$2,$3,$4) r`, [crmO1, FO1, ATOR, SO1]))[0].r, 'igual', 'o texto novo e o que a funcao gera hoje')
assert.equal((await q(`select public.meta_attach_form_answers($1,$2,$3) r`, [MO2, FO2, ATOR]))[0].r, 'igual')
// Novos anexos ja saem na ordem do formulario, qualquer que seja a ordem recebida.
for (const [i, order] of ['reverse', 'contact-first'].entries()) {
  const num = '1196144440' + i, f = await form('fn' + order, { name: 'Novo ' + order, phone: '+55' + num, ad: 'ADN' + order, at: '2026-10-14T17:30:00Z', order })
  const m = await manualLead('Novo ' + order, num)
  await link(true); const c = await metaCtx(m); assert.equal(c.length, 1); assert(inOrder(c[0].content), 'novo anexo na ordem do formulario (' + order + ')')
  assert.equal(c[0].content.split('\n→ ').length - 1, 15, 'as 15 respostas')
}

// Trafego: o registro do SITE traz as respostas do formulario ligado (e o formulario nao).
const WAVE = U(7001)
await db.query(`insert into public.meta_lead_waves(id,number) values($1,1)`, [WAVE])
const lone = await site('wavelone', { name: 'Site Sem Formulario', phone: '11961999000', ad: 'ADWL', at: '2026-10-14T18:00:00Z' })
await db.query(`update public.meta_form_leads set wave_id=$1 where id=any($2)`, [WAVE, [SO1, FO1, lone]])
const wl = (await q('select public.meta_wave_leads($1) r', [WAVE]))[0].r, wrow = id => wl.leads.find(l => l.id === id)
assert.equal(wl.leads.length, 3)
assert.equal(wrow(SO1).linked_form.id, FO1); assert.equal(wrow(SO1).linked_form.form_name, 'FORMULÁRIO ZYRON'); assert.equal(wrow(SO1).linked_form.field_data.length, 15)
assert.match(wrow(SO1).linked_form.basis, /mesmo anúncio, nome completo igual/); assert(wrow(SO1).linked_form.created_time)
assert.equal(wrow(FO1).linked_form, null); assert.equal(wrow(lone).linked_form, null)
for (const key of ['id', 'meta_lead_id', 'page_id', 'form_id', 'form_name', 'campaign_id', 'campaign_name', 'ad_id', 'created_time', 'received_at', 'first_received_at', 'entry_channel', 'updated_at',
  'full_name', 'phone', 'email', 'field_data', 'custom_disclaimer_responses', 'approval_status', 'status', 'review_note', 'reviewed_at', 'import_warning', 'crm_lead_id', 'crm_sync_status',
  'crm_sync_error', 'crm_sync_attempts', 'crm_sync_last_at', 'traffic_edited_at', 'source', 'batch_filename', 'time_known', 'date_known']) assert(key in wrow(SO1), 'chave original preservada: ' + key)
assert.deepEqual(wl.leads.map(l => l.id), [lone, SO1, FO1], 'a ordem da leva continua do mais recente para o mais antigo')

// Lead criado a mao duplicado (mesmo WhatsApp): os dois recebem as respostas; a aprovacao reaproveita o mais antigo.
const FD = await form('fd', { name: 'Dup Perfil', phone: '+5511961333001', ad: 'ADD1', at: '2026-10-14T19:00:00Z' })
const MD1 = await manualLead('Dup Um', '11961333001'), MD2 = await manualLead('Dup Dois', '(11) 96133-3001')
const pairsD = await q('select * from public.meta_manual_twin_pairs() where form_id=$1', [FD])
assert.equal(pairsD.length, 2); assert(pairsD.every(x => !x.ambiguous), 'dois leads para um formulario nao e duvida')
// Um lead com DOIS formularios continua em duvida.
const FE1 = await form('fe1', { name: 'Dois Forms', phone: '+5511961333002', ad: 'ADE1', at: '2026-10-14T19:10:00Z' }), FE2 = await form('fe2', { name: 'Dois Forms', phone: '+5511961333002', ad: 'ADE2', at: '2026-10-14T19:20:00Z' })
const ME = await manualLead('Dois Forms', '11961333002')
assert((await q('select * from public.meta_manual_twin_pairs() where crm_lead_id=$1', [ME])).every(x => x.ambiguous) && (await q('select * from public.meta_manual_twin_pairs() where crm_lead_id=$1', [ME])).length === 2)
await link(true)
assert.equal((await metaCtx(MD1)).length, 1); assert.equal((await metaCtx(MD2)).length, 1); assert.equal((await metaCtx(ME)).length, 0, 'lead com dois formularios espera decisao')
assert.deepEqual((await q('select crm_lead_id from public.crm_form_answer_links where form_lead_id=$1 order by linked_at,crm_lead_id', [FD])).map(r => r.crm_lead_id).sort(), [MD1, MD2].sort())
await approve(FD); const leadsD = await countCrm(), okD = await sync(FD)
assert.deepEqual([okD.ok, okD.crm_lead_id], [true, MD1], 'reaproveita o lead mais antigo, sem criar outro'); assert.equal(await countCrm(), leadsD)

// Confirmacao humana: site (nomes e telefones diferentes) e lead manual (telefone diferente).
const FC1 = await form('fc1', { name: 'EMANUEL GTN', phone: '+5564993203682', ad: 'ADC1', at: '2026-10-14T20:00:00Z' })
const SC1 = await site('fc1', { name: 'Emanuel de souza costa', phone: '11111118679', ad: 'ADC1', at: '2026-10-14T20:05:00Z', approved: true })
assert.equal((await sync(SC1)).ok, true); const crmC1 = await crmOf(SC1)
await link(true); assert.equal((await q('select answers_form_lead_id a from public.meta_form_leads where id=$1', [SC1]))[0].a, null, 'as regras automaticas deixam em duvida')
const confirmSite = (site, form, note) => q('select public.meta_confirm_site_form_link($1,$2,$3) r', [site, form, note])
await assert.rejects(confirmSite(SC1, FC1, '  '), /Informe o motivo/)
await assert.rejects(confirmSite(FC1, FC1, 'x'), /registro do site/); await assert.rejects(confirmSite(SC1, SC1, 'x'), /formulário com respostas/)
const confirmed = (await confirmSite(SC1, FC1, 'primeiro nome e anúncio iguais; o nome do perfil é apelido'))[0].r
assert.match(confirmed, /^vinculado; contexto (inserido|mesclado)$/)
const rowC1 = (await q('select answers_form_lead_id a,answers_link_basis b,answers_linked_at t from public.meta_form_leads where id=$1', [SC1]))[0]
assert.equal(rowC1.a, FC1); assert.match(rowC1.b, /^confirmado manualmente \(primeiro nome e anúncio iguais; o nome do perfil é apelido\), 300 s depois do formulário$/); assert(rowC1.t)
const ctxC1 = await metaCtx(crmC1); assert.equal(ctxC1.length, 1); assert(inOrder(ctxC1[0].content)); assert(ctxC1[0].content.includes('confirmado manualmente'), 'o motivo aparece no Contexto')
await assert.rejects(confirmSite(SC1, FC1, 'de novo'), /já está ligado/)
const SC1b = await site('fc1b', { name: 'Outro Site', phone: '11111110000', ad: 'ADC1', at: '2026-10-14T20:06:00Z' })
await assert.rejects(confirmSite(SC1b, FC1, 'mesmo formulário'), /já está ligado a outro registro do site/)
const FC2 = await form('fc2', { name: 'Jhan Marcos', phone: '+5541998077760', ad: 'ADC2', at: '2026-10-14T21:00:00Z' }), MC2 = await manualLead('Jhan Marcos', '41 9149-2428')
assert.equal((await q('select count(*) n from public.meta_manual_twin_pairs() where crm_lead_id=$1', [MC2]))[0].n, 0, 'telefone diferente: a regra nao liga')
const confirmManual = (crm, form, note) => q('select public.meta_confirm_manual_form_link($1,$2,$3) r', [crm, form, note])
await assert.rejects(confirmManual(MC2, FC2, ''), /Informe o motivo/); await assert.rejects(confirmManual(crmC1, FC2, 'x'), /lead criado à mão/)
assert.equal((await confirmManual(MC2, FC2, 'mesmo nome completo (nome raro), um dia depois'))[0].r, 'vinculado; contexto inserido')
assert.match((await q('select basis from public.crm_form_answer_links where crm_lead_id=$1', [MC2]))[0].basis, /^confirmado manualmente \(mesmo nome completo \(nome raro\), um dia depois\)$/)
assert((await metaCtx(MC2))[0].content.includes('Telefone\n→ +5541998077760')); await assert.rejects(confirmManual(MC2, FC2, 'de novo'), /já está ligado/)
await approve(FC2); const leadsC = await countCrm(); assert.equal((await sync(FC2)).crm_lead_id, MC2); assert.equal(await countCrm(), leadsC, 'a aprovacao reaproveita o lead confirmado')
// Permissoes das funcoes novas
await db.exec('set role authenticated')
for (const sql of ['select public.meta_confirm_site_form_link(null,null,null)', 'select public.meta_confirm_manual_form_link(null,null,null)', 'select public.meta_form_field_rank($$x$$)',
  'select * from public.meta_manual_twin_pairs()', 'select public.meta_form_answers_text(null,null)']) await assert.rejects(db.query(sql), /permission denied/, sql)
await db.exec('reset role; set role anon'); await assert.rejects(db.query('select public.meta_confirm_site_form_link(null,null,null)'), /permission denied/); await db.exec('reset role')

// ---------- migration 6: retorno bruto da Meta, definicao do formulario, consentimentos e formularios de outras campanhas ----------
const PROD6 = { answers: 'ba074624074c20a17c9eb0db431ebd2a', wave: 'b2a65c25c50a80891903c4c2468826d9', rank: '2a06572c5a8b7c5c92cf84f14f95ea0b' }
const md6 = { answers: await md5('public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads)'), wave: await md5('public.meta_wave_leads(uuid)'), rank: await md5('public.meta_form_field_rank(text)') }
assert.deepEqual(md6, PROD6, 'as tres funcoes substituidas sao identicas (md5) as de producao')
const withMd6 = sql => sql.replaceAll(PROD6.answers, md6.answers).replaceAll(PROD6.wave, md6.wave).replaceAll(PROD6.rank, md6.rank)
const defRank = (await q(`select pg_get_functiondef('public.meta_form_field_rank(text)'::regprocedure) d`))[0].d
await db.exec(defRank.replace('\nAS $function$', '\nAS $function$ -- alterada'))
await assert.rejects(db.exec(generated('raw')), /meta_form_field_rank mudou desde a auditoria/); await db.exec('ROLLBACK'); await db.exec(defRank)
const allCtx = async () => q(`select id,lead_id,content from public.crm_lead_contexts where context_type='meta_form' order by id`)
const ctx6before = await allCtx()
await assert.rejects(db.exec(withMd6(generated('raw-preflight'))), /PREFLIGHT_OK contextos_atualizados_agora=0 \| jobs_de_atualizacao=1/); await db.exec('ROLLBACK')
assert.equal((await q(`select to_regclass('public.meta_lead_raw') r`))[0].r, null, 'o ensaio nao instala nada')
const rawSql = withMd6(generated('raw'))
await db.exec(rawSql)
await assert.rejects(db.exec(rawSql), /ja instalada/); await db.exec('ROLLBACK')
assert.deepEqual(await allCtx(), ctx6before, 'sem dados novos da Meta, nenhum contexto muda')
assert.equal((await q(`select count(*) n from cron.job where jobname='meta-form-context-refresh'`))[0].n, 1)

// Formulario de OUTRA campanha, com perguntas que o sistema nunca viu, consentimentos e contato fora de ordem.
const NF = U(8001), NF2 = U(8002)
const newForm = (id, metaId, phone, order) => db.query(`insert into public.meta_form_leads(id,meta_lead_id,page_id,form_id,campaign_name,ad_id,form_name,created_time,field_data,custom_disclaimer_responses,full_name,phone,entry_channel,approval_status,first_received_at)
 values($1,$2,'PAGE1','FORM900','CAMPANHA NOVA','AD900','FORMULÁRIO NOVO','2026-10-20T12:00:00Z',$3::jsonb,$4::jsonb,'Outra Campanha',$5,'form','pendente','2026-10-20T12:00:00Z')`,
 [id, metaId, JSON.stringify(order), JSON.stringify([{ checkbox_key: 'aceito_contato', is_checked: 'true' }, { checkbox_key: 'aceito_newsletter', is_checked: 'false' }]), phone])
const newAnswers = phone => [{ name: 'qual_o_seu_orçamento_mensal?', values: ['ate_r$_500'] }, { name: 'você_já_investiu_antes?', values: ['sim'] }, { name: 'full_name', values: ['Outra Campanha'] },
  { name: 'phone_number', values: [phone] }, { name: 'cidade_onde_mora', values: ['Curitiba'] }]
await newForm(NF, '900000000000001', '+5511961555001', newAnswers('+5511961555001'))
await newForm(NF2, '900000000000002', '+5511961555002', newAnswers('+5511961555002'))
const MN = await manualLead('Outra Campanha (pai)', '11961555001')
await link(true)
let cn = (await metaCtx(MN))[0].content
const at = t => cn.indexOf(t)
assert(at('Qual o seu orçamento mensal?\n→ Ate r$ 500') >= 0 && at('Você já investiu antes?\n→ sim') >= 0 && at('Cidade onde mora\n→ Curitiba') >= 0, 'todas as respostas de um formulario novo aparecem, mesmo sem a definicao')
assert(at('Consentimento: aceito_contato\n→ marcado') >= 0 && at('Consentimento: aceito_newsletter\n→ não marcado') >= 0, 'consentimentos nao se perdem')
assert(at('Qual o seu orçamento mensal?') < at('Você já investiu antes?') && at('Você já investiu antes?') < at('Cidade onde mora') && at('Cidade onde mora') < at('Nome completo') && at('Nome completo') < at('Telefone'), 'perguntas novas antes do contato')

// Retorno bruto e definicao chegam depois: nada do que a Meta enviou fica de fora.
const missing0 = (await q('select * from public.meta_lead_raw_missing(10)')).map(r => r.meta_lead_id)
assert.deepEqual(missing0.sort(), ['900000000000001', '900000000000002'], 'so leads da API (id numerico) entram na fila de recuperacao')
assert.deepEqual((await q('select form_id from public.meta_form_definition_missing(5)')).map(r => r.form_id), ['FORM900'])
const raw1 = { id: '900000000000001', created_time: '2026-10-20T12:00:00+0000', form_id: 'FORM900', campaign_id: 'C1', campaign_name: 'CAMPANHA NOVA', ad_id: 'AD900', ad_name: 'Anúncio Teste',
  adset_id: 'AS1', adset_name: 'Conjunto Teste', platform: 'ig', is_organic: false, partner_name: '', campo_novo: 'valor novo', objeto: { a: 1 }, field_data: [], custom_disclaimer_responses: [] }
const store = (id, raw, fields = 'id,ad_name') => q('select public.meta_lead_raw_store($1,$2,$3,$4::jsonb,$5)', [id, 'PAGE1', 'FORM900', JSON.stringify(raw), fields])
await assert.rejects(store('900000000000001', { ...raw1, id: '123' }), /Retorno de outro lead/)
await assert.rejects(q('select public.meta_lead_raw_store($1,$2,$3,$4::jsonb,$5)', ['999', 'PAGE1', 'FORM900', JSON.stringify({ id: '999' }), 'id']), /Lead não recebido/)
await assert.rejects(q('select public.meta_lead_raw_store($1,$2,$3,$4::jsonb,$5)', ['900000000000001', 'PAGE1', 'FORM900', '[]', 'id']), /Retorno da Meta inválido/)
await store('900000000000001', raw1)
await store('900000000000001', { id: '900000000000001', ad_name: 'Anúncio Renomeado' }, 'id,ad_name')
const kept = (await q(`select raw from public.meta_lead_raw where meta_lead_id='900000000000001'`))[0].raw
assert.equal(kept.ad_name, 'Anúncio Renomeado'); assert.equal(kept.adset_name, 'Conjunto Teste', 'uma busca com menos campos nao apaga o que ja tinha'); assert.equal(kept.campo_novo, 'valor novo')
assert.deepEqual((await q('select * from public.meta_lead_raw_missing(10)')).map(r => r.meta_lead_id), ['900000000000002'])
// lead que a Meta nao devolveu: marca, nao tenta de novo por 7 dias, depois volta para a fila; um retorno real substitui a marca
await store('900000000000002', { id: '900000000000002', _unavailable: 'objeto inexistente' }, 'unavailable')
assert.deepEqual(await q('select * from public.meta_lead_raw_missing(10)'), [])
await db.query(`update public.meta_lead_raw set fetched_at=clock_timestamp()-interval '8 days' where meta_lead_id='900000000000002'`)
assert.deepEqual((await q('select * from public.meta_lead_raw_missing(10)')).map(r => r.meta_lead_id), ['900000000000002'])
await store('900000000000002', { id: '900000000000002', ad_name: 'Outro anuncio' }, 'id,ad_name')
assert.equal((await q(`select raw from public.meta_lead_raw where meta_lead_id='900000000000002'`))[0].raw._unavailable, undefined, 'o retorno real substitui a marca')
// definicao do formulario (aceita as duas formas do retorno da Graph API)
const defRaw = { id: 'FORM900', name: 'FORMULÁRIO NOVO', status: 'ACTIVE', locale: 'pt_BR', questions: [
  { key: 'qual_o_seu_orçamento_mensal?', label: 'Qual o seu orçamento mensal?', type: 'CUSTOM', options: [{ key: 'ate_r$_500', value: 'Até R$ 500' }] },
  { key: 'você_já_investiu_antes?', label: 'Você já investiu antes?', type: 'CUSTOM' }, { key: 'cidade_onde_mora', label: 'Em qual cidade você mora?', type: 'CUSTOM' },
  { key: 'full_name', label: 'Full name', type: 'FULL_NAME' }] }
await assert.rejects(q('select public.meta_form_definition_store($1,$2,$3,$4::jsonb)', ['FORM900', 'PAGE1', 'x', JSON.stringify({ ...defRaw, id: 'OUTRO' })]), /outro formulário/)
await assert.rejects(q('select public.meta_form_definition_store($1,$2,$3,$4::jsonb)', ['SEMLEADS', 'PAGE1', 'x', JSON.stringify({ id: 'SEMLEADS' })]), /sem leads recebidos/)
await q('select public.meta_form_definition_store($1,$2,$3,$4::jsonb)', ['FORM900', 'PAGE1', 'FORMULÁRIO NOVO', JSON.stringify({ ...defRaw, questions: { data: defRaw.questions } })])
assert.equal((await q(`select jsonb_array_length(questions) n from public.meta_form_definitions where form_id='FORM900'`))[0].n, 4)
await q('select public.meta_form_definition_store($1,$2,$3,$4::jsonb)', ['FORM900', 'PAGE1', 'FORMULÁRIO NOVO', JSON.stringify({ id: 'FORM900', name: 'FORMULÁRIO NOVO', questions: [] })])
assert.equal((await q(`select jsonb_array_length(questions) n from public.meta_form_definitions where form_id='FORM900'`))[0].n, 4, 'uma busca sem perguntas nao apaga a definicao')
assert.deepEqual(await q('select * from public.meta_form_definition_missing(5)'), [])
await db.query(`update public.meta_form_definitions set fetched_at=clock_timestamp()-interval '8 days'`)
assert.equal((await q('select * from public.meta_form_definition_missing(5)')).length, 1, 'definicao velha volta para a fila'); await db.query(`update public.meta_form_definitions set fetched_at=clock_timestamp()`)

// Atualiza o contexto ja gravado: texto exato da pergunta e da opcao, ordem da definicao, consentimentos e TODOS os dados da Meta.
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 1, 'so o lead com dados novos da Meta e atualizado')
cn = (await metaCtx(MN))[0].content
for (const line of ['Qual o seu orçamento mensal?\n→ Até R$ 500', 'Você já investiu antes?\n→ sim', 'Em qual cidade você mora?\n→ Curitiba', 'Nome completo\n→ Outra Campanha',
  'Consentimento: aceito_contato\n→ marcado', 'Consentimento: aceito_newsletter\n→ não marcado', 'Anúncio\n→ Anúncio Renomeado', 'Conjunto de anúncios\n→ Conjunto Teste', 'ID do anúncio\n→ AD900',
  'ID do conjunto de anúncios\n→ AS1', 'Plataforma\n→ Instagram', 'Lead orgânico\n→ não', 'Campo novo\n→ valor novo', 'Objeto\n→ {"a": 1}'])
  assert(cn.includes(line), 'aparece no Contexto: ' + line.replace('\n', ' | '))
assert(!cn.includes('Parceiro'), 'dado vazio da Meta nao vira linha'); assert(!cn.includes('Full name'), 'contato usa o rotulo fixo')
assert(at('Qual o seu orçamento mensal?') < at('Você já investiu antes?') && at('Você já investiu antes?') < at('Em qual cidade') && at('Nome completo') < at('Consentimento: aceito_contato'), 'ordem: perguntas da definicao, contato, consentimentos, dados da Meta')
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 0, 'idempotente')
assert.equal((await metaCtx(MN))[0].content, cn)
// Formulario conhecido: o texto exato da opcao vem da definicao.
await db.query(`update public.meta_form_leads set form_id='F11',page_id='PAGE1' where id=$1`, [FO3])
await q('select public.meta_form_definition_store($1,$2,$3,$4::jsonb)', ['F11', 'PAGE1', 'F11', JSON.stringify({ id: 'F11', questions: [{ key: 'quem_está_preenchendo_este_formulário?', label: 'Quem está preenchendo este formulário?', options: [{ key: 'sou_o_atleta', value: 'Sou o atleta (jogador)' }] }] })])
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 1)
const c3 = (await metaCtx(MO3))[0].content
assert(c3.includes('Quem está preenchendo este formulário?\n→ Sou o atleta (jogador)')); assert(inOrder(c3)); assert.equal(c3.split('\n→ ').length - 1, 15)
// Tráfego: dados da Meta alem das respostas (sem repetir respostas nem identificadores internos).
const WAVE2 = U(7002)
await db.query(`insert into public.meta_lead_waves(id,number) values($1,2)`, [WAVE2]); await db.query(`update public.meta_form_leads set wave_id=$1 where id=any($2)`, [WAVE2, [NF, NF2, FO1]])
const wl2 = (await q('select public.meta_wave_leads($1) r', [WAVE2]))[0].r, w2 = id => wl2.leads.find(l => l.id === id)
assert.deepEqual([w2(NF).meta_extra.ad_name, w2(NF).meta_extra.adset_name, w2(NF).meta_extra.platform, w2(NF).meta_extra.campo_novo], ['Anúncio Renomeado', 'Conjunto Teste', 'ig', 'valor novo'])
for (const key of ['id', 'field_data', 'custom_disclaimer_responses', 'created_time', 'form_id', 'campaign_id', 'campaign_name']) assert(!(key in w2(NF).meta_extra), 'nao repete: ' + key)
assert.equal(w2(FO1).meta_extra, null); assert.equal(Object.keys(wl2.leads[0]).length, 35)
// Permissoes: so a chave de servico da funcao de captura; ninguem le as tabelas.
await db.exec('set role service_role')
assert.equal((await q('select * from public.meta_lead_raw_missing(1)')).length, 0); await q('select * from public.meta_form_definition_missing(1)')
await assert.rejects(db.query('select public.meta_refresh_form_contexts()'), /permission denied/); await assert.rejects(db.query('select * from public.meta_lead_raw'), /permission denied/)
await assert.rejects(db.query('select * from public.meta_form_definitions'), /permission denied/); await db.exec('reset role')
for (const role of ['authenticated', 'anon']) {
  await db.exec('set role ' + role)
  for (const sql of ['select * from public.meta_lead_raw_missing(1)', 'select public.meta_lead_raw_store($$1$$,$$p$$,$$f$$,$${}$$::jsonb,$$id$$)', 'select * from public.meta_form_definition_missing(1)',
    'select public.meta_form_definition_store($$f$$,$$p$$,$$n$$,$${}$$::jsonb)', 'select public.meta_refresh_form_contexts()', 'select * from public.meta_lead_raw', 'select * from public.meta_form_definitions']) await assert.rejects(db.query(sql), /permission denied/, role + ': ' + sql)
  await db.exec('reset role')
}

// ---------- migration 7: a atualizacao reconhece o bloco de respostas em QUALQUER versao (dados chegam em momentos diferentes) ----------
const PROD7 = '4cac492e56b4fd4e6523b81fc499d896'
assert.equal(await md5('public.meta_refresh_form_contexts()'), PROD7, 'meta_refresh_form_contexts do teste e identica (md5) a de producao')
const storeRaw = (id, raw, fields = 'id,ad_name') => q('select public.meta_lead_raw_store($1,$2,$3,$4::jsonb,$5)', [id, 'PAGE1', 'F11', JSON.stringify(raw), fields])
// O contexto de FO3 ja esta no estado "so definicao" (sem dados do anuncio). Chegam os dados do anuncio DEPOIS.
await storeRaw('form:fo3', { id: 'form:fo3', ad_name: 'Anúncio MO3', platform: 'fb' })
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 0, 'defeito da migration 6: nao reconhecia o estado intermediario')
assert(!(await metaCtx(MO3))[0].content.includes('Anúncio MO3'))
const FOX = U(8101), MOX = await manualLead('Bloco de outro formulario', '11961666001')
const blockOfFO3 = (await q('select public.meta_form_answers_text(f,null) t from public.meta_form_leads f where f.id=$1', [FO3]))[0].t
await db.query(`insert into public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content) values($1,$2,'QA','trafego','meta_form',$3)`, [MOX, ATOR, blockOfFO3])
await db.query(`insert into public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) values($1,$2,'teste')`, [MOX, FO2])
const mdR = await md5('public.meta_refresh_form_contexts()')
const defRefresh = (await q(`select pg_get_functiondef('public.meta_refresh_form_contexts()'::regprocedure) d`))[0].d
await db.exec(defRefresh.replace('\nBEGIN\n', '\nBEGIN\n  -- alterada\n'))
await assert.rejects(db.exec(generated('refresh')), /meta_refresh_form_contexts mudou desde a auditoria/); await db.exec('ROLLBACK'); await db.exec(defRefresh)
const pre7 = await db.exec(generated('refresh-preflight').replaceAll(PROD7, mdR)).then(() => '', e => e.message); await db.exec('ROLLBACK')
assert.match(pre7, /PREFLIGHT_OK contextos_atualizados_agora=(\d+) de (\d+) contextos do formulario/); assert(Number(pre7.match(/agora=(\d+)/)[1]) >= 1, 'o ensaio ve o que atualizaria')
assert(!(await metaCtx(MO3))[0].content.includes('Anúncio MO3'), 'o ensaio nao grava')
await db.exec(generated('refresh').replaceAll(PROD7, mdR))
const ctx7a = (await metaCtx(MO3))[0].content
assert(ctx7a.includes('Anúncio\n→ Anúncio MO3') && ctx7a.includes('Plataforma\n→ Facebook') && inOrder(ctx7a) && ctx7a.includes('Quem está preenchendo este formulário?\n→ Sou o atleta (jogador)'), 'dados do anuncio entram no contexto')
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 0, 'idempotente')
// Mais dados chegam depois, de novo: continua atualizando (o estado anterior nao precisa ser reconhecido por texto fixo)
await storeRaw('form:fo3', { id: 'form:fo3', campo_tardio: 'chegou depois' })
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 1)
const ctx7b = (await metaCtx(MO3))[0].content
assert(ctx7b.includes('Campo tardio\n→ chegou depois') && ctx7b.includes('Anúncio\n→ Anúncio MO3'), 'nada do que ja chegou se perde')
// Lead do site: o texto do site que vem ANTES do bloco nao e tocado.
const siteCtxBefore = (await metaCtx(crmO1))[0].content, cut = siteCtxBefore.lastIndexOf('Respostas do formulário Meta')
await q('select public.meta_lead_raw_store($1,$2,$3,$4::jsonb,$5)', ['form:fo1', 'p', 'f', JSON.stringify({ id: 'form:fo1', ad_name: 'Anúncio do site' }), 'id,ad_name'])
assert.equal((await q('select public.meta_refresh_form_contexts() n'))[0].n, 1)
const siteCtxAfter = (await metaCtx(crmO1))[0].content
assert(siteCtxAfter.startsWith(siteCtxBefore.slice(0, cut)) && siteCtxAfter.includes('Anúncio\n→ Anúncio do site') && inOrder(siteCtxAfter) && siteCtxAfter.includes('Ligado ao envio do site de'))
// Seguranca: bloco de OUTRO formulario e texto sem bloco nunca sao tocados.
assert.equal((await metaCtx(MOX))[0].content, blockOfFO3, 'bloco de outro formulario nao e reescrito')
assert.equal((await metaCtx(MO4))[0].content, 'Texto que o SDR já tinha')
for (const c of [ctx7b, siteCtxAfter]) assert(c.length < 50000)

// ---------- aquecimento (frio / morno / quente) ----------
const answersOf = (o = {}) => {
  const v = { who: 'sou_o_atleta', linked: 'não', evals: 'sim', opp: 'sim,_convite_ou_proposta', goal: 'tornar-se_jogador_profissional', block: 'falta_de_oportunidades',
    clubs: 'Santos e Palmeiras', judged: 'Fui aprovado na peneira do Santos mas faltou vaga', traits: 'Velocidade, finalização e muita determinação dentro de campo', commit: '10', phone: '+5511948173104', ...o }
  return [['quem_está_preenchendo_este_formulário?', v.who], ['atualmente,_o_atleta_está_vinculado_a_algum_clube?', v.linked],
    ['o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?', v.evals], ['o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?', v.opp],
    ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', v.goal], ['o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?', v.block],
    ['quais_são_os_principais_clubes_que_o_atleta_já_representou?', v.clubs], ['quais_clubes_avaliou_e_qual_foi_o_resultado?', v.judged],
    ['quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?', v.traits],
    ['de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10', v.commit]].map(([name, value]) => ({ name, values: [value] }))
    .concat(v.phone === null ? [] : [{ name: 'phone_number', values: [v.phone] }])
}
const classify = async fields => (await q('select * from public.meta_form_temperature($1::jsonb)', [JSON.stringify(fields)]))[0]
const hot = await classify(answersOf())
assert.equal(hot.temperature, 'quente')
assert.equal(hot.reasons, 'Quente: DDD 11 (fora do Norte e do Nordeste); compromisso 10/10; objetivo: “Tornar-se jogador profissional”; impedimento: “Falta de oportunidades”; sinais de movimento: já participou de avaliações ou peneiras, já recebeu convite ou proposta, respostas detalhadas sobre clubes e características.')
for (const [label, override, expected] of [
  ['só 1 sinal de movimento não basta para quente', { opp: 'não', clubs: 'nenhum', judged: 'nenhum', traits: 'curto' }, 'morno'],
  ['nota 9 com 2 sinais é quente', { commit: '9', judged: 'nenhum', traits: 'curto', clubs: 'nenhum' }, 'quente'],
  ['nota 8/10 é morno', { commit: '8/10' }, 'morno'],
  ['nota escrita no meio do texto', { commit: 'Acho que us 8/10' }, 'morno'],
  ['nota 4 com DDD desconhecido é frio', { commit: '4', phone: null }, 'frio'],
  ['nota 4 fora do Norte/Nordeste vira morno (piso)', { commit: '4' }, 'morno'],
  ['nota ilegível nunca chega a quente', { commit: '19' }, 'morno'],
  ['"Muitos" descreve compromisso alto sem nota', { commit: 'Muitos' }, 'morno'],
  ['"pouco" com DDD desconhecido é frio', { commit: 'pouco', phone: null }, 'frio'],
  ['quem só quer evoluir fisicamente, DDD desconhecido, é frio', { goal: 'evoluir_e_se_preparar_melhor_como_atleta', block: 'preciso_evoluir_fisicamente', phone: null }, 'frio'],
  ['quem só quer evoluir fisicamente, fora do Norte/Nordeste, é morno', { goal: 'evoluir_e_se_preparar_melhor_como_atleta', block: 'preciso_evoluir_fisicamente' }, 'morno'],
  ['Nordeste (PE) é sempre frio, mesmo com tudo certo', { phone: '+5581988887777' }, 'frio'],
  ['Nordeste (BA) escrito com parênteses', { phone: '(71) 98888-7777' }, 'frio'],
  ['Norte (AM) é frio', { phone: '+5592988887777' }, 'frio'],
  ['Norte (TO) é frio', { phone: '63988887777' }, 'frio'],
  ['Centro-Oeste (DF) com tudo certo é quente', { phone: '+5561988887777' }, 'quente'],
  ['Goiás escrito +DD9… (sem o 55) não é estrangeiro', { phone: '+62983319848' }, 'quente'],
  ['Nordeste escrito +DD9… (sem o 55) é frio', { phone: '+81988887777' }, 'frio'],
  ['zero na frente do DDD', { phone: '011988887777' }, 'quente'],
  ['número estrangeiro (Portugal) não tem DDD: vale a resposta', { phone: '+351912345678' }, 'quente'],
  ['telefone sem DDD: vale a resposta', { phone: '982405584' }, 'quente'],
  ['sem telefone no formulário: vale a resposta', { phone: null }, 'quente'],
  ['pai ou mãe preenchendo continua classificado', { who: 'sou_pai/mãe_ou_responsável' }, 'quente'],
]) assert.equal((await classify(answersOf(override))).temperature, expected, label)
assert.match((await classify(answersOf({ phone: '+5571988887777' }))).reasons, /^Frio: DDD 71 \(Nordeste\), longe do local de atendimento; pelas respostas seria Quente; compromisso 10\/10;/)
assert.match((await classify(answersOf({ commit: '4' }))).reasons, /^Morno: DDD 11 \(fora do Norte e do Nordeste\); as respostas sozinhas indicariam Frio, mas aqui o mínimo é Morno; descreve|^Morno: DDD 11 \(fora do Norte e do Nordeste\); as respostas sozinhas indicariam Frio, mas aqui o mínimo é Morno; compromisso 4\/10/)
assert.match((await classify(answersOf({ phone: '982405584' }))).reasons, /^Quente: DDD não identificado no telefone informado; compromisso 10\/10;/)
for (const [phone, ddd, region] of [['+5511948173104', '11', 'Demais regiões'], ['5581989730863', '81', 'Nordeste'], ['71 98356-5093', '71', 'Nordeste'], ['(92) 99999-8888', '92', 'Norte'],
  ['+62983319848', '62', 'Demais regiões'], ['011 98888-7777', '11', 'Demais regiões'], ['2133334444', '21', 'Demais regiões'], ['+5563991227924', '63', 'Norte']])
  assert.deepEqual((await q('select * from public.meta_ddd_info($1)', [phone]))[0], { ddd, region }, phone)
for (const phone of ['982405584', '+351912345678', '+13055551234', '12345', '', '+5500988887777', '(00) 98888-7777', null])
  assert.equal((await q('select * from public.meta_ddd_info($1)', [phone])).length, 0, 'DDD nao identificado: ' + phone)
assert.match((await classify(answersOf({ commit: '19' }))).reasons, /nota de compromisso não informada de forma legível/)
assert.match((await classify(answersOf({ commit: 'Muitos' }))).reasons, /descreve compromisso alto, sem dar nota/)
assert.match((await classify(answersOf({ goal: 'evoluir_e_se_preparar_melhor_como_atleta', block: 'preciso_evoluir_fisicamente' }))).reasons, /\(pouco ligado a entrar em clube\).*\(menos ligado à entrada em clubes\)/)
// Planilha importada (perguntas e opcoes por extenso) tambem e entendida.
const sheet = answersOf().map(({ name, values }) => ({ name: name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), values: [values[0].replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())] }))
assert.equal((await classify(sheet)).temperature, 'quente')
// Lead de teste da Meta, formulario desconhecido ou dado invalido: nunca classificam.
assert.equal(await classify([{ name: 'quem_está_preenchendo_este_formulário?', values: ['<test lead: dummy data for quem_está_preenchendo_este_formulário?>'] }, ...answersOf()]), undefined)
assert.equal(await classify([{ name: 'idade', values: ['17'] }, { name: 'posicao', values: ['ala'] }]), undefined)
assert.equal((await q(`select count(*) n from public.meta_form_temperature('{}'::jsonb)`))[0].n, 0)

// Lead novo (aprovacao) ja nasce com o aquecimento e com o motivo.
const FH = await form('fh', { name: 'Hot Lead', phone: '+5511900002222', ad: 'ADH', at: '2026-10-11T14:00:00Z', approved: true, commitment: '10' })
assert.equal((await sync(FH)).ok, true); const crmH = await crmOf(FH)
assert.equal(await temperatureOf(crmH), 'quente'); const hH = await hintOf(crmH)
assert(hH.applied && hH.reasons.startsWith('Quente: DDD 11 (fora do Norte e do Nordeste); compromisso 10/10') && hH.temperature === 'quente')
assert.equal(await temperatureOf(await crmOf(F10)), 'morno', 'nota 8 = morno')
assert.equal(await temperatureOf(crm6), 'morno', 'lead nascido do site ja usa o formulario ligado'); assert.equal((await hintOf(crm6)).applied, true)
assert.equal(await temperatureOf(crm7), 'frio', 'DDD 71 (Nordeste) nasce frio'); assert.match((await hintOf(crm7)).reasons, /^Frio: DDD 71 \(Nordeste\)/)
// Lead que ja estava no CRM: so marca quem ninguem abordou; o ja trabalhado recebe apenas a sugestao.
assert.deepEqual([await temperatureOf(crm1), await temperatureOf(crm2), await temperatureOf(crm3)], ['morno', 'morno', 'morno'])
assert.equal((await hintOf(crm1)).applied, true)
assert.equal(await temperatureOf(crm8), 'frio', 'lead que o SDR ja abordou nao e alterado'); const h8 = await hintOf(crm8)
assert.deepEqual([h8.temperature, h8.applied], ['morno', false]); assert(h8.reasons.startsWith('Morno:'))
assert.equal(await hintOf(crm5), undefined, 'sem formulario ligado nao ha sugestao')
// O aquecimento e do SDR: se ele muda, nada o refaz (nem anexar de novo, nem rodar o vinculo).
await db.query(`update public.crm_leads set temperature='quente' where id=$1`, [crm1])
assert.equal((await q(`select public.meta_attach_form_answers($1,$2,$3,$4) r`, [crm1, F1, APROVADOR, S1]))[0].r, 'igual')
await link(true); assert.equal(await temperatureOf(crm1), 'quente', 'escolha do SDR preservada')
assert.equal((await q(`select public.meta_apply_form_temperature($1,$2,$3) r`, [crm1, F1, APROVADOR]))[0].r, 'ja_sugerida')
// O vinculo em lote roda sem usuario: a identidade usada na alteracao nao pode vazar para a sessao.
const F14 = await form('f14', { name: 'Marcos Vinicius', phone: '+5511900001414', ad: 'AD14', at: '2026-10-12T10:00:00Z' })
const S14 = await site('s14', { name: 'Marcos Vinicius', phone: '11900001414', ad: 'AD14', at: '2026-10-12T10:01:00Z', approved: true })
assert.equal((await sync(S14)).ok, true); const crm14 = await crmOf(S14)
await asUser(''); await q('select * from public.meta_link_site_answers(true)')
assert.equal((await q(`select current_setting('request.jwt.claim.sub',true) c`))[0].c, '', 'a sessao volta ao estado anterior'); await asUser(ATOR)
assert.equal(await temperatureOf(crm14), 'morno')
// A classificacao nunca impede a criacao do lead.
await db.exec(`alter function public.meta_form_temperature(jsonb) rename to meta_form_temperature_ok;
 create function public.meta_form_temperature(p jsonb) returns table(temperature text,reasons text) language plpgsql as $$ begin raise exception 'falha simulada'; end $$;`)
const FS = await form('fs', { name: 'Falha Simulada', phone: '+5511900001515', ad: 'AD15', at: '2026-10-12T11:00:00Z', approved: true })
assert.equal((await sync(FS)).ok, true); const crmS = await crmOf(FS)
assert.equal(await temperatureOf(crmS), 'frio'); assert.equal(await hintOf(crmS), undefined)
await db.exec(`drop function public.meta_form_temperature(jsonb); alter function public.meta_form_temperature_ok(jsonb) rename to meta_form_temperature;`)
// Conferencia para a gestao e leitura pelo app.
assert((await q('select count(*) n from public.meta_temperature_preview()'))[0].n > 5)
await db.exec('set role authenticated')
assert.equal((await q('select * from public.crm_lead_temperature_hint($1)', [crmH])).length, 1)
await assert.rejects(db.query('select * from public.meta_temperature_preview()'), /permission denied/)
await assert.rejects(db.query('select * from public.meta_form_temperature($1::jsonb)', ['[]']), /permission denied/)
await assert.rejects(db.query('select public.meta_apply_form_temperature($1,$2,$3)', [crmH, FH, ATOR]), /permission denied/)
await assert.rejects(db.query(`insert into public.crm_lead_temperature_hints(lead_id,temperature,reasons,rule_version) values($1,'quente','x',1)`, [crmH]), /permission denied/)
await db.exec('reset role; set role anon')
await assert.rejects(db.query('select * from public.crm_lead_temperature_hint($1)', [crmH]), /permission denied/)
await db.exec('reset role')

// ---------- travas ----------
await assert.rejects(db.query(`update public.meta_form_leads set answers_form_lead_id=$1,answers_linked_at=now() where id=$2`, [F1, S9]), /unique|duplicate/i, 'dois sites nao compartilham o mesmo formulario')
await assert.rejects(db.query(`update public.meta_form_leads set answers_form_lead_id=$1,answers_linked_at=now() where id=$2`, [F1, F2]), /meta_form_leads_answers_link_chk/, 'so registros do site apontam para formulario')
await db.exec('set role authenticated')
await assert.rejects(db.query('select * from public.meta_link_site_answers(true)'), /permission denied/)
await assert.rejects(db.query('select * from public.meta_manual_crm_twins()'), /permission denied/)
await assert.rejects(db.query('select public.meta_attach_form_answers($1,$2,$3)', [crm1, F1, APROVADOR]), /permission denied/)
await db.exec('reset role; set role anon')
await assert.rejects(db.query('select * from public.meta_link_site_answers(false)'), /permission denied/)
await db.exec('reset role')

// Leads criados a mao com o mesmo WhatsApp e primeiro nome: so aviso (nada e alterado).
await db.query(`insert into public.crm_leads(id,name,phone) values($1,'Rafael Lima da Silva','(71) 90000-0007')`, [U(3001)])
const F12 = await form('f12', { name: 'Rafael Souza', phone: '+5571900000007', ad: 'AD12', at: '2026-10-11T12:00:00Z' })
const twins = await q('select * from public.meta_manual_crm_twins()')
assert(twins.some(t => t.crm_lead_id === U(3001) && t.form_id === F12), 'aviso de lead manual com formulario do mesmo WhatsApp e 1o nome')
assert.equal((await ctx(U(3001))).length, 0, 'aviso nao altera o lead manual')

// Agendamento automatico (fica para o final: so liga depois da simulacao).
await assert.rejects(db.exec(generated('cron-preflight')), /PREFLIGHT_OK agendamento valido: 1 job/); await db.exec('ROLLBACK')
assert.equal((await q(`select count(*) n from cron.job where jobname='meta-site-form-link'`))[0].n, 0, 'o ensaio do agendamento nao deixa job')
await db.exec(generated('cron'))
await db.exec(generated('cron').replaceAll('20261015021600', '20261015021601')) // segunda execucao (outra versao): continua um unico job
const jobs = await q(`select jobname,schedule,command from cron.job where jobname='meta-site-form-link'`)
assert.deepEqual(jobs, [{ jobname: 'meta-site-form-link', schedule: '*/5 * * * *', command: 'SELECT public.meta_link_site_answers(true)' }], 'um unico job, mesmo se o script rodar de novo')
console.log('PASS: aquecimento frio/morno/quente pelas respostas (borda, lead novo, lead antigo so se intocado, escolha do SDR preservada, falha nao bloqueia) + vinculo site<->formulario (anuncio+horario+nome / telefone), contexto completo no lead do CRM, aprovacao sem duplicar, indicador, falha visivel, idempotencia e permissoes')
await db.close()
