BEGIN;

-- Scheduling a Closer call from the shared queue claims/assigns the lead in the
-- same transaction. This prevents a valid schedule form from failing only
-- because the card was still unclaimed.
CREATE OR REPLACE FUNCTION public.schedule_closer_call(
  p_lead_id uuid,
  p_call_type text,
  p_scheduled_at timestamptz,
  p_assigned_to uuid,
  p_context text DEFAULT NULL
)
RETURNS public.crm_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  l public.crm_leads;
  c public.crm_activities;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002';
  END IF;
  IF p_call_type IS NULL
     OR p_call_type NOT IN ('qualificacao','fechamento_closer')
     OR p_scheduled_at IS NULL
     OR NOT isfinite(p_scheduled_at)
     OR p_scheduled_at<=now() THEN
    RAISE EXCEPTION 'Escolha tipo e horário futuro válidos' USING ERRCODE='22023';
  END IF;
  PERFORM public.crm_require_role(
    CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END
  );
  IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido')
     OR (p_call_type='qualificacao' AND l.pipeline_stage='repassado_closer')
     OR (p_call_type='fechamento_closer' AND l.pipeline_stage<>'repassado_closer') THEN
    RAISE EXCEPTION 'Etapa incompatível. Envie explicitamente ao Closer antes de agendar fechamento.' USING ERRCODE='PT409';
  END IF;
  IF NOT public.crm_user_can(
    p_assigned_to,
    CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END
  ) THEN
    RAISE EXCEPTION 'Responsável incompatível' USING ERRCODE='22023';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM public.crm_activities
    WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed
  ) THEN
    RAISE EXCEPTION 'Já existe uma call pendente. Use Reagendar.' USING ERRCODE='PT409';
  END IF;

  IF p_call_type='fechamento_closer' THEN
    IF l.closer_id IS NULL THEN
      IF p_assigned_to IS DISTINCT FROM auth.uid()
         AND NOT public.crm_user_can(auth.uid(),'admin') THEN
        RAISE EXCEPTION 'Assuma o lead ou selecione você como responsável' USING ERRCODE='42501';
      END IF;
      UPDATE public.crm_leads
      SET closer_id=p_assigned_to
      WHERE id=l.id
      RETURNING * INTO l;
    ELSIF l.closer_id IS DISTINCT FROM p_assigned_to THEN
      RAISE EXCEPTION 'Lead atribuído a outro Closer. Reatribua antes de agendar.' USING ERRCODE='PT409';
    ELSIF NOT public.crm_user_can(auth.uid(),'admin')
          AND l.closer_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Somente o Closer responsável pode agendar esta call' USING ERRCODE='42501';
    END IF;
  END IF;

  INSERT INTO public.crm_activities(
    lead_id,user_id,activity_type,title,description,call_type,assigned_to,scheduled_at
  ) VALUES(
    l.id,
    auth.uid(),
    'reuniao',
    CASE WHEN p_call_type='qualificacao' THEN 'Qualificação' ELSE 'Fechamento com Closer' END,
    NULLIF(btrim(p_context),''),
    p_call_type,
    p_assigned_to,
    p_scheduled_at
  )
  RETURNING * INTO c;

  UPDATE public.crm_leads
  SET next_followup_at=p_scheduled_at,
      pipeline_stage=CASE WHEN pipeline_stage='novo' THEN 'em_qualificacao' ELSE pipeline_stage END
  WHERE id=l.id;
  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_closer_call(uuid,text,timestamptz,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_closer_call(uuid,text,timestamptz,uuid,text) TO authenticated;

COMMIT;
