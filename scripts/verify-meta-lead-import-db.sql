-- Runs only in a transaction. All fixtures, role changes and signals are rolled back.
BEGIN;
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE executive_id uuid; collaborator_id uuid; batch public.meta_lead_import_batches;
  response jsonb; complete_row jsonb; incomplete_row jsonb; invalid_row jsonb;
  prefix text := 'qa-manual-' || gen_random_uuid()::text; lead_id uuid; crm_id uuid;
BEGIN
  SELECT p.user_id INTO STRICT executive_id FROM public.profiles p
    WHERE NOT p.suspended AND public.is_executive(p.user_id) LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', executive_id::text, true);
  complete_row := jsonb_build_object('meta_lead_id', prefix || '-complete', 'created_time', '2026-09-20T17:30:00Z',
    'full_name', 'Responsável QA', 'phone', '11999990000', 'email', 'qa@example.invalid',
    'athlete_name', 'Atleta QA', 'athlete_birth_date', '2010-03-15', 'athlete_position', 'Meia',
    'source_row', 2, 'raw_notes', 'Motivação: Ser profissional',
    'field_data', jsonb_build_array(jsonb_build_object('name','Motivação','values',jsonb_build_array('Ser profissional'))));
  incomplete_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-queue', 'email', '', 'source_row', 3);
  invalid_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-invalid', 'created_time', 'data inválida', 'source_row', 5);
  response := public.meta_import_leads('qa-manual.csv', jsonb_build_array(complete_row, incomplete_row,
    complete_row || jsonb_build_object('source_row',4), invalid_row));
  IF response->>'status' IS DISTINCT FROM 'aprovado' THEN
    RAISE EXCEPTION 'FAIL: Executive import must publish immediately';
  END IF;
  IF response->'result'->>'crm' IS DISTINCT FROM '1'
    OR response->'result'->>'queued' IS DISTINCT FROM '1'
    OR response->'result'->>'duplicates' IS DISTINCT FROM '1'
    OR response->'result'->>'failed' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'FAIL: outcomes must account for CRM, queue, duplicates and failed rows';
  END IF;
  IF jsonb_array_length(response->'result'->'issues') <> 2 THEN RAISE EXCEPTION 'FAIL: missing row explanations'; END IF;
  SELECT id INTO STRICT lead_id FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-queue';
  IF (SELECT import_contact->>'athlete_birth_date' FROM public.meta_form_leads WHERE id=lead_id) IS DISTINCT FROM '2010-03-15'
    THEN RAISE EXCEPTION 'FAIL: incomplete lead lost mapped athlete data'; END IF;
  PERFORM public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix || '-queue',
    'page_id','qa-page','form_id','qa-form','created_time','2026-09-20T17:30:00Z',
    'full_name','Automatic replacement','phone','11000000000','email','automatic@example.invalid',
    'field_data',jsonb_build_array(jsonb_build_object('name','Meta question','values',jsonb_build_array('Meta answer')))));
  IF (SELECT full_name FROM public.meta_form_leads WHERE id=lead_id) IS DISTINCT FROM 'Responsável QA'
    OR NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE id=lead_id
      AND field_data @> '[{"name":"Motivação","values":["Ser profissional"]}]'::jsonb)
    THEN RAISE EXCEPTION 'FAIL: automatic ingestion overwrote manual queued responses'; END IF;
  crm_id := public.meta_promote_form_lead(lead_id, jsonb_build_object('name','Responsável QA','phone','11999990000',
    'email','completado@example.invalid','athlete_name','Atleta QA','athlete_birth_date','2010-03-15','athlete_position','Meia'));
  IF (SELECT observations FROM public.crm_leads WHERE id=crm_id) NOT LIKE '%Motivação: Ser profissional%'
    THEN RAISE EXCEPTION 'FAIL: promotion lost original responses'; END IF;
  response := public.meta_import_leads('renomeado.csv',jsonb_build_array(complete_row));
  IF response->'result'->>'duplicates' IS DISTINCT FROM '1' OR response->'result'->>'crm' IS DISTINCT FROM '0'
    THEN RAISE EXCEPTION 'FAIL: a repeated file duplicated a CRM lead'; END IF;

  SELECT p.user_id INTO STRICT collaborator_id FROM public.profiles p
    WHERE NOT p.suspended AND NOT public.is_executive(p.user_id)
      AND EXISTS(SELECT 1 FROM public.registration_requests r WHERE r.user_id=p.user_id AND r.status='approved') LIMIT 1;
  INSERT INTO public.user_roles(user_id,role) VALUES(collaborator_id,'traffic_manager') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claim.sub', collaborator_id::text, true);
  response := public.meta_import_leads('qa-pending.csv',jsonb_build_array(complete_row || jsonb_build_object('meta_lead_id',prefix || '-pending')));
  IF response->>'status' IS DISTINCT FROM 'pendente' OR EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-pending')
    THEN RAISE EXCEPTION 'FAIL: collaborator import bypassed approval'; END IF;
  SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE id=(response->>'batch_id')::uuid;
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
    RAISE EXCEPTION 'FAIL: collaborator approved own import';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', executive_id::text, true);
  batch := public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
  IF batch.status<>'aprovado' OR batch.result->>'crm' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'FAIL: approval did not publish pending rows'; END IF;
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
    RAISE EXCEPTION 'FAIL: decided import was approved again';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  IF has_function_privilege('authenticated','public.meta_ingest_lead_import_row(jsonb,uuid,uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'FAIL: internal ingest exposed to browser'; END IF;
END $$;
SELECT 'manual import: immediate publish, approval, outcomes, preservation and dedup verified (rollback)' AS verification;
ROLLBACK;
