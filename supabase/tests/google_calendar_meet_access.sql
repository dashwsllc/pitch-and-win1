-- Isolated QA only, run inside a transaction ending in ROLLBACK; no provider HTTP.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'meet-access-'||n||'@example.invalid',jsonb_build_object('display_name','Meet access QA'),'{}',now(),now() FROM generate_series(1,2) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,'Meet access QA',email,'seller','approved',now() FROM auth.users WHERE id::text LIKE 'ce000000-%' ON CONFLICT(user_id) DO UPDATE SET status='approved';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ce000000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES('ce000000-0000-4000-8000-000000000001','executive',true),('ce000000-0000-4000-8000-000000000002','closer',true);

DO $$
DECLARE s jsonb; k text; t1 timestamptz; t2 timestamptz; t3 timestamptz; before_row calendar_private.connection; after_row calendar_private.connection;
BEGIN
  -- Estado de partida e o status antigo intacto (a tela antiga so ganha um campo a mais).
  s:=public.google_calendar_admin_status('ce000000-0000-4000-8000-000000000001');
  IF s->'meetAccess'->>'state' IS DISTINCT FROM 'unknown' OR jsonb_typeof(s->'meetAccess'->'checkedAt')<>'null' THEN RAISE EXCEPTION 'initial meetAccess is unknown/null: %',s->'meetAccess'; END IF;
  FOREACH k IN ARRAY ARRAY['configured','connection','calendar','destinationLocked','activatedAt','lastRunAt','pendingCount','errorCount','backfillPending','errorCode'] LOOP
    IF NOT s ? k THEN RAISE EXCEPTION 'admin status lost field %',k; END IF;
  END LOOP;
  -- Nao-executivo continua sem ver o status.
  BEGIN PERFORM public.google_calendar_admin_status('ce000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'closer read admin status';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  -- Grava e le de volta, sem tocar em credenciais nem na conexao.
  SELECT * INTO before_row FROM calendar_private.connection;
  PERFORM public.google_calendar_set_meet_access('open');
  SELECT * INTO after_row FROM calendar_private.connection;
  IF after_row.meet_access_state<>'open' OR after_row.meet_access_checked_at IS NULL THEN RAISE EXCEPTION 'state not recorded'; END IF;
  IF (after_row.connection_status,after_row.credential_revision,after_row.calendar_id,after_row.account_id,after_row.error_code,after_row.access_secret_id,after_row.refresh_secret_id,after_row.scopes)
     IS DISTINCT FROM (before_row.connection_status,before_row.credential_revision,before_row.calendar_id,before_row.account_id,before_row.error_code,before_row.access_secret_id,before_row.refresh_secret_id,before_row.scopes)
  THEN RAISE EXCEPTION 'meet access touched the connection or credentials'; END IF;
  s:=public.google_calendar_admin_status('ce000000-0000-4000-8000-000000000001');
  IF s->'meetAccess'->>'state'<>'open' OR (s->'meetAccess'->>'checkedAt') IS NULL THEN RAISE EXCEPTION 'status does not show the recorded state: %',s->'meetAccess'; END IF;

  -- Mesmo estado em menos de 10 minutos nao reescreve (um job por minuto nao vira uma escrita por minuto).
  t1:=after_row.meet_access_checked_at;
  PERFORM public.google_calendar_set_meet_access('open');
  SELECT meet_access_checked_at INTO t2 FROM calendar_private.connection;
  IF t2<>t1 THEN RAISE EXCEPTION 'same state inside 10 minutes was rewritten'; END IF;
  -- Estado diferente reescreve na hora.
  PERFORM public.google_calendar_set_meet_access('scope_missing');
  SELECT meet_access_state,meet_access_checked_at INTO k,t3 FROM calendar_private.connection;
  IF k<>'scope_missing' OR t3<=t1 THEN RAISE EXCEPTION 'changed state was not recorded'; END IF;
  -- Mesmo estado, registro com mais de 10 minutos: renova a hora.
  UPDATE calendar_private.connection SET meet_access_checked_at=clock_timestamp()-interval '11 minutes' WHERE singleton;
  PERFORM public.google_calendar_set_meet_access('scope_missing');
  SELECT meet_access_checked_at INTO t1 FROM calendar_private.connection;
  IF t1<clock_timestamp()-interval '1 minute' THEN RAISE EXCEPTION 'stale record was not refreshed'; END IF;
  -- Todos os estados validos passam; nada fora da lista passa.
  FOREACH k IN ARRAY ARRAY['unknown','open','scope_missing','api_disabled','not_permitted','error'] LOOP
    PERFORM public.google_calendar_set_meet_access(k);
    IF (SELECT meet_access_state FROM calendar_private.connection)<>k THEN RAISE EXCEPTION 'valid state rejected: %',k; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['OPEN','opened','','ok','open ','abc'] LOOP
    BEGIN PERFORM public.google_calendar_set_meet_access(k); RAISE EXCEPTION 'invalid state accepted: %',k;
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.google_calendar_set_meet_access(NULL); RAISE EXCEPTION 'NULL state accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- A restricao da tabela tambem barra valor fora da lista.
  BEGIN UPDATE calendar_private.connection SET meet_access_state='qualquer' WHERE singleton; RAISE EXCEPTION 'table accepted an invalid state';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- So o servico grava; o app (authenticated) e o publico (anon) nao chamam nem a funcao nova.
DO $$ BEGIN
  IF NOT has_function_privilege('service_role','public.google_calendar_set_meet_access(text)','EXECUTE') THEN RAISE EXCEPTION 'service_role must execute set_meet_access'; END IF;
  IF has_function_privilege('anon','public.google_calendar_set_meet_access(text)','EXECUTE') OR has_function_privilege('authenticated','public.google_calendar_set_meet_access(text)','EXECUTE') THEN RAISE EXCEPTION 'set_meet_access exposed to app roles'; END IF;
  IF has_function_privilege('anon','public.google_calendar_admin_status(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.google_calendar_admin_status(uuid)','EXECUTE') THEN RAISE EXCEPTION 'admin_status exposed to app roles'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.google_calendar_set_meet_access('open'); RAISE EXCEPTION 'authenticated executed set_meet_access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
