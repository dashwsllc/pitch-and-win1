-- Two precision fixes found while auditing Arena/Metas:
--
-- 1) company_goals' own SELECT policy let any active colleague read a
-- role-scoped goal's title/target directly from the table (e.g. an SDR
-- reading the Closer's weekly target), even though arena_visible_goals()
-- already filters that same data to only people who actually hold the role.
-- The table policy now matches that same intent.
--
-- 2) The three daily-task executive RPCs still used the older is_executive()
-- check, while every other Arena RPC moved to arena_has_access(true), which
-- adds the registration_has_access() gate (blocks an executive/super_admin
-- role that was assigned before their registration was ever approved). Lines
-- them up so every executive-only action in Arena enforces the same rule.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DROP POLICY IF EXISTS goals_select ON public.company_goals;
CREATE POLICY goals_select ON public.company_goals FOR SELECT TO authenticated
 USING(public.registration_has_access() AND
   EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND NOT suspended) AND
   (scope='global'
     OR (scope='role' AND (public.arena_has_access(true)
       OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role::text=target_role)))
     OR (scope='user' AND (assignee_id=auth.uid() OR public.arena_has_access(true)))));

CREATE OR REPLACE FUNCTION public.executive_create_daily_goal_task(
  p_assignee_id uuid,
  p_task_date date,
  p_title text
)
RETURNS public.daily_goal_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_task public.daily_goal_tasks;
  v_title text := private.sanitize_plain_text(p_title, 280);
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_actor_name text;
BEGIN
  IF NOT public.arena_has_access(true) THEN
    RAISE EXCEPTION 'Somente o Executive pode cadastrar metas diárias'
      USING ERRCODE = '42501';
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

  INSERT INTO public.daily_goal_tasks(
    assignee_id, task_date, title, position, created_by
  ) VALUES (
    p_assignee_id,
    p_task_date,
    v_title,
    COALESCE((
      SELECT max(position) + 1 FROM public.daily_goal_tasks
       WHERE assignee_id = p_assignee_id AND task_date = p_task_date
    ), 0),
    auth.uid()
  ) RETURNING * INTO v_task;

  SELECT COALESCE(display_name, 'Executive') INTO v_actor_name
    FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, after_data
  ) VALUES (
    auth.uid(), COALESCE(v_actor_name, 'Executive'), 'daily_goal.create',
    v_task.id, v_task.title, 'Tarefa diária cadastrada pelo Executive', to_jsonb(v_task)
  );
  RETURN v_task;
END;
$$;

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
  IF NOT public.arena_has_access(true) THEN
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

CREATE OR REPLACE FUNCTION public.executive_delete_daily_goal_task(
  p_task_id uuid,
  p_expected_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_task public.daily_goal_tasks;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_actor_name text;
BEGIN
  IF NOT public.arena_has_access(true) THEN
    RAISE EXCEPTION 'Somente o Executive pode remover metas diárias'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_task FROM public.daily_goal_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_task.task_date < v_today THEN
    RAISE EXCEPTION 'O histórico de dias encerrados não pode ser removido'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_task.version THEN
    RAISE EXCEPTION 'Tarefa alterada por outra pessoa. Atualize e tente novamente.'
      USING ERRCODE = 'PT409';
  END IF;
  DELETE FROM public.daily_goal_tasks WHERE id = p_task_id;

  SELECT COALESCE(display_name, 'Executive') INTO v_actor_name
    FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, before_data
  ) VALUES (
    auth.uid(), COALESCE(v_actor_name, 'Executive'), 'daily_goal.delete',
    v_task.id, v_task.title, 'Tarefa diária removida pelo Executive', to_jsonb(v_task)
  );
END;
$$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
