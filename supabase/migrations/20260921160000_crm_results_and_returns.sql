-- Keep the latest commercial result when a lead returns to an operational queue.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.crm_leads
  ADD COLUMN last_result_outcome text CHECK (last_result_outcome IN ('venda_concluida','venda_perdida','lead_perdido')),
  ADD COLUMN last_result_at timestamptz,
  ADD COLUMN last_result_closer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN last_result_closer_name text;

-- This schema backfill has no user actor. Avoid generating fake user history;
-- the table lock and transaction restore the guards before writes can resume.
ALTER TABLE public.crm_leads DISABLE TRIGGER security_guard_crm_lead;
ALTER TABLE public.crm_leads DISABLE TRIGGER crm_audit_lead;
UPDATE public.crm_leads l SET
  last_result_outcome=CASE pipeline_stage WHEN 'fechado_ganho' THEN 'venda_concluida'
    WHEN 'fechado_perdido' THEN 'venda_perdida' ELSE 'lead_perdido' END,
  last_result_at=COALESCE(closed_at,updated_at,created_at),
  last_result_closer_id=CASE WHEN pipeline_stage<>'lead_perdido' THEN COALESCE(closer_id,closed_by) END,
  last_result_closer_name=CASE WHEN pipeline_stage<>'lead_perdido' THEN
    (SELECT display_name FROM public.profiles WHERE user_id=COALESCE(l.closer_id,l.closed_by)) END
WHERE pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido');

-- Recover completed outcomes for leads that were already reactivated.
WITH latest AS (
  SELECT DISTINCT ON (lead_id) lead_id,outcome,completed_at,assigned_to,user_id,author_name
  FROM public.crm_activities
  WHERE is_completed AND outcome IN ('venda_concluida','venda_perdida','lead_perdido')
    AND completed_at IS NOT NULL
  ORDER BY lead_id,completed_at DESC,id
)
UPDATE public.crm_leads l SET last_result_outcome=a.outcome,last_result_at=a.completed_at,
  last_result_closer_id=CASE WHEN a.outcome<>'lead_perdido' THEN COALESCE(a.assigned_to,a.user_id) END,
  last_result_closer_name=CASE WHEN a.outcome<>'lead_perdido' THEN COALESCE(
    (SELECT display_name FROM public.profiles WHERE user_id=COALESCE(a.assigned_to,a.user_id)),a.author_name) END
FROM latest a WHERE a.lead_id=l.id AND l.last_result_outcome IS NULL;
ALTER TABLE public.crm_leads ENABLE TRIGGER crm_audit_lead;
ALTER TABLE public.crm_leads ENABLE TRIGGER security_guard_crm_lead;

CREATE OR REPLACE FUNCTION public.crm_capture_result() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    -- Computed result fields cannot be forged when creating a lead.
    NEW.last_result_outcome:=NULL; NEW.last_result_at:=NULL;
    NEW.last_result_closer_id:=NULL; NEW.last_result_closer_name:=NULL;
  ELSIF NEW.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido')
    AND NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage THEN
    NEW.last_result_outcome:=CASE NEW.pipeline_stage WHEN 'fechado_ganho' THEN 'venda_concluida'
      WHEN 'fechado_perdido' THEN 'venda_perdida' ELSE 'lead_perdido' END;
    NEW.last_result_at:=COALESCE(NEW.closed_at,clock_timestamp());
    -- A new SDR negative must not erase the attribution of a previous Closer result.
    IF NEW.pipeline_stage<>'lead_perdido' THEN
      NEW.last_result_closer_id:=COALESCE(NEW.closer_id,NEW.closed_by);
      SELECT display_name INTO NEW.last_result_closer_name FROM public.profiles
        WHERE user_id=NEW.last_result_closer_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER zz_crm_capture_result BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_capture_result();

-- Start a fresh remarketing cycle after a reactivation and a subsequent refusal.
CREATE OR REPLACE FUNCTION public.crm_prepare_remarketing_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.pipeline_stage IN ('lead_perdido','fechado_perdido')
     AND (TG_OP='INSERT' OR OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage) THEN
    IF NEW.remarketing_status IS NULL OR NEW.remarketing_status='reactivated' THEN
      NEW.remarketing_status:='pending'; NEW.remarketing_next_at:=NULL;
    END IF;
    NEW.negative_reason:=COALESCE(NEW.negative_reason,
      CASE WHEN NEW.pipeline_stage='fechado_perdido' THEN 'Venda recusada no fechamento' ELSE 'Negativa registrada' END);
  END IF;
  RETURN NEW;
