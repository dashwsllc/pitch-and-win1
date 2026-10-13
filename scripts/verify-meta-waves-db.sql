-- Disposable local baseline; fixtures and every decision are rolled back.
BEGIN;
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION pg_temp.wave_assert(ok boolean,message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
SELECT pg_temp.wave_assert(to_regclass('public.meta_lead_waves') IS NOT NULL,'stable lead waves are not implemented');
SELECT pg_temp.wave_assert(NOT has_function_privilege('authenticated','public.meta_wave_decide(uuid,text,uuid[],jsonb,text)','EXECUTE'),
 'legacy client can bypass member versions');
DO $$
DECLARE actor uuid; prefix text:='qa-wave-'||gen_random_uuid(); lead_id uuid; partial uuid; snapshot jsonb;
  first_wave uuid; n integer; listed jsonb; members jsonb; request_id uuid:=gen_random_uuid(); result jsonb;
BEGIN
  actor:=pg_temp.seed_meta_actor('approved',false,'executive');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  listed:=public.meta_wave_list(NULL,20,0);
  PERFORM pg_temp.wave_assert((listed->>'count')::integer=0,'empty inbox created an empty wave');
  FOR n IN 1..148 LOOP
    lead_id:=public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix||'-'||n,
      'page_id','qa-wave-page','form_id','qa-wave-form','full_name','Synthetic contact',
      'phone','11999990000','created_time',timestamptz '2026-10-12 12:00:00Z'+n*interval '1 second','field_data','[]'::jsonb));
    IF n=1 THEN SELECT wave_id INTO first_wave FROM public.meta_form_leads WHERE id=lead_id; END IF;
    IF n IN(1,19,20,21,148) THEN
      PERFORM pg_temp.wave_assert((SELECT max(count)<=20 FROM(SELECT count(*) FROM public.meta_form_leads WHERE meta_lead_id LIKE prefix||'-%' GROUP BY wave_id)s),'capacity exceeded 20');
      PERFORM pg_temp.wave_assert((SELECT count(*) FROM public.meta_lead_waves)=ceil(n/20.0)::integer,'wave distribution wrong at '||n);
      PERFORM pg_temp.wave_assert((SELECT count(*) FROM public.meta_lead_waves WHERE is_open)<=1,'two intake waves open');
    END IF;
  END LOOP;
  SELECT wave_id INTO partial FROM public.meta_form_leads WHERE id=lead_id;
  snapshot:=public.meta_wave_begin_review(partial);
  PERFORM pg_temp.wave_assert(jsonb_array_length(snapshot->'leads')=8,'partial wave not immediately reviewable');
  PERFORM pg_temp.wave_assert(NOT(snapshot->'wave'->>'is_open')::boolean,'opening review did not seal membership');
  PERFORM pg_temp.wave_assert(public.meta_wave_begin_review(partial)=snapshot,'begin review is not idempotent');
  lead_id:=public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix||'-fresh','page_id','qa-wave-page',
    'form_id','qa-wave-form','full_name','Fresh contact','phone','11999990000','created_time','2026-10-12T14:00:00Z','field_data','[]'::jsonb));
  PERFORM pg_temp.wave_assert((SELECT wave_id<>partial FROM public.meta_form_leads WHERE id=lead_id),'new lead entered an opened review');
  lead_id:=public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix||'-historical','page_id','qa-wave-page',
    'form_id','qa-wave-form','full_name','Historical contact','phone','11999990000','created_time','2026-10-07T14:00:00Z','field_data','[]'::jsonb));
  PERFORM pg_temp.wave_assert((SELECT wave_id=first_wave FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-1'),'historical recovery moved an existing member');
  SELECT jsonb_agg(jsonb_build_object('id',x->>'id','updated_at',x->>'updated_at')) INTO members FROM jsonb_array_elements(snapshot->'leads')x;
  -- A concurrent edit invalidates the complete displayed snapshot.
  UPDATE public.meta_form_leads SET updated_at=clock_timestamp() WHERE id=(snapshot->'leads'->0->>'id')::uuid;
  BEGIN
    PERFORM public.meta_wave_decide_versioned(partial,(snapshot->'wave'->>'version')::bigint,members,'aprovar','[]','',request_id);
    RAISE EXCEPTION 'FAIL: unseen changed lead was approved';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM pg_temp.wave_assert((SELECT bool_and(approval_status='pendente') FROM public.meta_form_leads WHERE wave_id=partial),'stale review changed members');
  snapshot:=public.meta_wave_begin_review(partial);
  SELECT jsonb_agg(jsonb_build_object('id',x->>'id','updated_at',x->>'updated_at')) INTO members FROM jsonb_array_elements(snapshot->'leads')x;
  result:=public.meta_wave_decide_versioned(partial,(snapshot->'wave'->>'version')::bigint,members,'rejeitar','[]','Synthetic rejection',request_id);
  PERFORM pg_temp.wave_assert((result->>'rejected')::integer=8,'whole-wave rejection did not record eight members');
  PERFORM pg_temp.wave_assert(public.meta_wave_decide_versioned(partial,(snapshot->'wave'->>'version')::bigint,members,'rejeitar','[]','Synthetic rejection',request_id)=result,'replay lost recorded result');
  BEGIN
    PERFORM public.meta_wave_decide_versioned(partial,(snapshot->'wave'->>'version')::bigint,members,'aprovar','[]','',request_id);
    RAISE EXCEPTION 'FAIL: replay key changed decision';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM pg_temp.wave_assert((SELECT count(*) FROM public.crm_leads)=0,'rejected members entered CRM');
  PERFORM pg_temp.wave_assert((SELECT count(*) FROM public.meta_form_leads WHERE wave_id=partial)=8,'rejection removed historical membership');
  result:=public.meta_wave_reopen(partial,NULL);
  PERFORM pg_temp.wave_assert((result->>'reopened')::integer=8,'rejected contacts could not be recovered');
  PERFORM pg_temp.wave_assert(EXISTS(SELECT FROM public.meta_lead_waves WHERE id=partial),'reopening deleted the original wave history');
END $$;
ROLLBACK;
