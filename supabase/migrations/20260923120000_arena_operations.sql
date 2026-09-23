BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE public.daily_goal_tasks
 ADD COLUMN IF NOT EXISTS definition_id uuid REFERENCES public.workboard_tasks(id),
 ADD COLUMN IF NOT EXISTS completion_comment text,
 ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'not_scheduled'
 CHECK(operational_status IN ('scheduled','not_scheduled','scheduling','reapproach'));
DO $patch$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.get_sales_board(text,text,integer,integer)'::regprocedure);
 d:=replace(d,$$'pendente', 'aprovada', 'rejeitada', 'all'$$,$$'pendente', 'aprovada', 'rejeitada', 'cancelada', 'estornada', 'all'$$);
 d:=replace(d,$$p_status = 'rejeitada' AND NOT v_exec$$,$$p_status IN ('rejeitada','cancelada','estornada') AND NOT v_exec$$);
 EXECUTE d;
END $patch$;
CREATE UNIQUE INDEX arena_task_execution ON public.daily_goal_tasks(definition_id,assignee_id,task_date) WHERE definition_id IS NOT NULL;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.workboard_tasks,public.workboard_completions FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.arena_task_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks; v_kind text;
BEGIN
 IF TG_OP='DELETE' THEN t:=OLD; ELSE t:=NEW; END IF;
 v_kind:=CASE WHEN TG_OP='INSERT' THEN 'task.assigned' WHEN TG_OP='DELETE' THEN 'task.deleted'
 WHEN NEW.is_completed IS DISTINCT FROM OLD.is_completed THEN CASE WHEN NEW.is_completed THEN 'task.completed' ELSE 'task.reopened' END ELSE 'task.updated' END;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),v_kind,t.id,t.title,
 COALESCE(NULLIF(t.completion_comment,''),'Atualização de tarefa operacional'),
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 VALUES(t.assignee_id,v_kind||':'||t.id||':'||t.version,v_kind,t.title) ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER arena_tasks_history AFTER INSERT OR UPDATE OR DELETE ON public.daily_goal_tasks FOR EACH ROW EXECUTE FUNCTION public.arena_task_audit();

CREATE OR REPLACE FUNCTION public.arena_complete_task(p_id uuid,p_completed boolean,p_version bigint,p_comment text DEFAULT '')
RETURNS public.daily_goal_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks; v_admin boolean:=public.arena_has_access(true);
BEGIN
 PERFORM public.dashboard_require_access();
 IF NOT public.registration_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.daily_goal_tasks WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
 IF t.assignee_id<>auth.uid() AND NOT v_admin THEN RAISE EXCEPTION 'Você só pode concluir suas próprias tarefas' USING ERRCODE='42501'; END IF;
 IF v_admin AND t.assignee_id<>auth.uid() AND length(btrim(COALESCE(p_comment,'')))<5 THEN RAISE EXCEPTION 'A conclusão administrativa exige comentário'; END IF;
 IF t.task_date<>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'O prazo desta tarefa não está aberto'; END IF;
 IF t.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Tarefa alterada. Atualize a tela.' USING ERRCODE='PT409'; END IF;
 IF p_completed IS NULL OR length(COALESCE(p_comment,''))>2000 THEN RAISE EXCEPTION 'Conclusão inválida'; END IF;
 UPDATE public.daily_goal_tasks SET is_completed=p_completed,
 completed_at=CASE WHEN p_completed THEN clock_timestamp() END,completed_by=CASE WHEN p_completed THEN auth.uid() END,
 completion_comment=NULLIF(btrim(p_comment),''),version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO t;
 RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.set_daily_goal_task_completed(p_task_id uuid,p_completed boolean,p_expected_version bigint)
RETURNS public.daily_goal_tasks LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.arena_complete_task(p_task_id,p_completed,p_expected_version,'');
$$;