END; $$;

-- Shared approval metadata; financial and buyer details retain the existing sales RLS.
CREATE FUNCTION public.crm_result_sale_links()
RETURNS TABLE(lead_id uuid,sale_id uuid,can_open boolean,approval_status text,seller_id uuid,seller_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.crm_require_role('leads');
  RETURN QUERY SELECT v.crm_lead_id,
    CASE WHEN (v.user_id=auth.uid() AND v.approval_status<>'rejeitada') OR public.crm_user_can(auth.uid(),'executive') THEN v.id END,
    (v.user_id=auth.uid() AND v.approval_status<>'rejeitada') OR public.crm_user_can(auth.uid(),'executive'),
    v.approval_status::text,v.user_id,COALESCE(p.display_name,'Vendedor indisponível')
  FROM public.vendas v LEFT JOIN public.profiles p ON p.user_id=v.user_id
  WHERE v.crm_lead_id IS NOT NULL;
END; $$;

CREATE FUNCTION public.crm_reopen_result(
  p_lead_id uuid,p_expected_version bigint,p_target text,p_assigned_to uuid,
  p_next_at timestamptz,p_note text DEFAULT NULL
) RETURNS public.crm_leads
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.crm_leads; v_note text:=NULLIF(btrim(p_note),''); v_previous jsonb;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF l.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Lead alterado. Atualize e tente novamente.' USING ERRCODE='PT409'; END IF;
  IF l.pipeline_stage NOT IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN
    RAISE EXCEPTION 'Este lead já está em atendimento' USING ERRCODE='PT409'; END IF;
  IF NOT public.crm_user_can(auth.uid(),'executive') AND NOT COALESCE((
    (public.crm_user_can(auth.uid(),'closer') AND l.closer_id=auth.uid()) OR
    (public.crm_user_can(auth.uid(),'sdr') AND l.sdr_id=auth.uid())
  ),false) THEN RAISE EXCEPTION 'Somente o responsável pode devolver este lead' USING ERRCODE='42501'; END IF;
  IF p_target IS NULL OR p_target NOT IN ('sdr','closer') OR p_assigned_to IS NULL
    OR NOT public.crm_user_can(p_assigned_to,p_target) THEN
    RAISE EXCEPTION 'Selecione um responsável válido para o destino' USING ERRCODE='22023'; END IF;
  IF p_next_at IS NULL OR NOT isfinite(p_next_at) OR p_next_at<=now() THEN
    RAISE EXCEPTION 'Agende a próxima ação em uma data futura' USING ERRCODE='22023'; END IF;
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 3 AND 5000 THEN
    RAISE EXCEPTION 'Informe o motivo da devolução (3 a 5000 caracteres)' USING ERRCODE='22023'; END IF;
  v_previous:=jsonb_build_object('pipeline_stage',l.pipeline_stage,'sdr_id',l.sdr_id,'closer_id',l.closer_id);
  UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome='devolvido_sdr'
    WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed;
  UPDATE public.crm_leads SET
    pipeline_stage=CASE WHEN p_target='sdr' THEN 'em_qualificacao' ELSE 'repassado_closer' END,
    sdr_id=CASE WHEN p_target='sdr' THEN p_assigned_to ELSE sdr_id END,
    closer_id=CASE WHEN p_target='closer' THEN p_assigned_to ELSE NULL END,
    handed_off_at=CASE WHEN p_target='closer' THEN clock_timestamp() ELSE handed_off_at END,
    next_followup_at=p_next_at,closed_at=NULL,closed_by=NULL,
    remarketing_status=CASE WHEN remarketing_status IS NOT NULL THEN 'reactivated' END,
    remarketing_next_at=NULL
  WHERE id=l.id RETURNING * INTO l;
  -- The new appointment and the ownership transfer commit together.
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,call_type,assigned_to,scheduled_at)
  VALUES(l.id,auth.uid(),'reuniao',CASE WHEN p_target='sdr' THEN 'Retorno à qualificação SDR' ELSE 'Retorno ao Closer' END,
    v_note,CASE WHEN p_target='sdr' THEN 'qualificacao' ELSE 'fechamento_closer' END,p_assigned_to,p_next_at);
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,is_completed,completed_at,previous_state,new_state)
  VALUES(l.id,auth.uid(),'transicao','Resultado devolvido para '||upper(p_target),v_note,true,clock_timestamp(),v_previous,
    jsonb_build_object('target',p_target,'assigned_to',p_assigned_to,'next_at',p_next_at));
  RETURN l;
