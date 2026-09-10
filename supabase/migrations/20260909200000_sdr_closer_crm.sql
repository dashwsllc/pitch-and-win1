BEGIN;

-- Additive migration: historical corporate fields and pipeline values are preserved.
ALTER TABLE public.crm_leads
  ADD COLUMN city_state text,
  ADD COLUMN athlete_name text,
  ADD COLUMN athlete_birth_date date,
  ADD COLUMN athlete_position text,
  ADD COLUMN athlete_height_cm numeric,
  ADD COLUMN athlete_weight_kg numeric,
  ADD COLUMN performance_report_url text;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_athlete_input CHECK (
  (athlete_name IS NULL OR char_length(btrim(athlete_name)) BETWEEN 2 AND 160)
  AND (athlete_birth_date IS NULL OR athlete_birth_date BETWEEN DATE '1900-01-01' AND CURRENT_DATE)
  AND (athlete_position IS NULL OR athlete_position IN ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante'))
  AND (athlete_height_cm IS NULL OR athlete_height_cm BETWEEN 30 AND 250)
  AND (athlete_weight_kg IS NULL OR athlete_weight_kg BETWEEN 1 AND 300)
  AND char_length(COALESCE(city_state,'')) <= 160
  AND (performance_report_url IS NULL OR (char_length(performance_report_url) <= 2048 AND performance_report_url ~ '^https://[^/[:space:]]+'))
);

ALTER TABLE public.crm_activities
  ADD COLUMN call_type text,
  ADD COLUMN assigned_to uuid REFERENCES auth.users(id),
  ADD COLUMN author_name text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_call_input CHECK (
  call_type IS NULL OR (
    call_type IN ('qualificacao','fechamento_closer') AND activity_type = 'reuniao'
    AND assigned_to IS NOT NULL AND scheduled_at IS NOT NULL AND isfinite(scheduled_at)
    AND ((NOT is_completed AND outcome IS NULL AND completed_at IS NULL)
      OR (is_completed AND completed_at IS NOT NULL AND outcome IS NOT NULL AND (
        (call_type = 'qualificacao' AND outcome IN ('avancou','lead_perdido'))
        OR (call_type = 'fechamento_closer' AND outcome IN ('venda_concluida','venda_perdida','devolvido_sdr')))))
  )
);
CREATE UNIQUE INDEX crm_one_open_call_per_lead ON public.crm_activities(lead_id)
  WHERE call_type IS NOT NULL AND NOT is_completed;
CREATE INDEX crm_call_queue ON public.crm_activities(call_type, scheduled_at) WHERE NOT is_completed;
ALTER TABLE public.vendas ADD COLUMN crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE RESTRICT;
CREATE INDEX vendas_crm_lead ON public.vendas(crm_lead_id) WHERE crm_lead_id IS NOT NULL;

CREATE FUNCTION public.crm_has_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND suspended)
    AND (public.is_executive(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND crm_access));
$$;

-- Restrictive policies also cover legacy broad policies without widening access.
CREATE POLICY crm_active_access ON public.crm_leads AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.crm_has_access()) WITH CHECK (public.crm_has_access());
CREATE POLICY crm_active_access ON public.crm_activities AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.crm_has_access()) WITH CHECK (public.crm_has_access());

CREATE FUNCTION public.crm_require_role(p_role text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.crm_has_access() OR NOT (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text=p_role
  )) THEN RAISE EXCEPTION 'Acesso CRM e função % necessários', p_role USING ERRCODE='42501'; END IF;
END;
$$;

