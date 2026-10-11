BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- The durable lead worker uses partial when its execution budget ends.
-- The table already accepts this state; align the legacy completion RPC.
CREATE OR REPLACE FUNCTION public.meta_sync_run_finish(p_id uuid, p_status text, p_rows_synced integer DEFAULT 0, p_error_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_status NOT IN ('success','error','partial') THEN RAISE EXCEPTION 'Status final inválido'; END IF;
  UPDATE public.meta_sync_runs SET status=p_status, rows_synced=coalesce(p_rows_synced,0),
    error_message=p_error_message, finished_at=clock_timestamp() WHERE id=p_id AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Execução não encontrada ou já finalizada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_sync_run_finish(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_sync_run_finish(uuid,text,integer,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
