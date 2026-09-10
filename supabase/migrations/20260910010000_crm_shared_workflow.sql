BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Forward-only. Never replay the divergent migration history with db push.
ALTER TABLE public.crm_leads
  ADD COLUMN approach_stage text NOT NULL DEFAULT 'nao_abordado',
  ADD COLUMN sdr_id uuid REFERENCES auth.users(id),
  ADD COLUMN closer_id uuid REFERENCES auth.users(id),
  ADD COLUMN handed_off_at timestamptz,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid REFERENCES auth.users(id),
  ADD COLUMN version bigint NOT NULL DEFAULT 1,
  ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE public.crm_activities
  ADD COLUMN previous_state jsonb,
  ADD COLUMN new_state jsonb;

-- No invented personal data or inferred historical timestamps. Existing stages survive.
ALTER TABLE public.crm_leads DISABLE TRIGGER USER;
UPDATE public.crm_leads l SET
  approach_stage = CASE WHEN NOT approached THEN 'nao_abordado' WHEN approach_count > 1 THEN 'reabordado' ELSE 'abordado' END,
  sdr_id = COALESCE((SELECT id FROM auth.users WHERE id=l.assigned_to), (SELECT id FROM auth.users WHERE id=l.created_by)),
  closer_id = (SELECT a.assigned_to FROM public.crm_activities a WHERE a.lead_id=l.id AND a.call_type='fechamento_closer' ORDER BY a.created_at DESC,a.id LIMIT 1),
  handed_off_at = (SELECT min(a.created_at) FROM public.crm_activities a WHERE a.lead_id=l.id AND a.call_type='fechamento_closer'),
  closed_at = (SELECT max(a.completed_at) FROM public.crm_activities a WHERE a.lead_id=l.id AND a.outcome IN ('venda_concluida','venda_perdida','lead_perdido'));
ALTER TABLE public.crm_leads ENABLE TRIGGER USER;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_approach_stage CHECK (approach_stage IN ('nao_abordado','em_abordagem','abordado','reabordado'));
CREATE INDEX crm_closer_queue ON public.crm_leads(pipeline_stage,closer_id,handed_off_at);

-- Single capability rule, including active-profile requirement. Specific roles override seller fallback.
CREATE FUNCTION public.crm_user_can(p_user uuid, p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p_user IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles WHERE user_id=p_user AND NOT suspended)
    AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text IN ('executive','super_admin'))
      OR CASE p_capability
        WHEN 'leads' THEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND (role::text IN ('seller','sdr','closer') OR crm_access))
        WHEN 'sdr' THEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text='sdr')
          OR (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text='seller') AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text IN ('sdr','closer')))
        WHEN 'closer' THEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text='closer')
          OR (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text='seller') AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text IN ('sdr','closer')))
        WHEN 'sales' THEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text='closer')
          OR (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text='seller') AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user AND role::text IN ('sdr','closer')))
        ELSE false END);
