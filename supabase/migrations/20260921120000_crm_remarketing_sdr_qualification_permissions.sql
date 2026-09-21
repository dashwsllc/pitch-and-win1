-- Separate active leads, SDR qualification and remarketing while making the
-- operational role boundaries explicit. Executive can operate both desks;
-- only Super Admin receives the administrative CRM capability.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.crm_leads
  ADD COLUMN qualification_income_range text,
  ADD COLUMN qualification_goal text,
  ADD COLUMN qualification_decision_maker text,
  ADD COLUMN qualification_timeline text,
  ADD COLUMN qualification_summary text,
  ADD COLUMN qualification_completed_at timestamptz,
  ADD COLUMN qualification_completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN negative_reason text,
  ADD COLUMN remarketing_status text,
  ADD COLUMN remarketing_next_at timestamptz,
  ADD COLUMN remarketing_last_contact_at timestamptz,
  ADD COLUMN remarketing_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.crm_leads ADD CONSTRAINT crm_qualification_remarketing_input CHECK (
  (qualification_income_range IS NULL OR qualification_income_range IN (
    'ate_3k','3k_5k','5k_10k','10k_20k','acima_20k','nao_informado'
  ))
  AND (qualification_decision_maker IS NULL OR qualification_decision_maker IN (
    'proprio','pais_responsaveis','compartilhada','outro','nao_identificado'
  ))
  AND (qualification_timeline IS NULL OR qualification_timeline IN (
    'imediato','ate_30_dias','31_90_dias','acima_90_dias','sem_previsao'
  ))
  AND char_length(COALESCE(qualification_goal,'')) <= 2000
  AND char_length(COALESCE(qualification_summary,'')) <= 5000
  AND char_length(COALESCE(negative_reason,'')) <= 500
  AND (remarketing_status IS NULL OR remarketing_status IN (
    'pending','scheduled','nurturing','reactivated','do_not_contact'
  ))
  AND (remarketing_next_at IS NULL OR isfinite(remarketing_next_at))
  AND (remarketing_last_contact_at IS NULL OR isfinite(remarketing_last_contact_at))
  AND remarketing_attempt_count >= 0
);

CREATE INDEX crm_remarketing_queue
  ON public.crm_leads(remarketing_status, remarketing_next_at, sdr_id)
  WHERE pipeline_stage IN ('lead_perdido','fechado_perdido');
CREATE INDEX crm_sdr_qualification_data
  ON public.crm_leads(qualification_completed_at, qualification_income_range)
  WHERE qualification_completed_at IS NOT NULL;

UPDATE public.crm_leads
SET remarketing_status = 'pending',
    negative_reason = COALESCE(negative_reason,
      CASE WHEN pipeline_stage='fechado_perdido'
        THEN 'Venda perdida no fechamento'
        ELSE 'Negativa registrada antes do remarketing'
      END)
WHERE pipeline_stage IN ('lead_perdido','fechado_perdido')
  AND remarketing_status IS NULL;

CREATE OR REPLACE FUNCTION public.crm_user_can(p_user uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  SELECT p_user IS NOT NULL
    AND EXISTS(
      SELECT 1 FROM public.profiles
      WHERE user_id=p_user AND NOT suspended
    )
    AND CASE p_capability
      WHEN 'admin' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text='super_admin'
      )
      WHEN 'executive' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('executive','super_admin')
      )
      WHEN 'leads' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user
          AND (role::text IN ('seller','sdr','closer','executive','super_admin') OR crm_access)
      )
      WHEN 'sdr' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('sdr','executive','super_admin')
      )
      WHEN 'closer' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('closer','executive','super_admin')
      )
      WHEN 'sales' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('seller','closer','executive','super_admin')
      )
      ELSE false
    END;
$$;

-- Existing workflow functions used the old broad "admin" capability as an
-- operational override. Move those checks to the explicit Executive capability
-- without duplicating their already-audited bodies.
DO $patch_operational_capabilities$
DECLARE
  signature text;
  definition text;
  patched text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.crm_transition(uuid,text,bigint,jsonb)',
    'public.schedule_closer_call(uuid,text,timestamptz,uuid,text)',
    'public.reschedule_crm_call(uuid,timestamptz,timestamptz)',
    'public.resolve_closer_call(uuid,text,timestamptz)',
    'public.crm_guard_sale_link()',
    'public.crm_sale_links()'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
    IF definition IS NULL THEN
      RAISE EXCEPTION 'Função obrigatória ausente: %', signature;
    END IF;
    patched := replace(definition, '''admin''', '''executive''');
    IF patched = definition THEN
      RAISE EXCEPTION 'Override operacional não localizado em %', signature;
    END IF;
    EXECUTE patched;
  END LOOP;