CREATE OR REPLACE FUNCTION public.arena_assign_tasks(p_title text,p_date date,p_people uuid[],p_roles text[],p_status text DEFAULT 'not_scheduled')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_user uuid; v_task public.daily_goal_tasks; v_count integer:=0; v_people uuid[];
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_title)) NOT BETWEEN 2 AND 200 OR p_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date+366 THEN RAISE EXCEPTION 'Título ou data inválidos'; END IF;
 SELECT array_agg(DISTINCT p.user_id) INTO v_people FROM public.profiles p WHERE NOT p.suspended
 AND (p.user_id=ANY(COALESCE(p_people,'{}')) OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=ANY(COALESCE(p_roles,'{}'))));
 IF COALESCE(cardinality(v_people),0)=0 THEN RAISE EXCEPTION 'Selecione pelo menos um colaborador ou cargo ativo'; END IF;
 INSERT INTO public.workboard_tasks(title,created_by,assigned_to,target_roles,deadline,is_active)
 VALUES(btrim(p_title),auth.uid(),v_people,COALESCE(p_roles,'{}'),(p_date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo',true) RETURNING id INTO v_id;
 FOREACH v_user IN ARRAY v_people LOOP
   v_task:=public.executive_create_daily_goal_task(v_user,p_date,p_title);
   UPDATE public.daily_goal_tasks SET definition_id=v_id,operational_status=p_status WHERE id=v_task.id;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.arena_task_status(p_id uuid,p_version bigint,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.daily_goal_tasks;
BEGIN
 PERFORM public.dashboard_require_access();
 IF NOT public.registration_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.daily_goal_tasks WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR (t.assignee_id<>auth.uid() AND NOT public.arena_has_access(true)) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF t.version IS DISTINCT FROM p_version OR t.task_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Tarefa alterada ou prazo encerrado' USING ERRCODE='PT409'; END IF;
 UPDATE public.daily_goal_tasks SET operational_status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=p_id;
END $$;

ALTER TABLE public.traffic_metrics ADD CONSTRAINT arena_traffic_nonnegative CHECK(spend>=0 AND spend<=100000000 AND leads_generated>=0 AND impressions>=0 AND clicks>=0);
CREATE POLICY arena_traffic_role ON public.traffic_metrics AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.registration_has_access() AND (public.arena_has_access(true) OR (manager_id=auth.uid() AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='traffic_manager'))))
 WITH CHECK(public.registration_has_access() AND (public.arena_has_access(true) OR (manager_id=auth.uid() AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='traffic_manager'))));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.traffic_metrics FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.arena_save_traffic(p_id uuid,p_date date,p_platform text,p_campaign text,p_spend numeric,p_leads integer,p_revision timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.traffic_metrics; v_id uuid;
BEGIN
 PERFORM public.dashboard_require_access();
 IF NOT public.registration_has_access() OR NOT(public.arena_has_access(true) OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='traffic_manager')) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_date IS NULL OR p_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR length(btrim(p_campaign)) NOT BETWEEN 1 AND 160 OR p_spend IS NULL OR p_leads IS NULL THEN RAISE EXCEPTION 'Informe data, campanha, investimento e leads reais'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO public.traffic_metrics(manager_id,date,platform,campaign_name,spend,leads_generated)
   VALUES(auth.uid(),p_date,p_platform,btrim(p_campaign),p_spend,p_leads) RETURNING id INTO v_id;
 ELSE
   SELECT * INTO t FROM public.traffic_metrics WHERE id=p_id FOR UPDATE;
   IF NOT FOUND OR (t.manager_id<>auth.uid() AND NOT public.arena_has_access(true)) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
   IF t.updated_at IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Métrica alterada. Atualize a tela.' USING ERRCODE='PT409'; END IF;
   UPDATE public.traffic_metrics SET date=p_date,platform=p_platform,campaign_name=btrim(p_campaign),spend=p_spend,leads_generated=p_leads WHERE id=p_id;
   v_id:=p_id;
 END IF;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'traffic.saved',v_id,btrim(p_campaign),'Métricas reais de tráfego registradas',
 to_jsonb(t),jsonb_build_object('spend',p_spend,'leads',p_leads,'date',p_date));
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.arena_period_metrics(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH facts AS (SELECT COALESCE(sum(revenue_delta),0) revenue,count(*) FILTER(WHERE action_type='sale.approved') sales,
 count(*) FILTER(WHERE action_type IN ('q.scheduled','closing.scheduled')) appointments
 FROM public.activity_feed WHERE occurred_at>=p_start AND occurred_at<p_end),
 approaches AS (SELECT count(*) n FROM public.abordagens WHERE created_at>=p_start AND created_at<p_end),
 traffic AS (SELECT sum(spend) spend,sum(leads_generated) leads FROM public.traffic_metrics WHERE date>=(p_start AT TIME ZONE 'America/Sao_Paulo')::date
 AND date<(p_end AT TIME ZONE 'America/Sao_Paulo')::date+CASE WHEN (p_end AT TIME ZONE 'America/Sao_Paulo')::time>'00:00'::time THEN 1 ELSE 0 END)
 SELECT jsonb_build_object('revenue',revenue,'sales',sales,'ticket',CASE WHEN sales>0 THEN revenue/sales END,
 'conversion',CASE WHEN n>0 THEN sales*100.0/n END,'approaches',n,'cpl',CASE WHEN leads>0 THEN spend/leads END,
 'spend',spend,'leads',leads,'appointments',appointments) FROM facts,approaches,traffic;
$$;
REVOKE ALL ON FUNCTION public.arena_period_metrics(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;

-- A single lightweight revision covers legacy CRM/approach edits too.
CREATE OR REPLACE FUNCTION public.arena_revision() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN (SELECT COALESCE(sum(revision),0)::bigint FROM public.dashboard_events);
END $$;
REVOKE ALL ON FUNCTION public.arena_revision() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_revision() TO authenticated;

CREATE OR REPLACE FUNCTION public.arena_dashboard(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz:=now(); v_end timestamptz; v_previous_end timestamptz; v_series jsonb; v_cycles jsonb; v_feed jsonb; v_unit text;
BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start OR p_end-p_start>interval '367 days' OR p_start>v_now THEN RAISE EXCEPTION 'Escolha um período válido de até um ano'; END IF;
 v_end:=least(p_end,v_now);
 -- Today compares the same elapsed interval yesterday; longer ranges use the
 -- immediately previous calendar range of the same duration.
 v_previous_end:=CASE WHEN p_end-p_start<=interval '25 hours' AND p_end>v_now THEN p_start-(p_end-v_now) ELSE p_start END;
 v_unit:=CASE WHEN p_end-p_start<=interval '25 hours' THEN 'hour' WHEN p_end-p_start<=interval '62 days' THEN 'day' ELSE 'month' END;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('at',bucket,'revenue',revenue,'sales',sales,'appointments',appointments) ORDER BY bucket),'[]') INTO v_series
 FROM (SELECT d bucket,COALESCE(sum(f.revenue_delta),0) revenue,count(f.id) FILTER(WHERE action_type='sale.approved') sales,
 count(f.id) FILTER(WHERE action_type IN ('q.scheduled','closing.scheduled')) appointments
 FROM generate_series(date_trunc(v_unit,p_start AT TIME ZONE 'America/Sao_Paulo'),date_trunc(v_unit,v_end AT TIME ZONE 'America/Sao_Paulo'),('1 '||v_unit)::interval) d
 LEFT JOIN public.activity_feed f ON f.occurred_at>=p_start AND f.occurred_at<v_end AND date_trunc(v_unit,f.occurred_at AT TIME ZONE 'America/Sao_Paulo')=d GROUP BY d) x;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'goal_id',g.id,'title',g.title,'period',g.period,'scope',g.scope,'role',g.target_role,'metric',g.metric,
 'starts_at',c.starts_at,'ends_at',c.ends_at,'show_countdown',g.show_countdown,'result',public.arena_cycle_result(c.id)) ORDER BY g.scope,g.target_role),'[]') INTO v_cycles
 FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id WHERE c.starts_at<=v_now AND c.ends_at>v_now AND c.closed_at IS NULL AND g.enabled;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY occurred_at DESC,id DESC),'[]') INTO v_feed FROM (
 SELECT f.id,f.action_type,f.responsible_id,f.responsible_name,f.responsible_role,f.score_delta,f.revenue_delta,f.occurred_at,p.avatar_url,f.provenance
 FROM public.activity_feed f LEFT JOIN public.profiles p ON p.user_id=f.responsible_id
 WHERE f.occurred_at>=p_start AND f.occurred_at<v_end AND NOT COALESCE(p.arena_hidden,false)
 ORDER BY f.occurred_at DESC,f.id DESC LIMIT 40) x;
 RETURN jsonb_build_object('server_time',v_now,'revision',public.arena_revision(),
 'metrics',public.arena_period_metrics(p_start,v_end),'previous',public.arena_period_metrics(p_start-(p_end-p_start),v_previous_end),
 'series',v_series,'cycles',v_cycles,'feed',v_feed,'sdrs',public.get_sdr_ranking(p_start,v_end),'closers',public.get_team_ranking(p_start,v_end),
 'ticket_reference',(SELECT ticket_reference FROM public.company_goals WHERE scope='global' AND effective_at<=v_now ORDER BY effective_at DESC,version DESC LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.arena_management(p_tab text,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 IF p_tab='goals' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY title),'[]') INTO v FROM(SELECT DISTINCT ON(family_id) * FROM public.company_goals ORDER BY family_id,version DESC) x;
 ELSIF p_tab='history' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY ends_at DESC,id DESC),'[]') INTO v FROM(
   SELECT c.*,g.title,g.period,g.scope,g.target_role FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id WHERE c.closed_at IS NOT NULL ORDER BY c.ends_at DESC,c.id DESC LIMIT 30 OFFSET p_offset) x;
 ELSIF p_tab='audit' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,id DESC),'[]') INTO v FROM(
   SELECT id,actor_name,action,target_id,target_label,reason,created_at FROM public.executive_audit_events
   WHERE action LIKE 'goal.%' OR action LIKE 'arena.%' OR action LIKE 'task.%' OR action LIKE 'sale.%' OR action LIKE 'traffic.%'
   ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_offset) x;
 ELSIF p_tab='reconciliation' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') INTO v FROM(
   SELECT a.id,a.target_id,a.target_label,a.created_at,a.reason,a.before_data->>'valor_venda' amount
   FROM public.executive_audit_events a WHERE a.action='sale.delete' AND a.before_data->>'approval_status'='aprovada'
   AND NOT EXISTS(SELECT 1 FROM public.executive_audit_events decision WHERE decision.action='arena.legacy_classified' AND decision.target_id=a.target_id)
   AND NOT EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.source_id=a.target_id AND f.action_type='sale.approved')) x;
 ELSIF p_tab='events' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY occurred_at DESC,id DESC),'[]') INTO v FROM(
   SELECT id,action_type,responsible_id,responsible_name,responsible_role,actor_name,source_type,source_id,occurred_at,score_delta,revenue_delta,reason,provenance
   FROM public.activity_feed ORDER BY occurred_at DESC,id DESC LIMIT 50 OFFSET p_offset) x;
 ELSE RAISE EXCEPTION 'Aba inválida'; END IF;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.arena_classify_legacy(p_audit_id uuid,p_approved boolean,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.executive_audit_events; v_person uuid; v_event uuid;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_approved IS NULL OR length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Classificação e motivo são obrigatórios'; END IF;
 SELECT * INTO a FROM public.executive_audit_events WHERE id=p_audit_id AND action='sale.delete' AND before_data->>'approval_status'='aprovada' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registro histórico não encontrado'; END IF;
 IF EXISTS(SELECT 1 FROM public.executive_audit_events WHERE action='arena.legacy_classified' AND target_id=a.target_id) THEN RAISE EXCEPTION 'Registro já classificado' USING ERRCODE='PT409'; END IF;
 IF p_approved THEN
   v_person:=(a.before_data->>'user_id')::uuid;
   v_event:=public.arena_emit('sale.approved:'||a.target_id,'sale.approved',v_person,'closer','vendas',a.target_id,
     (a.before_data->>'reviewed_at')::timestamptz,10,(a.before_data->>'valor_venda')::numeric,NULL,NULL,p_reason,'legacy',auth.uid());
   IF v_event IS NOT NULL THEN
     PERFORM public.arena_emit('sale.reversed:'||a.target_id,'sale.reversed',v_person,'closer','vendas',a.target_id,
       a.created_at,-10,0,NULL,v_event,p_reason,'legacy',auth.uid());
   END IF;
 END IF;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,after_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'arena.legacy_classified',a.target_id,a.target_label,p_reason,
 jsonb_build_object('approved_before_cancellation',p_approved,'source_audit_id',a.id));