$$;
CREATE OR REPLACE FUNCTION public.crm_has_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.crm_user_can(auth.uid(),'leads'); $$;
CREATE FUNCTION public.crm_can(p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.crm_user_can(auth.uid(),p_capability); $$;
CREATE OR REPLACE FUNCTION public.crm_require_role(p_role text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.crm_user_can(auth.uid(),p_role) THEN RAISE EXCEPTION 'Sua função não permite esta ação no CRM' USING ERRCODE='42501'; END IF;
END; $$;
ALTER POLICY crm_leads_select ON public.crm_leads USING (public.crm_has_access());
ALTER POLICY crm_leads_insert ON public.crm_leads WITH CHECK (public.crm_has_access() AND created_by=auth.uid());
ALTER POLICY crm_leads_update ON public.crm_leads USING (public.crm_has_access()) WITH CHECK (public.crm_has_access());
ALTER POLICY crm_activities_select ON public.crm_activities USING (public.crm_has_access());
ALTER POLICY crm_activities_insert ON public.crm_activities WITH CHECK (public.crm_has_access() AND user_id=auth.uid());
CREATE POLICY vendas_capacity_insert ON public.vendas AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.crm_can('sales'));

CREATE OR REPLACE FUNCTION public.crm_call_assignees() RETURNS TABLE(user_id uuid,display_name text,role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.crm_require_role('leads');
  RETURN QUERY SELECT p.user_id,COALESCE(p.display_name,p.user_id::text),c.cap
    FROM public.profiles p CROSS JOIN (VALUES ('sdr'::text),('closer'::text)) c(cap)
    WHERE public.crm_user_can(p.user_id,c.cap);
END; $$;

CREATE OR REPLACE FUNCTION public.crm_guard_workflow() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_owner name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid=TG_RELID;
  IF TG_TABLE_NAME='crm_leads' THEN
    NEW.email:=NULLIF(btrim(NEW.email),''); NEW.athlete_position:=NULLIF(btrim(NEW.athlete_position),'');
    NEW.city_state:=NULLIF(btrim(NEW.city_state),''); NEW.performance_report_url:=NULLIF(btrim(NEW.performance_report_url),'');
    NEW.priority:=NULLIF(btrim(NEW.priority),''); NEW.lead_source:=NULLIF(btrim(NEW.lead_source),'');
    -- Old incomplete records remain usable; edits to personal data must complete only these three fields.
    IF TG_OP='INSERT' OR ROW(NEW.name,NEW.athlete_name,NEW.phone) IS DISTINCT FROM ROW(OLD.name,OLD.athlete_name,OLD.phone) THEN
      IF NULLIF(btrim(NEW.name),'') IS NULL OR NULLIF(btrim(NEW.athlete_name),'') IS NULL OR NULLIF(btrim(NEW.phone),'') IS NULL THEN
        RAISE EXCEPTION 'Preencha nome do responsável, nome do atleta e WhatsApp' USING ERRCODE='23514'; END IF;
    END IF;
    IF current_user<>v_owner THEN
      IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Atualize o lead pelas ações do CRM' USING ERRCODE='42501'; END IF;
      IF NEW.pipeline_stage<>'novo' OR NEW.approach_stage<>'nao_abordado' OR NEW.closer_id IS NOT NULL OR NEW.handed_off_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL THEN
        RAISE EXCEPTION 'Novo lead deve iniciar na esteira SDR' USING ERRCODE='42501'; END IF;
    END IF;
    IF TG_OP='INSERT' THEN
      NEW.version:=1; NEW.sdr_id:=CASE WHEN public.crm_can('sdr') THEN auth.uid() ELSE NULL END;
      NEW.approached:=false; NEW.approach_count:=0; NEW.approached_at:=NULL;
    ELSE NEW.version:=OLD.version+1; END IF;
  ELSE
    IF current_user<>v_owner AND (TG_OP<>'INSERT' OR NEW.call_type IS NOT NULL OR NEW.previous_state IS NOT NULL OR NEW.new_state IS NOT NULL) THEN
      RAISE EXCEPTION 'Histórico é imutável; altere calls pelas ações do CRM' USING ERRCODE='42501'; END IF;
    IF TG_OP='INSERT' THEN SELECT COALESCE(display_name,auth.uid()::text) INTO NEW.author_name FROM public.profiles WHERE user_id=auth.uid();
    ELSIF TG_OP='UPDATE' THEN NEW.author_name:=OLD.author_name; END IF;
    IF TG_OP<>'DELETE' THEN NEW.updated_at:=clock_timestamp(); END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.crm_audit_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  v_after:=jsonb_build_object('temperature',NEW.temperature,'approach_stage',NEW.approach_stage,'pipeline_stage',NEW.pipeline_stage,'sdr_id',NEW.sdr_id,'closer_id',NEW.closer_id,'next_followup_at',NEW.next_followup_at,'version',NEW.version);
  IF TG_OP='UPDATE' THEN
    v_before:=jsonb_build_object('temperature',OLD.temperature,'approach_stage',OLD.approach_stage,'pipeline_stage',OLD.pipeline_stage,'sdr_id',OLD.sdr_id,'closer_id',OLD.closer_id,'next_followup_at',OLD.next_followup_at,'version',OLD.version);
  END IF;
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,is_completed,completed_at,previous_state,new_state)
    VALUES(NEW.id,auth.uid(),'transicao',CASE WHEN TG_OP='INSERT' THEN 'Lead criado' ELSE 'Lead atualizado' END,true,clock_timestamp(),v_before,v_after);
  RETURN NEW;
END; $$;
CREATE TRIGGER crm_audit_lead AFTER INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_audit_lead();

ALTER TABLE public.crm_activities DROP CONSTRAINT crm_call_input;
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_call_input CHECK (call_type IS NULL OR (
  call_type IN ('qualificacao','fechamento_closer') AND activity_type='reuniao' AND assigned_to IS NOT NULL
  AND scheduled_at IS NOT NULL AND isfinite(scheduled_at)
  AND ((NOT is_completed AND outcome IS NULL AND completed_at IS NULL)
    OR (is_completed AND completed_at IS NOT NULL AND outcome IN ('avancou','lead_perdido','venda_concluida','venda_perdida','devolvido_sdr','followup','repassado_closer')))
));

-- Every action takes the same lead lock and version. Duplicate/stale clicks fail with HTTP 409.
CREATE FUNCTION public.crm_transition(p_lead_id uuid,p_action text,p_expected_version bigint,p_data jsonb DEFAULT '{}')
RETURNS public.crm_leads LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.crm_leads; c public.crm_activities; d public.crm_leads; v_when timestamptz; v_assignee uuid; v_outcome text; v_note text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF p_action IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN RAISE EXCEPTION 'Lead alterado por outra ação. A lista foi atualizada; confira e tente novamente.' USING ERRCODE='PT409'; END IF;
  v_note:=NULLIF(btrim(p_data->>'note'),'');
  IF char_length(v_note)>10000 THEN RAISE EXCEPTION 'Anotação excede 10000 caracteres' USING ERRCODE='22023'; END IF;
  IF p_action='edit' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','athlete_name','phone','email','city_state','athlete_birth_date','athlete_position','athlete_height_cm','athlete_weight_kg','performance_report_url','lead_source','estimated_deal_value','observations','priority')) THEN
      RAISE EXCEPTION 'Campo não permitido no cadastro' USING ERRCODE='22023'; END IF;
    d:=jsonb_populate_record(l,p_data);
    UPDATE public.crm_leads SET name=btrim(d.name),athlete_name=btrim(d.athlete_name),phone=btrim(d.phone),email=d.email,
      city_state=d.city_state,athlete_birth_date=d.athlete_birth_date,athlete_position=d.athlete_position,
      athlete_height_cm=d.athlete_height_cm,athlete_weight_kg=d.athlete_weight_kg,performance_report_url=d.performance_report_url,
      lead_source=d.lead_source,estimated_deal_value=d.estimated_deal_value,observations=d.observations,priority=d.priority WHERE id=l.id;
  ELSIF p_action IN ('classify','approach','qualify','lose') THEN
    PERFORM public.crm_require_role('sdr');
    IF p_action='classify' THEN
      IF p_data->>'temperature' IS NULL OR p_data->>'temperature' NOT IN ('frio','morno','quente') THEN RAISE EXCEPTION 'Aquecimento inválido' USING ERRCODE='22023'; END IF;
      l.temperature:=p_data->>'temperature';
    ELSIF p_action='approach' THEN
      IF p_data->>'stage' IS NULL OR p_data->>'stage' NOT IN ('nao_abordado','em_abordagem','abordado','reabordado') THEN RAISE EXCEPTION 'Abordagem inválida' USING ERRCODE='22023'; END IF;
      l.approach_stage:=p_data->>'stage';
    ELSIF p_action='lose' THEN
      IF l.pipeline_stage IN ('repassado_closer','fechado_ganho','fechado_perdido','lead_perdido') THEN RAISE EXCEPTION 'Transição indisponível para esta etapa' USING ERRCODE='PT409'; END IF;
      l.pipeline_stage:='lead_perdido'; l.closed_at:=clock_timestamp(); l.closed_by:=auth.uid();
    ELSE
      IF l.pipeline_stage NOT IN ('novo','em_qualificacao','pronto_closer','contato_feito','proposta_enviada','negociacao','reativacao') THEN RAISE EXCEPTION 'Transição indisponível para esta etapa' USING ERRCODE='PT409'; END IF;
      l.pipeline_stage:='em_qualificacao';
    END IF;
    IF l.pipeline_stage NOT IN ('repassado_closer','fechado_ganho','fechado_perdido','lead_perdido') THEN
      IF l.temperature='quente' AND l.approach_stage IN ('abordado','reabordado') THEN l.pipeline_stage:='pronto_closer';
      ELSIF l.approach_stage<>'nao_abordado' OR l.pipeline_stage='pronto_closer' THEN l.pipeline_stage:='em_qualificacao'; END IF;
    END IF;
    UPDATE public.crm_leads SET temperature=l.temperature,approach_stage=l.approach_stage,pipeline_stage=l.pipeline_stage,
      approached=l.approach_stage IN ('abordado','reabordado'),
      approach_count=approach_count+CASE WHEN p_action='approach' AND l.approach_stage<>'nao_abordado' THEN 1 ELSE 0 END,
      approached_at=CASE WHEN p_action='approach' THEN clock_timestamp() ELSE approached_at END,
      first_contact_at=CASE WHEN p_action='approach' AND l.approach_stage<>'nao_abordado' THEN COALESCE(first_contact_at,clock_timestamp()) ELSE first_contact_at END,
      last_contact_at=CASE WHEN p_action='approach' THEN clock_timestamp() ELSE last_contact_at END,
      closed_at=l.closed_at,closed_by=l.closed_by WHERE id=l.id;
    IF p_action='lose' THEN UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome='lead_perdido' WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed; END IF;
  ELSIF p_action='handoff' THEN
    PERFORM public.crm_require_role('sdr');
    IF l.pipeline_stage NOT IN ('novo','em_qualificacao','pronto_closer','contato_feito','proposta_enviada','negociacao','reativacao') THEN RAISE EXCEPTION 'Lead já repassado ou encerrado' USING ERRCODE='PT409'; END IF;
    v_assignee:=NULLIF(p_data->>'closer_id','')::uuid;
    IF v_assignee IS NOT NULL AND NOT public.crm_user_can(v_assignee,'closer') THEN RAISE EXCEPTION 'Responsável sem capacidade Closer' USING ERRCODE='22023'; END IF;
    UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome='repassado_closer' WHERE lead_id=l.id AND call_type='qualificacao' AND NOT is_completed;
    UPDATE public.crm_leads SET pipeline_stage='repassado_closer',closer_id=v_assignee,sdr_id=COALESCE(sdr_id,auth.uid()),handed_off_at=clock_timestamp(),next_followup_at=NULL WHERE id=l.id;
  ELSIF p_action IN ('claim','assign') THEN
    PERFORM public.crm_require_role('closer');
    IF l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'Lead fora da fila Closer' USING ERRCODE='PT409'; END IF;
    IF p_action='claim' THEN
      IF l.closer_id IS NOT NULL THEN RAISE EXCEPTION 'Lead já assumido. Atualize a fila.' USING ERRCODE='PT409'; END IF;
      v_assignee:=auth.uid();
    ELSE
      IF NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente responsável ou executive pode atribuir' USING ERRCODE='42501'; END IF;
      v_assignee:=NULLIF(p_data->>'closer_id','')::uuid;
    END IF;
    IF v_assignee IS NOT NULL AND NOT public.crm_user_can(v_assignee,'closer') THEN RAISE EXCEPTION 'Responsável sem capacidade Closer' USING ERRCODE='22023'; END IF;
    IF v_assignee IS NULL AND EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed) THEN RAISE EXCEPTION 'Atribua a call pendente a um responsável' USING ERRCODE='PT409'; END IF;
    UPDATE public.crm_activities SET assigned_to=v_assignee WHERE lead_id=l.id AND call_type='fechamento_closer' AND NOT is_completed;
    UPDATE public.crm_leads SET closer_id=v_assignee WHERE id=l.id;
  ELSIF p_action IN ('close','return') THEN
    PERFORM public.crm_require_role('closer');
    IF l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'Lead já encerrado ou fora da fila Closer' USING ERRCODE='PT409'; END IF;
    IF NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Assuma o lead antes de registrar o resultado' USING ERRCODE='42501'; END IF;
    v_outcome:=CASE WHEN p_action='return' THEN 'devolvido_sdr' ELSE p_data->>'outcome' END;
    IF v_outcome IS NULL OR v_outcome NOT IN ('venda_concluida','venda_perdida','followup','devolvido_sdr') THEN RAISE EXCEPTION 'Selecione o resultado do fechamento' USING ERRCODE='22023'; END IF;
    IF v_outcome='followup' THEN
      v_when:=(p_data->>'next_at')::timestamptz;
      IF v_when IS NULL OR NOT isfinite(v_when) OR v_when<=now() THEN RAISE EXCEPTION 'Follow-up exige uma próxima data futura' USING ERRCODE='22023'; END IF;
    END IF;
    UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome=v_outcome WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed;
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,outcome,is_completed,completed_at)
      VALUES(l.id,auth.uid(),'fechamento','Resultado do fechamento',v_note,v_outcome,true,clock_timestamp());
    v_note:=NULL;
    UPDATE public.crm_leads SET pipeline_stage=CASE v_outcome WHEN 'venda_concluida' THEN 'fechado_ganho' WHEN 'venda_perdida' THEN 'fechado_perdido' WHEN 'devolvido_sdr' THEN 'em_qualificacao' ELSE 'repassado_closer' END,
      closer_id=CASE WHEN v_outcome='devolvido_sdr' THEN NULL ELSE COALESCE(closer_id,auth.uid()) END,
      closed_at=CASE WHEN v_outcome IN ('venda_concluida','venda_perdida') THEN clock_timestamp() ELSE NULL END,
      closed_by=CASE WHEN v_outcome IN ('venda_concluida','venda_perdida') THEN auth.uid() ELSE NULL END,
      next_followup_at=v_when,last_contact_at=clock_timestamp() WHERE id=l.id;
  ELSIF p_action IN ('note','contact','followup') THEN
    IF p_action IN ('note','contact') AND v_note IS NULL THEN RAISE EXCEPTION 'Escreva uma anotação' USING ERRCODE='22023'; END IF;
    IF p_action='followup' THEN
      IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE='PT409'; END IF;
      PERFORM public.crm_require_role(CASE WHEN l.pipeline_stage='repassado_closer' THEN 'closer' ELSE 'sdr' END);
      IF l.pipeline_stage='repassado_closer' AND NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o responsável pode agendar retorno' USING ERRCODE='42501'; END IF;
      v_when:=(p_data->>'next_at')::timestamptz;
      IF v_when IS NULL OR NOT isfinite(v_when) OR v_when<=now() THEN RAISE EXCEPTION 'Escolha uma data futura' USING ERRCODE='22023'; END IF;
    END IF;
    UPDATE public.crm_leads SET next_followup_at=CASE WHEN p_action='followup' THEN v_when ELSE next_followup_at END,
      last_contact_at=CASE WHEN p_action='contact' THEN clock_timestamp() ELSE last_contact_at END,
      approach_count=approach_count+CASE WHEN p_action='contact' THEN 1 ELSE 0 END WHERE id=l.id;
  ELSE RAISE EXCEPTION 'Ação não reconhecida' USING ERRCODE='22023'; END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,is_completed,completed_at)
      VALUES(l.id,auth.uid(),'contexto_vida',CASE WHEN p_action='contact' THEN 'Tentativa de contato' ELSE 'Anotação' END,v_note,true,clock_timestamp());
  END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id;
  RETURN l;
