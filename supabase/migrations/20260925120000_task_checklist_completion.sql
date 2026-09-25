BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- One action completes or reopens the entire checklist in a single versioned
-- update. The existing audit and dashboard revision triggers publish the result.
CREATE OR REPLACE FUNCTION public.arena_set_task_checklist_completion(
  p_id uuid, p_completed boolean, p_version bigint)
RETURNS public.daily_goal_tasks LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks; v_items jsonb; v_completed_at timestamptz;
BEGIN
  PERFORM public.dashboard_require_access();
  IF NOT public.registration_has_access() OR p_completed IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501';
  END IF;
  SELECT * INTO t FROM public.daily_goal_tasks WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR t.assignee_id IS DISTINCT FROM auth.uid() OR t.deadline_at IS NULL THEN
    RAISE EXCEPTION 'Checklist indisponível' USING ERRCODE='42501';
  END IF;
  IF t.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Tarefa alterada. Atualize a tela.' USING ERRCODE='PT409';
  END IF;
  IF t.is_completed=p_completed AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.checklist_items) item
    WHERE (item->>'done')::boolean IS DISTINCT FROM p_completed
  ) THEN RETURN t; END IF;
  v_completed_at:=CASE WHEN p_completed THEN clock_timestamp() END;
  SELECT jsonb_agg(item||jsonb_build_object(
    'done',p_completed,'completed_at',v_completed_at) ORDER BY ordinal)
  INTO v_items
  FROM jsonb_array_elements(t.checklist_items) WITH ORDINALITY AS x(item,ordinal);
  UPDATE public.daily_goal_tasks SET checklist_items=v_items,
    is_completed=p_completed,
    completed_at=v_completed_at,
    completed_by=CASE WHEN p_completed THEN auth.uid() END,
    version=version+1,updated_at=clock_timestamp()
  WHERE id=p_id RETURNING * INTO t;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.arena_set_task_checklist_completion(uuid,boolean,bigint)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_set_task_checklist_completion(uuid,boolean,bigint)
  TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
