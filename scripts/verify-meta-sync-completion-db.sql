-- Run against the migrated database. All synthetic runs roll back.
-- Catches the RPC rejecting a resumable worker's legitimate partial result.
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE
  run_id uuid;
  run_row public.meta_sync_runs;
  prefix text := 'qa-completion-' || gen_random_uuid();
  final_status text;
  rejected boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  run_id := public.meta_lead_run_start(prefix,true);
  PERFORM public.meta_sync_run_finish(run_id,'partial',7,NULL);
  EXECUTE 'RESET ROLE';
  SELECT * INTO STRICT run_row FROM public.meta_sync_runs WHERE id=run_id;
  IF run_row.status <> 'partial' OR run_row.rows_synced <> 7
    OR run_row.finished_at IS NULL OR run_row.error_message IS NOT NULL
    OR run_row.request_params->>'discover' <> 'true' THEN
    RAISE EXCEPTION 'Partial discovery result was not finalized accurately';
  END IF;

  EXECUTE 'SET LOCAL ROLE service_role';
  rejected := false;
  BEGIN
    PERFORM public.meta_sync_run_finish(run_id,'success',8,NULL);
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'A finalized run was overwritten'; END IF;
  run_id := public.meta_lead_run_start(prefix,false);
  PERFORM public.meta_sync_run_finish(run_id,'partial',3,NULL);
  EXECUTE 'RESET ROLE';
  SELECT * INTO STRICT run_row FROM public.meta_sync_runs WHERE id=run_id;
  IF run_row.status <> 'partial' OR run_row.rows_synced <> 3
    OR run_row.finished_at IS NULL OR run_row.request_params->>'discover' <> 'false' THEN
    RAISE EXCEPTION 'Partial queue drain result was not finalized accurately';
  END IF;

  -- Legacy callers retain success/error results and validation of final states.
  FOREACH final_status IN ARRAY ARRAY['success','error'] LOOP
    EXECUTE 'SET LOCAL ROLE service_role';
    run_id := public.meta_sync_run_start('insights',prefix);
    rejected := false;
    BEGIN
      PERFORM public.meta_sync_run_finish(run_id,'running',0,NULL);
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'A non-final status was accepted'; END IF;
    PERFORM public.meta_sync_run_finish(run_id,final_status,NULL,'synthetic diagnostic');
    EXECUTE 'RESET ROLE';
    SELECT * INTO STRICT run_row FROM public.meta_sync_runs WHERE id=run_id;
    IF run_row.status <> final_status OR run_row.rows_synced <> 0
      OR run_row.finished_at IS NULL OR run_row.error_message <> 'synthetic diagnostic' THEN
      RAISE EXCEPTION 'Legacy completion behavior changed';
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.meta_sync_run_finish(uuid,text,integer,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.meta_sync_run_finish(uuid,text,integer,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.meta_sync_run_finish(uuid,text,integer,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Run completion is not restricted to the service';
  END IF;
END $$;
SELECT 'PASS: partial discovery/drain, legacy completion, immutable final runs and service-only access' AS verification;
ROLLBACK;