END; $$;

-- Sending a lead to remarketing closes its pending call in the same transaction.
CREATE OR REPLACE FUNCTION public.crm_mark_negative(
  p_lead_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_next_at timestamptz,
  p_note text DEFAULT NULL
)
RETURNS public.crm_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  l public.crm_leads;
  v_reason text := NULLIF(btrim(p_reason),'');
  v_note text := NULLIF(btrim(p_note),'');
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN
    RAISE EXCEPTION 'Lead alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF l.pipeline_stage='repassado_closer' THEN
    PERFORM public.crm_require_role('closer');
    IF NOT public.crm_user_can(auth.uid(),'executive') AND l.closer_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Somente o Closer responsável pode enviar este lead ao remarketing' USING ERRCODE='42501';
    END IF;
  ELSIF NOT public.crm_user_can(auth.uid(),'sdr') AND l.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o responsável pode enviar este lead ao remarketing' USING ERRCODE='42501';
  END IF;
  IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN
    RAISE EXCEPTION 'A negativa não está disponível nesta etapa' USING ERRCODE='PT409';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'Informe o motivo da negativa' USING ERRCODE='22023';
  END IF;
  IF p_next_at IS NULL OR NOT isfinite(p_next_at) OR p_next_at<=now() THEN
    RAISE EXCEPTION 'Agende o primeiro follow-up de remarketing' USING ERRCODE='22023';
  END IF;
  IF char_length(COALESCE(v_note,''))>5000 THEN
    RAISE EXCEPTION 'Anotação excede 5000 caracteres' USING ERRCODE='22023';
  END IF;

  UPDATE public.crm_activities
  SET is_completed=true, completed_at=clock_timestamp(), outcome=CASE WHEN l.pipeline_stage='repassado_closer' THEN 'venda_perdida' ELSE 'lead_perdido' END
  WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed;
  UPDATE public.crm_leads
  SET pipeline_stage=CASE WHEN l.pipeline_stage='repassado_closer' THEN 'fechado_perdido' ELSE 'lead_perdido' END,
      negative_reason=v_reason,
      remarketing_status='scheduled',
      remarketing_next_at=p_next_at,
      remarketing_attempt_count=0,
      next_followup_at=p_next_at,
      closed_at=clock_timestamp(),
      closed_by=auth.uid(),
      last_contact_at=clock_timestamp()
  WHERE id=l.id
  RETURNING * INTO l;
  INSERT INTO public.crm_activities(
    lead_id,user_id,activity_type,title,description,outcome,is_completed,completed_at,new_state
  ) VALUES(
    l.id,auth.uid(),'remarketing','Negativa enviada ao remarketing',
    COALESCE(v_note,v_reason),CASE WHEN l.pipeline_stage='fechado_perdido' THEN 'venda_perdida' ELSE 'lead_perdido' END,true,clock_timestamp(),
    jsonb_build_object('reason',v_reason,'next_at',p_next_at,'status','scheduled')
  );
  RETURN l;
END;
$$;

CREATE INDEX crm_latest_results ON public.crm_leads(last_result_at DESC) WHERE last_result_outcome IS NOT NULL;
-- Extend the existing anonymous revision feed to refresh every open screen.
ALTER TABLE public.dashboard_events DROP CONSTRAINT dashboard_events_topic_check;
ALTER TABLE public.dashboard_events ADD CONSTRAINT dashboard_events_topic_check
  CHECK (topic IN ('sales','users','audit','goals','products','crm'));
INSERT INTO public.dashboard_events(topic) VALUES('crm');
CREATE POLICY dashboard_events_crm_read ON public.dashboard_events FOR SELECT TO authenticated
  USING (topic='crm' AND public.crm_has_access());
CREATE TRIGGER dashboard_crm_leads_signal AFTER INSERT OR UPDATE OR DELETE ON public.crm_leads
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
CREATE TRIGGER dashboard_crm_activities_signal AFTER INSERT OR UPDATE OR DELETE ON public.crm_activities
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
CREATE TRIGGER dashboard_crm_contexts_signal AFTER INSERT OR UPDATE OR DELETE ON public.crm_lead_contexts
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
REVOKE ALL ON FUNCTION public.crm_capture_result() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_result_sale_links() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_reopen_result(uuid,bigint,text,uuid,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_result_sale_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reopen_result(uuid,bigint,text,uuid,timestamptz,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