END;
$patch_operational_capabilities$;

-- A completed SDR call can remain in nurture, qualify the lead for handoff, or
-- move a negative into remarketing. The Closer call outcomes stay unchanged.
ALTER TABLE public.crm_activities DROP CONSTRAINT crm_call_input;
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_call_input CHECK (call_type IS NULL OR (
  call_type IN ('qualificacao','fechamento_closer')
  AND activity_type='reuniao'
  AND assigned_to IS NOT NULL
  AND scheduled_at IS NOT NULL
  AND isfinite(scheduled_at)
  AND (
    (NOT is_completed AND outcome IS NULL AND completed_at IS NULL)
    OR (
      is_completed AND completed_at IS NOT NULL
      AND outcome IN (
        'avancou','followup_sdr','lead_perdido','venda_concluida','venda_perdida',
        'devolvido_sdr','followup','repassado_closer'
      )
    )
  )
));

CREATE OR REPLACE FUNCTION public.resolve_sdr_qualification_call(
  p_activity_id uuid,
  p_outcome text,
  p_expected_revision timestamptz,
  p_data jsonb DEFAULT '{}'
)
RETURNS public.crm_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  c public.crm_activities;
  l public.crm_leads;
  v_income text := NULLIF(p_data->>'income_range','');
  v_goal text := NULLIF(btrim(p_data->>'goal'),'');
  v_decision text := NULLIF(p_data->>'decision_maker','');
  v_timeline text := NULLIF(p_data->>'timeline','');
  v_summary text := NULLIF(btrim(p_data->>'summary'),'');
  v_negative text := NULLIF(btrim(p_data->>'negative_reason'),'');
  v_next timestamptz;
