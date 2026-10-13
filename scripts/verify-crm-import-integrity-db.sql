BEGIN;
SET LOCAL statement_timeout='90s';
DO $$
DECLARE actor uuid; received uuid; snapshot jsonb; members jsonb; outcome jsonb; c public.crm_leads;
  prefix text:='qa-import-integrity-'||gen_random_uuid(); response jsonb; original text:=repeat('Resposta importante <texto> ',200); batch_rows jsonb;
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 response:=public.meta_import_leads('qa-site.csv',jsonb_build_array(jsonb_build_object('meta_lead_id',prefix,
  'entry_channel','website','full_name','Synthetic site contact','phone','11999990001','created_time','2026-10-07T14:32:15Z',
  'field_data',jsonb_build_array(jsonb_build_object('name','Contexto completo','values',jsonb_build_array(original))),
  'time_known',true)));
 PERFORM pg_temp.assert((response->'result'->>'received')::int=1,'manual site lead was not retained');
 SELECT id INTO received FROM public.meta_form_leads WHERE meta_lead_id=prefix;
 snapshot:=public.meta_wave_begin_review((SELECT wave_id FROM public.meta_form_leads WHERE id=received));
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','updated_at',x->>'updated_at')) INTO members FROM jsonb_array_elements(snapshot->'leads')x;
 outcome:=public.meta_wave_decide_versioned((snapshot->'wave'->>'id')::uuid,(snapshot->'wave'->>'version')::bigint,members,'aprovar','[]','',gen_random_uuid());
 SELECT * INTO STRICT c FROM public.crm_leads WHERE meta_form_lead_id=received;
 PERFORM pg_temp.assert(c.import_channel='website' AND c.import_method='manual','manual website origin was misclassified');
 PERFORM pg_temp.assert(c.import_snapshot->'field_data'->0->'values'->>0=original,'CRM truncated original context');
 PERFORM pg_temp.assert(c.lead_generated_at=timestamptz '2026-10-07T14:32:15Z','CRM lost original form timestamp');
 PERFORM pg_temp.assert(c.lead_received_at=(SELECT first_received_at FROM public.meta_form_leads WHERE id=received),'CRM receipt differs from durable lead receipt');
 PERFORM pg_temp.assert(c.sdr_id IS NULL AND NOT c.approached,'import was assigned or counted as approach');
 -- Repeating a synchronization must not change the priority clock or duplicate context.
 PERFORM public.meta_sync_form_lead_to_crm(received,actor);
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.crm_leads WHERE meta_form_lead_id=received),'CRM sync duplicated the imported lead');
 PERFORM pg_temp.assert((SELECT lead_received_at=c.lead_received_at FROM public.crm_leads WHERE id=c.id),'repeat changed receipt timestamp');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.crm_lead_contexts WHERE lead_id=c.id AND context_type='meta_form'),'context was duplicated');
 -- Server entry validation must count digits, rather than arbitrary punctuation.
 response:=public.meta_import_leads('qa-bad-phone.csv',jsonb_build_array(jsonb_build_object('meta_lead_id',prefix||'-bad',
  'full_name','Synthetic invalid phone','phone','(--------)','field_data','[]'::jsonb)));
 SELECT id INTO received FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-bad';
 PERFORM pg_temp.assert(received IS NOT NULL,'invalid contact disappeared instead of remaining correctable');
 snapshot:=public.meta_wave_begin_review((SELECT wave_id FROM public.meta_form_leads WHERE id=received));
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','updated_at',x->>'updated_at')) INTO members FROM jsonb_array_elements(snapshot->'leads')x;
 outcome:=public.meta_wave_decide_versioned((snapshot->'wave'->>'id')::uuid,(snapshot->'wave'->>'version')::bigint,members,'aprovar','[]','',gen_random_uuid());
 PERFORM pg_temp.assert((outcome->>'failed')::int=1,'non-digit phone was sent as a usable contact');
 PERFORM pg_temp.assert((SELECT crm_lead_id IS NULL AND crm_sync_status='falhou' FROM public.meta_form_leads WHERE id=received),'failed member was hidden or lost');
 -- A bad member must not roll back the nineteen usable contacts in the same wave.
 SELECT jsonb_agg(jsonb_build_object('meta_lead_id',prefix||'-partial-'||n,'full_name','Synthetic partial '||n,
   'phone',CASE WHEN n=20 THEN '(--------)' ELSE '11999990001' END,'field_data','[]'::jsonb)) INTO batch_rows FROM generate_series(1,20)n;
 response:=public.meta_import_leads('qa-partial.csv',batch_rows);
 PERFORM pg_temp.assert((response->'result'->>'received')::int=20,'manual intake lost a partial-send member');
 SELECT id INTO received FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-partial-20';
 snapshot:=public.meta_wave_begin_review((SELECT wave_id FROM public.meta_form_leads WHERE id=received));
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','updated_at',x->>'updated_at')) INTO members FROM jsonb_array_elements(snapshot->'leads')x;
 outcome:=public.meta_wave_decide_versioned((snapshot->'wave'->>'id')::uuid,(snapshot->'wave'->>'version')::bigint,members,'aprovar','[]','',gen_random_uuid());
 PERFORM pg_temp.assert((outcome->>'sent')::int=19 AND (outcome->>'failed')::int=1,'one invalid contact prevented nineteen valid deliveries');
 PERFORM pg_temp.assert((SELECT count(*)=20 FROM public.meta_form_leads WHERE meta_lead_id LIKE prefix||'-partial-%'),'partial send removed a source lead');
 PERFORM pg_temp.assert((SELECT count(*)=19 FROM public.crm_leads crm_row JOIN public.meta_form_leads f ON crm_row.meta_form_lead_id=f.id WHERE f.meta_lead_id LIKE prefix||'-partial-%'),'partial send lost or duplicated a CRM contact');
 response:=public.meta_import_leads('qa-date-precision.csv',jsonb_build_array(
  jsonb_build_object('meta_lead_id',prefix||'-undated','full_name','Synthetic undated','phone','11999990001','time_known',false,'source_has_date',false),
  jsonb_build_object('meta_lead_id',prefix||'-date-only','full_name','Synthetic date only','phone','11999990001','created_time','2026-10-07T15:00:00Z','time_known',false,'source_has_date',true)));
 SELECT id INTO received FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-undated';
 snapshot:=public.meta_wave_begin_review((SELECT wave_id FROM public.meta_form_leads WHERE id=received));
 PERFORM pg_temp.assert(EXISTS(SELECT FROM jsonb_array_elements(snapshot->'leads') x WHERE x->>'id'=received::text AND x->>'date_known'='false'),'unknown generation date was not exposed to the wave');
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','updated_at',x->>'updated_at')) INTO members FROM jsonb_array_elements(snapshot->'leads')x;
 outcome:=public.meta_wave_decide_versioned((snapshot->'wave'->>'id')::uuid,(snapshot->'wave'->>'version')::bigint,members,'aprovar','[]','',gen_random_uuid());
 PERFORM pg_temp.assert((SELECT import_snapshot->'import_contact'->>'source_has_date'='false' FROM public.crm_leads WHERE meta_form_lead_id=received),'CRM lost the missing-generation-date flag');
 PERFORM pg_temp.assert((SELECT import_snapshot->'import_contact'->>'source_has_date'='true' FROM public.crm_leads WHERE meta_form_lead_id=(SELECT id FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-date-only')),'CRM lost date-only precision');
END $$;
ROLLBACK;
