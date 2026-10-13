-- Compatible evolution of deployed waves. No lead, context, receipt or decision is deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

ALTER TABLE public.meta_form_leads
 ADD COLUMN first_received_at timestamptz,
 ADD COLUMN entry_channel text NOT NULL DEFAULT 'form' CHECK(entry_channel IN('form','website'));
UPDATE public.meta_form_leads l SET first_received_at=least(l.received_at,
 (SELECT min(e.received_at) FROM public.meta_webhook_events e WHERE e.leadgen_id=l.meta_lead_id));
ALTER TABLE public.meta_form_leads ALTER COLUMN first_received_at SET NOT NULL;
ALTER TABLE public.crm_leads
 ADD COLUMN lead_received_at timestamptz,
 ADD COLUMN import_channel text CHECK(import_channel IN('form','website')),
 ADD COLUMN import_method text CHECK(import_method IN('automatic','manual')),
 ADD COLUMN import_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.meta_preserve_import_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.first_received_at:=least(NEW.received_at,(SELECT min(received_at) FROM public.meta_webhook_events WHERE leadgen_id=NEW.meta_lead_id));
 ELSE
  NEW.first_received_at:=OLD.first_received_at;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meta_preserve_import_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aa_meta_preserve_import_receipt BEFORE INSERT OR UPDATE ON public.meta_form_leads
 FOR EACH ROW EXECUTE FUNCTION public.meta_preserve_import_receipt();

-- Copy the complete source record in the SAME transaction as CRM creation.
-- The compact context panel can remain bounded; this snapshot never truncates answers.
CREATE OR REPLACE FUNCTION public.crm_preserve_import_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f public.meta_form_leads;
BEGIN
 IF TG_OP='UPDATE' AND OLD.meta_form_lead_id IS NOT NULL AND OLD.import_snapshot IS NOT NULL THEN
  NEW.lead_received_at:=OLD.lead_received_at; NEW.import_channel:=OLD.import_channel;
  NEW.import_method:=OLD.import_method; NEW.import_snapshot:=OLD.import_snapshot;
 ELSIF NEW.meta_form_lead_id IS NOT NULL THEN
  SELECT * INTO STRICT f FROM public.meta_form_leads WHERE id=NEW.meta_form_lead_id;
  NEW.lead_received_at:=f.first_received_at; NEW.lead_generated_at:=f.created_time;
  NEW.import_channel:=f.entry_channel;
  NEW.import_method:=CASE WHEN f.lead_import_batch_id IS NULL THEN 'automatic' ELSE 'manual' END;
  NEW.import_snapshot:=to_jsonb(f)||jsonb_build_object('batch_filename',
   (SELECT filename FROM public.meta_lead_import_batches WHERE id=f.lead_import_batch_id));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_preserve_import_origin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aa_crm_preserve_import_origin BEFORE INSERT OR UPDATE ON public.crm_leads
 FOR EACH ROW EXECUTE FUNCTION public.crm_preserve_import_origin();
UPDATE public.crm_leads c SET lead_received_at=l.first_received_at,import_channel=l.entry_channel,
 import_method=CASE WHEN l.lead_import_batch_id IS NULL THEN 'automatic' ELSE 'manual' END,
 import_snapshot=to_jsonb(l)||jsonb_build_object('batch_filename',(SELECT filename FROM public.meta_lead_import_batches WHERE id=l.lead_import_batch_id))
 FROM public.meta_form_leads l WHERE c.meta_form_lead_id=l.id AND c.import_snapshot IS NULL;

