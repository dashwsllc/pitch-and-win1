-- Lead context imports and collaborator-scoped daily goal checklists.
-- Operational dates are calendar days in America/Sao_Paulo (00:00–24:00).
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sanitize_plain_text(p_value text, p_maximum integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE v_text text;
BEGIN
  SELECT
    btrim(
      translate(
        replace(replace(COALESCE(p_value, ''), E'\r\n', E'\n'), E'\r', E'\n'),
        (SELECT string_agg(chr(codepoint), '')
           FROM generate_series(1, 159) AS codes(codepoint)
          WHERE codepoint NOT IN (9, 10) AND (codepoint < 32 OR codepoint >= 127)),
        ''
      ), E' \t\n'
    ) INTO v_text;
  IF char_length(v_text) > greatest(COALESCE(p_maximum, 0), 0) THEN
    RAISE EXCEPTION 'O conteúdo excede % caracteres. Divida-o em entradas menores.', p_maximum USING ERRCODE = '22023';
  END IF;
  RETURN v_text;
END;
$$;
REVOKE ALL ON FUNCTION private.sanitize_plain_text(text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_lead_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_name text NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('sdr', 'closer')),
  context_type text NOT NULL CHECK (
    context_type IN ('whatsapp_summary', 'call_transcript', 'manual_note')
  ),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 50000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX crm_lead_contexts_lead_time
  ON public.crm_lead_contexts(lead_id, created_at DESC, id);

ALTER TABLE public.crm_lead_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_contexts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_lead_contexts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_lead_contexts TO authenticated;
CREATE POLICY crm_lead_contexts_select
  ON public.crm_lead_contexts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.crm_can('leads'));

CREATE OR REPLACE FUNCTION public.crm_add_lead_context(
  p_lead_id uuid,
  p_context_type text,
  p_content text
)
RETURNS public.crm_lead_contexts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_context public.crm_lead_contexts;
  v_content text := private.sanitize_plain_text(p_content, 50000);
  v_author_name text;
  v_author_role text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF NOT (public.crm_can('sdr') OR public.crm_can('closer')) THEN
    RAISE EXCEPTION 'Somente SDR, Closer ou executivo podem importar contexto' USING ERRCODE = '42501';
  END IF;
  IF p_context_type IS NULL OR p_context_type NOT IN (
    'whatsapp_summary', 'call_transcript', 'manual_note'
  ) THEN
    RAISE EXCEPTION 'Tipo de contexto inválido' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) < 1 THEN
    RAISE EXCEPTION 'Cole ou anexe um conteúdo antes de salvar' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE id = p_lead_id) THEN
    RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(display_name, 'Usuário CRM')
    INTO v_author_name
    FROM public.profiles
   WHERE user_id = auth.uid();

  -- Both SDR and Closer may import either content type. The recorded role is
  -- the user's real role when available and otherwise follows the work type.
  v_author_role := CASE
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = auth.uid() AND role::text = 'closer'
    ) THEN 'closer'
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = auth.uid() AND role::text = 'sdr'
    ) THEN 'sdr'
    WHEN p_context_type = 'call_transcript'
         AND public.crm_user_can(auth.uid(), 'closer') THEN 'closer'
    ELSE 'sdr'
  END;

  INSERT INTO public.crm_lead_contexts(
    lead_id, author_id, author_name, author_role, context_type, content
  ) VALUES (
    p_lead_id, auth.uid(), COALESCE(v_author_name, 'Usuário CRM'),
    v_author_role, p_context_type, v_content
  ) RETURNING * INTO v_context;

  RETURN v_context;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_update_lead_context(
  p_context_id uuid,
  p_context_type text,
  p_content text,
  p_expected_version bigint
)
RETURNS public.crm_lead_contexts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_context public.crm_lead_contexts;
  v_content text := private.sanitize_plain_text(p_content, 50000);
  v_editor_name text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF NOT (public.crm_can('sdr') OR public.crm_can('closer')) THEN
    RAISE EXCEPTION 'Somente SDR, Closer ou executivo podem editar contexto' USING ERRCODE = '42501';
  END IF;
  IF p_context_type IS NULL OR p_context_type NOT IN (
    'whatsapp_summary', 'call_transcript', 'manual_note'
  ) THEN
    RAISE EXCEPTION 'Tipo de contexto inválido' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) < 1 THEN
    RAISE EXCEPTION 'O contexto não pode ficar vazio' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_context
    FROM public.crm_lead_contexts
   WHERE id = p_context_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contexto não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_context.version THEN
    RAISE EXCEPTION 'Contexto alterado por outra pessoa. Atualize e tente novamente.'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(display_name, 'Usuário CRM')
    INTO v_editor_name
    FROM public.profiles
   WHERE user_id = auth.uid();

  UPDATE public.crm_lead_contexts
     SET context_type = p_context_type,
         content = v_content,
         updated_at = clock_timestamp(),
         updated_by = auth.uid(),
         updated_by_name = COALESCE(v_editor_name, 'Usuário CRM'),
         version = version + 1
   WHERE id = p_context_id
   RETURNING * INTO v_context;

  RETURN v_context;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_lead_context(uuid, text, text),
  public.crm_update_lead_context(uuid, text, text, bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_add_lead_context(uuid, text, text),
  public.crm_update_lead_context(uuid, text, text, bigint)
  TO authenticated;

CREATE TABLE public.daily_goal_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- task_date is deliberately a Brasília calendar day, never a rolling window.
  task_date date NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 280),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  is_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (is_completed AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR (NOT is_completed AND completed_at IS NULL AND completed_by IS NULL)
  )
);
CREATE INDEX daily_goal_tasks_assignee_date
  ON public.daily_goal_tasks(assignee_id, task_date, position, created_at, id);
