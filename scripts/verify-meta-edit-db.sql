-- Exercise real edit RPCs and permissions. No fixture survives this transaction.
BEGIN;
SET LOCAL statement_timeout='90s';
DO $$
DECLARE
  manager uuid; other_user uuid; b public.meta_lead_import_batches; mb public.meta_import_batches;
  f public.meta_form_leads; d public.meta_traffic_daily; snapshot jsonb; response jsonb;
  item jsonb; metric jsonb; crm_before jsonb; run_id uuid; auto_id uuid; audit_count integer; current_version bigint; prefix text:='qa-edit-'||gen_random_uuid();
BEGIN
  IF to_regprocedure('public.meta_edit_form_lead(uuid,timestamp with time zone,bigint,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: audited editing is not implemented';
  END IF;
  SELECT user_id INTO STRICT manager FROM public.profiles WHERE NOT suspended AND public.is_executive(user_id) LIMIT 1;
  SELECT p.user_id INTO STRICT other_user FROM public.profiles p WHERE NOT suspended AND user_id<>manager
    AND EXISTS(SELECT 1 FROM public.registration_requests r WHERE r.user_id=p.user_id AND r.status='approved') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM public.user_roles WHERE user_id=other_user;
  INSERT INTO public.user_roles(user_id,role) VALUES(other_user,'traffic_manager');
  PERFORM set_config('request.jwt.claim.sub',other_user::text,true);
  item:=jsonb_build_object('meta_lead_id',prefix,'created_time','2026-09-20T17:30:00Z',
    'full_name','Responsável QA','phone','11999990000','email','qa@example.invalid',
    'athlete_name','Atleta QA','athlete_birth_date','2010-03-15','athlete_position','Meia',
    'field_data','[{"name":"Motivação","values":["Original"]}]'::jsonb,'raw_notes','Motivação: Original');
  response:=public.meta_import_leads('qa-edit.csv',jsonb_build_array(item));
  SELECT * INTO b FROM public.meta_lead_import_batches WHERE id=(response->>'batch_id')::uuid;
  PERFORM public.meta_edit_import_row('leads',b.id,0,b.updated_at,'{"full_name":"Nome corrigido"}','Corrigir nome informado');
  SELECT * INTO b FROM public.meta_lead_import_batches WHERE id=b.id;
  IF b.rows->0->>'full_name'<>'Nome corrigido' OR b.status<>'pendente' OR b.rows->0->'field_data'<>item->'field_data' THEN
    RAISE EXCEPTION 'FAIL: pending edit changed original answers or approval'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=b.id AND action='batch.row_edited'
    AND actor_id=other_user AND summary->>'reason'='Corrigir nome informado'
    AND summary->'changes' @> '[{"field":"full_name","before":"Responsável QA","after":"Nome corrigido"}]') THEN
    RAISE EXCEPTION 'FAIL: pending edit lacks before/after audit'; END IF;
  b:=public.meta_review_lead_import(b.id,'aprovar',b.updated_at);
  SELECT * INTO STRICT f FROM public.meta_form_leads WHERE meta_lead_id=prefix;
  SELECT to_jsonb(c) INTO crm_before FROM public.crm_leads c WHERE id=f.crm_lead_id;
  snapshot:=public.meta_get_traffic_lead(f.id);
  PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,
    '{"full_name":"Responsável atualizado","phone":"11999998888","city_state":"São Paulo/SP"}','Correção após aprovação');
  IF (SELECT name FROM public.crm_leads WHERE id=f.crm_lead_id)<>'Responsável atualizado'
    OR (SELECT phone FROM public.crm_leads WHERE id=f.crm_lead_id)<>'11999998888'
    OR (SELECT city_state FROM public.crm_leads WHERE id=f.crm_lead_id)<>'São Paulo/SP'
    OR (SELECT pipeline_stage FROM public.crm_leads WHERE id=f.crm_lead_id) IS DISTINCT FROM crm_before->>'pipeline_stage'
    OR (SELECT sdr_id::text FROM public.crm_leads WHERE id=f.crm_lead_id) IS DISTINCT FROM crm_before->>'sdr_id' THEN
    RAISE EXCEPTION 'FAIL: approved edit not synchronized or changed SDR work'; END IF;
  BEGIN
    PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,'{"phone":"11888888888"}','Prévia desatualizada');
    RAISE EXCEPTION 'FAIL: stale lead edit accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  SELECT * INTO f FROM public.meta_form_leads WHERE id=f.id;
  snapshot:=public.meta_get_traffic_lead(f.id);
  BEGIN
    PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,'{"crm_lead_id":null}','Campo protegido');
    RAISE EXCEPTION 'FAIL: internal linkage editable';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,'{"phone":"11888888888"}','');
    RAISE EXCEPTION 'FAIL: reasonless edit accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  -- Editing provenance does not touch a linked CRM version or SDR observations.
  SELECT version INTO current_version FROM public.crm_leads WHERE id=f.crm_lead_id;
  PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,'{"campaign_name":"Campanha corrigida"}','Corrigir campanha');
  IF (SELECT version FROM public.crm_leads WHERE id=f.crm_lead_id)<>current_version
    OR (SELECT observations FROM public.crm_leads WHERE id=f.crm_lead_id) IS DISTINCT FROM crm_before->>'observations'
    OR (SELECT source_snapshot->>'full_name' FROM public.meta_form_leads WHERE id=f.id)<>'Nome corrigido' THEN
    RAISE EXCEPTION 'FAIL: metadata edit touched CRM or lost original source'; END IF;
  SELECT * INTO f FROM public.meta_form_leads WHERE id=f.id;
  snapshot:=public.meta_get_traffic_lead(f.id);
  -- Explicit observations editing is audited and synchronized in full.
  PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,'{"raw_notes":"Observações corrigidas pelo Gestor"}','Corrigir observações');
  IF (SELECT observations FROM public.crm_leads WHERE id=f.crm_lead_id)<>'Observações corrigidas pelo Gestor'
    OR NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=f.id AND action='lead.edited'
      AND summary->'changes' @> '[{"field":"raw_notes","after":"Observações corrigidas pelo Gestor"}]') THEN
    RAISE EXCEPTION 'FAIL: explicit notes edit not synchronized/audited'; END IF;
  SELECT * INTO f FROM public.meta_form_leads WHERE id=f.id;
  snapshot:=public.meta_get_traffic_lead(f.id);
  -- Concurrent SDR update must not be overwritten, even when form version is unchanged.
  UPDATE public.crm_leads SET city_state='Cidade do SDR',updated_at=clock_timestamp() WHERE id=f.crm_lead_id;
  PERFORM set_config('request.jwt.claim.sub',other_user::text,true);
  BEGIN
    PERFORM public.meta_edit_form_lead(f.id,f.updated_at,(snapshot->>'crm_version')::bigint,'{"phone":"11888888888"}','Conflito com SDR');
    RAISE EXCEPTION 'FAIL: concurrent CRM edit overwritten';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  -- A repeated pending webhook cannot overwrite a manager correction.
  auto_id:=public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-auto','page_id','page','form_id','form'));
  snapshot:=public.meta_get_traffic_lead(auto_id);
  PERFORM public.meta_edit_form_lead(auto_id,(snapshot->>'updated_at')::timestamptz,NULL,'{"full_name":"Webhook corrigido"}','Corrigir webhook');
  PERFORM public.meta_ingest_form_lead(item||jsonb_build_object('meta_lead_id',prefix||'-auto','page_id','page','form_id','form'));
  IF (SELECT full_name FROM public.meta_form_leads WHERE id=auto_id)<>'Webhook corrigido'
    OR (SELECT approval_status FROM public.meta_form_leads WHERE id=auto_id)<>'pendente' THEN
    RAISE EXCEPTION 'FAIL: webhook overwrote manually edited pending lead'; END IF;
  -- Historical corrections retain approval and do not republish.
  PERFORM public.meta_edit_import_row('leads',b.id,0,b.updated_at,'{"full_name":"Correção do histórico"}','Corrigir histórico');
  IF (SELECT status FROM public.meta_lead_import_batches WHERE id=b.id)<>'aprovado'
    OR (SELECT name FROM public.crm_leads WHERE id=f.crm_lead_id)<>'Responsável atualizado' THEN
    RAISE EXCEPTION 'FAIL: history edit changed approval or republished CRM'; END IF;
  metric:=jsonb_build_object('date','2026-09-20','level','campaign','account_id',prefix,'campaign_id','campaign',
    'campaign_name','Campanha QA','currency','BRL','spend',10,'leads',2,'purchases',0);
  response:=public.meta_import_daily('qa-metrics.csv',jsonb_build_array(metric));
  SELECT * INTO mb FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
  PERFORM public.meta_edit_import_row('metrics',mb.id,0,mb.updated_at,'{"spend":12.5}','Corrigir gasto exportado');
  SELECT * INTO mb FROM public.meta_import_batches WHERE id=mb.id;
  mb:=public.meta_review_traffic_import(mb.id,'aprovar',mb.updated_at);
  SELECT * INTO STRICT d FROM public.meta_traffic_daily WHERE account_id=prefix;
  IF NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=d.id AND action='metric.published' AND summary->'changes' @> '[{"field":"spend","after":12.5}]') THEN RAISE EXCEPTION 'FAIL: published values not audited'; END IF;
  IF d.spend<>12.5 THEN RAISE EXCEPTION 'FAIL: approval ignored metric correction'; END IF;
  PERFORM public.meta_edit_traffic_row(d.id,d.updated_at,'{"spend":15,"leads":3,"date":"2026-09-21"}','Atualização aprovada');
  IF NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE id=d.id AND spend=15 AND leads=3 AND date='2026-09-21')
    OR NOT EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=d.id AND action='metric.edited' AND actor_id=other_user
      AND summary->'changes' @> '[{"field":"spend","before":12.5,"after":15}]') THEN
    RAISE EXCEPTION 'FAIL: published metric edit or audit missing'; END IF;
  SELECT * INTO d FROM public.meta_traffic_daily WHERE id=d.id;
  BEGIN
    PERFORM public.meta_edit_traffic_row(d.id,d.updated_at,'{"leads":-1}','Inválido');
    RAISE EXCEPTION 'FAIL: negative count accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.meta_edit_traffic_row(d.id,NULL,'{"spend":20}','Sem versão');
    RAISE EXCEPTION 'FAIL: NULL version accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  -- Corrected API identity must not cause a duplicate in the next pending capture.
  INSERT INTO public.meta_sync_runs(kind,account_id,triggered_by) VALUES('insights',prefix||'-api','cron') RETURNING id INTO run_id;
  metric:=metric||jsonb_build_object('account_id',prefix||'-api');
  response:=public.meta_import_daily_system(jsonb_build_array(metric),run_id);
  SELECT * INTO mb FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
  PERFORM public.meta_edit_import_row('metrics',mb.id,0,mb.updated_at,'{"spend":35,"date":"2026-09-22"}','Corrigir captura');
  response:=public.meta_import_daily_system(jsonb_build_array(metric||'{"spend":99}'::jsonb),run_id);
  SELECT * INTO mb FROM public.meta_import_batches WHERE id=mb.id;
  IF jsonb_array_length(mb.rows)<>1 OR mb.rows->0->>'spend'<>'35' OR mb.rows->0->>'date'<>'2026-09-22'
    OR mb.rows->0->'traffic_original'->>'spend'<>'10' THEN
    RAISE EXCEPTION 'FAIL: API overwrote corrected pending identity or duplicated its original'; END IF;
  -- If audit insertion fails, the metric update must roll back with it.
  SELECT count(*) INTO audit_count FROM public.meta_audit_events WHERE entity_id=d.id;
  ALTER TABLE public.meta_audit_events ADD CONSTRAINT qa_reject_edit_audit CHECK(action<>'metric.edited') NOT VALID;
  BEGIN
    PERFORM public.meta_edit_traffic_row(d.id,d.updated_at,'{"spend":88}','Teste de atomicidade');
    RAISE EXCEPTION 'FAIL: edit survived audit failure';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ALTER TABLE public.meta_audit_events DROP CONSTRAINT qa_reject_edit_audit;
  IF (SELECT spend FROM public.meta_traffic_daily WHERE id=d.id)<>15
    OR (SELECT count(*) FROM public.meta_audit_events WHERE entity_id=d.id)<>audit_count THEN
    RAISE EXCEPTION 'FAIL: audit failure left partial mutation'; END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  DELETE FROM public.user_roles WHERE user_id=other_user;
  INSERT INTO public.user_roles(user_id,role) VALUES(other_user,'sdr');
  PERFORM set_config('request.jwt.claim.sub',other_user::text,true);
  BEGIN
    PERFORM public.meta_edit_traffic_row(d.id,d.updated_at,'{"spend":20}','SDR sem acesso');
    RAISE EXCEPTION 'FAIL: SDR edited traffic';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_table_privilege('authenticated','public.meta_audit_events','UPDATE')
    OR has_function_privilege('anon','public.meta_edit_traffic_row(uuid,timestamptz,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: audit or RPC grants allow unauthorized editing'; END IF;
  RAISE NOTICE 'PASS: audited pending and approved edits, CRM sync, stale versions, validation and permissions';
END $$;
SELECT 'Audited edits: pending/approved, CRM sync, notes, source retention, repeated capture, conflicts, atomicity, permissions (rollback)' AS verification;
ROLLBACK;
