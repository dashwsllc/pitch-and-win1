import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '../.verification.local/form-answers/node_modules/@electric-sql/pglite/dist/index.js'
const db = new PGlite()
try {
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.crm_leads(id uuid primary key,meta_form_lead_id uuid,import_snapshot jsonb,visible_to uuid);
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
 insert into public.site_import_events values ('00000000-0000-4000-8000-000000000102','{"payload":{"profile":{"position":"Ala"}}}','context_only',2);`)
 const file=readdirSync('supabase/migrations').find(x=>x.endsWith('_crm_import_context_summary.sql'))
 if(file) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'))
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
 await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000777'`)
 const result=await db.query('select lead_id from public.crm_context_summary() order by lead_id')
 assert.deepEqual(result.rows.map(x=>x.lead_id),['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'])
 const page=await db.query('select lead_id from public.crm_context_summary(1,1)')
 assert.deepEqual(page.rows.map(x=>x.lead_id),['00000000-0000-4000-8000-000000000002'])
 await db.exec('reset role;set role anon')
 await assert.rejects(db.query('select * from public.crm_context_summary()'),/permission denied/)
 console.log('PASS: preserved Meta answers, later site context and SDR notes mark context available; empty/technical-only contexts stay inactive, cross-user RLS and anonymous access preserved')
}finally{await db.close()}
