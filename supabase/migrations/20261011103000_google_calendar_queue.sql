BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION calendar_private.enqueue(p_call_id uuid,p_lead_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection; b calendar_private.bindings; a public.crm_activities; l public.crm_leads; fresh boolean:=false; removing boolean;
BEGIN
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.calendar_id IS NULL OR c.activated_at IS NULL THEN RETURN; END IF;
  SELECT * INTO b FROM calendar_private.bindings WHERE call_id=p_call_id AND calendar_id=c.calendar_id FOR UPDATE;
  SELECT * INTO a FROM public.crm_activities WHERE id=p_call_id;
  SELECT * INTO l FROM public.crm_leads WHERE id=coalesce(a.lead_id,p_lead_id);
  IF b.id IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM calendar_private.activation_seeds WHERE call_id=p_call_id AND calendar_id=c.calendar_id)
      AND NOT (a.id IS NOT NULL AND a.call_type='fechamento_closer' AND NOT a.is_completed AND a.cancelled_at IS NULL
        AND a.outcome IS NULL AND l.pipeline_stage='repassado_closer') THEN RETURN; END IF;
    INSERT INTO calendar_private.bindings(call_id,lead_id,calendar_id) VALUES(p_call_id,coalesce(a.lead_id,p_lead_id),c.calendar_id)
      RETURNING * INTO b;
    fresh:=true;
  END IF;
  removing:=a.id IS NULL OR l.id IS NULL OR a.cancelled_at IS NOT NULL
    OR a.call_type IS DISTINCT FROM 'fechamento_closer' OR coalesce(a.outcome IN ('devolvido_sdr','followup_sdr'),false)
    OR (NOT a.is_completed AND a.outcome IS NULL AND l.pipeline_stage IS DISTINCT FROM 'repassado_closer');
  IF NOT fresh THEN
    UPDATE calendar_private.bindings SET revision=revision+1,lead_id=coalesce(a.lead_id,p_lead_id),
      completed=coalesce(a.is_completed OR a.outcome IS NOT NULL,false) WHERE id=b.id RETURNING * INTO b;
  ELSE
    UPDATE calendar_private.bindings SET completed=coalesce(a.is_completed OR a.outcome IS NOT NULL,false) WHERE id=b.id;
  END IF;
  DELETE FROM calendar_private.activation_seeds WHERE call_id=p_call_id AND calendar_id=c.calendar_id;
  INSERT INTO calendar_private.outbox(binding_id) VALUES(b.id)
    ON CONFLICT(binding_id) DO UPDATE SET available_at=clock_timestamp(),attempt=0,error_code=NULL;
  IF a.id IS NOT NULL THEN
    INSERT INTO public.crm_google_calendar_status(call_id,desired_revision,confirmed_revision,status)
      VALUES(a.id,b.revision::text,b.confirmed_revision::text,CASE WHEN removing THEN 'removal_pending' ELSE 'pending' END)
      ON CONFLICT(call_id) DO UPDATE SET desired_revision=excluded.desired_revision,status=excluded.status,error_code=NULL,updated_at=clock_timestamp();
  END IF;
END $$;

CREATE FUNCTION calendar_private.call_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.lead_id,NEW.call_type,NEW.scheduled_at,NEW.assigned_to,NEW.is_completed,NEW.cancelled_at,NEW.outcome)
    IS NOT DISTINCT FROM ROW(OLD.lead_id,OLD.call_type,OLD.scheduled_at,OLD.assigned_to,OLD.is_completed,OLD.cancelled_at,OLD.outcome) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN PERFORM calendar_private.enqueue(OLD.id,OLD.lead_id); RETURN OLD; END IF;
  PERFORM calendar_private.enqueue(NEW.id,NEW.lead_id); RETURN NEW;
END $$;
CREATE TRIGGER google_calendar_call_changed AFTER INSERT OR UPDATE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION calendar_private.call_changed();
CREATE TRIGGER google_calendar_call_deleted BEFORE DELETE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION calendar_private.call_changed();
CREATE FUNCTION calendar_private.lead_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q record; lid uuid;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.name,NEW.pipeline_stage) IS NOT DISTINCT FROM ROW(OLD.name,OLD.pipeline_stage) THEN RETURN NEW; END IF;
  lid:=OLD.id;
  FOR q IN SELECT id FROM public.crm_activities WHERE lead_id=lid ORDER BY id LOOP PERFORM calendar_private.enqueue(q.id,lid); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER google_calendar_lead_changed AFTER UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION calendar_private.lead_changed();
