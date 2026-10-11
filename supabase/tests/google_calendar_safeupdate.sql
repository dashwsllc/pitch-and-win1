-- Run inside a rollback transaction on native Supabase; no CRM/Google fixtures.
-- PostgREST preloads safeupdate; the SQL management role cannot LOAD it.
-- Audit RPC statements here, then validate the deployed worker over HTTP.
DO $$ DECLARE f record; command text[]; started timestamptz:=clock_timestamp(); BEGIN
  FOR f IN SELECT p.proname,pg_get_functiondef(p.oid) definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'google_calendar_%'
  LOOP
    FOR command IN SELECT regexp_matches(f.definition,
      'UPDATE\s+calendar_private\.(?:connection|scan_state)\s+SET[^;]*','gi')
    LOOP
      IF command[1] !~* '\mWHERE\M' THEN
        RAISE EXCEPTION 'RPC % contains an update incompatible with PostgREST safeupdate',f.proname;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM public.google_calendar_record_run(started);
  PERFORM public.google_calendar_record_run(started-interval '1 minute');
  IF (SELECT last_run_at FROM calendar_private.connection WHERE singleton) < started THEN
    RAISE EXCEPTION 'worker run timestamp regressed';
  END IF;
END $$;
