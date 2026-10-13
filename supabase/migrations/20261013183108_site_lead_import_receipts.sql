-- Additive durable inbox. Raw source versions and human decisions are never replaced.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

CREATE TABLE public.site_import_events(
 event_id uuid PRIMARY KEY, receipt_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 source_project text NOT NULL CHECK(source_project='mehmqibxzxfqdxqjnjad'),
 source_lead_id uuid NOT NULL, source_revision bigint NOT NULL CHECK(source_revision>0),
 schema_version integer NOT NULL, body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
 event jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 meta_form_lead_id uuid REFERENCES public.meta_form_leads(id),
 status text NOT NULL CHECK(status IN('pending_review','context_only','superseded','quarantined')),
 error_code text, UNIQUE(source_project,source_lead_id,source_revision));
CREATE INDEX site_import_events_contact_time ON public.site_import_events(meta_form_lead_id,received_at DESC,event_id DESC);
CREATE INDEX site_import_events_source_revision ON public.site_import_events(source_lead_id,source_revision DESC);
ALTER TABLE public.site_import_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_import_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.site_import_events TO authenticated;
CREATE POLICY site_import_events_read ON public.site_import_events FOR SELECT TO authenticated
 USING(public.traffic_has_access() OR EXISTS(SELECT FROM public.crm_leads c WHERE c.meta_form_lead_id=site_import_events.meta_form_lead_id));

CREATE TABLE public.site_bridge_health(source_project text PRIMARY KEY CHECK(source_project='mehmqibxzxfqdxqjnjad'),
 observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(), status jsonb NOT NULL);
