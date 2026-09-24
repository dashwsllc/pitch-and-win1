-- Read-only post-deploy guard for the corrected September 24 assignment.
DO $verify$
DECLARE v_definition constant uuid:='a6ac7099-dd07-4937-a94e-3704f38bf492';
 v_keep constant uuid:='ef951f8b-b392-435e-8afc-e599caffdc46';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workboard_tasks w WHERE w.id=v_definition
   AND w.assigned_to=ARRAY[v_keep]::uuid[] AND w.target_roles='{}'::text[])
 OR (SELECT count(*) FROM public.daily_goal_tasks WHERE definition_id=v_definition)<>1
 OR NOT EXISTS(SELECT 1 FROM public.daily_goal_tasks WHERE definition_id=v_definition AND assignee_id=v_keep)
 OR EXISTS(SELECT 1 FROM public.arena_notifications n WHERE n.recipient_id<>v_keep
   AND (n.event_key LIKE '%920ba827-a69b-4cbb-9606-b31aa22c20f0%'
     OR n.event_key LIKE '%13e97443-06f3-4c5f-8979-e14daddc6073%'))
 OR NOT EXISTS(SELECT 1 FROM public.executive_audit_events a WHERE a.target_id=v_definition
   AND a.action='task.assignment_corrected' AND a.actor_id IS NULL)
 THEN RAISE EXCEPTION 'A tarefa de Pedro ainda possui destinatários ou avisos indevidos'; END IF;
END $verify$;
SELECT 'pedro_assignment_passed' result;
