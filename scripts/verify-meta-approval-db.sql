-- Real database regression checks; every fixture and temporary permission rolls back.
BEGIN;
SET LOCAL statement_timeout = '90s';
DO $$
DECLARE
  executive_id uuid; operator_id uuid; response jsonb; contact jsonb; item jsonb;
  batch public.meta_lead_import_batches; metrics public.meta_import_batches;
  lead public.meta_form_leads; crm_id uuid; run_id uuid; later_run_id uuid; r text; count_visible integer;
  account text:='91001'; prefix text := 'qa-approval-' || gen_random_uuid()::text;
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
  -- A planilha entra nas MESMAS levas dos leads automáticos: nada chega ao CRM antes da aprovação.
  response := public.meta_import_leads('qa-approval.csv',jsonb_build_array(item));
  IF response->>'status' IS DISTINCT FROM 'recebido' OR (response->'result'->>'received')::int<>1
    OR NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-manual' AND approval_status='pendente'
      AND wave_id IS NOT NULL AND crm_lead_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL: manual import must wait for approval inside a Tráfego wave';
  END IF;
  -- Lote antigo ainda pendente (criado antes das levas): versão ausente ou desatualizada nunca o aprova.
  INSERT INTO public.meta_lead_import_batches(imported_by,filename,row_count,status,rows)
    VALUES(executive_id,'legacy-approval.csv',1,'pendente',jsonb_build_array(item||jsonb_build_object('meta_lead_id',prefix||'-legacy'))) RETURNING * INTO batch;
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
  -- Os mesmos três papéis aprovam a leva de forma independente, sem precisar de acesso ao CRM.
  FOREACH r IN ARRAY ARRAY['traffic_manager','executive','super_admin'] LOOP
    PERFORM set_config('request.jwt.claim.sub','',true);
    DELETE FROM public.user_roles WHERE user_id=operator_id;
    EXECUTE format('INSERT INTO public.user_roles(user_id,role) VALUES($1,%L)',r) USING operator_id;
    PERFORM set_config('request.jwt.claim.sub',operator_id::text,true);
    response := public.meta_import_leads('qa-'||r||'.csv',jsonb_build_array(item||jsonb_build_object('meta_lead_id',prefix||'-'||r)));
    IF response->>'status' IS DISTINCT FROM 'recebido' OR EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-'||r AND approval_status<>'pendente') THEN
      RAISE EXCEPTION 'FAIL: privileged import auto-approved'; END IF;
    SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-'||r;
    PERFORM public.meta_wave_decide(lead.wave_id,'aprovar',ARRAY[lead.id]);
    SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE id=lead.id;
    IF lead.crm_sync_status IS DISTINCT FROM 'enviado' THEN RAISE EXCEPTION 'FAIL: approval did not synchronize a complete lead'; END IF;
    IF lead.approval_status<>'aprovado' OR lead.reviewed_by<>operator_id OR lead.reviewed_at IS NULL
      OR (SELECT sdr_id FROM public.crm_leads WHERE id=lead.crm_lead_id) IS NOT NULL
      OR (SELECT pipeline_stage FROM public.crm_leads WHERE id=lead.crm_lead_id)<>'novo'
      OR (SELECT athlete_name FROM public.crm_leads WHERE id=lead.crm_lead_id) IS DISTINCT FROM 'Atleta QA'
      OR (SELECT lead_generated_at FROM public.crm_leads WHERE id=lead.crm_lead_id) IS DISTINCT FROM timestamptz '2026-09-20T17:30:00Z' THEN
      RAISE EXCEPTION 'FAIL: approval attribution, spreadsheet data or generation time is wrong';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=lead.id
      AND actor_id=operator_id AND action='lead.synced') THEN RAISE EXCEPTION 'FAIL: CRM synchronization not audited'; END IF;
  END LOOP;

  -- Rejection stays private, requires a reason, and records the reviewer.
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE filename='legacy-approval.csv' AND status='pendente';
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'rejeitar',batch.updated_at,'x');
    RAISE EXCEPTION 'FAIL: rejection accepted an empty reason';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  batch:=public.meta_review_lead_import(batch.id,'rejeitar',batch.updated_at,'Dados recusados pelo gestor');
  IF batch.status<>'rejeitado' OR EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix||'-legacy')
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
  -- Name and WhatsApp are enough: the SDR completes athlete data inside the CRM.
  IF response->>'crm' IS DISTINCT FROM '1' OR response->>'queued' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'FAIL: approved lead with name and WhatsApp did not reach the CRM'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_form_leads f JOIN public.crm_leads c ON c.id=f.crm_lead_id
    WHERE f.id=lead.id AND f.crm_sync_status='enviado' AND c.sdr_id IS NULL AND c.athlete_name IS NULL
      AND c.lead_generated_at=f.created_time AND c.lead_source='meta_ads_form') THEN
    RAISE EXCEPTION 'FAIL: minimal Meta lead missing from the shared CRM queue with its generation time'; END IF;
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
  -- A WhatsApp below the CRM minimum keeps this approved form unsent (crm_sync_status = 'falhou').
  crm_id := public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-collision',
    'page_id','qa-page','form_id','qa-form','phone','123'));
  PERFORM set_config('request.jwt.claim.sub',executive_id::text,true);
  response := public.meta_import_leads('collision.csv',jsonb_build_array(item||jsonb_build_object('meta_lead_id',prefix||'-collision')));
  IF (response->'result'->>'duplicates')::int<>1 OR (response->'result'->>'received')::int<>0
    OR response->'result'->'issues'->0->>'reason' NOT LIKE 'Lead já recebido e aguardando aprovação na leva #%'
    OR (SELECT approval_status FROM public.meta_form_leads WHERE id=crm_id)<>'pendente'
    THEN RAISE EXCEPTION 'FAIL: a pending API collision was not explained as an already received lead'; END IF;

  -- Generic CRM inserts must atomically reconcile an approved form too.
  SELECT * INTO STRICT lead FROM public.meta_form_leads WHERE id=crm_id;
  PERFORM public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at);
  IF (SELECT crm_sync_status FROM public.meta_form_leads WHERE id=lead.id) IS DISTINCT FROM 'falhou' THEN
    RAISE EXCEPTION 'FAIL: invalid WhatsApp was not reported as a visible CRM sync failure'; END IF;
  INSERT INTO public.crm_leads(name,phone,email,athlete_name,athlete_birth_date,athlete_position,lead_source,meta_form_lead_id)
    VALUES('QA','11999990000','qa@example.invalid','Atleta QA','2010-03-15','Meia','meta_ads_form',lead.id) RETURNING id INTO crm_id;
  IF (SELECT crm_lead_id FROM public.meta_form_leads WHERE id=lead.id) IS DISTINCT FROM crm_id
    OR public.meta_promote_form_lead(lead.id,contact)<>crm_id THEN RAISE EXCEPTION 'FAIL: generic CRM insert stranded an approved form'; END IF;

  -- API metrics must stage, merge newer captures, invalidate stale review, then publish once.
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO public.meta_sync_runs(kind,account_id,triggered_by) VALUES('insights',account,'cron') RETURNING id INTO run_id;
  item := jsonb_build_object('date','2026-09-20','account_id',account,'campaign_id',prefix,
    'campaign_name','QA','level','campaign','spend',10,'leads',1,'purchases',0,'currency','BRL');
  response := public.meta_import_daily_system(jsonb_build_array(item,item||jsonb_build_object('date','2026-09-19')),run_id);
  IF response->>'status' IS DISTINCT FROM 'pendente'
    OR EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id=account) THEN
    RAISE EXCEPTION 'FAIL: API metrics published without approval'; END IF;
  SELECT * INTO STRICT metrics FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
  UPDATE public.meta_sync_runs SET status='success', finished_at=clock_timestamp() WHERE id=run_id;
  INSERT INTO public.meta_sync_runs(kind,account_id,triggered_by) VALUES('insights',account,'cron') RETURNING id INTO later_run_id;
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
  IF NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id=account AND spend=20
    AND date='2026-09-20' AND import_batch_id=metrics.id AND sync_run_id=later_run_id AND source='api') THEN
    RAISE EXCEPTION 'FAIL: approved API metrics missing or lost approval lineage'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id=account AND date='2026-09-19'
    AND spend=10 AND sync_run_id=run_id AND import_batch_id=metrics.id) THEN RAISE EXCEPTION 'FAIL: pending merge lost an older row or its sync-run lineage'; END IF;
  IF has_table_privilege('authenticated','public.meta_audit_events','INSERT')
    OR has_table_privilege('authenticated','public.meta_audit_events','UPDATE')
    OR has_function_privilege('authenticated','public.meta_import_daily_system(jsonb,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: browser can forge audit or automatic captures'; END IF;
END $$;
SELECT 'Tráfego approval, SDR isolation, CRM handoff, API staging and audit verified (rollback)' AS verification;
ROLLBACK;