END; $$;

-- Existing clients get the same permissions and no implicit handoff from scheduling.
CREATE OR REPLACE FUNCTION public.schedule_closer_call(p_lead_id uuid,p_call_type text,p_scheduled_at timestamptz,p_assigned_to uuid,p_context text DEFAULT NULL)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.crm_leads; c public.crm_activities;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_call_type IS NULL OR p_call_type NOT IN ('qualificacao','fechamento_closer') OR p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at<=now() THEN RAISE EXCEPTION 'Escolha tipo e horário futuro válidos' USING ERRCODE='22023'; END IF;
  PERFORM public.crm_require_role(CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END);
  IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') OR (p_call_type='qualificacao' AND l.pipeline_stage='repassado_closer') OR (p_call_type='fechamento_closer' AND l.pipeline_stage<>'repassado_closer') THEN RAISE EXCEPTION 'Etapa incompatível. Envie explicitamente ao Closer antes de agendar fechamento.' USING ERRCODE='PT409'; END IF;
  IF NOT public.crm_user_can(p_assigned_to,CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END) THEN RAISE EXCEPTION 'Responsável incompatível' USING ERRCODE='22023'; END IF;
  IF p_call_type='fechamento_closer' AND (l.closer_id IS DISTINCT FROM p_assigned_to OR (NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid())) THEN RAISE EXCEPTION 'Assuma ou atribua o lead antes de agendar a call do responsável' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed) THEN RAISE EXCEPTION 'Já existe uma call pendente. Use Reagendar.' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,call_type,assigned_to,scheduled_at)
    VALUES(l.id,auth.uid(),'reuniao',CASE WHEN p_call_type='qualificacao' THEN 'Qualificação' ELSE 'Fechamento com Closer' END,NULLIF(btrim(p_context),''),p_call_type,p_assigned_to,p_scheduled_at) RETURNING * INTO c;
  UPDATE public.crm_leads SET next_followup_at=p_scheduled_at,pipeline_stage=CASE WHEN pipeline_stage='novo' THEN 'em_qualificacao' ELSE pipeline_stage END WHERE id=l.id;
  RETURN c;
