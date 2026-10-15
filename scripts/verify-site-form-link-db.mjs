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
  ['20261013165410_crm_import_integrity.sql', ['crm_preserve_import_origin', 'crm_check_import_phone']],
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
assert.deepEqual((await q(`select version,name,(statements[1] like '%meta_link_site_answers%' or statements[1] like '%meta_form_temperature%') ok from supabase_migrations.schema_migrations order by version`)),
  [{ version: '20261015021500', name: 'site_form_answers_link', ok: true }, { version: '20261015030000', name: 'form_temperature', ok: true }])
await assert.rejects(db.exec(installSql), /ja instalada/); await db.exec('ROLLBACK')

// A funcao de aprovacao so pode diferir da original nos trechos marcados NOVO.
const norm = s => s.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean)
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
const fieldData = (name, phone, commitment = 'Acho que us 8/10') => JSON.stringify([...QUESTIONS.map(([n, v], i) => ({ name: n, values: [i === 10 ? commitment : v] })),
  { name: 'full_name', values: [name] }, { name: 'phone_number', values: [phone] }, { name: 'date_of_birth', values: ['2008-09-06'] }, { name: 'state', values: ['SP'] }])
let seq = 0
async function form(key, { name, phone, ad, at, approved = false, answers = true, commitment }) {
  const id = U(1000 + ++seq)
  await db.query(`insert into public.meta_form_leads(id,meta_lead_id,campaign_name,ad_id,form_name,created_time,field_data,full_name,phone,entry_channel,approval_status,reviewed_by,first_received_at)
   values($1,$2,'FORMULARIO ZYRON TST 04',$3,'FORMULÁRIO ZYRON',$4,$5::jsonb,$6,$7,'form',$8,$9,$4)`,
  [id, 'form:' + key, ad, at, answers ? fieldData(name, phone, commitment) : '[]', name, phone, approved ? 'aprovado' : 'pendente', approved ? APROVADOR : null])
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
assert.equal((await q(`select count(*) n from cron.job`))[0].n, 0, 'o ensaio do agendamento nao deixa job')
await db.exec(generated('cron'))
await db.exec(generated('cron').replaceAll('20261015021600', '20261015021601')) // segunda execucao (outra versao): continua um unico job
const jobs = await q(`select jobname,schedule,command from cron.job`)
assert.deepEqual(jobs, [{ jobname: 'meta-site-form-link', schedule: '*/5 * * * *', command: 'SELECT public.meta_link_site_answers(true)' }], 'um unico job, mesmo se o script rodar de novo')
console.log('PASS: aquecimento frio/morno/quente pelas respostas (borda, lead novo, lead antigo so se intocado, escolha do SDR preservada, falha nao bloqueia) + vinculo site<->formulario (anuncio+horario+nome / telefone), contexto completo no lead do CRM, aprovacao sem duplicar, indicador, falha visivel, idempotencia e permissoes')
await db.close()
