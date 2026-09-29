BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.meta_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leadgen_id text NOT NULL UNIQUE CHECK (length(leadgen_id) BETWEEN 1 AND 100),
  page_id text NOT NULL DEFAULT '',
  form_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','error','ignored')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts>=1),
  last_error text,
  meta_form_lead_id uuid REFERENCES public.meta_form_leads(id),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX meta_webhook_events_status ON public.meta_webhook_events(status, received_at DESC);
ALTER TABLE public.meta_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_webhook_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meta_webhook_events TO authenticated;
CREATE POLICY meta_webhook_events_read ON public.meta_webhook_events FOR SELECT TO authenticated USING (public.meta_lead_inbox_access());

CREATE OR REPLACE FUNCTION public.meta_webhook_event_receive(p_leadgen_id text, p_page_id text, p_form_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
  IF length(btrim(coalesce(p_leadgen_id,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'leadgen_id inválido'; END IF;
  INSERT INTO public.meta_webhook_events(leadgen_id,page_id,form_id,status,attempts)
  VALUES(btrim(p_leadgen_id),left(coalesce(p_page_id,''),100),left(coalesce(p_form_id,''),100),'pending',1)
  ON CONFLICT(leadgen_id) DO UPDATE SET attempts=meta_webhook_events.attempts+1,
    status=CASE WHEN meta_webhook_events.status='processed' THEN 'processed' ELSE 'pending' END,
    updated_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.meta_webhook_event_complete(p_id uuid, p_status text, p_error text DEFAULT NULL, p_meta_form_lead_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_status NOT IN ('processed','error','ignored') THEN RAISE EXCEPTION 'Status inválido'; END IF;
  UPDATE public.meta_webhook_events SET status=p_status,last_error=p_error,
    meta_form_lead_id=coalesce(p_meta_form_lead_id,meta_form_lead_id),
    processed_at=CASE WHEN p_status='processed' THEN clock_timestamp() ELSE processed_at END,
    updated_at=clock_timestamp() WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento de webhook não encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_webhook_event_receive(text,text,text), public.meta_webhook_event_complete(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_webhook_event_receive(text,text,text), public.meta_webhook_event_complete(uuid,text,text,uuid) TO service_role;
CREATE TRIGGER meta_webhook_events_signal AFTER INSERT OR UPDATE ON public.meta_webhook_events FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
NOTIFY pgrst,'reload schema';
COMMIT;
