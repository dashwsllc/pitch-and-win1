BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.crm_activities ADD COLUMN duration_minutes integer NOT NULL DEFAULT 30 CHECK(duration_minutes BETWEEN 1 AND 480);
ALTER TABLE public.crm_google_calendar_status ADD COLUMN meeting_url text CHECK(meeting_url IS NULL OR meeting_url ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$');
ALTER TABLE calendar_private.connection ADD COLUMN manual_refresh_at timestamptz;

-- Keep the original RPC signatures available to clients cached before rollout.
CREATE FUNCTION public.crm_schedule_call_details(p_lead_id uuid,p_call_type text,p_scheduled_at timestamptz,p_assigned_to uuid,p_context text,p_duration_minutes integer,p_expected_version bigint DEFAULT NULL)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.crm_activities;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 1 AND 480 THEN RAISE EXCEPTION 'Duração inválida' USING ERRCODE='22023'; END IF;
  IF p_expected_version IS NOT NULL THEN
    IF p_call_type IS DISTINCT FROM 'fechamento_closer' THEN RAISE EXCEPTION 'Tipo inválido' USING ERRCODE='22023'; END IF;
    c:=public.handoff_and_schedule_closer_call(p_lead_id,p_expected_version,p_scheduled_at,p_assigned_to,p_context);
  ELSE c:=public.schedule_closer_call(p_lead_id,p_call_type,p_scheduled_at,p_assigned_to,p_context); END IF;
  UPDATE public.crm_activities SET duration_minutes=p_duration_minutes WHERE id=c.id RETURNING * INTO c;
  RETURN c;
END $$;
CREATE FUNCTION public.crm_edit_call_details(p_activity_id uuid,p_assigned_to uuid,p_scheduled_at timestamptz,p_expected_revision timestamptz,p_duration_minutes integer)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.crm_activities; current_assignee uuid;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 1 AND 480 THEN RAISE EXCEPTION 'Duração inválida' USING ERRCODE='22023'; END IF;
  SELECT assigned_to INTO current_assignee FROM public.crm_activities WHERE id=p_activity_id;
  -- The existing RPC performs role checks, lead-first locking and revision CAS.
  c:=public.update_crm_call(p_activity_id,coalesce(p_assigned_to,current_assignee),p_scheduled_at,p_expected_revision);
  UPDATE public.crm_activities SET duration_minutes=p_duration_minutes WHERE id=c.id AND duration_minutes IS DISTINCT FROM p_duration_minutes RETURNING * INTO c;
  IF NOT FOUND THEN SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id; END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.crm_schedule_call_details(uuid,text,timestamptz,uuid,text,integer,bigint),public.crm_edit_call_details(uuid,uuid,timestamptz,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_schedule_call_details(uuid,text,timestamptz,uuid,text,integer,bigint),public.crm_edit_call_details(uuid,uuid,timestamptz,timestamptz,integer) TO authenticated;

CREATE OR REPLACE FUNCTION calendar_private.call_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.lead_id,NEW.call_type,NEW.scheduled_at,NEW.assigned_to,NEW.is_completed,NEW.cancelled_at,NEW.outcome,NEW.duration_minutes,NEW.description)
    IS NOT DISTINCT FROM ROW(OLD.lead_id,OLD.call_type,OLD.scheduled_at,OLD.assigned_to,OLD.is_completed,OLD.cancelled_at,OLD.outcome,OLD.duration_minutes,OLD.description) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN PERFORM calendar_private.enqueue(OLD.id,OLD.lead_id); RETURN OLD; END IF;
  PERFORM calendar_private.enqueue(NEW.id,NEW.lead_id); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION calendar_private.lead_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q record; lid uuid;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.name,NEW.pipeline_stage,NEW.athlete_name,NEW.qualification_summary,NEW.observations)
    IS NOT DISTINCT FROM ROW(OLD.name,OLD.pipeline_stage,OLD.athlete_name,OLD.qualification_summary,OLD.observations) THEN RETURN NEW; END IF;
  lid:=OLD.id;
  FOR q IN SELECT id FROM public.crm_activities WHERE lead_id=lid ORDER BY id LOOP PERFORM calendar_private.enqueue(q.id,lid); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION calendar_private.context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q record; lid uuid;
BEGIN
  lid:=CASE WHEN TG_OP='DELETE' THEN OLD.lead_id ELSE NEW.lead_id END;
  FOR q IN SELECT id FROM public.crm_activities WHERE lead_id=lid AND call_type='fechamento_closer' ORDER BY id LOOP PERFORM calendar_private.enqueue(q.id,lid); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER google_calendar_context_changed AFTER INSERT OR UPDATE OR DELETE ON public.crm_lead_contexts FOR EACH ROW EXECUTE FUNCTION calendar_private.context_changed();

