BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.daily_goal_tasks
  ADD COLUMN deadline_at timestamptz,
  ADD COLUMN checklist_items jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.checklist_task_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_all_done boolean;
BEGIN
  IF jsonb_typeof(NEW.checklist_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.checklist_items)>20 THEN
    RAISE EXCEPTION 'Checklist inválido' USING ERRCODE='22023';
  END IF;
  IF NEW.deadline_at IS NOT NULL THEN
    IF jsonb_array_length(NEW.checklist_items)=0
      OR NEW.task_date IS DISTINCT FROM (NEW.deadline_at AT TIME ZONE 'America/Sao_Paulo')::date
    THEN RAISE EXCEPTION 'Prazo e checklist incompatíveis' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.checklist_items) item
      WHERE jsonb_typeof(item) <> 'object'
        OR item->>'id' IS NULL OR item->>'text' IS NULL
        OR item->>'done' IS NULL OR item->>'done' NOT IN ('true','false'))
    THEN RAISE EXCEPTION 'Itens do checklist inválidos' USING ERRCODE='22023'; END IF;
    SELECT bool_and((item->>'done')::boolean) INTO v_all_done
    FROM jsonb_array_elements(NEW.checklist_items) item;
    IF NEW.is_completed IS DISTINCT FROM v_all_done THEN
      RAISE EXCEPTION 'A conclusão deve seguir o checklist' USING ERRCODE='22023';
    END IF;
  ELSIF NEW.checklist_items <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Checklist sem prazo' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER daily_goal_checklist_guard BEFORE INSERT OR UPDATE ON public.daily_goal_tasks
FOR EACH ROW EXECUTE FUNCTION public.checklist_task_guard();

CREATE OR REPLACE FUNCTION public.arena_assign_checklist_task(
  p_title text, p_assignee uuid, p_deadline_at timestamptz, p_items text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_title text; v_text text; v_items jsonb:='[]'::jsonb; v_task public.daily_goal_tasks;
  v_date date;
BEGIN
  IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  v_title:=private.sanitize_plain_text(p_title,200);
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 2 AND 200
    OR p_deadline_at IS NULL OR NOT isfinite(p_deadline_at)
    OR p_deadline_at<=clock_timestamp()+interval '1 minute'
    OR p_deadline_at>clock_timestamp()+interval '366 days'
    OR p_items IS NULL OR cardinality(p_items) NOT BETWEEN 1 AND 20
  THEN RAISE EXCEPTION 'Informe tarefa, checklist e prazo futuro válidos' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=p_assignee AND NOT suspended)
  THEN RAISE EXCEPTION 'Colaborador não encontrado ou inativo' USING ERRCODE='22023'; END IF;
  FOREACH v_text IN ARRAY p_items LOOP
    v_text:=private.sanitize_plain_text(v_text,200);
    IF v_text IS NULL OR char_length(v_text) NOT BETWEEN 2 AND 200 THEN
      RAISE EXCEPTION 'Cada item deve ter entre 2 e 200 caracteres' USING ERRCODE='22023'; END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,'text',v_text,'done',false,'completed_at',NULL));
  END LOOP;
  v_date:=(p_deadline_at AT TIME ZONE 'America/Sao_Paulo')::date;
  INSERT INTO public.daily_goal_tasks(
    assignee_id,task_date,title,position,created_by,deadline_at,checklist_items)
  VALUES(p_assignee,v_date,v_title,
    COALESCE((SELECT max(position)+1 FROM public.daily_goal_tasks
      WHERE assignee_id=p_assignee AND task_date=v_date),0),
    auth.uid(),p_deadline_at,v_items)
  RETURNING * INTO v_task;
  RETURN v_task.id;
