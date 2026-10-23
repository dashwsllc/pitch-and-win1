BEGIN;
SET LOCAL statement_timeout='90s';
DO $$
#variable_conflict use_variable
DECLARE id uuid; lead uuid; prefix text:='qa-queue-'||gen_random_uuid();
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 id:=public.meta_webhook_event_receive(prefix,'qa-page','qa-form');
 lead:=public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix,'page_id','qa-page','form_id','qa-form','field_data','[]'::jsonb,'created_time','2026-10-09T12:00:00Z'));
 PERFORM public.meta_webhook_event_complete(id,'processed',NULL,lead);
 PERFORM public.meta_webhook_event_complete(id,'error','late failure');
 PERFORM pg_temp.assert((SELECT status='processed' FROM public.meta_webhook_events WHERE meta_webhook_events.id=id),'old completion downgraded processed event');
 EXECUTE 'RESET ROLE';
END $$;
DO $$
#variable_conflict use_variable
DECLARE id uuid; second uuid; actor uuid; claim public.meta_webhook_events; newer public.meta_webhook_events; row_data jsonb; form_id uuid; crm_id uuid; snapshot jsonb; prefix text:='qa-queue-'||gen_random_uuid(); n int; expected int; delay interval; discovery jsonb; version bigint;
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 id:=public.meta_webhook_event_receive(prefix,'qa-page','qa-form');
 PERFORM public.meta_webhook_event_receive(prefix,'qa-page','qa-form');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_webhook_event_receive(%L,%L,%L)',prefix,'wrong-page','qa-form'),'22023');
 PERFORM pg_temp.assert((SELECT receipt_count=2 AND processing_attempts=0 AND page_id='qa-page' FROM public.meta_webhook_events WHERE meta_webhook_events.id=id),'receipt changed processing or identity');
 UPDATE public.meta_webhook_events SET received_at=clock_timestamp()-interval '7 days' WHERE meta_webhook_events.id=id;
 PERFORM pg_temp.assert((SELECT count(*)=0 FROM public.meta_lead_events_claim(10,60,'{}')),'empty allowlist claimed a lead');
 SELECT * INTO STRICT claim FROM public.meta_lead_events_claim(1,60,ARRAY['qa-page']);
 PERFORM pg_temp.assert(claim.id=id AND claim.processing_attempts=1,'old pending event abandoned');
 PERFORM pg_temp.assert((SELECT count(*)=0 FROM public.meta_lead_events_claim(1,60,ARRAY['qa-page'])),'event claimed twice');
 UPDATE public.meta_webhook_events SET lease_until=clock_timestamp()-interval '1 second' WHERE meta_webhook_events.id=id;
 SELECT * INTO STRICT newer FROM public.meta_lead_events_claim(1,60,ARRAY['qa-page']);
 PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_event_fail(%L,%L,%L,%L)',id,claim.claim_token,'late failure','transient'),'PT409');
 row_data:=jsonb_build_object('meta_lead_id',prefix,'page_id','qa-page','form_id','qa-form','created_time','2026-10-09T12:00:00Z','field_data','[]'::jsonb,'full_name','Original');
 form_id:=public.meta_lead_event_ingest(id,newer.claim_token,row_data);
 PERFORM pg_temp.assert((SELECT status='processed' AND meta_form_lead_id=form_id FROM public.meta_webhook_events WHERE meta_webhook_events.id=id),'ingest and completion separated');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_event_fail(%L,%L,%L,%L)',id,newer.claim_token,'late failure','transient'),'PT409');
 PERFORM public.meta_webhook_event_receive(prefix,'qa-page','qa-form');
 PERFORM pg_temp.assert((SELECT status='processed' AND receipt_count=3 FROM public.meta_webhook_events WHERE meta_webhook_events.id=id),'receipt requeued processed event');
 -- Recover an old uncompleted event whose contact has since been corrected and approved.
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);EXECUTE 'SET LOCAL ROLE authenticated';
 snapshot:=public.meta_get_traffic_lead(form_id);
 snapshot:=public.meta_edit_form_lead(form_id,(snapshot->>'updated_at')::timestamptz,NULL,'{"full_name":"Corrected"}','Correção do responsável');
 PERFORM public.meta_review_form_lead(form_id,'aprovar',(snapshot->>'updated_at')::timestamptz);
 crm_id:=public.meta_promote_form_lead(form_id,'{"name":"Corrected","phone":"11999990000","email":"qa@example.invalid","athlete_name":"Athlete","athlete_birth_date":"2010-03-15","athlete_position":"Meia"}');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','service_role',true);EXECUTE 'SET LOCAL ROLE service_role';
 UPDATE public.meta_webhook_events SET status='error',next_attempt_at=clock_timestamp()-interval '1 second' WHERE meta_webhook_events.id=id;
 SELECT * INTO STRICT claim FROM public.meta_lead_events_claim(1,60,ARRAY['qa-page']);
 PERFORM public.meta_lead_event_ingest(id,claim.claim_token,row_data||'{"full_name":"Automatic replacement"}');
 PERFORM pg_temp.assert((SELECT full_name='Corrected' AND approval_status='aprovado' AND crm_lead_id=crm_id FROM public.meta_form_leads WHERE meta_form_leads.id=form_id),'retry overwrote approved correction or CRM link');
 -- Processing errors roll back the ingest and leave the same owner in control.
 second:=public.meta_webhook_event_receive(prefix||'-invalid','qa-page','qa-form');
 SELECT * INTO STRICT claim FROM public.meta_lead_events_claim(1,60,ARRAY['qa-page']);
 PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_event_ingest(%L,%L,%L::jsonb)',second,claim.claim_token,row_data||jsonb_build_object('meta_lead_id',prefix||'-invalid','created_time','bad')),'22007');
 PERFORM pg_temp.assert((SELECT status='processing' FROM public.meta_webhook_events WHERE meta_webhook_events.id=second),'ingest failure marked complete');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-invalid'),'failed ingest left contact');
 -- Retry schedule counts processing attempts rather than receipt repeats.
 FOR n IN 1..5 LOOP
  IF n>1 THEN UPDATE public.meta_webhook_events SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE meta_webhook_events.id=second;
    SELECT * INTO STRICT claim FROM public.meta_lead_events_claim(1,60,ARRAY['qa-page']); END IF;
  PERFORM public.meta_lead_event_fail(second,claim.claim_token,'synthetic transient failure','transient');
  SELECT next_attempt_at-updated_at INTO delay FROM public.meta_webhook_events WHERE meta_webhook_events.id=second;
  expected:=CASE n WHEN 1 THEN 1 WHEN 2 THEN 5 WHEN 3 THEN 15 ELSE 60 END;
  PERFORM pg_temp.assert(abs(extract(epoch FROM delay)-expected*60)<1,'wrong retry delay');
 END LOOP;
 -- A durable page receipt is required before discovery checkpoints advance.
 discovery:=public.meta_lead_discovery_claim('qa-page');
 version:=(discovery->>'version')::bigint;
 PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_discovery_checkpoint(%L,%L,%s,%L::jsonb)','qa-page',discovery->>'claim_token',version,'{"received_ids":["not-persisted"],"forms_next":{"path":"/qa-page/leadgen_forms","params":{"after":"x"}}}'),'22023');
 version:=public.meta_lead_discovery_checkpoint('qa-page',(discovery->>'claim_token')::uuid,version,jsonb_build_object('received_ids',jsonb_build_array(prefix),'form_id','qa-form',
   'forms_next',jsonb_build_object('path','/qa-page/leadgen_forms','params',jsonb_build_object('after','x'))));
 PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_discovery_checkpoint(%L,%L,%s,%L::jsonb)','qa-page',discovery->>'claim_token',version,
   jsonb_build_object('received_ids','[]'::jsonb,'last_completed_until',discovery->>'window_until')),'22023');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_discovery_checkpoint(%L,%L,%s,%L::jsonb)','qa-page',discovery->>'claim_token',version,'{"forms_next":{"path":"/qa-page/leadgen_forms","params":{"access_token":"secret"}}}'),'22023');
 PERFORM public.meta_lead_discovery_release('qa-page',(discovery->>'claim_token')::uuid);
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error('SELECT public.meta_lead_events_claim(1,60,ARRAY[''qa-page''])','42501');
 PERFORM pg_temp.expect_error('SELECT public.meta_lead_discovery_claim(''qa-page'')','42501');
 EXECUTE 'RESET ROLE';
END $$;
DO $$
DECLARE signature text;
BEGIN
 FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'meta_lead_event%' OR p.proname LIKE 'meta_lead_discovery%') LOOP
  PERFORM pg_temp.assert(NOT has_function_privilege('anon',signature,'EXECUTE'),'anonymous queue access: '||signature);
  PERFORM pg_temp.assert(NOT has_function_privilege('authenticated',signature,'EXECUTE'),'authenticated queue access: '||signature);
 END LOOP;
END $$;
SELECT 'PASS: lead queue ownership, old recovery, replay, atomic ingest, backoff and durable discovery' AS verification;
ROLLBACK;
