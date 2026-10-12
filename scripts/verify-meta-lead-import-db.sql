-- Importação manual de leads: a planilha entra nas mesmas levas dos leads automáticos.
-- Roda só em transação; fixtures, papéis e sinais voltam com o ROLLBACK.
BEGIN;
SET LOCAL statement_timeout = '90s';
DO $$
DECLARE executive_id uuid; collaborator_id uuid; batch public.meta_lead_import_batches;
  response jsonb; complete_row jsonb; incomplete_row jsonb; invalid_date_row jsonb; broken_row jsonb; no_time_row jsonb; recent_row jsonb;
  prefix text := 'qa-manual-' || gen_random_uuid()::text; v_lead uuid; crm_id uuid; decided jsonb; v_wave uuid; started timestamptz; rows jsonb; n integer;
BEGIN
  SELECT p.user_id INTO STRICT executive_id FROM public.profiles p
    WHERE NOT p.suspended AND public.is_executive(p.user_id) LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', executive_id::text, true);
  complete_row := jsonb_build_object('meta_lead_id', prefix || '-complete', 'created_time', '2026-09-20T17:30:42Z',
    'full_name', 'Responsável QA', 'phone', '11999990000', 'email', 'qa@example.invalid',
    'athlete_name', 'Atleta QA', 'athlete_birth_date', '2010-03-15', 'athlete_position', 'Meia',
    'source_row', 2, 'raw_notes', 'Motivação: Ser profissional',
    'field_data', jsonb_build_array(jsonb_build_object('name','Motivação','values',jsonb_build_array('Ser profissional'))));
  -- Um WhatsApp abaixo do mínimo do CRM não impede a entrada: o lead fica na leva e falha de forma visível ao enviar.
  incomplete_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-queue', 'phone', '123', 'source_row', 3,
    'created_time', '2026-09-20T17:31:10Z');
  -- Data impossível não faz o lead sumir: entra com o horário do recebimento e um aviso.
  invalid_date_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-invalid-date', 'created_time', 'data inválida', 'source_row', 5);
  -- Só linha estruturalmente quebrada é recusada, e a recusa é listada com o número da linha.
  broken_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-broken', 'field_data', '"texto solto"'::jsonb, 'source_row', 6);
  response := public.meta_import_leads('qa-manual.csv', jsonb_build_array(complete_row, incomplete_row,
    complete_row || jsonb_build_object('source_row',4), invalid_date_row, broken_row));
  IF response->>'status' IS DISTINCT FROM 'recebido' THEN RAISE EXCEPTION 'FAIL: import must report that the rows were received'; END IF;
  IF (response->'result'->>'received')::int<>3 OR (response->'result'->>'duplicates')::int<>1 OR (response->'result'->>'failed')::int<>1
    OR jsonb_array_length(response->'result'->'issues')<>2 THEN
    RAISE EXCEPTION 'FAIL: outcomes must account for received, duplicate and refused rows: %', response->'result';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'result'->'issues') i WHERE i->>'kind'='failed' AND (i->>'row')::int=6)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'result'->'issues') i WHERE i->>'kind'='duplicate' AND (i->>'row')::int=4) THEN
    RAISE EXCEPTION 'FAIL: refused and duplicate rows must be explained with their row number'; END IF;
  SELECT * INTO STRICT batch FROM public.meta_lead_import_batches WHERE id=(response->>'batch_id')::uuid;
  IF batch.status<>'recebido' OR jsonb_array_length(batch.rows)<>5 OR batch.result->>'received' IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'FAIL: the whole file must stay stored with its outcome'; END IF;
  -- Nada vai ao CRM nem aparece para o SDR antes da aprovação; todos esperam numa leva, com data e hora exatas.
  IF EXISTS(SELECT 1 FROM public.crm_leads WHERE meta_form_lead_id IN (SELECT id FROM public.meta_form_leads WHERE lead_import_batch_id=batch.id)) THEN
    RAISE EXCEPTION 'FAIL: manual import reached the CRM without approval'; END IF;
  IF (SELECT count(*) FROM public.meta_form_leads WHERE lead_import_batch_id=batch.id AND approval_status='pendente' AND wave_id IS NOT NULL)<>3 THEN
    RAISE EXCEPTION 'FAIL: every received row must wait in a wave'; END IF;
  IF (SELECT created_time FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-complete') IS DISTINCT FROM timestamptz '2026-09-20T17:30:42Z'
    OR (SELECT import_contact->>'time_known' FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-complete') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL: the lead time must be kept to the second'; END IF;
  SELECT created_time, import_warning INTO STRICT started, decided FROM (SELECT created_time, to_jsonb(import_warning) AS import_warning FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-invalid-date') x;
  IF started < clock_timestamp()-interval '1 minute' OR decided #>> '{}' NOT LIKE '%horário do recebimento%'
    OR (SELECT import_contact->>'time_known' FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-invalid-date')<>'false' THEN
    RAISE EXCEPTION 'FAIL: a lead with an invalid date must be kept with the receipt time and a warning'; END IF;
  SELECT id INTO STRICT v_lead FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-queue';
  IF (SELECT import_contact->>'athlete_birth_date' FROM public.meta_form_leads WHERE id=v_lead) IS DISTINCT FROM '2010-03-15'
    THEN RAISE EXCEPTION 'FAIL: lead lost mapped athlete data'; END IF;
  -- Reenviar o mesmo arquivo (por exemplo, após erro de rede) não duplica nada.
  response := public.meta_import_leads('qa-manual.csv', jsonb_build_array(complete_row, incomplete_row, invalid_date_row));
  IF (response->'result'->>'received')::int<>0 OR (response->'result'->>'duplicates')::int<>3
    OR (SELECT count(*) FROM public.meta_form_leads WHERE meta_lead_id LIKE prefix || '%')<>3 THEN
    RAISE EXCEPTION 'FAIL: sending the same file again duplicated leads: %', response->'result'; END IF;
  IF response->'result'->'issues'->0->>'reason' NOT LIKE 'Lead já recebido e aguardando aprovação na leva #%' THEN
    RAISE EXCEPTION 'FAIL: duplicate must point to the wave that already holds the lead'; END IF;
  -- A entrega automática da Meta não sobrescreve as respostas já recebidas pela planilha.
  PERFORM public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix || '-queue',
    'page_id','qa-page','form_id','qa-form','created_time','2026-09-20T17:30:00Z',
    'full_name','Automatic replacement','phone','11000000000','email','automatic@example.invalid',
    'field_data',jsonb_build_array(jsonb_build_object('name','Meta question','values',jsonb_build_array('Meta answer')))));
  IF (SELECT full_name FROM public.meta_form_leads WHERE id=v_lead) IS DISTINCT FROM 'Responsável QA'
    OR NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE id=v_lead
      AND field_data @> '[{"name":"Motivação","values":["Ser profissional"]}]'::jsonb)
    THEN RAISE EXCEPTION 'FAIL: automatic ingestion overwrote manual responses'; END IF;

  -- Aprovar a leva envia ao CRM com os dados da planilha e a hora real do lead; a falha de um não derruba os outros.
  SELECT l.wave_id INTO STRICT v_wave FROM public.meta_form_leads l WHERE l.meta_lead_id=prefix || '-complete';
  decided := public.meta_wave_decide(v_wave,'aprovar',ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.lead_import_batch_id=batch.id AND l.wave_id=v_wave));
  IF (decided->>'sent')::int<>2 OR (decided->>'failed')::int<>1 THEN RAISE EXCEPTION 'FAIL: wave approval outcome wrong: %', decided; END IF;
  SELECT crm_lead_id INTO STRICT crm_id FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-complete';
  IF NOT EXISTS(SELECT 1 FROM public.crm_leads WHERE id=crm_id AND athlete_name='Atleta QA' AND athlete_birth_date='2010-03-15' AND athlete_position='Meia'
      AND email='qa@example.invalid' AND lead_generated_at=timestamptz '2026-09-20T17:30:42Z' AND sdr_id IS NULL AND lead_source='meta_ads_form')
    OR NOT EXISTS(SELECT 1 FROM public.crm_lead_contexts WHERE lead_id=crm_id AND context_type='meta_form' AND content LIKE '%Motivação: Ser profissional%'
      AND content LIKE '%Caiu em: 20/09/2026 14:30 (Brasília)%') THEN
    RAISE EXCEPTION 'FAIL: spreadsheet data, generation time or context missing in the CRM'; END IF;
  IF (SELECT crm_sync_status FROM public.meta_form_leads WHERE id=v_lead) IS DISTINCT FROM 'falhou' THEN
    RAISE EXCEPTION 'FAIL: the short WhatsApp must stay as a visible failure'; END IF;
  -- O lead com falha ainda pode ser completado pelo SDR (caminho antigo) sem perder as respostas.
  crm_id := public.meta_promote_form_lead(v_lead, jsonb_build_object('name','Responsável QA','phone','11999990000',
    'email','completado@example.invalid','athlete_name','Atleta QA','athlete_birth_date','2010-03-15','athlete_position','Meia'));
  IF (SELECT observations FROM public.crm_leads WHERE id=crm_id) NOT LIKE '%Motivação: Ser profissional%'
    THEN RAISE EXCEPTION 'FAIL: promotion lost original responses'; END IF;

  -- Planilha sem horário: a data vale, o horário é marcado como aproximado e o contexto avisa.
  no_time_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-date-only', 'created_time', '2026-09-19T15:00:00Z', 'time_known', false, 'source_row', 8);
  response := public.meta_import_leads('sem-horario.csv', jsonb_build_array(no_time_row));
  IF (response->'result'->>'received')::int<>1 THEN RAISE EXCEPTION 'FAIL: date-only row refused'; END IF;
  SELECT l.wave_id INTO STRICT v_wave FROM public.meta_form_leads l WHERE l.meta_lead_id=prefix || '-date-only';
  PERFORM public.meta_wave_decide(v_wave,'aprovar',ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.wave_id=v_wave AND l.approval_status='pendente'));
  SELECT crm_lead_id INTO STRICT crm_id FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-date-only';
  IF NOT EXISTS(SELECT 1 FROM public.crm_lead_contexts WHERE lead_id=crm_id AND content LIKE '%Caiu em: 19/09/2026 (horário não informado na planilha)%') THEN
    RAISE EXCEPTION 'FAIL: context must say the spreadsheet had no time'; END IF;

  -- Planilha antiga e lead recente se misturam em ordem cronológica, o mais recente fica na última leva.
  recent_row := complete_row || jsonb_build_object('meta_lead_id', prefix || '-recent', 'created_time', to_char((clock_timestamp() - interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'source_row', 9);
  PERFORM public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix || '-api-newer','page_id','qa-page','form_id','qa-form',
    'created_time',clock_timestamp() - interval '1 minute','full_name','Lead automatico','phone','11977770000','field_data','[]'::jsonb));
  PERFORM public.meta_import_leads('misturado.csv', jsonb_build_array(recent_row,
    complete_row || jsonb_build_object('meta_lead_id', prefix || '-old', 'created_time', '2026-08-01T10:00:00Z', 'source_row', 10)));
  IF public.meta_wave_needs_rebuild() THEN RAISE EXCEPTION 'FAIL: imported and automatic leads must share one chronological order'; END IF;
  IF (SELECT number FROM public.meta_lead_waves w JOIN public.meta_form_leads l ON l.wave_id=w.id WHERE l.meta_lead_id=prefix || '-old')
     >= (SELECT number FROM public.meta_lead_waves w JOIN public.meta_form_leads l ON l.wave_id=w.id WHERE l.meta_lead_id=prefix || '-api-newer')
     AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads a JOIN public.meta_form_leads b ON a.wave_id=b.wave_id WHERE a.meta_lead_id=prefix || '-old' AND b.meta_lead_id=prefix || '-api-newer') THEN
    RAISE EXCEPTION 'FAIL: the oldest imported lead must not sit in a newer wave than the newest automatic lead'; END IF;

  -- Um arquivo grande entra inteiro, em ordem, em levas de no máximo 20, sem perder nenhuma linha.
  SELECT jsonb_agg(complete_row || jsonb_build_object('meta_lead_id', prefix || '-bulk-' || g, 'source_row', g + 1,
    'phone', '1199' || lpad(g::text, 7, '0'), 'created_time', to_char((timestamptz '2026-09-01T12:00:00Z' + (g || ' minutes')::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    INTO rows FROM generate_series(1, 450) g;
  started := clock_timestamp();
  response := public.meta_import_leads('grande.csv', rows);
  IF (response->'result'->>'received')::int<>450 OR (response->'result'->>'failed')::int<>0 THEN RAISE EXCEPTION 'FAIL: bulk import lost rows: %', response->'result'; END IF;
  IF clock_timestamp()-started > interval '8 seconds' THEN RAISE EXCEPTION 'FAIL: bulk import is too slow for the API timeout'; END IF;
  IF EXISTS(SELECT 1 FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.meta_form_leads WHERE wave_id IS NOT NULL GROUP BY wave_id HAVING count(*)>20)
    OR public.meta_wave_needs_rebuild() THEN RAISE EXCEPTION 'FAIL: bulk leads must sit in ordered waves of at most 20'; END IF;

  -- Papéis: Gestor de Tráfego importa e as linhas esperam aprovação; SDR não importa.
  SELECT p.user_id INTO STRICT collaborator_id FROM public.profiles p
    WHERE NOT p.suspended AND NOT public.is_executive(p.user_id)
      AND EXISTS(SELECT 1 FROM public.registration_requests r WHERE r.user_id=p.user_id AND r.status='approved') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  DELETE FROM public.user_roles WHERE user_id=collaborator_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(collaborator_id,'sdr');
  PERFORM set_config('request.jwt.claim.sub', collaborator_id::text, true);
  BEGIN
    PERFORM public.meta_import_leads('sdr.csv',jsonb_build_array(complete_row || jsonb_build_object('meta_lead_id',prefix || '-sdr')));
    RAISE EXCEPTION 'FAIL: SDR imported leads';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  DELETE FROM public.user_roles WHERE user_id=collaborator_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(collaborator_id,'traffic_manager');
  PERFORM set_config('request.jwt.claim.sub', collaborator_id::text, true);
  response := public.meta_import_leads('qa-pending.csv',jsonb_build_array(complete_row || jsonb_build_object('meta_lead_id',prefix || '-pending')));
  IF response->>'status' IS DISTINCT FROM 'recebido' OR NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-pending' AND approval_status='pendente' AND crm_lead_id IS NULL)
    THEN RAISE EXCEPTION 'FAIL: collaborator import bypassed approval'; END IF;

  -- Lote antigo ainda pendente: aprovar manda as linhas às levas (não ao CRM) e não pode ser repetido.
  INSERT INTO public.meta_lead_import_batches(imported_by,filename,row_count,status,rows)
    VALUES(collaborator_id,'antigo.csv',1,'pendente',jsonb_build_array(complete_row || jsonb_build_object('meta_lead_id',prefix || '-legacy'))) RETURNING * INTO batch;
  batch := public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
  IF batch.status<>'aprovado' OR batch.result->>'received' IS DISTINCT FROM '1'
    OR NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=prefix || '-legacy' AND approval_status='pendente' AND wave_id IS NOT NULL AND crm_lead_id IS NULL)
    THEN RAISE EXCEPTION 'FAIL: legacy approval must send rows to the waves'; END IF;
  BEGIN
    PERFORM public.meta_review_lead_import(batch.id,'aprovar',batch.updated_at);
    RAISE EXCEPTION 'FAIL: decided import was approved again';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  IF has_function_privilege('authenticated','public.meta_ingest_lead_import_row(jsonb,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.meta_lead_import_ingest(uuid,jsonb)','EXECUTE')
    THEN RAISE EXCEPTION 'FAIL: internal ingest exposed to browser'; END IF;
END $$;
SELECT 'manual import: same waves as automatic leads, no lead lost, dedup, order, CRM sync and failure visibility verified (rollback)' AS verification;
ROLLBACK;