CREATE TRIGGER google_calendar_lead_deleted BEFORE DELETE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION calendar_private.lead_changed();
CREATE FUNCTION calendar_private.closer_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q record;
BEGIN
  IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN RETURN NEW; END IF;
  FOR q IN SELECT id,lead_id FROM public.crm_activities WHERE assigned_to=NEW.user_id AND call_type='fechamento_closer' ORDER BY id
    LOOP PERFORM calendar_private.enqueue(q.id,q.lead_id); END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER google_calendar_closer_changed AFTER UPDATE OF display_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION calendar_private.closer_changed();

CREATE FUNCTION public.google_calendar_claim(p_limit integer,p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b calendar_private.bindings; claimed calendar_private.outbox; result jsonb:='[]'; c calendar_private.connection;
BEGIN
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.connection_status<>'connected' OR c.activated_at IS NULL THEN RETURN result; END IF;
  FOR b IN SELECT queued.* FROM calendar_private.bindings queued JOIN calendar_private.outbox o ON o.binding_id=queued.id
    WHERE queued.calendar_id=c.calendar_id AND o.available_at<=clock_timestamp() AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())
    ORDER BY o.available_at,queued.id LIMIT greatest(0,least(20,p_limit)) FOR UPDATE OF queued SKIP LOCKED
  LOOP
    UPDATE calendar_private.outbox SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>greatest(10,least(60,p_lease_seconds))),attempt=attempt+1
      WHERE binding_id=b.id AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING * INTO claimed;
    IF FOUND THEN
      result:=result||jsonb_build_array(jsonb_build_object('binding',calendar_private.binding_json(b),'leaseToken',claimed.lease_token,'leaseExpiresAt',claimed.lease_until,'attempt',claimed.attempt));
      UPDATE public.crm_google_calendar_status SET status=CASE WHEN status='removal_pending' THEN status ELSE 'syncing' END,updated_at=clock_timestamp() WHERE call_id=b.call_id;
    END IF;
  END LOOP;
  RETURN result;
END $$;
CREATE FUNCTION public.google_calendar_snapshot(p_binding_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b calendar_private.bindings; c calendar_private.connection; result jsonb;
BEGIN
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.connection_status<>'connected' THEN RETURN NULL; END IF;
  SELECT * INTO b FROM calendar_private.bindings WHERE id=p_binding_id AND calendar_id=c.calendar_id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM calendar_private.outbox WHERE binding_id=p_binding_id AND lease_token=p_token AND lease_until>clock_timestamp()) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('binding',calendar_private.binding_json(b),'connectionRevision',c.credential_revision::text,
    'call',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'leadId',a.lead_id,'callType',a.call_type,'scheduledAt',a.scheduled_at,
      'assignedTo',a.assigned_to,'isCompleted',a.is_completed,'cancelledAt',a.cancelled_at,'outcome',a.outcome) END,
    'lead',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id',l.id,'name',l.name,'pipelineStage',l.pipeline_stage) END,
    'closerName',p.display_name)
  INTO result FROM (SELECT 1) dummy LEFT JOIN public.crm_activities a ON a.id=b.call_id
    LEFT JOIN public.crm_leads l ON l.id=a.lead_id LEFT JOIN public.profiles p ON p.user_id=a.assigned_to;
  RETURN result;
