-- A checklist task reassigned to a different person (or moved to another day)
-- already reset is_completed/completed_at/completed_by, but left the item-level
-- checklist_items untouched. The new assignee could inherit items already
-- marked done by the previous assignee, and reassigning a fully-completed
-- checklist was silently blocked by checklist_task_guard (is_completed=false
-- would no longer match bool_and(items.done)=true). Reset every item's `done`
-- and `completed_at` whenever the assignee or date changes, matching the
-- header-level reset already in place.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.executive_update_daily_goal_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_task_date date,
  p_title text,
  p_expected_version bigint
)
RETURNS public.daily_goal_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_before public.daily_goal_tasks;
  v_task public.daily_goal_tasks;
  v_title text := private.sanitize_plain_text(p_title, 280);
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_actor_name text;
  v_reset boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o executivo pode editar metas diárias'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_before FROM public.daily_goal_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.task_date < v_today THEN
    RAISE EXCEPTION 'O histórico de dias encerrados não pode ser alterado'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_before.version THEN
    RAISE EXCEPTION 'Tarefa alterada por outra pessoa. Atualize e tente novamente.'
      USING ERRCODE = 'PT409';
  END IF;
  IF char_length(v_title) < 1 THEN
    RAISE EXCEPTION 'Escreva a tarefa' USING ERRCODE = '22023';
  END IF;
  IF p_task_date IS NULL OR p_task_date < v_today OR p_task_date > v_today + 730 THEN
    RAISE EXCEPTION 'Data da tarefa fora do intervalo permitido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = p_assignee_id AND NOT suspended
  ) THEN
    RAISE EXCEPTION 'Colaborador não encontrado ou inativo' USING ERRCODE = '22023';
  END IF;

  v_reset := p_assignee_id IS DISTINCT FROM v_before.assignee_id
    OR p_task_date IS DISTINCT FROM v_before.task_date;

  UPDATE public.daily_goal_tasks
     SET assignee_id = p_assignee_id,
         task_date = p_task_date,
         title = v_title,
         checklist_items = CASE WHEN v_reset THEN (
           SELECT COALESCE(jsonb_agg(item - 'completed_at' || jsonb_build_object('done', false, 'completed_at', NULL) ORDER BY ordinal), '[]'::jsonb)
           FROM jsonb_array_elements(checklist_items) WITH ORDINALITY AS x(item, ordinal)
         ) ELSE checklist_items END,
         is_completed = CASE WHEN v_reset THEN false ELSE is_completed END,
         completed_at = CASE WHEN v_reset THEN NULL ELSE completed_at END,
         completed_by = CASE WHEN v_reset THEN NULL ELSE completed_by END,
         updated_at = clock_timestamp(),
         version = version + 1
   WHERE id = p_task_id
   RETURNING * INTO v_task;

  SELECT COALESCE(display_name, 'Executivo') INTO v_actor_name
    FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data
  ) VALUES (
    auth.uid(), COALESCE(v_actor_name, 'Executivo'), 'daily_goal.update',
    v_task.id, v_task.title,
    CASE WHEN v_reset THEN 'Tarefa diária reatribuída pelo executivo; checklist reiniciado' ELSE 'Tarefa diária editada pelo executivo' END,
    to_jsonb(v_before), to_jsonb(v_task)
  );
  RETURN v_task;
END;
$$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic='goals';
NOTIFY pgrst, 'reload schema';
COMMIT;