BEGIN
  PERFORM public.crm_require_role('sdr');
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) key
       WHERE key NOT IN ('income_range','goal','decision_maker','timeline','summary','negative_reason','next_at')) THEN
    RAISE EXCEPTION 'Dados de qualificação inválidos' USING ERRCODE='22023';
  END IF;
  SELECT * INTO c FROM public.crm_activities
    WHERE id=p_activity_id FOR UPDATE;
  IF NOT FOUND OR c.call_type IS DISTINCT FROM 'qualificacao' THEN
    RAISE EXCEPTION 'Call de qualificação não encontrada' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=c.lead_id FOR UPDATE;
  IF c.is_completed OR p_expected_revision IS DISTINCT FROM c.updated_at THEN
    RAISE EXCEPTION 'Call alterada. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF NOT public.crm_user_can(auth.uid(),'executive') AND c.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o SDR responsável pode concluir esta call' USING ERRCODE='42501';
  END IF;
  IF p_outcome NOT IN ('avancou','followup_sdr','lead_perdido') THEN
    RAISE EXCEPTION 'Resultado inválido para a qualificação' USING ERRCODE='22023';
  END IF;
  IF v_summary IS NULL OR char_length(v_summary) NOT BETWEEN 3 AND 5000 THEN
    RAISE EXCEPTION 'Registre um resumo da qualificação' USING ERRCODE='22023';
  END IF;
  IF v_income IS NOT NULL AND v_income NOT IN ('ate_3k','3k_5k','5k_10k','10k_20k','acima_20k','nao_informado') THEN
    RAISE EXCEPTION 'Faixa de renda inválida' USING ERRCODE='22023';
  END IF;
  IF v_decision IS NOT NULL AND v_decision NOT IN ('proprio','pais_responsaveis','compartilhada','outro','nao_identificado') THEN
    RAISE EXCEPTION 'Decisor inválido' USING ERRCODE='22023';
  END IF;
  IF v_timeline IS NOT NULL AND v_timeline NOT IN ('imediato','ate_30_dias','31_90_dias','acima_90_dias','sem_previsao') THEN
    RAISE EXCEPTION 'Prazo inválido' USING ERRCODE='22023';
  END IF;
  IF char_length(COALESCE(v_goal,''))>2000 OR char_length(COALESCE(v_negative,''))>500 THEN
    RAISE EXCEPTION 'Dados de qualificação excedem o limite' USING ERRCODE='22023';
  END IF;
  IF p_outcome='avancou' AND (v_income IS NULL OR v_goal IS NULL OR v_decision IS NULL OR v_timeline IS NULL) THEN
    RAISE EXCEPTION 'Preencha renda, objetivo, decisor e prazo antes do repasse' USING ERRCODE='22023';
  END IF;
  IF p_outcome='lead_perdido' AND (v_negative IS NULL OR char_length(v_negative)<2) THEN
    RAISE EXCEPTION 'Informe o motivo da negativa' USING ERRCODE='22023';
  END IF;
  IF NULLIF(p_data->>'next_at','') IS NOT NULL THEN
    v_next := (p_data->>'next_at')::timestamptz;
  END IF;
  IF p_outcome IN ('followup_sdr','lead_perdido')
     AND (v_next IS NULL OR NOT isfinite(v_next) OR v_next<=now()) THEN
    RAISE EXCEPTION 'Escolha uma próxima data futura' USING ERRCODE='22023';
  END IF;

  UPDATE public.crm_activities
  SET outcome=p_outcome,
      is_completed=true,
      completed_at=clock_timestamp(),
      description=COALESCE(description,v_summary),
      new_state=jsonb_build_object(
        'income_range',v_income,'goal',v_goal,'decision_maker',v_decision,
        'timeline',v_timeline,'summary',v_summary,'negative_reason',v_negative,
        'next_at',v_next
      )
  WHERE id=c.id
  RETURNING * INTO c;

  UPDATE public.crm_leads
  SET qualification_income_range=v_income,
      qualification_goal=v_goal,
      qualification_decision_maker=v_decision,
      qualification_timeline=v_timeline,
      qualification_summary=v_summary,
      qualification_completed_at=clock_timestamp(),
      qualification_completed_by=auth.uid(),
      pipeline_stage=CASE p_outcome
        WHEN 'avancou' THEN 'pronto_closer'
        WHEN 'lead_perdido' THEN 'lead_perdido'
        ELSE 'em_qualificacao'
      END,
      negative_reason=CASE WHEN p_outcome='lead_perdido' THEN v_negative ELSE negative_reason END,
      remarketing_status=CASE WHEN p_outcome='lead_perdido' THEN 'scheduled' ELSE remarketing_status END,
      remarketing_next_at=CASE WHEN p_outcome='lead_perdido' THEN v_next ELSE remarketing_next_at END,
      remarketing_attempt_count=CASE WHEN p_outcome='lead_perdido' THEN 0 ELSE remarketing_attempt_count END,
      next_followup_at=CASE WHEN p_outcome IN ('followup_sdr','lead_perdido') THEN v_next ELSE NULL END,
      closed_at=CASE WHEN p_outcome='lead_perdido' THEN clock_timestamp() ELSE NULL END,
      closed_by=CASE WHEN p_outcome='lead_perdido' THEN auth.uid() ELSE NULL END,
      last_contact_at=clock_timestamp()
  WHERE id=l.id;
  RETURN c;
