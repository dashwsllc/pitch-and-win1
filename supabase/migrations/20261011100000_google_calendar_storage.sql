BEGIN;
SET LOCAL lock_timeout='5s';
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE SCHEMA calendar_private;
REVOKE ALL ON SCHEMA calendar_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA calendar_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE calendar_private.connection(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  connection_status text NOT NULL DEFAULT 'not_connected' CHECK(connection_status IN ('not_connected','connected','reconnect_required','permission_denied','disconnected')),
  credential_revision bigint NOT NULL DEFAULT 0,
  access_secret_id uuid,refresh_secret_id uuid,account_id text,expires_at timestamptz,scopes text[] NOT NULL DEFAULT '{}',
  credential_lease_token uuid,credential_lease_until timestamptz,
  calendar_id text,calendar_name text,time_zone text,activated_at timestamptz,last_run_at timestamptz,error_code text
);
INSERT INTO calendar_private.connection DEFAULT VALUES;
CREATE TABLE calendar_private.oauth_states(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),state_hash text NOT NULL UNIQUE CHECK(state_hash~'^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL,origin text NOT NULL,expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
  consumed_at timestamptz,saved_at timestamptz
);
CREATE TABLE calendar_private.bindings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),call_id uuid NOT NULL,lead_id uuid NOT NULL,calendar_id text NOT NULL,
  event_id text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),generation integer NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,confirmed_revision bigint,confirmed_hash text,etag text,
  removed boolean NOT NULL DEFAULT false,completed boolean NOT NULL DEFAULT false,
  UNIQUE(call_id,calendar_id),UNIQUE(calendar_id,event_id)
);
CREATE TABLE calendar_private.outbox(
  binding_id uuid PRIMARY KEY REFERENCES calendar_private.bindings(id),attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz DEFAULT clock_timestamp(),lease_token uuid,lease_until timestamptz,error_code text
);
CREATE INDEX calendar_outbox_due ON calendar_private.outbox(available_at) WHERE available_at IS NOT NULL;
CREATE TABLE calendar_private.activation_seeds(
  call_id uuid NOT NULL,lead_id uuid NOT NULL,calendar_id text NOT NULL,
  PRIMARY KEY(call_id,calendar_id)
);
CREATE TABLE calendar_private.scan_state(mode text PRIMARY KEY CHECK(mode IN ('backfill','reconcile')),cursor uuid);
INSERT INTO calendar_private.scan_state VALUES('backfill',NULL),('reconcile',NULL);
CREATE TABLE public.crm_google_calendar_status(
  call_id uuid PRIMARY KEY REFERENCES public.crm_activities(id) ON DELETE CASCADE,
  desired_revision text NOT NULL,confirmed_revision text,
  status text NOT NULL CHECK(status IN ('disabled','awaiting_connection','pending','syncing','synced','removal_pending','removed','error')),
  error_code text,last_synced_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.crm_google_calendar_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_google_calendar_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.crm_google_calendar_status TO authenticated;
CREATE POLICY calendar_status_visible ON public.crm_google_calendar_status FOR SELECT TO authenticated
USING(public.crm_has_access() AND public.registration_has_access()
  AND EXISTS(SELECT 1 FROM public.crm_activities a WHERE a.id=call_id));

CREATE FUNCTION calendar_private.require_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.crm_user_can(p_actor,'executive') OR NOT EXISTS(
    SELECT 1 FROM public.registration_requests WHERE user_id=p_actor AND status='approved'
  ) THEN RAISE EXCEPTION 'calendar_admin_required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION calendar_private.binding_json(b calendar_private.bindings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('id',b.id,'callId',b.call_id,'leadId',b.lead_id,'calendarId',b.calendar_id,
    'eventId',b.event_id,'generation',b.generation,'revision',b.revision::text,
    'confirmedRevision',b.confirmed_revision::text,'confirmedHash',b.confirmed_hash,'etag',b.etag)
