-- Receipt is durable and independent of processing ownership.
BEGIN;
ALTER TABLE public.meta_webhook_events
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),ADD COLUMN lease_until timestamptz,ADD COLUMN claim_token uuid,
 ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0 CHECK(processing_attempts>=0),
 ADD COLUMN receipt_count integer NOT NULL DEFAULT 1 CHECK(receipt_count>=1),ADD COLUMN error_class text;
UPDATE public.meta_webhook_events SET receipt_count=attempts;
ALTER TABLE public.meta_webhook_events DROP CONSTRAINT meta_webhook_events_status_check;
ALTER TABLE public.meta_webhook_events ADD CONSTRAINT meta_webhook_events_status_check CHECK(status IN ('pending','processing','processed','error','ignored'));
ALTER TABLE public.meta_webhook_events ADD CONSTRAINT meta_webhook_events_ownership CHECK((status='processing')=(claim_token IS NOT NULL AND lease_until IS NOT NULL));
CREATE INDEX meta_lead_events_due ON public.meta_webhook_events(page_id,next_attempt_at,received_at,id) WHERE status IN ('pending','error','processing');
CREATE TABLE public.meta_lead_discovery_state (
 page_id text PRIMARY KEY,version bigint NOT NULL DEFAULT 1,window_since timestamptz NOT NULL,window_until timestamptz NOT NULL,
 forms_next jsonb,form_id text,leads_next jsonb,form_queue jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(form_queue)='array'),
 active_form_name text,last_completed_until timestamptz,lease_until timestamptz,claim_token uuid,last_error text,
 CHECK((lease_until IS NULL)=(claim_token IS NULL))
);
ALTER TABLE public.meta_lead_discovery_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_lead_discovery_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_lead_discovery_state TO service_role;

CREATE OR REPLACE FUNCTION public.meta_webhook_event_receive(p_leadgen_id text,p_page_id text,p_form_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE id uuid; meta_id text:=btrim(coalesce(p_leadgen_id,'')); page text:=btrim(coalesce(p_page_id,'')); form text:=btrim(coalesce(p_form_id,''));
BEGIN
 PERFORM public.meta_capture_require_service();
 IF length(meta_id) NOT BETWEEN 1 AND 100 OR length(page) NOT BETWEEN 1 AND 100 OR length(form) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Identidade de evento inválida' USING ERRCODE='22023'; END IF;
 INSERT INTO public.meta_webhook_events(leadgen_id,page_id,form_id) VALUES(meta_id,page,form)
 ON CONFLICT(leadgen_id) DO UPDATE SET receipt_count=least(meta_webhook_events.receipt_count::bigint+1,2147483647)::int,updated_at=clock_timestamp()
 WHERE meta_webhook_events.page_id=excluded.page_id AND meta_webhook_events.form_id=excluded.form_id
 RETURNING meta_webhook_events.id INTO id;
 IF id IS NULL THEN RAISE EXCEPTION 'Replay com página ou formulário diferente' USING ERRCODE='22023'; END IF;
 RETURN id;
END $$;
CREATE FUNCTION public.meta_lead_events_claim(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 60,p_page_ids text[] DEFAULT '{}') RETURNS SETOF public.meta_webhook_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.meta_capture_require_service();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Claim inválido' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH due AS (
   SELECT e.id FROM public.meta_webhook_events e WHERE e.page_id=ANY(coalesce(p_page_ids,'{}')) AND
     ((e.status IN ('pending','error') AND e.next_attempt_at<=clock_timestamp()) OR (e.status='processing' AND e.lease_until<=clock_timestamp()))
   ORDER BY e.next_attempt_at,e.received_at,e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
 ) UPDATE public.meta_webhook_events e SET status='processing',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   processing_attempts=least(e.processing_attempts::bigint+1,2147483647)::int,updated_at=clock_timestamp()
   FROM due WHERE e.id=due.id RETURNING e.*;