END; $$;
CREATE OR REPLACE FUNCTION public.reschedule_crm_call(p_activity_id uuid,p_scheduled_at timestamptz,p_expected_revision timestamptz)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.crm_activities; l public.crm_leads; v_lead uuid;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id FOR UPDATE;
  PERFORM public.crm_require_role(CASE WHEN c.call_type='qualificacao' THEN 'sdr' ELSE 'closer' END);
  IF c.call_type='fechamento_closer' AND NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente responsável pode reagendar fechamento' USING ERRCODE='42501'; END IF;
  IF c.is_completed OR p_expected_revision IS DISTINCT FROM c.updated_at THEN RAISE EXCEPTION 'Call alterada. Atualize e tente novamente.' USING ERRCODE='PT409'; END IF;
  IF p_scheduled_at IS NULL OR NOT isfinite(p_scheduled_at) OR p_scheduled_at<=now() THEN RAISE EXCEPTION 'Escolha horário futuro' USING ERRCODE='22023'; END IF;
  UPDATE public.crm_activities SET scheduled_at=p_scheduled_at WHERE id=c.id RETURNING * INTO c;
  UPDATE public.crm_leads SET next_followup_at=p_scheduled_at WHERE id=l.id;
  RETURN c;
END; $$;
CREATE OR REPLACE FUNCTION public.resolve_closer_call(p_activity_id uuid,p_outcome text,p_expected_revision timestamptz)
RETURNS public.crm_activities LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.crm_activities; l public.crm_leads; v_lead uuid;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id FOR UPDATE;
  IF c.is_completed OR p_expected_revision IS DISTINCT FROM c.updated_at THEN RAISE EXCEPTION 'Call alterada. Atualize e tente novamente.' USING ERRCODE='PT409'; END IF;
  IF c.call_type='fechamento_closer' THEN
    PERFORM public.crm_transition(l.id,'close',l.version,jsonb_build_object('outcome',p_outcome));
  ELSE
    PERFORM public.crm_require_role('sdr');
    IF NOT public.crm_user_can(auth.uid(),'admin') AND c.assigned_to IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente responsável pode concluir a call' USING ERRCODE='42501'; END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('avancou','lead_perdido') THEN RAISE EXCEPTION 'Resultado inválido' USING ERRCODE='22023'; END IF;
    PERFORM public.crm_transition(l.id,CASE WHEN p_outcome='avancou' THEN 'qualify' ELSE 'lose' END,l.version);
    UPDATE public.crm_activities SET outcome=p_outcome,is_completed=true,completed_at=clock_timestamp() WHERE id=c.id;
    UPDATE public.crm_leads SET next_followup_at=NULL WHERE id=l.id;
  END IF;
  SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id;
  RETURN c;