-- Reuse the existing manual ingestion validation, preserving a declared source channel.
ALTER FUNCTION public.meta_ingest_lead_import_row(jsonb,uuid,uuid) RENAME TO meta_ingest_lead_import_row_v1;
CREATE FUNCTION public.meta_ingest_lead_import_row(item jsonb,p_batch_id uuid,p_reviewer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE channel text:=coalesce(item->>'entry_channel','form'); meta_id text;
BEGIN
 IF channel NOT IN('form','website') THEN RAISE EXCEPTION 'Origem da importação inválida' USING ERRCODE='22023'; END IF;
 PERFORM public.meta_ingest_lead_import_row_v1(item,p_batch_id,p_reviewer);
 meta_id:=regexp_replace(btrim(coalesce(item->>'meta_lead_id','')),'^l:([0-9]+)$','\1');
 IF meta_id='' THEN meta_id:='csv:'||md5(coalesce(item->'field_data','[]'::jsonb)::text||'|'||coalesce(item->>'full_name','')||'|'||coalesce(item->>'phone','')||'|'||coalesce(item->>'created_time','')); END IF;
 UPDATE public.meta_form_leads SET entry_channel=channel,source_snapshot=coalesce(source_snapshot,'{}')||
  jsonb_build_object('manual_row',item,'entry_channel',channel) WHERE meta_lead_id=meta_id AND lead_import_batch_id=p_batch_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_ingest_lead_import_row(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- A correctable invalid phone stays in the wave; sending it to CRM must fail explicitly.
CREATE OR REPLACE FUNCTION public.crm_check_import_phone() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.meta_form_lead_id IS NOT NULL THEN
  IF length(regexp_replace(coalesce(NEW.phone,''),'[^0-9]','','g')) NOT BETWEEN 8 AND 15 THEN
   RAISE EXCEPTION 'Corrija o WhatsApp: informe de 8 a 15 dígitos' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_check_import_phone() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aa_crm_check_import_phone BEFORE INSERT ON public.crm_leads
 FOR EACH ROW EXECUTE FUNCTION public.crm_check_import_phone();

-- Receipt order does not require moving members. Historical replay never rebuilds waves.
DROP TRIGGER meta_lead_discovery_rebuild_waves ON public.meta_lead_discovery_state;
CREATE OR REPLACE FUNCTION public.meta_wave_needs_rebuild() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL)
$$;
CREATE OR REPLACE FUNCTION public.meta_wave_rebuild_core() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lead_id uuid; w public.meta_lead_waves;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
 FOR lead_id IN SELECT id FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL ORDER BY first_received_at,created_time,id FOR UPDATE LOOP
  w:=public.meta_wave_current();
  UPDATE public.meta_form_leads SET wave_id=w.id WHERE id=lead_id;
  UPDATE public.meta_lead_waves SET version=version+1,is_open=(SELECT count(*)<20 FROM public.meta_form_leads WHERE wave_id=w.id),
   closed_at=CASE WHEN (SELECT count(*) FROM public.meta_form_leads WHERE wave_id=w.id)>=20 THEN clock_timestamp() END,updated_at=clock_timestamp() WHERE id=w.id;
 END LOOP;
 RETURN (SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente');
END $$;

CREATE FUNCTION public.meta_wave_begin_review(p_wave uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
 UPDATE public.meta_lead_waves SET is_open=false,closed_at=coalesce(closed_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp()
  WHERE id=p_wave AND is_open;
 RETURN public.meta_wave_leads(p_wave);
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_begin_review(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_begin_review(uuid) TO authenticated;

CREATE TABLE public.meta_wave_decision_requests(
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES auth.users(id), wave_id uuid NOT NULL REFERENCES public.meta_lead_waves(id),
 payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.meta_wave_decision_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_wave_decision_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.meta_wave_decide_versioned(p_wave uuid,p_expected_version bigint,p_members jsonb,p_action text,
 p_excluded jsonb,p_note text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; previous public.meta_wave_decision_requests; payload jsonb; result jsonb; ids uuid[]; current_members jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'Solicitação ou membros inválidos' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('wave',p_wave,'version',p_expected_version,'members',p_members,'action',p_action,'excluded',p_excluded,'note',p_note);
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
 SELECT * INTO previous FROM public.meta_wave_decision_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id<>auth.uid() OR previous.payload<>payload THEN RAISE EXCEPTION 'Solicitação já usada para outra decisão' USING ERRCODE='40001'; END IF;
  RETURN previous.result;
 END IF;
 SELECT * INTO w FROM public.meta_lead_waves WHERE id=p_wave FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
 IF w.status<>'pendente' OR w.is_open OR w.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'A leva mudou; abra a revisão e confira os dados atuais' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.meta_form_leads WHERE wave_id=p_wave ORDER BY id FOR UPDATE;
 SELECT jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) ORDER BY id),array_agg(id ORDER BY id) FILTER(WHERE approval_status='pendente')
  INTO current_members,ids FROM public.meta_form_leads WHERE wave_id=p_wave;
 IF current_members IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('id',(x->>'id')::uuid,'updated_at',(x->>'updated_at')::timestamptz) ORDER BY (x->>'id')::uuid) FROM jsonb_array_elements(p_members)x) THEN
  RAISE EXCEPTION 'Um lead mudou; confira novamente antes de decidir' USING ERRCODE='40001'; END IF;
 result:=public.meta_wave_decide(p_wave,p_action,ids,p_excluded,p_note);
 result:=result||jsonb_build_object('wave',public.meta_wave_summary(p_wave));
 INSERT INTO public.meta_wave_decision_requests(id,actor_id,wave_id,payload,result) VALUES(p_request_id,auth.uid(),p_wave,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_decide_versioned(uuid,bigint,jsonb,text,jsonb,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_decide_versioned(uuid,bigint,jsonb,text,jsonb,text,uuid) TO authenticated;
-- The previous RPC remains an internal helper, so clients cannot bypass the reviewed versions.
REVOKE ALL ON FUNCTION public.meta_wave_decide(uuid,text,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_wave_summary(p_wave uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('id',w.id,'number',w.number,'status',w.status,'is_open',w.is_open,'version',w.version,
    'created_at',w.created_at,'closed_at',w.closed_at,'reviewed_at',w.reviewed_at,'review_note',w.review_note,
    'reviewed_by_name',(SELECT p.display_name FROM public.profiles p WHERE p.user_id=w.reviewed_by),
    'lead_count',count(l.id),
    'pending',count(l.id) FILTER(WHERE l.approval_status='pendente'),
    'approved',count(l.id) FILTER(WHERE l.approval_status='aprovado'),
    'rejected',count(l.id) FILTER(WHERE l.approval_status='rejeitado'),
    'sent',count(l.id) FILTER(WHERE l.crm_sync_status='enviado'),
    'failed',count(l.id) FILTER(WHERE l.crm_sync_status='falhou'),
    'first_lead_at',min(l.created_time),'last_lead_at',max(l.created_time),
    'first_received_at',min(l.first_received_at),'last_received_at',max(l.first_received_at))
  FROM public.meta_lead_waves w LEFT JOIN public.meta_form_leads l ON l.wave_id=w.id
  WHERE w.id=p_wave GROUP BY w.id
$$;

CREATE OR REPLACE FUNCTION public.meta_wave_leads(p_wave uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_lead_waves WHERE id=p_wave) THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
  SELECT jsonb_build_object('wave',public.meta_wave_summary(p_wave),
    'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'meta_lead_id',l.meta_lead_id,'page_id',l.page_id,'form_id',l.form_id,'form_name',l.form_name,
      'campaign_id',l.campaign_id,'campaign_name',l.campaign_name,'ad_id',l.ad_id,'created_time',l.created_time,'received_at',l.received_at,'first_received_at',l.first_received_at,'entry_channel',l.entry_channel,'updated_at',l.updated_at,
      'full_name',l.full_name,'phone',l.phone,'email',l.email,'field_data',l.field_data,'custom_disclaimer_responses',l.custom_disclaimer_responses,
      'approval_status',l.approval_status,'status',l.status,'review_note',l.review_note,'reviewed_at',l.reviewed_at,'import_warning',l.import_warning,
      'crm_lead_id',l.crm_lead_id,'crm_sync_status',l.crm_sync_status,'crm_sync_error',l.crm_sync_error,'crm_sync_attempts',l.crm_sync_attempts,
      'crm_sync_last_at',l.crm_sync_last_at,'traffic_edited_at',l.traffic_edited_at,
      'source',CASE WHEN l.lead_import_batch_id IS NULL THEN 'api' ELSE 'planilha' END,
      'batch_filename',(SELECT b.filename FROM public.meta_lead_import_batches b WHERE b.id=l.lead_import_batch_id),
      'time_known',CASE WHEN l.import_contact->>'time_known' IN ('true','false') THEN (l.import_contact->>'time_known')::boolean ELSE true END) ORDER BY l.first_received_at DESC,l.created_time DESC,l.id)
      FROM public.meta_form_leads l WHERE l.wave_id=p_wave),'[]'))
  INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.meta_wave_list(p_status text DEFAULT NULL,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pendente','aprovada','rejeitada') THEN RAISE EXCEPTION 'Status de leva inválido' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Paginação inválida' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'count',(SELECT count(*) FROM public.meta_lead_waves WHERE p_status IS NULL OR status=p_status),
    'pending_waves',(SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente'),
    'pending_leads',(SELECT count(*) FROM public.meta_form_leads WHERE approval_status='pendente'),
    'failed_leads',(SELECT count(*) FROM public.meta_form_leads WHERE approval_status='aprovado' AND crm_lead_id IS NULL AND crm_sync_status='falhou'),
    'newest_pending_lead_at',(SELECT max(first_received_at) FROM public.meta_form_leads WHERE approval_status='pendente'),
    'needs_rebuild',public.meta_wave_needs_rebuild(),
    'waves',coalesce((SELECT jsonb_agg(public.meta_wave_summary(page.id) ORDER BY page.last_lead_at DESC NULLS LAST,page.number DESC)
      FROM (
        SELECT w.id,w.number,max(l.first_received_at) AS last_lead_at
        FROM public.meta_lead_waves w LEFT JOIN public.meta_form_leads l ON l.wave_id=w.id
        WHERE p_status IS NULL OR w.status=p_status
        GROUP BY w.id ORDER BY last_lead_at DESC NULLS LAST,w.number DESC LIMIT p_limit OFFSET p_offset
      ) page),'[]'))
  INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_list(text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_list(text,integer,integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.meta_wave_reopen(p_wave uuid DEFAULT NULL,p_lead uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; ids uuid[]; origin_number bigint;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF (p_wave IS NULL) = (p_lead IS NULL) THEN RAISE EXCEPTION 'Informe a leva ou o lead a reabrir' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  IF p_lead IS NOT NULL THEN
    PERFORM 1 FROM public.meta_form_leads l WHERE l.id=p_lead FOR UPDATE;
    ids:=ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.id=p_lead AND l.approval_status='rejeitado' AND l.crm_lead_id IS NULL);
  ELSE
    SELECT * INTO w FROM public.meta_lead_waves WHERE id=p_wave FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
    IF w.status<>'rejeitada' THEN RAISE EXCEPTION 'Só uma leva rejeitada pode ser reaberta' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.meta_form_leads l WHERE l.wave_id=p_wave ORDER BY l.id FOR UPDATE;
    ids:=ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.wave_id=p_wave AND l.approval_status='rejeitado' AND l.crm_lead_id IS NULL);
  END IF;
  IF cardinality(ids)=0 THEN RAISE EXCEPTION 'Não há lead rejeitado para reabrir' USING ERRCODE='22023'; END IF;
  UPDATE public.meta_form_leads SET approval_status='pendente',status='novo',reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,
    ignored_reason=NULL,wave_id=NULL,updated_at=clock_timestamp() WHERE id=ANY(ids);
  PERFORM public.meta_wave_rebuild_core();
  -- Preserve the original wave and its recorded decision after an explicit reopening.
  IF p_wave IS NOT NULL THEN
    PERFORM public.meta_record_edit('lead_wave',p_wave,'wave.reopened','api',jsonb_build_object('number',w.number,'reopened',cardinality(ids)));
  END IF;
  RETURN jsonb_build_object('reopened',cardinality(ids),'pending_waves',(SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente'));
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
