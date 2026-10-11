-- Synthetic fixtures only; no commercial users or contacts. All changes roll back.
BEGIN;
DO $$
DECLARE actor uuid:=pg_temp.seed_meta_actor('approved',false,'executive'); sdr uuid:=pg_temp.seed_meta_actor('approved',false,'sdr'); lead public.meta_form_leads; linked uuid; lead_id uuid; item jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 item:=jsonb_build_object('meta_lead_id','qa-inbox-'||gen_random_uuid(),'page_id','qa-page','form_id','qa-form','created_time','2026-10-09T12:00:00Z','full_name','Responsável sintético','phone','11999990000','email','qa@example.invalid','field_data','[{"name":"Objetivo","values":["Resposta original"]}]'::jsonb);
 lead_id:=public.meta_ingest_form_lead(item);
 SELECT * INTO lead FROM public.meta_form_leads WHERE id=lead_id;
 PERFORM pg_temp.assert(lead.approval_status='pendente' AND lead.crm_lead_id IS NULL,'ingestion requires approval');
 PERFORM set_config('request.jwt.claim.sub',sdr::text,true);
 PERFORM pg_temp.expect_error(format('SELECT public.meta_promote_form_lead(%L::uuid,%L::jsonb)',lead.id,'{}'),'42501');
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.assert((SELECT count(*)=0 FROM public.meta_form_leads WHERE id=lead.id),'pending hidden from SDR');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at,'Revisão sintética');
 PERFORM set_config('request.jwt.claim.sub',sdr::text,true);
 linked:=public.meta_promote_form_lead(lead.id,'{"name":"Responsável sintético","phone":"11999990000","email":"qa@example.invalid","athlete_name":"Atleta sintético","athlete_birth_date":"2010-01-01","athlete_position":"Atacante"}');
 PERFORM pg_temp.assert(linked IS NOT NULL,'approved lead promotes to CRM');
 PERFORM pg_temp.assert((SELECT meta_form_lead_id=lead.id FROM public.crm_leads WHERE id=linked),'CRM links the exact original');
 PERFORM pg_temp.assert((SELECT field_data=item->'field_data' FROM public.meta_form_leads WHERE id=lead.id),'original answers preserved');
 PERFORM pg_temp.assert(public.meta_promote_form_lead(lead.id,'{}')=linked,'repeat promotion is idempotent');
END $$;
ROLLBACK;