CREATE OR REPLACE FUNCTION public.google_calendar_snapshot(p_binding_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b calendar_private.bindings; c calendar_private.connection; result jsonb;
BEGIN
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.connection_status<>'connected' THEN RETURN NULL; END IF;
  SELECT * INTO b FROM calendar_private.bindings WHERE id=p_binding_id AND calendar_id=c.calendar_id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM calendar_private.outbox WHERE binding_id=p_binding_id AND lease_token=p_token AND lease_until>clock_timestamp()) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('binding',calendar_private.binding_json(b),'connectionRevision',c.credential_revision::text,
    'call',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'leadId',a.lead_id,'callType',a.call_type,'scheduledAt',a.scheduled_at,
      'assignedTo',a.assigned_to,'isCompleted',a.is_completed,'cancelledAt',a.cancelled_at,'outcome',a.outcome,'context',a.description,'durationMinutes',a.duration_minutes) END,
    'lead',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id',l.id,'name',l.name,'pipelineStage',l.pipeline_stage,'athleteName',l.athlete_name,'qualificationSummary',l.qualification_summary,'observations',l.observations) END,
    'contexts',coalesce((SELECT jsonb_agg(jsonb_build_object('type',x.context_type,'content',x.content) ORDER BY x.created_at DESC,x.id) FROM (SELECT id,context_type,left(content,6000) AS content,created_at FROM public.crm_lead_contexts WHERE lead_id=l.id ORDER BY created_at DESC,id LIMIT 20) x),'[]'::jsonb),
    'closerName',p.display_name)
  INTO result FROM (SELECT 1) dummy LEFT JOIN public.crm_activities a ON a.id=b.call_id LEFT JOIN public.crm_leads l ON l.id=a.lead_id LEFT JOIN public.profiles p ON p.user_id=a.assigned_to;
  RETURN result;
END $$;

CREATE FUNCTION public.google_calendar_request_refresh(p_actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection; q record;
BEGIN
  IF NOT public.crm_user_can(p_actor,'closer') OR NOT EXISTS(SELECT 1 FROM public.registration_requests WHERE user_id=p_actor AND status='approved') THEN RAISE EXCEPTION 'Acesso Closer necessário' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM calendar_private.connection FOR UPDATE;
  IF c.connection_status<>'connected' OR c.activated_at IS NULL THEN RAISE EXCEPTION 'Agenda desconectada' USING ERRCODE='22023'; END IF;
  IF c.manual_refresh_at>clock_timestamp()-interval '10 seconds' THEN RETURN false; END IF;
  UPDATE calendar_private.connection SET manual_refresh_at=clock_timestamp() WHERE singleton;
  -- Repair missed new-call enqueues, without importing pre-activation overdue calls.
  FOR q IN SELECT a.id,a.lead_id FROM public.crm_activities a JOIN public.crm_leads l ON l.id=a.lead_id
    WHERE a.call_type='fechamento_closer' AND NOT a.is_completed AND a.cancelled_at IS NULL AND a.outcome IS NULL
      AND a.assigned_to IS NOT NULL AND a.scheduled_at>clock_timestamp() AND l.pipeline_stage='repassado_closer'
      AND NOT EXISTS(SELECT 1 FROM calendar_private.bindings b WHERE b.call_id=a.id AND b.calendar_id=c.calendar_id)
    ORDER BY a.id LIMIT 500 LOOP PERFORM calendar_private.enqueue(q.id,q.lead_id); END LOOP;
  UPDATE calendar_private.outbox SET available_at=clock_timestamp(),attempt=0,error_code=NULL WHERE binding_id IN(SELECT id FROM calendar_private.bindings WHERE calendar_id=c.calendar_id);
  UPDATE public.crm_google_calendar_status SET status='pending',error_code=NULL,updated_at=clock_timestamp() WHERE status='error';
  RETURN true;
END $$;
-- Refresh is for approved closers; admin retry remains restricted separately.
CREATE FUNCTION public.google_calendar_pending() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM calendar_private.outbox) $$;
CREATE FUNCTION public.google_calendar_ack_details(p_binding_id uuid,p_token uuid,p_revision bigint,p_hash text,p_etag text,p_removed boolean,p_meeting_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ok boolean;
BEGIN
  ok:=public.google_calendar_ack(p_binding_id,p_token,p_revision,p_hash,p_etag,p_removed);
  IF ok THEN UPDATE public.crm_google_calendar_status SET meeting_url=CASE WHEN p_removed THEN NULL ELSE p_meeting_url END
    WHERE call_id=(SELECT call_id FROM calendar_private.bindings WHERE id=p_binding_id) AND desired_revision=p_revision::text; END IF;
  RETURN ok;
END $$;
REVOKE ALL ON FUNCTION public.google_calendar_request_refresh(uuid),public.google_calendar_ack_details(uuid,uuid,bigint,text,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_request_refresh(uuid),public.google_calendar_ack_details(uuid,uuid,bigint,text,text,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION public.google_calendar_pending() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_pending() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