END $$;
CREATE FUNCTION public.meta_lead_event_check_claim(p_id uuid,p_claim uuid) RETURNS public.meta_webhook_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.meta_webhook_events;
BEGIN
 PERFORM public.meta_capture_require_service();
 SELECT * INTO e FROM public.meta_webhook_events WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e.status<>'processing' OR p_claim IS NULL OR e.claim_token IS DISTINCT FROM p_claim OR e.lease_until<=clock_timestamp() THEN
   RAISE EXCEPTION 'Lease do lead expirado ou substituído' USING ERRCODE='40001'; END IF;
 RETURN e;
END $$;
CREATE FUNCTION public.meta_lead_event_ingest(p_id uuid,p_claim uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.meta_webhook_events; lead uuid;
BEGIN
 e:=public.meta_lead_event_check_claim(p_id,p_claim);
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_data->>'meta_lead_id' IS DISTINCT FROM e.leadgen_id
   OR p_data->>'page_id' IS DISTINCT FROM e.page_id OR p_data->>'form_id' IS DISTINCT FROM e.form_id THEN RAISE EXCEPTION 'Lead diferente do evento recebido' USING ERRCODE='22023'; END IF;
 lead:=public.meta_ingest_form_lead(p_data);
 UPDATE public.meta_webhook_events SET status='processed',meta_form_lead_id=lead,processed_at=clock_timestamp(),
   claim_token=NULL,lease_until=NULL,last_error=NULL,error_class=NULL,updated_at=clock_timestamp() WHERE id=p_id;
 RETURN lead;
END $$;
CREATE FUNCTION public.meta_lead_event_fail(p_id uuid,p_claim uuid,p_error text,p_class text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.meta_webhook_events; minutes int; stamp timestamptz:=clock_timestamp();
BEGIN
 e:=public.meta_lead_event_check_claim(p_id,p_claim);
 IF p_class IS NULL OR p_class NOT IN ('transient','configuration','permission','invalid_data') THEN RAISE EXCEPTION 'Classe de erro inválida' USING ERRCODE='22023'; END IF;
 minutes:=CASE WHEN p_class<>'transient' THEN 60 WHEN e.processing_attempts=1 THEN 1 WHEN e.processing_attempts=2 THEN 5 WHEN e.processing_attempts=3 THEN 15 ELSE 60 END;
 UPDATE public.meta_webhook_events SET status='error',claim_token=NULL,lease_until=NULL,last_error=left(p_error,1000),error_class=p_class,
   next_attempt_at=stamp+make_interval(mins=>minutes),updated_at=stamp WHERE id=p_id;
END $$;
CREATE FUNCTION public.meta_lead_event_ignore(p_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.meta_capture_require_service();
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Motivo necessário' USING ERRCODE='22023'; END IF;
 UPDATE public.meta_webhook_events SET status='ignored',last_error=p_reason,error_class='allowlist',updated_at=clock_timestamp()
   WHERE id=p_id AND status IN ('pending','error') AND claim_token IS NULL;
 -- Idempotent replay must not change a processed/claimed event.
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.meta_webhook_events WHERE id=p_id) THEN RAISE EXCEPTION 'Evento não encontrado' USING ERRCODE='22023'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.meta_webhook_event_complete(p_id uuid,p_status text,p_error text DEFAULT NULL,p_meta_form_lead_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.meta_webhook_events;
BEGIN
 PERFORM public.meta_capture_require_service();
 IF p_status IS NULL OR p_status NOT IN ('processed','error','ignored') THEN RAISE EXCEPTION 'Status inválido' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.meta_webhook_events WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evento não encontrado' USING ERRCODE='22023'; END IF;
 IF e.status IN ('processed','processing') THEN RETURN; END IF;
 IF p_status='processed' AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads f WHERE f.id=p_meta_form_lead_id AND f.meta_lead_id=e.leadgen_id AND f.page_id=e.page_id AND f.form_id=e.form_id) THEN
   RAISE EXCEPTION 'Conclusão sem lead persistido compatível' USING ERRCODE='22023'; END IF;
 UPDATE public.meta_webhook_events SET status=p_status,last_error=left(p_error,1000),meta_form_lead_id=coalesce(p_meta_form_lead_id,meta_form_lead_id),
   processed_at=CASE WHEN p_status='processed' THEN clock_timestamp() ELSE processed_at END,updated_at=clock_timestamp(),
   next_attempt_at=clock_timestamp()+interval '1 minute' WHERE id=p_id;
END $$;

CREATE FUNCTION public.meta_lead_discovery_claim(p_page_id text,p_lease_seconds integer DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.meta_lead_discovery_state; stamp timestamptz:=clock_timestamp();
BEGIN
 PERFORM public.meta_capture_require_service();
 IF p_page_id IS NULL OR p_page_id !~ '^[A-Za-z0-9_-]{1,100}$' OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Descoberta inválida' USING ERRCODE='22023'; END IF;
 INSERT INTO public.meta_lead_discovery_state(page_id,window_since,window_until,forms_next) VALUES(p_page_id,stamp-interval '48 hours',stamp,
   jsonb_build_object('path','/'||p_page_id||'/leadgen_forms','params',jsonb_build_object('fields','id,name','limit','50'))) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT d FROM public.meta_lead_discovery_state WHERE page_id=p_page_id FOR UPDATE;
 IF d.lease_until>stamp THEN RETURN NULL; END IF;
 IF d.forms_next IS NULL AND d.form_id IS NULL AND d.form_queue='[]' THEN
   d.window_since:=coalesce(d.last_completed_until-interval '5 minutes',stamp-interval '48 hours');d.window_until:=stamp;
   d.forms_next:=jsonb_build_object('path','/'||p_page_id||'/leadgen_forms','params',jsonb_build_object('fields','id,name','limit','50'));
 END IF;
 UPDATE public.meta_lead_discovery_state SET claim_token=gen_random_uuid(),lease_until=stamp+make_interval(secs=>p_lease_seconds),
   version=version+1,window_since=d.window_since,window_until=d.window_until,forms_next=d.forms_next WHERE page_id=p_page_id RETURNING * INTO d;
 RETURN to_jsonb(d);
END $$;
CREATE FUNCTION public.meta_lead_discovery_checkpoint(p_page_id text,p_claim uuid,p_expected_version bigint,p_state jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.meta_lead_discovery_state; cursor jsonb; key text; chosen_form text; candidate jsonb;
BEGIN
 PERFORM public.meta_capture_require_service();
 SELECT * INTO d FROM public.meta_lead_discovery_state WHERE page_id=p_page_id FOR UPDATE;
 IF NOT FOUND OR p_claim IS NULL OR d.claim_token IS DISTINCT FROM p_claim OR d.lease_until<=clock_timestamp() OR d.version IS DISTINCT FROM p_expected_version THEN
   RAISE EXCEPTION 'Descoberta alterada ou lease expirado' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_state) k WHERE k NOT IN ('received_ids','forms_next','form_id','leads_next','form_queue','active_form_name','last_completed_until'))
   OR jsonb_typeof(p_state->'received_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_state->'received_ids')>500 THEN
   RAISE EXCEPTION 'Checkpoint inválido: recibos necessários' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_state->'received_ids') received(id) WHERE NOT EXISTS(
   SELECT 1 FROM public.meta_webhook_events e WHERE e.leadgen_id=received.id AND e.page_id=p_page_id)) THEN
   RAISE EXCEPTION 'Página de leads ainda não persistida' USING ERRCODE='22023'; END IF;
 chosen_form:=CASE WHEN p_state ? 'form_id' THEN nullif(p_state->>'form_id','') ELSE d.form_id END;
 IF chosen_form IS NOT NULL AND chosen_form !~ '^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'Formulário inválido' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_state->'received_ids') received(id) WHERE NOT EXISTS(
   SELECT 1 FROM public.meta_webhook_events e WHERE e.leadgen_id=received.id AND e.page_id=p_page_id
     AND (coalesce(d.form_id,chosen_form) IS NULL OR e.form_id=coalesce(d.form_id,chosen_form)))) THEN
   RAISE EXCEPTION 'Recibo pertence a outro formulário' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY ARRAY['forms_next','leads_next'] LOOP
   cursor:=p_state->key;
   IF cursor IS NOT NULL AND cursor<>'null'::jsonb AND (jsonb_typeof(cursor) IS DISTINCT FROM 'object' OR jsonb_typeof(cursor->'params') IS DISTINCT FROM 'object'
     OR cursor::text ~* '(access_token|appsecret_proof)' OR cursor->>'path' IS DISTINCT FROM CASE key WHEN 'forms_next' THEN '/'||p_page_id||'/leadgen_forms' ELSE '/'||chosen_form||'/leads' END) THEN
     RAISE EXCEPTION 'Cursor de descoberta fora do escopo' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_state ? 'form_queue' AND (jsonb_typeof(p_state->'form_queue') IS DISTINCT FROM 'array' OR jsonb_array_length(p_state->'form_queue')>500
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'form_queue') f WHERE coalesce(f->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$' OR length(coalesce(f->>'name',''))>160)) THEN
   RAISE EXCEPTION 'Fila de formulários inválida' USING ERRCODE='22023'; END IF;
 IF p_state ? 'last_completed_until' AND ((p_state->>'last_completed_until')::timestamptz IS DISTINCT FROM d.window_until) THEN RAISE EXCEPTION 'Janela de descoberta incompatível' USING ERRCODE='22023'; END IF;
 candidate:=to_jsonb(d)||p_state;
 IF p_state ? 'last_completed_until' AND (candidate->'forms_next' IS DISTINCT FROM 'null'::jsonb
   OR candidate->'leads_next' IS DISTINCT FROM 'null'::jsonb OR chosen_form IS NOT NULL OR candidate->'form_queue'<>'[]'::jsonb) THEN
   RAISE EXCEPTION 'Descoberta incompleta não pode avançar a janela' USING ERRCODE='22023'; END IF;
 UPDATE public.meta_lead_discovery_state SET
   forms_next=CASE WHEN p_state ? 'forms_next' THEN nullif(p_state->'forms_next','null'::jsonb) ELSE forms_next END,
   form_id=chosen_form,leads_next=CASE WHEN p_state ? 'leads_next' THEN nullif(p_state->'leads_next','null'::jsonb) ELSE leads_next END,
   form_queue=CASE WHEN p_state ? 'form_queue' THEN p_state->'form_queue' ELSE form_queue END,
   active_form_name=CASE WHEN p_state ? 'active_form_name' THEN left(p_state->>'active_form_name',160) ELSE active_form_name END,
   last_completed_until=CASE WHEN p_state ? 'last_completed_until' THEN (p_state->>'last_completed_until')::timestamptz ELSE last_completed_until END,
   version=version+1,last_error=NULL WHERE page_id=p_page_id RETURNING * INTO d;
 RETURN d.version;
END $$;
CREATE FUNCTION public.meta_lead_discovery_release(p_page_id text,p_claim uuid,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.meta_capture_require_service();
 UPDATE public.meta_lead_discovery_state SET claim_token=NULL,lease_until=NULL,last_error=left(p_error,1000)
   WHERE page_id=p_page_id AND p_claim IS NOT NULL AND claim_token=p_claim AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease da descoberta expirado' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_lead_event_check_claim(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.meta_webhook_event_receive(text,text,text),public.meta_webhook_event_complete(uuid,text,text,uuid),public.meta_lead_events_claim(integer,integer,text[]),
 public.meta_lead_event_ingest(uuid,uuid,jsonb),public.meta_lead_event_fail(uuid,uuid,text,text),public.meta_lead_event_ignore(uuid,text),
 public.meta_lead_discovery_claim(text,integer),public.meta_lead_discovery_checkpoint(text,uuid,bigint,jsonb),public.meta_lead_discovery_release(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_webhook_event_receive(text,text,text),public.meta_webhook_event_complete(uuid,text,text,uuid),public.meta_lead_events_claim(integer,integer,text[]),
 public.meta_lead_event_ingest(uuid,uuid,jsonb),public.meta_lead_event_fail(uuid,uuid,text,text),public.meta_lead_event_ignore(uuid,text),
 public.meta_lead_discovery_claim(text,integer),public.meta_lead_discovery_checkpoint(text,uuid,bigint,jsonb),public.meta_lead_discovery_release(text,uuid,text) TO service_role;
COMMIT;
