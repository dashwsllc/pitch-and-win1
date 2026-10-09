-- Real database regression checks; every fixture and temporary permission rolls back.
BEGIN;
SET LOCAL statement_timeout = '90s';
DO $$
DECLARE
  executive_id uuid; operator_id uuid; response jsonb; contact jsonb; item jsonb;
  batch public.meta_lead_import_batches; metrics public.meta_import_batches;
  lead public.meta_form_leads; crm_id uuid; run_id uuid; later_run_id uuid; r text; count_visible integer;
  prefix text := 'qa-approval-' || gen_random_uuid()::text;
BEGIN
  SELECT p.user_id INTO STRICT executive_id FROM public.profiles p
    WHERE NOT p.suspended AND public.is_executive(p.user_id) LIMIT 1;
  SELECT p.user_id INTO STRICT operator_id FROM public.profiles p
    WHERE NOT p.suspended AND p.user_id<>executive_id
      AND EXISTS(SELECT 1 FROM public.registration_requests rr WHERE rr.user_id=p.user_id AND rr.status='approved') LIMIT 1;
  contact := '{"name":"Responsável QA","phone":"11999990000","email":"qa@example.invalid","athlete_name":"Atleta QA","athlete_birth_date":"2010-03-15","athlete_position":"Meia"}';
  item := contact || jsonb_build_object('meta_lead_id',prefix||'-manual','full_name','Responsável QA',
    'created_time','2026-09-20T17:30:00Z','source_row',2,'raw_notes','Motivação: Ser profissional',
    'field_data','[{"name":"Motivação","values":["Ser profissional"]}]'::jsonb);
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  response := public.meta_import_leads('qa-approval.csv',jsonb_build_array(item));
  IF response->>'status' IS DISTINCT FROM 'pendente'
    OR EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-manual') THEN
    RAISE EXCEPTION 'FAIL: Executive import bypassed manual approval in Tráfego';
  END IF;
  SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE id=(response->>'batch_id')::uuid;
  -- A stale or missing preview version must never approve a batch.
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'aprovar',NULL);
    RAISE EXCEPTION 'FAIL: NULL version approved a lead batch';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM public.user_roles WHERE user_id=operator_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(operator_id,'sdr');
  PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
    RAISE EXCEPTION 'FAIL: SDR approved an import';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- The same three permitted roles must independently approve, without needing CRM access.
  FOREACH r IN ARRAY ARRAY['traffic_manager','executive','super_admin'] LOOP
    PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM public.user_roles WHERE user_id=operator_id;
    EXECUTE format('INSERT INTO public.user_roles(user_id,role) VALUES($1,%L)',r) USING operator_id;
    PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);
    response := public.meta_import_leads('qa-'||r||'.csv',jsonb_build_array(item||jsonb_build_object('meta_lead_id',prefix||'-'||r)));
    IF response->>'status' IS DISTINCT FROM 'pendente' THEN RAISE EXCEPTION 'FAIL: privileged import auto-approved'; END IF;
    SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE id=(response->>'batch_id')::uuid;
    batch := public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
    IF batch.result->>'crm' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: approval did not synchronize a complete lead'; END IF;
    SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-'||r;
    IF lead.approval_status<>'aprovado' OR lead.reviewed_by<>operator_id OR lead.reviewed_at IS NULL
      OR (SELECT sdr_id FROM public.crm_leads WHERE id=lead.crm_lead_id) IS NOT NULL
      OR (SELECT pipeline_stage FROM public.crm_leads WHERE id=lead.crm_lead_id)<>'novo' THEN
      RAISE EXCEPTION 'FAIL: approval attribution or shared SDR queue is wrong';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=lead.id
      AND actor_id=operator_id AND action='lead.synced') THEN RAISE EXCEPTION 'FAIL: CRM synchronization not audited'; END IF;
  END LOOP;

  -- Rejection stays private, requires a reason, and records the reviewer.
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE filename='qa-approval.csv' AND id=(
    SELECT id FROM public.meta_lead_import_batches WHERE rows->0->>'meta_lead_id'=prefix||'-manual');
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'rejeitar',batch.updated_at,'x');
    RAISE EXCEPTION 'FAIL: rejection accepted an empty reason';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  batch:=public.meta_review_lead_import(batch.id,'rejeitar',batch.updated_at,'Dados recusados pelo gestor');
  IF batch.status<>'rejeitado' OR EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-manual')
    OR NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=batch.id AND action='batch.rejected'
      AND actor_id=executive_id AND summary->>'note'='Dados recusados pelo gestor') THEN
    RAISE EXCEPTION 'FAIL: rejected import published or lost its audited decision'; END IF;
  -- Even a traffic manager cannot approve while suspended.
  PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM public.user_roles WHERE user_id=operator_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(operator_id,'traffic_manager');
  UPDATE public.profiles SET suspended=true WHERE user_id=operator_id;
  PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);
  BEGIN
    PERFORM public.meta_import_leads('suspended.csv',jsonb_build_array(item));
    RAISE EXCEPTION 'FAIL: suspended traffic manager received review access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE public.profiles SET suspended=false WHERE user_id=operator_id;

  -- Webhook reception stays private to Tráfego until explicit review.
  PERFORM set_config('request.jwt.claim.sub','',true);
  crm_id := public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-auto',
    'page_id','qa-page','form_id','qa-form'));
  SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE id=crm_id;
  PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM public.user_roles WHERE user_id=operator_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(operator_id,'sdr');
  PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO count_visible FROM public.meta_form_leads WHERE id=lead.id;
  RESET ROLE;
  IF count_visible<>0 THEN RAISE EXCEPTION 'FAIL: SDR saw an unapproved automatic lead'; END IF;
  BEGIN
    PERFORM public.meta_promote_form_lead(lead.id,contact);
    RAISE EXCEPTION 'FAIL: SDR synchronized an unapproved lead';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at);
    RAISE EXCEPTION 'FAIL: SDR approved an automatic lead';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Generic CRM inserts must not provide an alternate approval bypass.
  BEGIN
    INSERT INTO public.crm_leads(name,phone,athlete_name,lead_source,meta_form_lead_id)
      VALUES('QA','11999990000','QA','meta_ads_form',lead.id);
    RAISE EXCEPTION 'FAIL: generic CRM insert bypassed approval';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  response := public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at);
  IF response->>'queued' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: incomplete approved lead was not retained for SDR completion'; END IF;
  PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO count_visible FROM public.meta_form_leads WHERE id=lead.id;
  RESET ROLE;
  IF count_visible<>1 THEN RAISE EXCEPTION 'FAIL: approved lead missing from SDR inbox'; END IF;
  PERFORM public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-auto',
    'page_id','qa-page','form_id','qa-form','full_name','Replaced before completion','field_data','[]'::jsonb));
  IF (SELECT full_name FROM public.meta_form_leads WHERE id=lead.id)<>'Responsável QA' THEN
    RAISE EXCEPTION 'FAIL: redelivery modified an approved incomplete lead'; END IF;
  crm_id := public.meta_promote_form_lead(lead.id,contact);
  IF crm_id IS NULL OR public.meta_promote_form_lead(lead.id,contact)<>crm_id THEN
    RAISE EXCEPTION 'FAIL: SDR completion missing or duplicated CRM lead'; END IF;
  PERFORM public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-auto',
    'page_id','qa-page','form_id','qa-form','full_name','Replaced','field_data','[]'::jsonb));
  IF (SELECT full_name FROM public.meta_form_leads WHERE id=lead.id)<>'Responsável QA' THEN
    RAISE EXCEPTION 'FAIL: redelivery modified reviewed lead'; END IF;

  -- Complete answers from webhook forms route directly to the shared CRM queue.
  PERFORM set_config('request.jwt.claim.sub','',true);
  crm_id := public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-complete-auto',
    'page_id','qa-page','form_id','qa-form','field_data',
    '[{"name":"nome_do_atleta","values":["Atleta QA"]},{"name":"data_de_nascimento","values":["15/03/2010"]},{"name":"posição","values":["meia"]}]'::jsonb));
  SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE id=crm_id;
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  response := public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at);
  IF response->>'crm' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: complete webhook answers did not route into CRM'; END IF;

  -- A collision with a pending API lead must be explicitly reported as unresolved.
  PERFORM set_config('request.jwt.claim.sub','',true);
  crm_id := public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-collision',
    'page_id','qa-page','form_id','qa-form'));
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  response := public.meta_import_leads('collision.csv',jsonb_build_array(item||jsonb_build_object('meta_lead_id',prefix||'-collision')));
  SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE id=(response->>'batch_id')::uuid;
  batch := public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
  IF batch.result->>'failed' IS DISTINCT FROM '1' OR jsonb_array_length(batch.result->'issues')<>1
    OR (SELECT approval_status FROM public.meta_form_leads WHERE id=crm_id)<>'pendente'
    THEN RAISE EXCEPTION 'FAIL: a pending API collision was silently reported as reviewed duplicate'; END IF;

  -- Generic CRM inserts must atomically reconcile an approved form too.
  SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE id=crm_id;
  PERFORM public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at);
  INSERT INTO public.crm_leads(name,phone,email,athlete_name,athlete_birth_date,athlete_position,lead_source,meta_form_lead_id)
    VALUES('QA','11999990000','qa@example.invalid','Atleta QA','2010-03-15','Meia','meta_ads_form',lead.id) RETURNING id INTO crm_id;
  IF (SELECT crm_lead_id FROM public.meta_form_leads WHERE id=lead.id) IS DISTINCT FROM crm_id
    OR public.meta_promote_form_lead(lead.id,contact)<>crm_id THEN RAISE EXCEPTION 'FAIL: generic CRM insert stranded an approved form'; END IF;

  -- API metrics must stage, merge newer captures, invalidate stale review, then publish once.
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO public.meta_sync_runs(kind,account_id,triggered_by) VALUES('insights',prefix,'cron') RETURNING id INTO run_id;
  item := jsonb_build_object('date','2026-09-20','account_id',prefix,'campaign_id',prefix,
    'campaign_name','QA','level','campaign','spend',10,'leads',1,'purchases',0,'currency','BRL');
  response := public.meta_import_daily_system(jsonb_build_array(item,item||jsonb_build_object('date','2026-09-19')),run_id);
  IF response->>'status' IS DISTINCT FROM 'pendente'
    OR EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id=prefix) THEN
    RAISE EXCEPTION 'FAIL: API metrics published without approval'; END IF;
  SELECT * INTO STRICT metrics FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
  UPDATE public.meta_sync_runs SET status='success', finished_at=clock_timestamp() WHERE id=run_id;
  INSERT INTO public.meta_sync_runs(kind,account_id,triggered_by) VALUES('insights',prefix,'cron') RETURNING id INTO later_run_id;
  response := public.meta_import_daily_system(jsonb_build_array(item||'{"spend":20}'::jsonb),later_run_id);
  IF (response->>'batch_id')::uuid<>metrics.id THEN RAISE EXCEPTION 'FAIL: cron filled queue with duplicate pending batches'; END IF;
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  BEGIN
    PERFORM public.meta_review_traffic_import(metrics.id,'aprovar',metrics.updated_at);
    RAISE EXCEPTION 'FAIL: stale API preview approved';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  SELECT * INTO STRICT metrics FROM public.meta_import_batches WHERE id=metrics.id;
  BEGIN
    PERFORM public.meta_review_traffic_import(metrics.id,NULL,metrics.updated_at);
    RAISE EXCEPTION 'FAIL: NULL action reviewed metrics';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  metrics := public.meta_review_traffic_import(metrics.id,'aprovar',metrics.updated_at);
  IF NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id=prefix AND spend=20
    AND date='2026-09-20' AND import_batch_id=metrics.id AND sync_run_id=later_run_id AND source='api') THEN
    RAISE EXCEPTION 'FAIL: approved API metrics missing or lost approval lineage'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id=prefix AND date='2026-09-19'
    AND spend=10 AND sync_run_id=run_id AND import_batch_id=metrics.id) THEN RAISE EXCEPTION 'FAIL: pending merge lost an older row or its sync-run lineage'; END IF;
  IF has_table_privilege('authenticated','public.meta_audit_events','INSERT')
    OR has_table_privilege('authenticated','public.meta_audit_events','UPDATE')
    OR has_function_privilege('authenticated','public.meta_import_daily_system(jsonb,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: browser can forge audit or automatic captures'; END IF;
END $$;
SELECT 'Tráfego approval, SDR isolation, CRM handoff, API staging and audit verified (rollback)' AS verification;
ROLLBACK;
