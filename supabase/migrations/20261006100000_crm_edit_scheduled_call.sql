-- Any SDR or Closer (Executive and Super Admin included) can change, at any time,
-- who is responsible for an already scheduled call (the Closer of a closing call,
-- the SDR of a qualification call) and its time, in one revisioned operation.
-- Before this, only the lead's own Closer or an Executive could reassign or
-- reschedule a closing call, and nobody could change the SDR of a qualification call.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.update_crm_call(
  p_activity_id uuid,
  p_assigned_to uuid,
  p_scheduled_at timestamptz,
  p_expected_revision timestamptz
) RETURNS public.crm_activities
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  c public.crm_activities;
  l public.crm_leads;
  v_lead uuid;
  v_old_assignee uuid;
  v_old_scheduled timestamptz;
BEGIN
  PERFORM public.crm_require_role('leads');
  PERFORM public.crm_require_role('sdr');
  IF p_assigned_to IS NULL AND p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Informe o novo responsável ou o novo horário' USING ERRCODE='22023';
  END IF;
  SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  -- Same lock order as crm_transition: lead first, then its call.
  SELECT * INTO l FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  IF c.is_completed OR c.cancelled_at IS NOT NULL OR p_expected_revision IS DISTINCT FROM c.updated_at THEN
    RAISE EXCEPTION 'Call alterada. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN
    RAISE EXCEPTION 'Lead encerrado' USING ERRCODE='PT409';
  END IF;
  v_old_assignee := c.assigned_to;
  v_old_scheduled := c.scheduled_at;
  IF p_assigned_to IS NOT NULL AND p_assigned_to IS DISTINCT FROM c.assigned_to THEN
    IF NOT public.crm_user_can(p_assigned_to,CASE WHEN c.call_type='qualificacao' THEN 'sdr' ELSE 'closer' END) THEN
      RAISE EXCEPTION 'Responsável incompatível com o tipo da call' USING ERRCODE='22023';
    END IF;
    -- Same rule as arena_call_guard: the SDR who schedules a closing call never receives it.
    IF c.call_type='fechamento_closer' AND p_assigned_to=c.user_id THEN
      RAISE EXCEPTION 'A call de fechamento deve ficar com outro colaborador, não com quem a agendou.' USING ERRCODE='42501';
    END IF;
    c.assigned_to := p_assigned_to;
  END IF;
  IF p_scheduled_at IS NOT NULL AND p_scheduled_at IS DISTINCT FROM c.scheduled_at THEN
    IF NOT isfinite(p_scheduled_at) OR p_scheduled_at <= now() THEN
      RAISE EXCEPTION 'Escolha horário futuro' USING ERRCODE='22023';
    END IF;
    c.scheduled_at := p_scheduled_at;
  END IF;
  IF c.assigned_to IS NOT DISTINCT FROM v_old_assignee AND c.scheduled_at IS NOT DISTINCT FROM v_old_scheduled THEN
    RETURN c;
  END IF;
  UPDATE public.crm_activities SET assigned_to=c.assigned_to,scheduled_at=c.scheduled_at WHERE id=c.id RETURNING * INTO c;
  -- The lead follows its closing call (a pending closing call and lead.closer_id always match);
  -- lead.sdr_id stays: it is the lead owner, not the person who holds one call.
  IF (c.call_type='fechamento_closer' AND c.assigned_to IS DISTINCT FROM l.closer_id)
    OR c.scheduled_at IS DISTINCT FROM v_old_scheduled THEN
    UPDATE public.crm_leads SET
      closer_id=CASE WHEN c.call_type='fechamento_closer' THEN c.assigned_to ELSE closer_id END,
      next_followup_at=CASE WHEN c.scheduled_at IS DISTINCT FROM v_old_scheduled THEN c.scheduled_at ELSE next_followup_at END
    WHERE id=l.id;
  END IF;
  -- A closing-call reassignment is already on the timeline through crm_audit_lead (closer_id).
  -- A qualification call changes no lead column, so its reassignment gets its own entry.
  IF c.call_type='qualificacao' AND c.assigned_to IS DISTINCT FROM v_old_assignee THEN
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,is_completed,completed_at,previous_state,new_state)
      VALUES(l.id,auth.uid(),'transicao','Responsável da call de qualificação alterado',true,clock_timestamp(),
        jsonb_build_object('call_assigned_to',v_old_assignee),jsonb_build_object('call_assigned_to',c.assigned_to));
  END IF;
  RETURN c;
END; $$;

REVOKE ALL ON FUNCTION public.update_crm_call(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_crm_call(uuid,uuid,timestamptz,timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
