import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '../.verification.local/form-answers/node_modules/@electric-sql/pglite/dist/index.js'
const db = new PGlite()
try {
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.crm_leads(id uuid primary key,meta_form_lead_id uuid,import_snapshot jsonb,visible_to uuid,import_channel text);
 create table public.crm_lead_contexts(lead_id uuid,context_type text,content text);
 create table public.site_import_events(meta_form_lead_id uuid,event jsonb,status text,source_revision bigint);
 alter table public.crm_leads enable row level security; alter table public.crm_lead_contexts enable row level security;alter table public.site_import_events enable row level security;
 create policy crm_visible on public.crm_leads for select using(visible_to=auth.uid());
 create policy notes_visible on public.crm_lead_contexts for select using(exists(select from public.crm_leads c where c.id=lead_id));
 create policy site_visible on public.site_import_events for select using(exists(select from public.crm_leads c where c.meta_form_lead_id=site_import_events.meta_form_lead_id));
 grant usage on schema auth to authenticated;grant select on all tables in schema public to authenticated;
 insert into public.crm_leads(id,meta_form_lead_id,import_snapshot,visible_to) values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','{"field_data":[{"name":"Objetivo?","values":["Profissional"]}]}','00000000-0000-4000-8000-000000000777'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102','{"field_data":[]}','00000000-0000-4000-8000-000000000777'),
 ('00000000-0000-4000-8000-000000000003',null,'{}','00000000-0000-4000-8000-000000000777'),
 ('00000000-0000-4000-8000-000000000004',null,'{"field_data":[{"name":"reviewed_by","values":["operator"]}]}','00000000-0000-4000-8000-000000000777'),
 ('00000000-0000-4000-8000-000000000005',null,'{"field_data":[{"name":"Objetivo?","values":["Hidden"]}]}','00000000-0000-4000-8000-000000000888'),
 ('00000000-0000-4000-8000-000000000006',null,'{"field_data":[{"name":"Objetivo?","values":[]}]}','00000000-0000-4000-8000-000000000777');
 insert into public.crm_lead_contexts values ('00000000-0000-4000-8000-000000000003','manual_note','Contexto SDR');
 insert into public.crm_leads values ('00000000-0000-4000-8000-000000000007',null,
 '{"field_data":[{"name":"full_name","values":["Contact only"]},{"name":"phone_number","values":["11999990000"]},{"name":"date_of_birth","values":["2008-01-01"]},{"name":"state","values":["SP"]}]}',
 '00000000-0000-4000-8000-000000000777','form');
 insert into public.crm_lead_contexts values ('00000000-0000-4000-8000-000000000007','manual_note','SDR has a note, but form answers are not synchronized');
 insert into public.site_import_events values ('00000000-0000-4000-8000-000000000102','{"payload":{"profile":{"position":"Ala"}}}','context_only',2);`)
 const file=readdirSync('supabase/migrations').find(x=>x.endsWith('_crm_import_context_summary.sql'))
 if(file) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'))
 const completeFile=readdirSync('supabase/migrations').find(x=>x.endsWith('_crm_form_context_integrity.sql'))
 if(completeFile) await db.exec(readFileSync('supabase/migrations/'+completeFile,'utf8'))
 const available=await db.query(`select to_regprocedure('public.crm_context_summary(integer,integer)') is not null as ok`)
 assert.equal(available.rows[0].ok,true,'CRM summary must include preserved form answers and later site context, not only manual notes')
 const cases=await db.query(`select public.crm_source_context_present('{"source_snapshot":{"site_event":{"payload":{"contact":{"name":"Only contact"},"attribution":{"utm_source":"Meta"}}}}}') as contact_only,
 public.crm_source_context_present('{"field_data":[{"name":"Comprometido?","values":[false,0]}]}') as false_and_zero,
 public.crm_source_context_present('{"source_snapshot":{"field_data":[{"name":"Objetivo?","values":["Original"]}]}}') as original,
 public.crm_source_context_present('{"source_snapshot":{"manual_row":{"raw_cells":[{"header":"Objetivo?","value":"Manual"}]}}}') as manual`)
 assert.deepEqual(cases.rows[0],{contact_only:false,false_and_zero:true,original:true,manual:true})
 const siteCases=await db.query(`select public.crm_source_context_present('{"source_snapshot":{"site_event":{"payload":{"profile":{"id":"technical-id"}}}}}') as technical_only,
 public.crm_source_context_present('{"source_snapshot":{"site_event":{"payload":{"profile":{"notes":"   "}}}}}') as whitespace_only,
 public.crm_source_context_present('{"source_snapshot":{"site_event":{"payload":{"source_record":{"notes":"Completed assessment from source"}}}}}') as source_only,
 public.crm_source_context_present('{"source_snapshot":{"site_event":{"payload":{"source_record":{"name":"Only contact","phone":"11999990000"}}}}}') as source_contact_only`)
 assert.deepEqual(siteCases.rows[0],{technical_only:false,whitespace_only:false,source_only:true,source_contact_only:false})
 const rawCases=await db.query(`select public.crm_form_answers_present('{"source_snapshot":{"manual_row":{"raw_cells":[{"header":"Pergunta adicional","value":[]}]}}}') as empty_choice,
 public.crm_form_answers_present('{"source_snapshot":{"manual_row":{"raw_cells":{"Pergunta adicional":["Resposta 1","Resposta 2"]}}}}') as multiple,
 public.crm_form_answers_present('{"field_data":[{"name":"Comprometido?","values":[false,0]}]}') as false_zero,
 public.crm_form_answers_present('{"field_data":[{"name":"FullName","values":["Contato"]},{"name":"date_of_birth?","values":["2008-01-01"]}]}') as contact_aliases`)
 assert.deepEqual(rawCases.rows[0],{empty_choice:false,multiple:true,false_zero:true,contact_aliases:false})
 const metadataCases=await db.query(`select public.crm_form_answers_present('{"field_data":[{"name":"full_name","values":["Contato"]},{"name":"CreatedTime","values":["Meta"]}]}') as camel_metadata,
 public.crm_form_answers_present('{"field_data":[{"name":"created_time ","values":["Meta"]}]}') as padded_metadata,
 public.crm_form_answers_present('{"field_data":[{"name":"Consentimentos","values":["Meta"]}]}') as consent_only`)
 assert.deepEqual(metadataCases.rows[0],{camel_metadata:false,padded_metadata:false,consent_only:false})
 await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000777'`)
 const result=await db.query('select lead_id from public.crm_context_summary() order by lead_id')
 assert(!result.rows.some(x=>x.lead_id==='00000000-0000-4000-8000-000000000007'),'a contact-only imported form must not turn orange, even with an SDR note')
 assert.deepEqual(result.rows.map(x=>x.lead_id),['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'])
 const page=await db.query('select lead_id from public.crm_context_summary(1,1)')
 assert.deepEqual(page.rows.map(x=>x.lead_id),['00000000-0000-4000-8000-000000000002'])
 await db.exec('reset role;set role anon')
 await assert.rejects(db.query('select * from public.crm_context_summary()'),/permission denied/)
 await db.exec(`reset role;
 create table public.meta_lead_import_batches(id uuid primary key,filename text);
 create table public.meta_form_leads(id uuid primary key,first_received_at timestamptz,created_time timestamptz,
 entry_channel text,lead_import_batch_id uuid,field_data jsonb,source_snapshot jsonb,custom_disclaimer_responses jsonb);
 alter table public.crm_leads add column lead_received_at timestamptz,add column lead_generated_at timestamptz,add column import_method text;
 insert into public.meta_lead_import_batches values ('00000000-0000-4000-8000-000000000999','synthetic.csv');`)
 // Execute the exact production trigger: copying a whitelist or clipped summary must fail this test.
 const originMigration=readFileSync('supabase/migrations/20261013165410_crm_import_integrity.sql','utf8')
 const originTrigger=originMigration.match(/CREATE OR REPLACE FUNCTION public\.crm_preserve_import_origin\(\)[\s\S]*?END \$\$;/)?.[0]
 assert(originTrigger)
 await db.exec(originTrigger+`CREATE TRIGGER import_origin BEFORE INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_preserve_import_origin();`)
 const fullAnswers=[
  ['quem_está_preenchendo_este_formulário?','Sou o atleta'],['atualmente,_o_atleta_está_vinculado_a_algum_clube?','Não'],
  ['o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?','Sim'],['o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?','Não'],
  ['qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?','Tornar-se profissional'],['o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?','Falta de oportunidades'],
  ['qual_é_a_posição_e_a_categoria_atual_do_atleta?','Ala, sub-17'],['quais_são_os_principais_clubes_que_o_atleta_já_representou?','Clube sintético'],
  ['quais_clubes_avaliou_e_qual_foi_o_resultado?','Não aprovado'],
  ['quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?','Texto completo '.repeat(1000)+'FIM'],
  ['de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?','8/10'],
  ['full_name','Synthetic contact'],['phone_number','11999990000'],['date_of_birth','2008-01-01'],['state','SP']
 ].map(([name,value])=>({name,values:[value]}))
 fullAnswers[9].values.push('Outra característica preservada')
 for(const [suffix,method] of [['009','automatic'],['010','manual']]) {
  const formId='00000000-0000-4000-8000-000000000'+suffix
  const batchId=method==='manual'?'00000000-0000-4000-8000-000000000999':null
  const original={field_data:fullAnswers,...(batchId?{manual_row:{raw_cells:[{header:'Pergunta futura',value:'Resposta futura integral'}]}}:{})}
  await db.query(`insert into public.meta_form_leads values ($1,'2026-10-14T14:32:15Z','2026-10-14T14:31:12Z','form',$2,$3,$4,'[{"accepted":true}]')`,[formId,batchId,JSON.stringify(fullAnswers),JSON.stringify(original)])
  await db.query(`insert into public.crm_leads(id,meta_form_lead_id,visible_to) values ($1,$1,'00000000-0000-4000-8000-000000000777')`,[formId])
  const {rows:[saved]}=await db.query('select import_channel,import_method,import_snapshot from public.crm_leads where id=$1',[formId])
  assert.equal(saved.import_channel,'form');assert.equal(saved.import_method,method)
  assert.deepEqual(saved.import_snapshot.field_data,fullAnswers,method+' must synchronize all fifteen original fields, every multi-choice value and the complete long answer')
  assert.deepEqual(saved.import_snapshot.source_snapshot,original,method+' must preserve additional original columns')
  await db.query(`update public.crm_leads set import_snapshot='{}',lead_received_at='2026-01-01' where id=$1`,[formId])
  const {rows:[again]}=await db.query('select import_snapshot,lead_received_at::text as receipt from public.crm_leads where id=$1',[formId])
  assert.deepEqual(again.import_snapshot,saved.import_snapshot,'later CRM edits must not erase a single source answer')
  assert.match(again.receipt,/2026-10-14 14:32:15/)
 }
 await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000777'`)
 const synced=await db.query(`select lead_id from public.crm_context_summary() where lead_id in('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010') order by lead_id`)
 assert.deepEqual(synced.rows.map(x=>x.lead_id),['00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010'],'only synchronized form answers activate the orange indicator; contact fields and notes must not')
 console.log('PASS: preserved Meta answers, later site context and SDR notes mark context available; empty/technical-only contexts stay inactive, cross-user RLS and anonymous access preserved')
 console.log('PASS: the production CRM trigger synchronizes all eleven questions and four contact fields, long and multi-choice answers, manual extras and exact receipt seconds for automatic and manual forms; later edits preserve them')
}finally{await db.close()}
