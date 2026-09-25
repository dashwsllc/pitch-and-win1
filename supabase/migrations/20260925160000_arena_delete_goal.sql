-- Executive-facing "remove goal and cycles" action. company_goals versions are
-- permanently immutable (arena_goal_versions_immutable fires unconditionally)
-- and closed goal_cycles rows are frozen by arena_cycle_guard, by design, so a
-- real DELETE of goal history is not possible and must not be worked around.
-- "Removing" a goal here means: disable it (a final version, same mechanism
-- as arena_save_goal) so it stops generating cycles and drops off every open
-- dashboard immediately, and delete only the goal's still-open cycle rows
-- (closed_at IS NULL), which never produced a historical result. Closed
-- cycles, rankings and the audit trail stay exactly as they are.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.arena_delete_goal(p_family_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE g public.company_goals; v_id uuid; v_open_cycles integer; v_closed_cycles integer;
BEGIN
  IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da remoção'; END IF;
  PERFORM pg_advisory_xact_lock(23091100);
  SELECT * INTO g FROM public.company_goals WHERE family_id=p_family_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada' USING ERRCODE='P0002'; END IF;
  IF NOT g.enabled THEN RAISE EXCEPTION 'Esta meta já está desativada' USING ERRCODE='PT409'; END IF;

  SELECT count(*) FILTER(WHERE closed_at IS NULL), count(*) FILTER(WHERE closed_at IS NOT NULL)
    INTO v_open_cycles, v_closed_cycles FROM public.goal_cycles WHERE family_id=p_family_id;
  DELETE FROM public.goal_cycles WHERE family_id=p_family_id AND closed_at IS NULL;

  INSERT INTO public.company_goals(title,description,period,target,unit,scope,target_role,assignee_id,metric,
    family_id,version,effective_at,cycle_start,cycle_end,recurring,show_countdown,ticket_reference,enabled,created_by)
  VALUES(g.title,g.description,g.period,g.target,g.unit,g.scope,g.target_role,g.assignee_id,g.metric,
    g.family_id,g.version+1,transaction_timestamp(),g.cycle_start,g.cycle_end,g.recurring,g.show_countdown,
    g.ticket_reference,false,auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
  VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'goal.delete',v_id,g.title,btrim(p_reason),
    to_jsonb(g),jsonb_build_object('enabled',false,'open_cycles_removed',v_open_cycles,'closed_cycles_preserved',v_closed_cycles));

  INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
  SELECT DISTINCT user_id,'goal.delete:'||v_id,'goal.delete','Meta removida: '||g.title FROM public.user_roles
  WHERE role::text IN ('sdr','closer','executive','super_admin')
    AND (g.scope<>'user' OR user_id=g.assignee_id OR role::text IN ('executive','super_admin')) ON CONFLICT DO NOTHING;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.arena_delete_goal(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.arena_delete_goal(uuid,text) TO authenticated;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
