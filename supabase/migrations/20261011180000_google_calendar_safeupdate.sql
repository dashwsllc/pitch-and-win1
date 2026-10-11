BEGIN;
SET LOCAL lock_timeout='5s';
-- Supabase PostgREST preloads safeupdate. Bound singleton updates and known
-- scan modes explicitly; preserve function signatures, grants and all data.
CREATE OR REPLACE FUNCTION public.google_calendar_credential_save(
  p_token uuid,p_expected_revision bigint,p_actor uuid,p_state_id uuid,p_account_id text,
  p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_scopes text[]
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection; aid uuid; rid uuid;
BEGIN
  SELECT * INTO c FROM calendar_private.connection FOR UPDATE;
  IF c.credential_lease_token IS DISTINCT FROM p_token OR c.credential_lease_until<=clock_timestamp()
     OR c.credential_revision<>p_expected_revision THEN RETURN false; END IF;
  IF p_actor IS NOT NULL THEN
    PERFORM calendar_private.require_admin(p_actor);
    UPDATE calendar_private.oauth_states SET saved_at=clock_timestamp()
      WHERE id=p_state_id AND actor_id=p_actor AND consumed_at IS NOT NULL AND saved_at IS NULL AND expires_at>clock_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_oauth_state' USING ERRCODE='22023'; END IF;
  ELSIF p_state_id IS NOT NULL OR c.account_id IS DISTINCT FROM p_account_id OR c.connection_status<>'connected' THEN
    RAISE EXCEPTION 'invalid_refresh_identity' USING ERRCODE='42501';
  END IF;
  IF nullif(p_access_token,'') IS NULL OR nullif(p_refresh_token,'') IS NULL OR nullif(p_account_id,'') IS NULL
    OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at<=clock_timestamp()
    OR NOT coalesce(p_scopes @> ARRAY['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],false)
  THEN RAISE EXCEPTION 'invalid_calendar_credential' USING ERRCODE='22023'; END IF;
  aid:=vault.create_secret(p_access_token);
  rid:=vault.create_secret(p_refresh_token);
  UPDATE calendar_private.connection SET access_secret_id=aid,refresh_secret_id=rid,account_id=p_account_id,
    expires_at=p_expires_at,scopes=p_scopes,credential_revision=credential_revision+1,connection_status='connected',error_code=NULL WHERE singleton;
  IF p_actor IS NOT NULL THEN
    UPDATE calendar_private.outbox SET available_at=clock_timestamp(),error_code=NULL,attempt=0,lease_token=NULL,lease_until=NULL
      WHERE available_at IS NULL AND error_code IN ('calendar_access','reconnect_required');
    UPDATE public.crm_google_calendar_status SET status='pending',error_code=NULL,updated_at=clock_timestamp()
      WHERE status='error' AND error_code IN ('calendar_access','reconnect_required');
  END IF;
  DELETE FROM vault.secrets WHERE id IN(c.access_secret_id,c.refresh_secret_id);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.google_calendar_activate(p_actor uuid,p_calendar_id text,p_calendar_name text,p_time_zone text,p_credential_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection;
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  SELECT * INTO c FROM calendar_private.connection FOR UPDATE;
  IF c.connection_status<>'connected' OR c.credential_revision<>p_credential_revision THEN RAISE EXCEPTION 'connection_changed' USING ERRCODE='PT409'; END IF;
  IF nullif(btrim(p_calendar_id),'') IS NULL OR p_calendar_id='primary' THEN RAISE EXCEPTION 'select_calendar_id' USING ERRCODE='22023'; END IF;
  IF c.calendar_id IS DISTINCT FROM p_calendar_id AND (
    EXISTS(SELECT 1 FROM calendar_private.bindings) OR EXISTS(SELECT 1 FROM calendar_private.activation_seeds)
  ) THEN RAISE EXCEPTION 'destination_locked' USING ERRCODE='PT409'; END IF;
  -- This lock also orders commercial triggers against activation. A repeat activation does not reset the cohort.
  IF c.calendar_id IS DISTINCT FROM p_calendar_id OR c.activated_at IS NULL THEN
    UPDATE calendar_private.connection SET calendar_id=p_calendar_id,calendar_name=p_calendar_name,time_zone=p_time_zone,activated_at=clock_timestamp() WHERE singleton;
    INSERT INTO calendar_private.activation_seeds(call_id,lead_id,calendar_id)
      SELECT a.id,a.lead_id,p_calendar_id FROM public.crm_activities a JOIN public.crm_leads l ON l.id=a.lead_id
      WHERE a.call_type='fechamento_closer' AND NOT a.is_completed AND a.cancelled_at IS NULL
        AND a.outcome IS NULL AND a.assigned_to IS NOT NULL AND a.scheduled_at>=clock_timestamp()
        AND isfinite(a.scheduled_at) AND l.pipeline_stage='repassado_closer'
      ON CONFLICT DO NOTHING;
    UPDATE calendar_private.scan_state SET cursor=NULL WHERE mode IN ('backfill','reconcile');
  ELSE UPDATE calendar_private.connection SET calendar_name=p_calendar_name,time_zone=p_time_zone WHERE singleton; END IF;
  RETURN public.google_calendar_admin_status(p_actor);
END $$;

CREATE OR REPLACE FUNCTION public.google_calendar_disconnect(p_actor uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection;
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  SELECT * INTO c FROM calendar_private.connection FOR UPDATE;
  IF c.credential_lease_token IS DISTINCT FROM p_token OR c.credential_lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'credential_lease_lost' USING ERRCODE='PT409'; END IF;
  UPDATE calendar_private.connection SET connection_status='disconnected',access_secret_id=NULL,refresh_secret_id=NULL,
    expires_at=NULL,scopes='{}',credential_revision=credential_revision+1,error_code=NULL WHERE singleton;
  DELETE FROM vault.secrets WHERE id IN(c.access_secret_id,c.refresh_secret_id);
  RETURN public.google_calendar_admin_status(p_actor);
END $$;

CREATE OR REPLACE FUNCTION public.google_calendar_record_run(p_started_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE calendar_private.connection SET last_run_at=greatest(last_run_at,p_started_at) WHERE singleton
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
