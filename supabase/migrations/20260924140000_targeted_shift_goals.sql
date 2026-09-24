BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Operational tasks are always individual. Collective targets belong to Arena.
CREATE OR REPLACE FUNCTION public.arena_assign_tasks(p_title text,p_date date,p_people uuid[],p_roles text[],p_status text DEFAULT 'not_scheduled')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_user uuid; v_task public.daily_goal_tasks; v_count integer:=0; v_people uuid[];
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 200 OR p_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date+366 THEN RAISE EXCEPTION 'Título ou data inválidos'; END IF;
 IF COALESCE(cardinality(p_people),0)<>1 OR COALESCE(cardinality(p_roles),0)<>0 THEN
   RAISE EXCEPTION 'Selecione exatamente um colaborador; metas por cargo pertencem à Arena' USING ERRCODE='22023';
 END IF;
 SELECT ARRAY[p.user_id] INTO v_people FROM public.profiles p
 WHERE NOT p.suspended AND p.user_id=p_people[1];
 IF COALESCE(cardinality(v_people),0)<>1 THEN RAISE EXCEPTION 'Colaborador não encontrado ou inativo' USING ERRCODE='22023'; END IF;
 INSERT INTO public.workboard_tasks(title,created_by,assigned_to,target_roles,deadline,is_active)
 VALUES(btrim(p_title),auth.uid(),v_people,'{}'::text[],
   (p_date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo',true) RETURNING id INTO v_id;
 FOREACH v_user IN ARRAY v_people LOOP
   v_task:=public.executive_create_daily_goal_task(v_user,p_date,p_title);
   UPDATE public.daily_goal_tasks SET definition_id=v_id,operational_status=p_status WHERE id=v_task.id;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;

-- Role goals are visible only to that role. The Executive still sees every
-- goal in the management view; a colleague cannot see another role's target.
CREATE OR REPLACE FUNCTION public.arena_visible_goals()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb; v_now timestamptz:=now();
BEGIN
 IF auth.uid() IS NULL OR NOT public.registration_has_access()
   OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND NOT suspended)
 THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'goal_id',g.id,'title',g.title,'period',g.period,
   'scope',g.scope,'role',g.target_role,'metric',g.metric,'starts_at',c.starts_at,'ends_at',c.ends_at,
   'show_countdown',g.show_countdown,'result',public.arena_collective_result(c.id))
   ORDER BY g.scope,g.target_role,g.title,c.id),'[]') INTO v
 FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
 WHERE c.starts_at<=v_now AND c.ends_at>v_now AND c.closed_at IS NULL AND g.enabled
   AND (public.arena_has_access(true) OR g.scope='global'
     OR (g.scope='user' AND g.assignee_id=auth.uid())
     OR (g.scope='role' AND EXISTS(SELECT 1 FROM public.user_roles r
       WHERE r.user_id=auth.uid() AND r.role::text=g.target_role)));
 RETURN v;
END $$;

CREATE TABLE public.arena_shift_approach_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 assignee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
 target_approaches integer NOT NULL CHECK (target_approaches BETWEEN 1 AND 100000),
 approach_source text NOT NULL CHECK (approach_source IN ('crm','manual')),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cancelled_at timestamptz,
 cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours')
);
CREATE INDEX arena_shift_approach_goals_person_time ON public.arena_shift_approach_goals(assignee_id,starts_at,ends_at);
CREATE INDEX arena_shift_approach_goals_time ON public.arena_shift_approach_goals(starts_at,ends_at);
CREATE INDEX arena_shift_crm_approaches ON public.activity_feed(responsible_id,occurred_at) WHERE action_type='lead.approached';
CREATE INDEX arena_shift_manual_approaches ON public.abordagens(user_id,created_at);
ALTER TABLE public.arena_shift_approach_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arena_shift_approach_goals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_shift_approach_goals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.arena_shift_approach_goals TO authenticated;
CREATE POLICY arena_shift_goals_select ON public.arena_shift_approach_goals FOR SELECT TO authenticated
 USING (public.registration_has_access() AND (assignee_id=auth.uid() OR public.arena_has_access(true)));
CREATE TRIGGER arena_shift_goals_signal AFTER INSERT OR UPDATE OR DELETE ON public.arena_shift_approach_goals
 FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('goals');