CREATE UNIQUE INDEX daily_goal_tasks_no_duplicate_title
  ON public.daily_goal_tasks(assignee_id, task_date, lower(btrim(title)));

ALTER TABLE public.daily_goal_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_goal_tasks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_goal_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_goal_tasks TO authenticated;
CREATE POLICY daily_goal_tasks_select
  ON public.daily_goal_tasks FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (assignee_id = auth.uid() OR public.is_executive(auth.uid()))
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
       WHERE user_id = auth.uid() AND suspended
    )
  );

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
  IF auth.uid() IS NULL OR NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o executivo pode cadastrar metas diárias'
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

  SELECT COALESCE(display_name, 'Executivo') INTO v_actor_name
    FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, after_data
  ) VALUES (
    auth.uid(), COALESCE(v_actor_name, 'Executivo'), 'daily_goal.create',
    v_task.id, v_task.title, 'Tarefa diária cadastrada pelo executivo', to_jsonb(v_task)
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

  UPDATE public.daily_goal_tasks
     SET assignee_id = p_assignee_id,
         task_date = p_task_date,
         title = v_title,
         is_completed = CASE
           WHEN p_assignee_id IS DISTINCT FROM v_before.assignee_id
             OR p_task_date IS DISTINCT FROM v_before.task_date THEN false
           ELSE is_completed
         END,
         completed_at = CASE
           WHEN p_assignee_id IS DISTINCT FROM v_before.assignee_id
             OR p_task_date IS DISTINCT FROM v_before.task_date THEN NULL
           ELSE completed_at
         END,
         completed_by = CASE
           WHEN p_assignee_id IS DISTINCT FROM v_before.assignee_id
             OR p_task_date IS DISTINCT FROM v_before.task_date THEN NULL
           ELSE completed_by
         END,
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
    v_task.id, v_task.title, 'Tarefa diária editada pelo executivo',
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
  IF auth.uid() IS NULL OR NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o executivo pode remover metas diárias'
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

  SELECT COALESCE(display_name, 'Executivo') INTO v_actor_name
    FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, before_data
  ) VALUES (
    auth.uid(), COALESCE(v_actor_name, 'Executivo'), 'daily_goal.delete',
    v_task.id, v_task.title, 'Tarefa diária removida pelo executivo', to_jsonb(v_task)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_daily_goal_task_completed(
  p_task_id uuid,
  p_completed boolean,
  p_expected_version bigint
)
RETURNS public.daily_goal_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_task public.daily_goal_tasks;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.dashboard_require_access();
  IF p_completed IS NULL THEN
    RAISE EXCEPTION 'Estado de conclusão inválido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task FROM public.daily_goal_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_task.assignee_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Você só pode concluir as suas próprias tarefas'
      USING ERRCODE = '42501';
  END IF;
  IF v_task.task_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'Somente tarefas do dia corrente podem ser marcadas'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_task.version THEN
    RAISE EXCEPTION 'Tarefa alterada em outro dispositivo. Atualize e tente novamente.'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.daily_goal_tasks
     SET is_completed = p_completed,
         completed_at = CASE WHEN p_completed THEN clock_timestamp() ELSE NULL END,
         completed_by = CASE WHEN p_completed THEN auth.uid() ELSE NULL END,
         updated_at = clock_timestamp(),
         version = version + 1
   WHERE id = p_task_id
   RETURNING * INTO v_task;
  RETURN v_task;
END;
$$;

REVOKE ALL ON FUNCTION public.executive_create_daily_goal_task(uuid, date, text),
  public.executive_update_daily_goal_task(uuid, uuid, date, text, bigint),
  public.executive_delete_daily_goal_task(uuid, bigint),
  public.set_daily_goal_task_completed(uuid, boolean, bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.executive_create_daily_goal_task(uuid, date, text),
  public.executive_update_daily_goal_task(uuid, uuid, date, text, bigint),
  public.executive_delete_daily_goal_task(uuid, bigint),
  public.set_daily_goal_task_completed(uuid, boolean, bigint)
  TO authenticated;

-- Requested checklist for 11/09/2026. A missing collaborator simply produces
-- no seed row; the executive screen can assign the task once that account exists.
-- User confirmed Alex = Sinclair, and requested both Pedro profiles.
WITH requested(first_name, title, position) AS (
  VALUES
    ('sinclair', 'Criar funis de vendas', 0),
    ('sinclair', 'Alinhamento com o Vinicius', 1),
    ('sinclair', 'Manutenção das plataformas', 2),
    ('sinclair', 'Fazer SDR', 3),
    ('sinclair', 'Auxiliar no suporte', 4),
    ('sinclair', 'Criar landing pages para rodar funis diferentes', 5),
    ('sinclair', 'Revisar tráfego utilizado', 6),
    ('pedro', 'Trabalho de SDR', 0),
    ('pedro', 'Acompanhamento dos leads', 1),
    ('ismael', 'Ajudar a selecionar criativos para tráfego', 0),
    ('ismael', 'Editar hook e gancho dos criativos', 1),
    ('ismael', 'Publicar a campanha programada para rodar em 12/09', 2)
), candidates AS (
  SELECT user_id,
    lower(split_part(btrim(display_name), ' ', 1)) AS first_name,
    count(*) OVER (PARTITION BY lower(split_part(btrim(display_name), ' ', 1))) AS matches
  FROM public.profiles
  WHERE NOT suspended
), assignees AS (
  SELECT user_id, first_name FROM candidates WHERE matches = 1 OR first_name = 'pedro'
)
INSERT INTO public.daily_goal_tasks(assignee_id, task_date, title, position, created_by)
SELECT assignees.user_id, DATE '2026-09-11', requested.title, requested.position, NULL
FROM requested
JOIN assignees USING (first_name)
ON CONFLICT DO NOTHING;

CREATE TRIGGER dashboard_daily_goals_signal
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_goal_tasks
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('goals');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'crm_lead_contexts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_contexts;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'daily_goal_tasks'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_goal_tasks;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