END $$;
REVOKE ALL ON FUNCTION public.arena_assign_checklist_task(text,uuid,timestamptz,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_assign_checklist_task(text,uuid,timestamptz,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.arena_toggle_task_checklist(
  p_id uuid,p_item_id uuid,p_done boolean,p_version bigint)
RETURNS public.daily_goal_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks; v_items jsonb; v_all_done boolean;
BEGIN
  PERFORM public.dashboard_require_access();
  IF NOT public.registration_has_access() OR p_done IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  SELECT * INTO t FROM public.daily_goal_tasks WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR t.assignee_id IS DISTINCT FROM auth.uid() OR t.deadline_at IS NULL
  THEN RAISE EXCEPTION 'Checklist indisponível' USING ERRCODE='42501'; END IF;
  IF t.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Tarefa alterada. Atualize a tela.' USING ERRCODE='PT409'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.checklist_items) item
    WHERE item->>'id'=p_item_id::text) THEN
    RAISE EXCEPTION 'Item não encontrado' USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(
    CASE WHEN item->>'id'=p_item_id::text THEN
      item||jsonb_build_object('done',p_done,'completed_at',
        CASE WHEN p_done THEN clock_timestamp() ELSE NULL END)
    ELSE item END ORDER BY ordinal)
  INTO v_items
  FROM jsonb_array_elements(t.checklist_items) WITH ORDINALITY AS x(item,ordinal);
  IF v_items=t.checklist_items THEN RETURN t; END IF;
  SELECT bool_and((item->>'done')::boolean) INTO v_all_done
  FROM jsonb_array_elements(v_items) item;
  UPDATE public.daily_goal_tasks SET checklist_items=v_items,
    is_completed=v_all_done,
    completed_at=CASE WHEN v_all_done THEN clock_timestamp() END,
    completed_by=CASE WHEN v_all_done THEN auth.uid() END,
    version=version+1,updated_at=clock_timestamp()
  WHERE id=p_id RETURNING * INTO t;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.arena_toggle_task_checklist(uuid,uuid,boolean,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_toggle_task_checklist(uuid,uuid,boolean,bigint) TO authenticated;

-- Checklist changes go to the assigning Executive. Existing task events retain
-- their prior assignee notification behavior.
CREATE OR REPLACE FUNCTION public.arena_task_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks; v_kind text; v_progress integer; v_recipient uuid;
BEGIN
 IF TG_OP='DELETE' THEN t:=OLD; ELSE t:=NEW; END IF;
 v_kind:=CASE WHEN TG_OP='INSERT' THEN 'task.assigned' WHEN TG_OP='DELETE' THEN 'task.deleted'
 WHEN NEW.deadline_at IS NOT NULL AND OLD.deadline_at IS NOT NULL
   AND NEW.checklist_items IS DISTINCT FROM OLD.checklist_items THEN 'task.progress'
 WHEN NEW.is_completed IS DISTINCT FROM OLD.is_completed THEN CASE WHEN NEW.is_completed THEN 'task.completed' ELSE 'task.reopened' END ELSE 'task.updated' END;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(auth.uid(),COALESCE((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Sistema'),v_kind,t.id,t.title,
 COALESCE(NULLIF(t.completion_comment,''),CASE WHEN v_kind='task.progress' THEN 'Checklist atualizado' ELSE 'Atualização de tarefa operacional' END),
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
 IF v_kind='task.progress' THEN
   SELECT round(100.0*count(*) FILTER(WHERE item->>'done'='true')/count(*))::integer
   INTO v_progress FROM jsonb_array_elements(t.checklist_items) item;
 END IF;
 v_recipient:=CASE WHEN v_kind='task.progress' AND t.created_by IS NOT NULL
   AND t.created_by<>t.assignee_id THEN t.created_by ELSE t.assignee_id END;
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 VALUES(v_recipient,v_kind||':'||t.id||':'||t.version,v_kind,
   CASE WHEN v_kind='task.progress' THEN t.title||' · '||v_progress||'% concluído' ELSE t.title END)
 ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp()
WHERE topic='goals';
NOTIFY pgrst,'reload schema';
COMMIT;