END; $$;

CREATE OR REPLACE FUNCTION public.crm_guard_sale_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE l public.crm_leads;
BEGIN
  IF TG_OP='UPDATE' AND NEW.crm_lead_id IS DISTINCT FROM OLD.crm_lead_id THEN RAISE EXCEPTION 'Vínculo com lead é imutável' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' AND NEW.crm_lead_id IS NOT NULL THEN
    IF NOT public.crm_can('sales') OR NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Registre a venda com o usuário Closer logado' USING ERRCODE='42501'; END IF;
    SELECT * INTO l FROM public.crm_leads WHERE id=NEW.crm_lead_id FOR UPDATE;
    IF NOT FOUND OR l.pipeline_stage<>'fechado_ganho' THEN RAISE EXCEPTION 'Selecione um lead com venda concluída' USING ERRCODE='22023'; END IF;
    IF NOT public.crm_can('admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente Closer responsável pode cadastrar esta venda' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.vendas WHERE crm_lead_id=l.id) THEN RAISE EXCEPTION 'Venda já cadastrada para este fechamento' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN NEW;
END; $$;

-- Shared status without exposing another seller's buyer/financial records or broadening sales RLS.
CREATE FUNCTION public.crm_sale_links() RETURNS TABLE(lead_id uuid,sale_id uuid,can_open boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.crm_require_role('leads');
  RETURN QUERY SELECT v.crm_lead_id,CASE WHEN v.user_id=auth.uid() OR public.crm_user_can(auth.uid(),'admin') THEN v.id ELSE NULL END,
    v.user_id=auth.uid() OR public.crm_user_can(auth.uid(),'admin') FROM public.vendas v WHERE v.crm_lead_id IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION public.crm_user_can(uuid,text),public.crm_can(text),public.crm_audit_lead(),public.crm_transition(uuid,text,bigint,jsonb),public.crm_sale_links() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_can(text),public.crm_transition(uuid,text,bigint,jsonb),public.crm_sale_links() TO authenticated;
-- Existing helpers/guards retain their previously restricted grants.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='vendas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vendas;
  END IF;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