END $$;
CREATE FUNCTION public.google_calendar_renew(p_binding_id uuid,p_token uuid,p_lease_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM calendar_private.connection WHERE connection_status='connected' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM calendar_private.bindings WHERE id=p_binding_id FOR SHARE;
  UPDATE calendar_private.outbox SET lease_until=clock_timestamp()+make_interval(secs=>greatest(10,least(60,p_lease_seconds)))
    WHERE binding_id=p_binding_id AND lease_token=p_token AND lease_until>clock_timestamp();
  RETURN FOUND;
END $$;
CREATE FUNCTION public.google_calendar_ack(p_binding_id uuid,p_token uuid,p_revision bigint,p_hash text,p_etag text,p_removed boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b calendar_private.bindings;
BEGIN
  PERFORM 1 FROM calendar_private.connection WHERE connection_status='connected' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO b FROM calendar_private.bindings WHERE id=p_binding_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM calendar_private.outbox WHERE binding_id=p_binding_id AND lease_token=p_token AND lease_until>clock_timestamp()) THEN RETURN false; END IF;
  IF b.revision<>p_revision THEN
    UPDATE calendar_private.outbox SET lease_token=NULL,lease_until=NULL WHERE binding_id=p_binding_id AND lease_token=p_token;
    RETURN false;
  END IF;
  UPDATE calendar_private.bindings SET confirmed_revision=p_revision,confirmed_hash=p_hash,etag=p_etag,removed=p_removed WHERE id=b.id;
  DELETE FROM calendar_private.outbox WHERE binding_id=b.id AND lease_token=p_token;
  UPDATE public.crm_google_calendar_status SET confirmed_revision=p_revision::text,status=CASE WHEN p_removed THEN 'removed' ELSE 'synced' END,
    error_code=NULL,last_synced_at=clock_timestamp(),updated_at=clock_timestamp() WHERE call_id=b.call_id;
  RETURN true;
END $$;
CREATE FUNCTION public.google_calendar_fail(p_binding_id uuid,p_token uuid,p_revision bigint,p_code text,p_retry_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b calendar_private.bindings;
BEGIN
  SELECT * INTO b FROM calendar_private.bindings WHERE id=p_binding_id FOR UPDATE;
  UPDATE calendar_private.outbox SET available_at=CASE WHEN b.revision=p_revision THEN p_retry_at ELSE clock_timestamp() END,
    error_code=CASE WHEN b.revision=p_revision THEN p_code ELSE NULL END,lease_token=NULL,lease_until=NULL
    WHERE binding_id=p_binding_id AND lease_token=p_token AND lease_until>clock_timestamp();
  IF FOUND AND b.revision=p_revision THEN
    UPDATE public.crm_google_calendar_status SET status='error',error_code=p_code,updated_at=clock_timestamp() WHERE call_id=b.call_id;
  END IF;
END $$;
CREATE FUNCTION public.google_calendar_rotate_event_id(p_binding_id uuid,p_token uuid,p_revision bigint,p_old_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b calendar_private.bindings;
BEGIN
  PERFORM 1 FROM calendar_private.connection WHERE connection_status='connected' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO b FROM calendar_private.bindings WHERE id=p_binding_id FOR UPDATE;
  IF b.revision<>p_revision OR b.event_id<>p_old_event_id OR NOT EXISTS(
    SELECT 1 FROM calendar_private.outbox WHERE binding_id=b.id AND lease_token=p_token AND lease_until>clock_timestamp()
  ) THEN RETURN NULL; END IF;
  UPDATE calendar_private.bindings SET event_id=replace(gen_random_uuid()::text,'-',''),generation=generation+1,revision=revision+1,
    confirmed_revision=NULL,confirmed_hash=NULL,etag=NULL,removed=false WHERE id=b.id RETURNING * INTO b;
  UPDATE public.crm_google_calendar_status SET desired_revision=b.revision::text,status='pending',updated_at=clock_timestamp() WHERE call_id=b.call_id;
  RETURN calendar_private.binding_json(b);
END $$;
CREATE FUNCTION public.google_calendar_scan_page(p_mode text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection; cur uuid; q record; n integer:=0; last_id uuid; cap integer:=greatest(1,least(500,p_limit)); more boolean;
BEGIN
  IF p_mode NOT IN ('backfill','reconcile') THEN RAISE EXCEPTION 'invalid_scan_mode' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.connection_status<>'connected' OR c.activated_at IS NULL THEN RETURN jsonb_build_object('processed',0,'done',true); END IF;
  SELECT cursor INTO cur FROM calendar_private.scan_state WHERE mode=p_mode FOR UPDATE;
  IF p_mode='backfill' THEN
    FOR q IN SELECT call_id,lead_id FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id ORDER BY call_id LIMIT cap
      LOOP PERFORM calendar_private.enqueue(q.call_id,q.lead_id); n:=n+1; last_id:=q.call_id; END LOOP;
    more:=EXISTS(SELECT 1 FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id);
  ELSE
    FOR q IN SELECT id,call_id,lead_id FROM calendar_private.bindings WHERE calendar_id=c.calendar_id AND NOT completed AND NOT removed AND (cur IS NULL OR id>cur) ORDER BY id LIMIT cap
    LOOP
      -- Reconciliation rechecks Google even when the CRM revision did not change.
      INSERT INTO calendar_private.outbox(binding_id) VALUES(q.id) ON CONFLICT DO NOTHING;
      n:=n+1; last_id:=q.id;
    END LOOP;
    more:=n=cap AND EXISTS(SELECT 1 FROM calendar_private.bindings WHERE calendar_id=c.calendar_id AND NOT completed AND NOT removed AND id>last_id);
  END IF;
  UPDATE calendar_private.scan_state SET cursor=CASE WHEN more THEN last_id ELSE NULL END WHERE mode=p_mode;
  RETURN jsonb_build_object('processed',n,'done',NOT more);
END $$;
CREATE FUNCTION public.google_calendar_record_run(p_started_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE calendar_private.connection SET last_run_at=greatest(last_run_at,p_started_at)
$$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'google_calendar_%'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