END $$;

-- New approved-sale alerts are delivered by INSERT events only. The frontend
-- never celebrates dashboard snapshots or rows imported above.
CREATE OR REPLACE FUNCTION public.arena_live_cursor() RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM public.dashboard_require_access();
 IF NOT public.registration_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN now();
END $$;
REVOKE ALL ON FUNCTION public.arena_live_cursor() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_live_cursor() TO authenticated;

CREATE OR REPLACE FUNCTION public.arena_notify_sale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.action_type='sale.approved' AND NEW.provenance='live' THEN
   INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
   SELECT DISTINCT user_id,'sale.approved:'||NEW.id,'sale.approved',COALESCE(NEW.responsible_name,'Colaborador')||' · venda aprovada'
   FROM public.user_roles WHERE role::text IN ('sdr','closer','executive','super_admin') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER arena_sale_notification AFTER INSERT ON public.activity_feed FOR EACH ROW EXECUTE FUNCTION public.arena_notify_sale();

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('arena_complete_task','arena_assign_tasks','arena_task_status','arena_save_traffic','arena_dashboard','arena_management','arena_classify_legacy') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',r.sig);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.sig);
 END LOOP;
END $$;

-- Trigger entry points are not callable application APIs.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname LIKE 'arena_%' AND prorettype='trigger'::regtype LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.sig);
 END LOOP;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