CREATE FUNCTION public.crm_guard_workflow() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_owner name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid=TG_RELID;
  IF TG_TABLE_NAME='crm_leads' THEN
    IF TG_OP='INSERT' OR ROW(NEW.athlete_name,NEW.athlete_birth_date,NEW.athlete_position,NEW.email,NEW.phone)
      IS DISTINCT FROM ROW(OLD.athlete_name,OLD.athlete_birth_date,OLD.athlete_position,OLD.email,OLD.phone) THEN
      IF NULLIF(btrim(NEW.athlete_name),'') IS NULL OR NEW.athlete_birth_date IS NULL OR NEW.athlete_position IS NULL
        OR NULLIF(btrim(NEW.email),'') IS NULL OR NULLIF(btrim(NEW.phone),'') IS NULL THEN
        RAISE EXCEPTION 'Preencha responsável, WhatsApp, e-mail, atleta, nascimento e posição' USING ERRCODE='23514';
      END IF;
    END IF;
    IF current_user <> v_owner AND ((TG_OP='INSERT' AND NEW.pipeline_stage <> 'novo')
      OR (TG_OP='UPDATE' AND NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage)) THEN
      RAISE EXCEPTION 'Atualize o pipeline pelo resultado ou agendamento da call' USING ERRCODE='42501';
    END IF;
  ELSE
    IF current_user <> v_owner AND (COALESCE(NEW.call_type,OLD.call_type) IS NOT NULL
      OR (TG_OP <> 'INSERT' AND OLD.activity_type='contexto_vida')) THEN
      RAISE EXCEPTION 'Calls são alteradas pelas funções do CRM; notas de contexto são imutáveis' USING ERRCODE='42501';
    END IF;
    IF TG_OP='INSERT' THEN
      SELECT COALESCE(display_name,auth.uid()::text) INTO NEW.author_name FROM public.profiles WHERE user_id=auth.uid();
    ELSIF TG_OP='UPDATE' THEN
      NEW.author_name := OLD.author_name;
    END IF;
    IF TG_OP <> 'DELETE' THEN NEW.updated_at := clock_timestamp(); END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER crm_guard_workflow BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_workflow();
CREATE TRIGGER crm_guard_workflow BEFORE INSERT OR UPDATE OR DELETE ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_workflow();

CREATE FUNCTION public.crm_call_assignees() RETURNS TABLE(user_id uuid, display_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso CRM necessário' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT DISTINCT r.user_id, COALESCE(p.display_name,r.user_id::text), r.role::text
    FROM public.user_roles r JOIN public.profiles p ON p.user_id=r.user_id
    WHERE NOT p.suspended AND r.role::text IN ('sdr','closer','executive','super_admin')
      AND (public.is_executive(r.user_id) OR EXISTS(SELECT 1 FROM public.user_roles a WHERE a.user_id=r.user_id AND a.crm_access));
END;
$$;

-- Both call types share one activity; the historical RPC names are kept for deployment clarity.
CREATE FUNCTION public.schedule_closer_call(p_lead_id uuid, p_call_type text, p_scheduled_at timestamptz, p_assigned_to uuid, p_context text DEFAULT NULL)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_call public.crm_activities; v_stage text;
BEGIN
  PERFORM public.crm_require_role('sdr');
  IF p_call_type IS NULL OR p_call_type NOT IN ('qualificacao','fechamento_closer')
    OR p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at <= now() THEN
    RAISE EXCEPTION 'Escolha tipo e horário futuro válidos' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_call_assignees() a WHERE a.user_id=p_assigned_to
    AND a.role IN (CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END,'executive','super_admin')) THEN
    RAISE EXCEPTION 'Responsável sem função ou acesso compatível' USING ERRCODE='22023'; END IF;
  SELECT pipeline_stage INTO v_stage FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF v_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN
    RAISE EXCEPTION 'Lead encerrado' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=p_lead_id AND call_type IS NOT NULL AND NOT is_completed) THEN
    RAISE EXCEPTION 'Já existe uma call pendente. Reagende ou registre seu resultado.' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,call_type,assigned_to,scheduled_at)
    VALUES(p_lead_id,auth.uid(),'reuniao',CASE WHEN p_call_type='qualificacao' THEN 'Qualificação' ELSE 'Fechamento com Closer' END,
      NULLIF(btrim(p_context),''),p_call_type,p_assigned_to,p_scheduled_at) RETURNING * INTO v_call;
  UPDATE public.crm_leads SET pipeline_stage=CASE WHEN p_call_type='qualificacao' THEN 'em_qualificacao' ELSE 'repassado_closer' END WHERE id=p_lead_id;
  RETURN v_call;
END;
$$;