CREATE OR REPLACE FUNCTION public.arena_create_shift_approach_goals(
 p_title text,p_people uuid[],p_roles text[],p_starts_at timestamptz,p_duration_minutes integer,p_target_approaches integer,p_source text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_people uuid[]; v_user uuid; v_goal public.arena_shift_approach_goals; v_count integer:=0; v_end timestamptz;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_title,''))) NOT BETWEEN 2 AND 200
   OR p_target_approaches NOT BETWEEN 1 AND 100000
   OR p_source IS NULL OR p_source NOT IN ('crm','manual')
   OR p_duration_minutes NOT BETWEEN 1 AND 1440
   OR p_starts_at IS NULL OR NOT isfinite(p_starts_at)
   OR p_starts_at<clock_timestamp()-interval '5 minutes'
   OR p_starts_at>clock_timestamp()+interval '366 days'
 THEN RAISE EXCEPTION 'Informe título, quantidade, início e duração válidos' USING ERRCODE='22023'; END IF;
 IF COALESCE(cardinality(p_people),0)<>1 OR COALESCE(cardinality(p_roles),0)<>0 THEN
   RAISE EXCEPTION 'Selecione exatamente um colaborador; metas por cargo pertencem à Arena' USING ERRCODE='22023';
 END IF;
 v_end:=p_starts_at+make_interval(mins=>p_duration_minutes);
 SELECT ARRAY[p.user_id] INTO v_people FROM public.profiles p
 WHERE NOT p.suspended AND p.user_id=p_people[1];
 IF COALESCE(cardinality(v_people),0)<>1 THEN RAISE EXCEPTION 'Colaborador não encontrado ou inativo' USING ERRCODE='22023'; END IF;
 FOREACH v_user IN ARRAY v_people LOOP
   INSERT INTO public.arena_shift_approach_goals(assignee_id,title,target_approaches,approach_source,starts_at,ends_at,created_by)
   VALUES(v_user,
     btrim(p_title),p_target_approaches,p_source,p_starts_at,v_end,auth.uid()) RETURNING * INTO v_goal;
   INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,after_data)
   VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),
     'task.shift_assigned',v_goal.id,v_goal.title,'Meta de abordagens por turno',to_jsonb(v_goal));
   INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
   VALUES(v_user,'task.shift_assigned:'||v_goal.id,'task.assigned',v_goal.title) ON CONFLICT DO NOTHING;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.arena_convert_task_to_shift_goal(
 p_task_id uuid,p_expected_version bigint,p_starts_at timestamptz,p_duration_minutes integer,p_target_approaches integer,p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_task public.daily_goal_tasks;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_task FROM public.daily_goal_tasks WHERE id=p_task_id FOR UPDATE;
 IF NOT FOUND OR v_task.is_completed THEN RAISE EXCEPTION 'Tarefa pendente não encontrada'; END IF;
 IF v_task.version IS DISTINCT FROM p_expected_version THEN
   RAISE EXCEPTION 'Tarefa alterada. Atualize a tela.' USING ERRCODE='PT409';
 END IF;
 IF (p_starts_at AT TIME ZONE 'America/Sao_Paulo')::date<>v_task.task_date THEN
   RAISE EXCEPTION 'O turno deve começar na data da tarefa' USING ERRCODE='22023';
 END IF;
 PERFORM public.arena_create_shift_approach_goals(v_task.title,ARRAY[v_task.assignee_id],
   '{}'::text[],p_starts_at,p_duration_minutes,p_target_approaches,p_source);
 DELETE FROM public.daily_goal_tasks WHERE id=v_task.id;
 IF v_task.definition_id IS NOT NULL THEN
   UPDATE public.workboard_tasks SET assigned_to=array_remove(assigned_to,v_task.assignee_id),
     is_active=EXISTS(SELECT 1 FROM public.daily_goal_tasks WHERE definition_id=v_task.definition_id),
     target_roles='{}'::text[] WHERE id=v_task.definition_id;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.arena_shift_approach_progress(p_day date,p_person uuid DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb; v_start timestamptz; v_end timestamptz; v_now timestamptz:=now(); v_admin boolean:=public.arena_has_access(true);
BEGIN
 IF auth.uid() IS NULL OR NOT public.registration_has_access() OR p_day IS NULL
   OR p_offset<0 OR p_offset>100000 OR (p_person IS NOT NULL AND p_person<>auth.uid() AND NOT v_admin)
 THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 v_start:=p_day::timestamp AT TIME ZONE 'America/Sao_Paulo';
 v_end:=(p_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY starts_at DESC,id DESC),'[]') INTO v FROM (
   SELECT g.id,g.assignee_id,g.title,g.target_approaches,g.approach_source,g.starts_at,g.ends_at,
     g.created_at,g.cancelled_at,p.display_name,
     CASE WHEN g.approach_source='manual' THEN (SELECT count(*) FROM public.abordagens a
       WHERE a.user_id=g.assignee_id AND a.created_at>=g.starts_at
         AND a.created_at<least(g.ends_at,COALESCE(g.cancelled_at,g.ends_at),v_now))
     ELSE (SELECT count(*) FROM public.activity_feed f
       WHERE f.responsible_id=g.assignee_id AND f.action_type='lead.approached'
         AND f.occurred_at>=g.starts_at AND f.occurred_at<least(g.ends_at,COALESCE(g.cancelled_at,g.ends_at),v_now)) END AS actual
   FROM public.arena_shift_approach_goals g JOIN public.profiles p ON p.user_id=g.assignee_id
   WHERE g.starts_at<v_end AND g.ends_at>v_start
     AND (v_admin AND (p_person IS NULL OR g.assignee_id=p_person)
       OR NOT v_admin AND g.assignee_id=auth.uid())
   ORDER BY g.starts_at DESC,g.id DESC LIMIT 50 OFFSET p_offset
 ) x;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.arena_cancel_shift_approach_goal(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_goal public.arena_shift_approach_goals;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Informe o motivo da remoção'; END IF;
 SELECT * INTO v_goal FROM public.arena_shift_approach_goals WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_goal.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Meta não encontrada ou já cancelada'; END IF;
 UPDATE public.arena_shift_approach_goals SET cancelled_at=clock_timestamp(),cancelled_by=auth.uid() WHERE id=p_id;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),
   'task.shift_cancelled',p_id,v_goal.title,btrim(p_reason),to_jsonb(v_goal));
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 VALUES(v_goal.assignee_id,'task.shift_cancelled:'||p_id,'task.cancelled',v_goal.title) ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.arena_create_shift_approach_goals(text,uuid[],text[],timestamptz,integer,integer,text),
 public.arena_convert_task_to_shift_goal(uuid,bigint,timestamptz,integer,integer,text),
 public.arena_shift_approach_progress(date,uuid,integer),public.arena_cancel_shift_approach_goal(uuid,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_create_shift_approach_goals(text,uuid[],text[],timestamptz,integer,integer,text),
 public.arena_convert_task_to_shift_goal(uuid,bigint,timestamptz,integer,integer,text),
 public.arena_shift_approach_progress(date,uuid,integer),public.arena_cancel_shift_approach_goal(uuid,text)
 TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
