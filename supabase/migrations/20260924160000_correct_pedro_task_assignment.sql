BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- Administrative corrections have no end-user JWT. Preserve an honest
-- system actor in the existing task audit instead of inventing a user.
CREATE OR REPLACE FUNCTION public.arena_task_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks; v_kind text;
BEGIN
 IF TG_OP='DELETE' THEN t:=OLD; ELSE t:=NEW; END IF;
 v_kind:=CASE WHEN TG_OP='INSERT' THEN 'task.assigned' WHEN TG_OP='DELETE' THEN 'task.deleted'
 WHEN NEW.is_completed IS DISTINCT FROM OLD.is_completed THEN CASE WHEN NEW.is_completed THEN 'task.completed' ELSE 'task.reopened' END ELSE 'task.updated' END;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(auth.uid(),COALESCE((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Sistema'),v_kind,t.id,t.title,
 COALESCE(NULLIF(t.completion_comment,''),'Atualização de tarefa operacional'),
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 VALUES(t.assignee_id,v_kind||':'||t.id||':'||t.version,v_kind,t.title) ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;

DO $fix$
DECLARE
 v_definition constant uuid:='a6ac7099-dd07-4937-a94e-3704f38bf492';
 v_keep constant uuid:='ef951f8b-b392-435e-8afc-e599caffdc46';
 v_keep_task constant uuid:='43f78418-ed59-454f-8b88-d40910774638';
 v_wrong_one constant uuid:='920ba827-a69b-4cbb-9606-b31aa22c20f0';
 v_wrong_two constant uuid:='13e97443-06f3-4c5f-8979-e14daddc6073';
 v_before public.workboard_tasks;
 v_after public.workboard_tasks;
 v_count integer;
 v_deleted integer;
BEGIN
 SELECT * INTO v_before FROM public.workboard_tasks WHERE id=v_definition FOR UPDATE;
 IF NOT FOUND OR v_before.title<>'Abordar 50 LEAD''s da lista'
   OR v_before.assigned_to IS DISTINCT FROM ARRAY[
     'c84e101d-e966-477a-8ef6-c3766cd781cf'::uuid,
     'e7d04d3d-4212-4117-b12b-1d7471997138'::uuid,v_keep]
   OR v_before.target_roles IS DISTINCT FROM ARRAY['sdr']::text[] THEN
   RAISE EXCEPTION 'Atribuição original mudou; revisão manual necessária' USING ERRCODE='PT409';
 END IF;
 PERFORM 1 FROM public.daily_goal_tasks WHERE definition_id=v_definition FOR UPDATE;
 SELECT count(*) INTO v_count FROM public.daily_goal_tasks
 WHERE definition_id=v_definition AND NOT is_completed AND task_date=DATE '2026-09-24'
   AND ((id=v_keep_task AND assignee_id=v_keep)
     OR (id=v_wrong_one AND assignee_id='e7d04d3d-4212-4117-b12b-1d7471997138')
     OR (id=v_wrong_two AND assignee_id='c84e101d-e966-477a-8ef6-c3766cd781cf'));
 IF v_count<>3 OR (SELECT count(*) FROM public.daily_goal_tasks WHERE definition_id=v_definition)<>3 THEN
   RAISE EXCEPTION 'Tarefas originais mudaram; revisão manual necessária' USING ERRCODE='PT409';
 END IF;
 IF EXISTS(SELECT 1 FROM public.workboard_completions WHERE task_id=v_definition) THEN
   RAISE EXCEPTION 'Há conclusões no quadro; revisão manual necessária' USING ERRCODE='PT409';
 END IF;

 DELETE FROM public.daily_goal_tasks WHERE definition_id=v_definition AND id IN(v_wrong_one,v_wrong_two);
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>2 THEN RAISE EXCEPTION 'Correção incompleta'; END IF;
 UPDATE public.workboard_tasks SET assigned_to=ARRAY[v_keep]::uuid[],target_roles='{}'::text[],mode='individual'
 WHERE id=v_definition RETURNING * INTO v_after;
 -- Remove the original erroneous alerts and the deletion alerts for the two
 -- non-recipients. Pedro's assignment and notifications remain intact.
 DELETE FROM public.arena_notifications WHERE recipient_id IN(
   'e7d04d3d-4212-4117-b12b-1d7471997138'::uuid,
   'c84e101d-e966-477a-8ef6-c3766cd781cf'::uuid)
   AND (event_key LIKE '%'||v_wrong_one::text||'%' OR event_key LIKE '%'||v_wrong_two::text||'%');
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(NULL,'Sistema','task.assignment_corrected',v_definition,v_before.title,
   'Correção autorizada: a tarefa foi atribuída somente a Pedro Iago',to_jsonb(v_before),to_jsonb(v_after));
 IF (SELECT count(*) FROM public.daily_goal_tasks WHERE definition_id=v_definition AND assignee_id=v_keep)<>1
   OR (SELECT count(*) FROM public.daily_goal_tasks WHERE definition_id=v_definition)<>1 THEN
   RAISE EXCEPTION 'Pós-condição da atribuição individual falhou';
 END IF;
END $fix$;

COMMIT;