END;
$$;

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
  PERFORM public.crm_require_role('sdr');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN
    RAISE EXCEPTION 'Lead alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF l.pipeline_stage IN ('repassado_closer','fechado_ganho','fechado_perdido','lead_perdido') THEN
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
  SET is_completed=true, completed_at=clock_timestamp(), outcome='lead_perdido'
  WHERE lead_id=l.id AND call_type='qualificacao' AND NOT is_completed;
  UPDATE public.crm_leads
  SET pipeline_stage='lead_perdido',
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
    COALESCE(v_note,v_reason),'lead_perdido',true,clock_timestamp(),
    jsonb_build_object('reason',v_reason,'next_at',p_next_at,'status','scheduled')
  );
  RETURN l;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_update_remarketing(
  p_lead_id uuid,
  p_expected_version bigint,
  p_action text,
  p_next_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.crm_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  l public.crm_leads;
  v_note text := NULLIF(btrim(p_note),'');
  v_title text;
BEGIN
  PERFORM public.crm_require_role('sdr');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN
    RAISE EXCEPTION 'Lead alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF l.pipeline_stage NOT IN ('lead_perdido','fechado_perdido') THEN
    RAISE EXCEPTION 'Lead fora da fila de remarketing' USING ERRCODE='PT409';
  END IF;
  IF NOT public.crm_user_can(auth.uid(),'executive')
     AND l.sdr_id IS NOT NULL AND l.sdr_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o SDR responsável pode acompanhar este lead' USING ERRCODE='42501';
  END IF;
  IF p_action NOT IN ('schedule','contacted','reactivate','do_not_contact') THEN
    RAISE EXCEPTION 'Ação de remarketing inválida' USING ERRCODE='22023';
  END IF;
  IF p_action IN ('schedule','contacted')
     AND (p_next_at IS NULL OR NOT isfinite(p_next_at) OR p_next_at<=now()) THEN
    RAISE EXCEPTION 'Escolha uma próxima data futura' USING ERRCODE='22023';
  END IF;
  IF p_action IN ('contacted','do_not_contact') AND (v_note IS NULL OR char_length(v_note)<3) THEN
    RAISE EXCEPTION 'Registre o resultado do contato' USING ERRCODE='22023';
  END IF;
  IF char_length(COALESCE(v_note,''))>5000 THEN
    RAISE EXCEPTION 'Anotação excede 5000 caracteres' USING ERRCODE='22023';
  END IF;

  v_title := CASE p_action
    WHEN 'schedule' THEN 'Follow-up de remarketing agendado'
    WHEN 'contacted' THEN 'Contato de remarketing realizado'
    WHEN 'reactivate' THEN 'Lead reativado pelo remarketing'
    ELSE 'Remarketing encerrado — não contatar'
  END;
  UPDATE public.crm_leads
  SET sdr_id=COALESCE(sdr_id,auth.uid()),
      remarketing_status=CASE p_action
        WHEN 'schedule' THEN 'scheduled'
        WHEN 'contacted' THEN 'nurturing'
        WHEN 'reactivate' THEN 'reactivated'
        ELSE 'do_not_contact'
      END,
      remarketing_next_at=CASE WHEN p_action IN ('schedule','contacted') THEN p_next_at ELSE NULL END,
      remarketing_last_contact_at=CASE WHEN p_action='contacted' THEN clock_timestamp() ELSE remarketing_last_contact_at END,
      remarketing_attempt_count=remarketing_attempt_count+CASE WHEN p_action='contacted' THEN 1 ELSE 0 END,
      pipeline_stage=CASE WHEN p_action='reactivate' THEN 'em_qualificacao' ELSE pipeline_stage END,
      next_followup_at=CASE WHEN p_action IN ('schedule','contacted') THEN p_next_at ELSE NULL END,
      closed_at=CASE WHEN p_action='reactivate' THEN NULL ELSE closed_at END,
      closed_by=CASE WHEN p_action='reactivate' THEN NULL ELSE closed_by END,
      last_contact_at=CASE WHEN p_action='contacted' THEN clock_timestamp() ELSE last_contact_at END
  WHERE id=l.id
  RETURNING * INTO l;
  INSERT INTO public.crm_activities(
    lead_id,user_id,activity_type,title,description,outcome,is_completed,completed_at,new_state
  ) VALUES(
    l.id,auth.uid(),'remarketing',v_title,v_note,p_action,true,clock_timestamp(),
    jsonb_build_object('action',p_action,'next_at',p_next_at,'status',l.remarketing_status)
  );
  RETURN l;
END;
$$;

-- Closer losses also enter the negative department, even when no SDR date has
-- been selected yet. Existing qualified/contact data is preserved.
CREATE OR REPLACE FUNCTION public.crm_prepare_remarketing_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.pipeline_stage IN ('lead_perdido','fechado_perdido')
     AND (TG_OP='INSERT' OR OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage) THEN
    NEW.remarketing_status := COALESCE(NEW.remarketing_status,'pending');
    NEW.negative_reason := COALESCE(
      NEW.negative_reason,
      CASE WHEN NEW.pipeline_stage='fechado_perdido'
        THEN 'Venda perdida no fechamento'
        ELSE 'Negativa registrada'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_crm_prepare_remarketing_state
  BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_prepare_remarketing_state();

REVOKE ALL ON FUNCTION public.crm_user_can(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resolve_sdr_qualification_call(uuid,text,timestamptz,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_mark_negative(uuid,bigint,text,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_update_remarketing(uuid,bigint,text,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_prepare_remarketing_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sdr_qualification_call(uuid,text,timestamptz,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mark_negative(uuid,bigint,text,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_remarketing(uuid,bigint,text,timestamptz,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