ALTER TABLE public.site_bridge_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_bridge_health FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.site_import_receive(p_event jsonb,p_body_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sid uuid; eid uuid; revision bigint; schema_v integer; existing public.site_import_events; f public.meta_form_leads;
 state text; error text; latest bigint; contact jsonb; profile jsonb; fields jsonb; mapped jsonb;
 generated timestamptz; source_updated timestamptz; valid_v1 boolean:=false; v_name text; v_phone text; v_email text; warning text;
BEGIN
 IF p_event->>'source_project' IS DISTINCT FROM 'mehmqibxzxfqdxqjnjad' OR p_body_sha256 !~ '^[0-9a-f]{64}$' OR p_body_sha256 IS NULL THEN
  RAISE EXCEPTION 'Invalid source identity or hash' USING ERRCODE='22023'; END IF;
 sid:=(p_event->>'source_lead_id')::uuid;eid:=(p_event->>'event_id')::uuid;revision:=(p_event->>'source_revision')::bigint;schema_v:=(p_event->>'schema_version')::integer;
 IF sid IS NULL OR eid IS NULL OR revision IS NULL OR revision<1 OR schema_v IS NULL OR schema_v<1 THEN RAISE EXCEPTION 'Invalid event identity' USING ERRCODE='22023'; END IF;
 -- Shared with manual imports, wave assignment and review: one transaction determines identity and membership.
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
 SELECT * INTO existing FROM public.site_import_events WHERE event_id=eid;
 IF FOUND THEN
  IF existing.body_sha256<>p_body_sha256 OR existing.event<>p_event THEN RAISE EXCEPTION 'Event identity conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('event_id',existing.event_id,'source_lead_id',existing.source_lead_id,'source_revision',existing.source_revision,'receipt_id',existing.receipt_id,'status',existing.status);
 END IF;
 IF EXISTS(SELECT FROM public.site_import_events WHERE source_project='mehmqibxzxfqdxqjnjad' AND source_lead_id=sid AND source_revision=revision) THEN
  RAISE EXCEPTION 'Source revision identity conflict' USING ERRCODE='23505'; END IF;
 SELECT * INTO f FROM public.meta_form_leads WHERE meta_lead_id='site:zyron:'||sid FOR UPDATE;
 SELECT max(source_revision) INTO latest FROM public.site_import_events WHERE source_lead_id=sid AND status<>'quarantined';
 BEGIN
  generated:=(p_event->>'generated_at')::timestamptz;source_updated:=(p_event->>'source_updated_at')::timestamptz;
  valid_v1:=schema_v=1 AND jsonb_typeof(p_event->'payload')='object'
   AND generated IS NOT NULL AND source_updated IS NOT NULL AND isfinite(generated) AND isfinite(source_updated)
   AND generated<=clock_timestamp()+interval '1 day' AND source_updated<=clock_timestamp()+interval '1 day';
 EXCEPTION WHEN data_exception THEN valid_v1:=false; END;
 IF NOT coalesce(valid_v1,false) THEN state:='quarantined';error:=CASE WHEN schema_v<>1 THEN 'unsupported_schema' ELSE 'invalid_payload' END;
 ELSIF revision<=coalesce(latest,0) THEN state:='superseded';
 ELSIF f.id IS NOT NULL AND (f.approval_status<>'pendente' OR f.lead_import_batch_id IS NOT NULL OR f.traffic_edited_at IS NOT NULL) THEN state:='context_only';
 ELSE
  contact:=coalesce(p_event->'payload'->'contact','{}');profile:=coalesce(p_event->'payload'->'profile','{}');
  v_name:=left(btrim(coalesce(contact->>'name','')),160);v_phone:=left(regexp_replace(coalesce(contact->>'phone',''),'[^0-9]','','g'),32);v_email:=left(btrim(coalesce(contact->>'email','')),254);
  warning:=CASE WHEN length(v_name)<2 OR length(v_phone) NOT BETWEEN 8 AND 15 THEN 'Contato incompleto: confira nome e WhatsApp antes de aprovar' END;
  IF warning IS NULL AND EXISTS(SELECT FROM public.meta_form_leads x WHERE x.meta_lead_id<>'site:zyron:'||sid AND
   (regexp_replace(x.phone,'[^0-9]','','g')=v_phone OR v_email<>'' AND lower(x.email)=lower(v_email))) THEN
   warning:='Possível contato semelhante em outra origem; confira as identidades. Nenhuma fusão automática foi feita'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',left(key,80),'values',jsonb_build_array(left(value#>>'{}',160))) ORDER BY key),'[]') INTO fields
   FROM (SELECT key,value FROM jsonb_each(CASE WHEN jsonb_typeof(profile)='object' THEN profile ELSE '{}' END)
    WHERE jsonb_typeof(value) IN('string','number','boolean') AND key NOT IN('photo','report') ORDER BY key LIMIT 20)s;
  mapped:=jsonb_build_object('name',v_name,'phone',v_phone,'email',v_email,'athlete_name',left(coalesce(profile->>'name',v_name),160),
   'athlete_age',left(coalesce(profile->>'age',''),10),'athlete_height_cm',left(coalesce(profile->>'height',''),10),
   'athlete_weight_kg',left(coalesce(profile->>'weight',''),10),'athlete_position',left(coalesce(profile->>'position',''),100),
   'city_state',left(concat_ws(' / ',nullif(profile->>'city',''),nullif(profile->>'state','')),160),'source_has_date',true,'time_known',true);
  IF f.id IS NULL THEN
   INSERT INTO public.meta_form_leads(meta_lead_id,page_id,form_id,form_name,created_time,field_data,full_name,phone,email,entry_channel,import_contact,import_warning,source_snapshot,received_at,updated_at)
    VALUES('site:zyron:'||sid,'site:zyron','site:avaliacao','Site / conversão direta',generated,fields,v_name,v_phone,v_email,'website',mapped,warning,jsonb_build_object('site_event',p_event),clock_timestamp(),clock_timestamp()) RETURNING * INTO f;
  ELSE
   UPDATE public.meta_form_leads SET created_time=generated,field_data=fields,full_name=v_name,phone=v_phone,email=v_email,
    import_contact=mapped,import_warning=warning,source_snapshot=jsonb_build_object('site_event',p_event),updated_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
  END IF;
  state:='pending_review';
 END IF;
 INSERT INTO public.site_import_events(event_id,source_project,source_lead_id,source_revision,schema_version,body_sha256,event,meta_form_lead_id,status,error_code)
  VALUES(eid,'mehmqibxzxfqdxqjnjad',sid,revision,schema_v,p_body_sha256,p_event,f.id,state,error) RETURNING * INTO existing;
 RETURN jsonb_build_object('event_id',existing.event_id,'source_lead_id',sid,'source_revision',revision,'receipt_id',existing.receipt_id,'status',state);
END $$;
REVOKE ALL ON FUNCTION public.site_import_receive(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_import_receive(jsonb,text) TO service_role;

CREATE FUNCTION public.site_bridge_heartbeat_receive(p_status jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE stamp timestamptz:=(p_status->>'observed_at')::timestamptz;
BEGIN
 IF p_status->>'source_project' IS DISTINCT FROM 'mehmqibxzxfqdxqjnjad' OR stamp IS NULL OR NOT isfinite(stamp) OR stamp>clock_timestamp()+interval '5 minutes'
  OR (p_status->>'pending_count')::bigint<0 OR (p_status->>'quarantined_count')::bigint<0 THEN RAISE EXCEPTION 'Invalid health signal' USING ERRCODE='22023'; END IF;
 INSERT INTO public.site_bridge_health(source_project,observed_at,status) VALUES('mehmqibxzxfqdxqjnjad',stamp,p_status)
 ON CONFLICT(source_project) DO UPDATE SET observed_at=excluded.observed_at,received_at=clock_timestamp(),status=excluded.status WHERE excluded.observed_at>site_bridge_health.observed_at;
END $$;
REVOKE ALL ON FUNCTION public.site_bridge_heartbeat_receive(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_bridge_heartbeat_receive(jsonb) TO service_role;

CREATE FUNCTION public.site_bridge_operation() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE health public.site_bridge_health;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 SELECT * INTO health FROM public.site_bridge_health WHERE source_project='mehmqibxzxfqdxqjnjad';
 RETURN jsonb_build_object('last_heartbeat',health.observed_at,'heartbeat_received_at',health.received_at,
  'last_received_at',(SELECT max(received_at) FROM public.site_import_events),
  'pending_count',health.status->'pending_count','quarantined_count',coalesce((health.status->>'quarantined_count')::bigint,0)+(SELECT count(*) FROM public.site_import_events WHERE status='quarantined'),
  'oldest_pending_at',health.status->'oldest_pending_at');
END $$;
REVOKE ALL ON FUNCTION public.site_bridge_operation() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.site_bridge_operation() TO authenticated;

CREATE TRIGGER site_import_events_signal AFTER INSERT ON public.site_import_events REFERENCING NEW TABLE AS meta_signal_new
 FOR EACH STATEMENT EXECUTE FUNCTION public.meta_changed_signal('arena','crm');
COMMIT;