CREATE FUNCTION public.resolve_closer_call(p_activity_id uuid, p_outcome text, p_expected_revision timestamptz)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_call public.crm_activities; v_lead uuid;
BEGIN
  IF NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso CRM necessário' USING ERRCODE='42501'; END IF;
  SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO v_call FROM public.crm_activities WHERE id=p_activity_id FOR UPDATE;
  PERFORM public.crm_require_role(CASE WHEN v_call.call_type='qualificacao' THEN 'sdr' ELSE 'closer' END);
  IF NOT public.is_executive(auth.uid()) AND v_call.assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Somente o responsável pode concluir esta call' USING ERRCODE='42501'; END IF;
  IF v_call.is_completed OR p_expected_revision IS DISTINCT FROM v_call.updated_at THEN
    RAISE EXCEPTION 'Call alterada. Atualize a lista antes de continuar.' USING ERRCODE='PT409'; END IF;
  IF p_outcome IS NULL OR NOT ((v_call.call_type='qualificacao' AND p_outcome IN ('avancou','lead_perdido'))
    OR (v_call.call_type='fechamento_closer' AND p_outcome IN ('venda_concluida','venda_perdida','devolvido_sdr'))) THEN
    RAISE EXCEPTION 'Resultado inválido para este tipo de call' USING ERRCODE='22023'; END IF;
  UPDATE public.crm_activities SET outcome=p_outcome,is_completed=true,completed_at=clock_timestamp()
    WHERE id=p_activity_id RETURNING * INTO v_call;
  UPDATE public.crm_leads SET pipeline_stage=CASE p_outcome
    WHEN 'venda_concluida' THEN 'fechado_ganho' WHEN 'venda_perdida' THEN 'fechado_perdido'
    WHEN 'lead_perdido' THEN 'lead_perdido' ELSE 'em_qualificacao' END,
    last_contact_at=clock_timestamp() WHERE id=v_lead;
  RETURN v_call;
END;
$$;

CREATE FUNCTION public.reschedule_crm_call(p_activity_id uuid, p_scheduled_at timestamptz, p_expected_revision timestamptz)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_call public.crm_activities; v_lead uuid;
BEGIN
  PERFORM public.crm_require_role('sdr');
  IF p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at <= now() THEN
    RAISE EXCEPTION 'Escolha um horário futuro válido' USING ERRCODE='22023'; END IF;
  SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO v_call FROM public.crm_activities WHERE id=p_activity_id FOR UPDATE;
  IF v_call.is_completed OR p_expected_revision IS DISTINCT FROM v_call.updated_at THEN
    RAISE EXCEPTION 'Call alterada. Atualize a lista antes de continuar.' USING ERRCODE='PT409'; END IF;
  UPDATE public.crm_activities SET scheduled_at=p_scheduled_at WHERE id=p_activity_id RETURNING * INTO v_call;
  RETURN v_call;
END;
$$;

CREATE FUNCTION public.crm_guard_sale_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.crm_lead_id IS DISTINCT FROM OLD.crm_lead_id THEN
    RAISE EXCEPTION 'Vínculo com lead é imutável' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' AND NEW.crm_lead_id IS NOT NULL THEN
    IF NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso CRM necessário' USING ERRCODE='42501'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.crm_leads WHERE id=NEW.crm_lead_id AND pipeline_stage='fechado_ganho') THEN
      RAISE EXCEPTION 'Selecione um lead com venda concluída' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER crm_guard_sale_link BEFORE INSERT OR UPDATE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.crm_guard_sale_link();

REVOKE ALL ON FUNCTION public.crm_has_access(), public.crm_require_role(text), public.crm_guard_workflow(),
  public.crm_guard_sale_link(), public.crm_call_assignees(),
  public.schedule_closer_call(uuid,text,timestamptz,uuid,text), public.resolve_closer_call(uuid,text,timestamptz),
  public.reschedule_crm_call(uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_has_access(), public.crm_call_assignees(),
  public.schedule_closer_call(uuid,text,timestamptz,uuid,text), public.resolve_closer_call(uuid,text,timestamptz),
  public.reschedule_crm_call(uuid,timestamptz,timestamptz) TO authenticated;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='crm_leads') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='crm_activities') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_activities;
    END IF;
  END IF;
END; $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
