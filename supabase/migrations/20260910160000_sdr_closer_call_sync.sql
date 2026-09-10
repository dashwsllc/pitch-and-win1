-- Atomically hand a lead from SDR to Closer together with the scheduled call.
-- The assigned Closer receives the same date/time and context through the
-- shared CRM activity; next_followup_at stays synchronized for sorting/alerts.
BEGIN;

CREATE OR REPLACE FUNCTION public.handoff_and_schedule_closer_call(
  p_lead_id uuid,
  p_expected_version bigint,
  p_scheduled_at timestamptz,
  p_assigned_to uuid,
  p_context text DEFAULT NULL
)
RETURNS public.crm_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  l public.crm_leads;
  c public.crm_activities;
  v_context text := NULLIF(btrim(p_context), '');
BEGIN
  PERFORM public.crm_require_role('sdr');

  SELECT * INTO l
  FROM public.crm_leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN
    RAISE EXCEPTION 'Lead alterado por outra ação. Atualize e tente novamente.' USING ERRCODE = 'PT409';
  END IF;
  IF l.pipeline_stage NOT IN (
    'novo', 'em_qualificacao', 'pronto_closer', 'contato_feito',
    'proposta_enviada', 'negociacao', 'reativacao'
  ) THEN
    RAISE EXCEPTION 'Lead já repassado ou encerrado' USING ERRCODE = 'PT409';
  END IF;
  IF p_scheduled_at IS NULL
     OR NOT isfinite(p_scheduled_at)
     OR p_scheduled_at <= now() THEN
    RAISE EXCEPTION 'Escolha um horário futuro' USING ERRCODE = '22023';
  END IF;
  IF p_assigned_to IS NULL
     OR NOT public.crm_user_can(p_assigned_to, 'closer') THEN
    RAISE EXCEPTION 'Selecione um responsável com acesso Closer' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_context) > 10000 THEN
    RAISE EXCEPTION 'Contexto excede 10000 caracteres' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.crm_activities
    WHERE lead_id = l.id
      AND call_type = 'fechamento_closer'
      AND NOT is_completed
  ) THEN
    RAISE EXCEPTION 'Já existe uma call de fechamento pendente' USING ERRCODE = 'PT409';
  END IF;

  -- A qualification call no longer remains open after the handoff.
  UPDATE public.crm_activities
  SET is_completed = true,
      completed_at = clock_timestamp(),
      outcome = 'repassado_closer'
  WHERE lead_id = l.id
    AND call_type = 'qualificacao'
    AND NOT is_completed;

  UPDATE public.crm_leads
  SET pipeline_stage = 'repassado_closer',
      closer_id = p_assigned_to,
      sdr_id = COALESCE(sdr_id, auth.uid()),
      handed_off_at = clock_timestamp(),
      next_followup_at = p_scheduled_at
  WHERE id = l.id;

  INSERT INTO public.crm_activities (
    lead_id,
    user_id,
    activity_type,
    title,
    description,
    call_type,
    assigned_to,
    scheduled_at
  )
  VALUES (
    l.id,
    auth.uid(),
    'reuniao',
    'Fechamento com Closer',
    v_context,
    'fechamento_closer',
    p_assigned_to,
    p_scheduled_at
  )
  RETURNING * INTO c;

  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION public.handoff_and_schedule_closer_call(uuid,bigint,timestamptz,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handoff_and_schedule_closer_call(uuid,bigint,timestamptz,uuid,text)
  TO authenticated;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES (
  '20260910160000',
  'sdr_closer_call_sync',
  ARRAY['Atomic SDR to Closer handoff with synchronized call schedule and context']
)
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
