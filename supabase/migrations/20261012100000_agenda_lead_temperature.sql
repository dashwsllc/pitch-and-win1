BEGIN;
SET LOCAL lock_timeout='5s';

-- CRM remains the source of truth, including temperature-only edits.
CREATE OR REPLACE FUNCTION calendar_private.lead_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q record; lid uuid;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.name,NEW.pipeline_stage,NEW.athlete_name,NEW.qualification_summary,NEW.observations,NEW.temperature)
    IS NOT DISTINCT FROM ROW(OLD.name,OLD.pipeline_stage,OLD.athlete_name,OLD.qualification_summary,OLD.observations,OLD.temperature) THEN RETURN NEW; END IF;
  lid:=OLD.id;
  FOR q IN SELECT id FROM public.crm_activities WHERE lead_id=lid ORDER BY id LOOP PERFORM calendar_private.enqueue(q.id,lid); END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

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
    'lead',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id',l.id,'name',l.name,'pipelineStage',l.pipeline_stage,'athleteName',l.athlete_name,'qualificationSummary',l.qualification_summary,'observations',l.observations,'temperature',l.temperature) END,
    'contexts',coalesce((SELECT jsonb_agg(jsonb_build_object('type',x.context_type,'content',x.content) ORDER BY x.created_at DESC,x.id) FROM (SELECT id,context_type,left(content,6000) AS content,created_at FROM public.crm_lead_contexts WHERE lead_id=l.id ORDER BY created_at DESC,id LIMIT 20) x),'[]'::jsonb),
    'closerName',p.display_name)
  INTO result FROM (SELECT 1) dummy LEFT JOIN public.crm_activities a ON a.id=b.call_id LEFT JOIN public.crm_leads l ON l.id=a.lead_id LEFT JOIN public.profiles p ON p.user_id=a.assigned_to;
  RETURN result;
END $$;

-- Refresh existing linked events in place; preserve event IDs and Meet links.
-- Do not import old, unbound calls or resurrect removed events.
DO $$ DECLARE q record; BEGIN
  FOR q IN SELECT a.id,a.lead_id FROM calendar_private.bindings b
    JOIN calendar_private.connection c ON c.calendar_id=b.calendar_id AND c.connection_status='connected'
    JOIN public.crm_activities a ON a.id=b.call_id
    WHERE NOT b.removed AND a.call_type='fechamento_closer'
    ORDER BY a.id
  LOOP PERFORM calendar_private.enqueue(q.id,q.lead_id); END LOOP;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