$$;
CREATE FUNCTION public.google_calendar_admin_status(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection;
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  SELECT * INTO STRICT c FROM calendar_private.connection;
  RETURN jsonb_build_object('configured',c.calendar_id IS NOT NULL,'connection',c.connection_status,
    'calendar',CASE WHEN c.calendar_id IS NULL THEN NULL ELSE jsonb_build_object('id',c.calendar_id,'name',c.calendar_name,'accessRole','writer','timeZone',c.time_zone) END,
    'destinationLocked',EXISTS(SELECT 1 FROM calendar_private.bindings) OR EXISTS(SELECT 1 FROM calendar_private.activation_seeds),
    'activatedAt',c.activated_at,'lastRunAt',c.last_run_at,
    'pendingCount',(SELECT count(*) FROM calendar_private.outbox),
    'errorCount',(SELECT count(*) FROM calendar_private.outbox WHERE error_code IS NOT NULL),
    'backfillPending',EXISTS(SELECT 1 FROM calendar_private.activation_seeds),'errorCode',c.error_code);
END $$;
CREATE FUNCTION public.google_calendar_oauth_start(p_actor uuid,p_state_hash text,p_origin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s calendar_private.oauth_states;
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  DELETE FROM calendar_private.oauth_states WHERE expires_at<clock_timestamp()-interval '1 day';
  INSERT INTO calendar_private.oauth_states(state_hash,actor_id,origin) VALUES(p_state_hash,p_actor,p_origin) RETURNING * INTO s;
  RETURN jsonb_build_object('stateId',s.id,'expiresAt',s.expires_at);
END $$;
CREATE FUNCTION public.google_calendar_oauth_consume(p_state_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s calendar_private.oauth_states;
BEGIN
  UPDATE calendar_private.oauth_states SET consumed_at=clock_timestamp()
    WHERE state_hash=p_state_hash AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING * INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_oauth_state' USING ERRCODE='22023'; END IF;
  -- Consume even if the actor lost permission. Callback revalidates the actor before exchange/save.
  RETURN jsonb_build_object('stateId',s.id,'actorId',s.actor_id,'origin',s.origin);
END $$;
CREATE FUNCTION public.google_calendar_credential_claim(p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection;
BEGIN
  UPDATE calendar_private.connection SET credential_lease_token=gen_random_uuid(),
    credential_lease_until=clock_timestamp()+make_interval(secs=>greatest(5,least(60,p_lease_seconds)))
    WHERE credential_lease_until IS NULL OR credential_lease_until<=clock_timestamp() RETURNING * INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('token',c.credential_lease_token,'revision',c.credential_revision::text,'expiresAt',c.credential_lease_until);
END $$;
CREATE FUNCTION public.google_calendar_credential_read(p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection; a text; r text;
BEGIN
  SELECT * INTO c FROM calendar_private.connection WHERE credential_lease_token=p_token AND credential_lease_until>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'credential_lease_lost' USING ERRCODE='PT409'; END IF;
  SELECT decrypted_secret INTO a FROM vault.decrypted_secrets WHERE id=c.access_secret_id;
  SELECT decrypted_secret INTO r FROM vault.decrypted_secrets WHERE id=c.refresh_secret_id;
  RETURN jsonb_build_object('accountId',c.account_id,'accessToken',a,'refreshToken',r,'expiresAt',c.expires_at,'scopes',c.scopes,'revision',c.credential_revision::text);
END $$;
CREATE FUNCTION public.google_calendar_credential_save(
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
    expires_at=p_expires_at,scopes=p_scopes,credential_revision=credential_revision+1,connection_status='connected',error_code=NULL;
  IF p_actor IS NOT NULL THEN
    UPDATE calendar_private.outbox SET available_at=clock_timestamp(),error_code=NULL,attempt=0,lease_token=NULL,lease_until=NULL
      WHERE available_at IS NULL AND error_code IN ('calendar_access','reconnect_required');
    UPDATE public.crm_google_calendar_status SET status='pending',error_code=NULL,updated_at=clock_timestamp()
      WHERE status='error' AND error_code IN ('calendar_access','reconnect_required');
  END IF;
  DELETE FROM vault.secrets WHERE id IN(c.access_secret_id,c.refresh_secret_id);
  RETURN true;
END $$;
CREATE FUNCTION public.google_calendar_credential_release(p_token uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE calendar_private.connection SET credential_lease_token=NULL,credential_lease_until=NULL WHERE credential_lease_token=p_token
$$;
CREATE FUNCTION public.google_calendar_activate(p_actor uuid,p_calendar_id text,p_calendar_name text,p_time_zone text,p_credential_revision bigint) RETURNS jsonb
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
    UPDATE calendar_private.connection SET calendar_id=p_calendar_id,calendar_name=p_calendar_name,time_zone=p_time_zone,activated_at=clock_timestamp();
    INSERT INTO calendar_private.activation_seeds(call_id,lead_id,calendar_id)
      SELECT a.id,a.lead_id,p_calendar_id FROM public.crm_activities a JOIN public.crm_leads l ON l.id=a.lead_id
      WHERE a.call_type='fechamento_closer' AND NOT a.is_completed AND a.cancelled_at IS NULL
        AND a.outcome IS NULL AND a.assigned_to IS NOT NULL AND a.scheduled_at>=clock_timestamp()
        AND isfinite(a.scheduled_at) AND l.pipeline_stage='repassado_closer'
      ON CONFLICT DO NOTHING;
    UPDATE calendar_private.scan_state SET cursor=NULL;
  ELSE UPDATE calendar_private.connection SET calendar_name=p_calendar_name,time_zone=p_time_zone; END IF;
  RETURN public.google_calendar_admin_status(p_actor);
END $$;
CREATE FUNCTION public.google_calendar_disconnect(p_actor uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection;
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  SELECT * INTO c FROM calendar_private.connection FOR UPDATE;
  IF c.credential_lease_token IS DISTINCT FROM p_token OR c.credential_lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'credential_lease_lost' USING ERRCODE='PT409'; END IF;
  UPDATE calendar_private.connection SET connection_status='disconnected',access_secret_id=NULL,refresh_secret_id=NULL,
    expires_at=NULL,scopes='{}',credential_revision=credential_revision+1,error_code=NULL;
  DELETE FROM vault.secrets WHERE id IN(c.access_secret_id,c.refresh_secret_id);
  RETURN public.google_calendar_admin_status(p_actor);
END $$;
CREATE FUNCTION public.google_calendar_set_connection_error(p_credential_revision bigint,p_code text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE calendar_private.connection SET connection_status=CASE WHEN p_code='permission_denied' THEN 'permission_denied' ELSE 'reconnect_required' END,
    error_code=CASE WHEN p_code='permission_denied' THEN 'permission_denied' ELSE 'reconnect_required' END
    WHERE credential_revision=p_credential_revision AND connection_status='connected'
$$;
CREATE FUNCTION public.google_calendar_retry(p_actor uuid,p_call_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  UPDATE calendar_private.outbox o SET available_at=clock_timestamp(),attempt=0,error_code=NULL
    FROM calendar_private.bindings b WHERE b.id=o.binding_id AND (p_call_id IS NULL OR b.call_id=p_call_id);
  UPDATE public.crm_google_calendar_status SET status='pending',error_code=NULL,updated_at=clock_timestamp()
    WHERE (p_call_id IS NULL OR call_id=p_call_id) AND status='error';
  RETURN public.google_calendar_admin_status(p_actor);
END $$;
-- Newly introduced functions become reachable only after this transaction commits.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'google_calendar_%'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
