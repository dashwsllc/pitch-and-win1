-- Align personal goal visibility and the live Closer ranking with the Arena.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

DROP POLICY IF EXISTS goals_select ON public.company_goals;
CREATE POLICY goals_select ON public.company_goals FOR SELECT TO authenticated
 USING(public.registration_has_access() AND
   EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND NOT suspended) AND
   (scope<>'user' OR assignee_id=auth.uid() OR public.arena_has_access(true)));

DROP POLICY IF EXISTS arena_cycles_read ON public.goal_cycles;
CREATE POLICY arena_cycles_read ON public.goal_cycles FOR SELECT TO authenticated
 USING(public.arena_has_access() AND EXISTS(
   SELECT 1 FROM public.company_goals g WHERE g.id=goal_id
   AND (g.scope<>'user' OR g.assignee_id=auth.uid() OR public.arena_has_access(true))));
-- Closed role snapshots may contain individual targets. Read them through the
-- scoped management RPC; the live collective view below uses role targets.
REVOKE SELECT ON public.goal_cycles FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_team_ranking()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_start timestamp without time zone;
BEGIN
 PERFORM public.dashboard_require_access();
 v_start:=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo');
 RETURN public.arena_team_ranking(
   v_start AT TIME ZONE 'America/Sao_Paulo',
   (v_start+interval '1 month') AT TIME ZONE 'America/Sao_Paulo');
END $$;
REVOKE ALL ON FUNCTION public.get_team_ranking() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_team_ranking() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.arena_collective_result(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.goal_cycles; g public.company_goals; v_result jsonb; v_members jsonb; v_target numeric;
BEGIN
 SELECT * INTO c FROM public.goal_cycles WHERE id=p_id;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 v_result:=public.arena_cycle_result(p_id);
 IF g.scope<>'role' THEN RETURN v_result; END IF;
 SELECT COALESCE(jsonb_agg(m.value||jsonb_build_object('target',c.target,
   'state',public.arena_classification((m.value->>'actual')::numeric,c.target,c.starts_at,c.ends_at,now()))
   ORDER BY m.ordinality),'[]') INTO v_members
 FROM jsonb_array_elements(v_result->'members') WITH ORDINALITY AS m(value,ordinality);
 v_target:=c.target*jsonb_array_length(v_members);
 RETURN v_result||jsonb_build_object('members',v_members,'target',v_target,
   'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE
     public.arena_classification((v_result->>'actual')::numeric,v_target,c.starts_at,c.ends_at,now()) END);
END $$;
REVOKE ALL ON FUNCTION public.arena_collective_result(uuid) FROM PUBLIC,anon,authenticated;

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
   AND (g.scope<>'user' OR g.assignee_id=auth.uid() OR public.arena_has_access(true));
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.arena_visible_goals() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_visible_goals() TO authenticated;

CREATE OR REPLACE FUNCTION public.arena_dashboard(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz:=now(); v_end timestamptz; v_previous_end timestamptz; v_series jsonb; v_cycles jsonb; v_feed jsonb; v_unit text;
BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start OR p_end-p_start>interval '367 days' OR p_start>v_now THEN RAISE EXCEPTION 'Escolha um período válido de até um ano'; END IF;
 v_end:=least(p_end,v_now);
 v_previous_end:=CASE WHEN p_end-p_start<=interval '25 hours' AND p_end>v_now THEN p_start-(p_end-v_now) ELSE p_start END;
 v_unit:=CASE WHEN p_end-p_start<=interval '25 hours' THEN 'hour' WHEN p_end-p_start<=interval '62 days' THEN 'day' ELSE 'month' END;
 WITH buckets AS (
   SELECT d AS bucket FROM generate_series(date_trunc(v_unit,p_start AT TIME ZONE 'America/Sao_Paulo'),
     date_trunc(v_unit,v_end AT TIME ZONE 'America/Sao_Paulo'),('1 '||v_unit)::interval) d
 ), sales AS (
   SELECT date_trunc(v_unit,v.occurred_at AT TIME ZONE 'America/Sao_Paulo') bucket,
     COALESCE(sum(v.revenue),0) revenue,count(*) FILTER(WHERE v.active) sales FROM public.arena_sale_facts v
   WHERE v.occurred_at>=p_start AND v.occurred_at<v_end GROUP BY 1
 ), appointments AS (
   SELECT date_trunc(v_unit,f.occurred_at AT TIME ZONE 'America/Sao_Paulo') bucket,count(*) appointments
   FROM public.arena_counted_call_events f WHERE f.action_type IN ('q.scheduled','closing.scheduled')
     AND f.occurred_at>=p_start AND f.occurred_at<v_end GROUP BY 1
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('at',b.bucket,'revenue',COALESCE(s.revenue,0),
   'sales',COALESCE(s.sales,0),'appointments',COALESCE(a.appointments,0)) ORDER BY b.bucket),'[]') INTO v_series
 FROM buckets b LEFT JOIN sales s USING(bucket) LEFT JOIN appointments a USING(bucket);
 v_cycles:=public.arena_visible_goals();
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

CREATE OR REPLACE FUNCTION public.arena_save_goal(p_data jsonb,p_reason text,p_previous uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE g public.company_goals; v_id uuid; v_family uuid; v_version integer;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Informe o motivo da configuração'; END IF;
 PERFORM pg_advisory_xact_lock(23091100);
 IF p_previous IS NOT NULL THEN
   SELECT * INTO g FROM public.company_goals WHERE id=p_previous;
   IF NOT FOUND OR EXISTS(SELECT 1 FROM public.company_goals WHERE family_id=g.family_id AND version>g.version) THEN RAISE EXCEPTION 'Meta alterada. Atualize antes de salvar.' USING ERRCODE='PT409'; END IF;
   v_family:=g.family_id; v_version:=g.version+1;
   IF p_data ? 'cycle_start' OR p_data ? 'cycle_end' THEN
     IF g.scope='global' AND g.period='monthly' THEN RAISE EXCEPTION 'O faturamento mensal e seu ranking preservam o mês civil de Brasília'; END IF;
     IF NOT EXISTS(SELECT 1 FROM public.goal_cycles WHERE family_id=g.family_id AND closed_at IS NULL
       AND starts_at=NULLIF(p_data->>'cycle_start','')::timestamptz AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp())
       OR NULLIF(p_data->>'cycle_end','')::timestamptz<=clock_timestamp()
       OR NULLIF(p_data->>'cycle_end','') IS NULL
       OR COALESCE(NULLIF(p_data->>'effective_at','')::timestamptz,transaction_timestamp())>clock_timestamp()
     THEN RAISE EXCEPTION 'O prazo só pode alterar o ciclo aberto, com vigência imediata e fim futuro; o início é preservado'; END IF;
   END IF;
   IF COALESCE(NULLIF(p_data->>'effective_at','')::timestamptz,transaction_timestamp())<g.effective_at THEN RAISE EXCEPTION 'A nova versão deve começar na vigência da versão anterior ou depois'; END IF;
 ELSE v_family:=gen_random_uuid(); v_version:=1;
   IF EXISTS(SELECT 1 FROM public.company_goals WHERE scope=p_data->>'scope' AND period=p_data->>'period'
     AND target_role IS NOT DISTINCT FROM NULLIF(p_data->>'target_role','')
     AND assignee_id IS NOT DISTINCT FROM NULLIF(p_data->>'assignee_id','')::uuid) THEN
     RAISE EXCEPTION 'Já existe meta para este escopo e ciclo. Edite a meta existente para criar uma nova versão.';
   END IF;
 END IF;
 IF COALESCE(g.scope,p_data->>'scope')='user' AND NOT EXISTS(
   SELECT 1 FROM public.profiles p JOIN public.user_roles r USING(user_id)
   WHERE p.user_id=COALESCE(g.assignee_id,NULLIF(p_data->>'assignee_id','')::uuid)
   AND r.role::text=COALESCE(g.target_role,NULLIF(p_data->>'target_role',''))
   AND NOT p.suspended AND EXISTS(SELECT 1 FROM public.registration_requests WHERE user_id=p.user_id AND status='approved')
 ) THEN RAISE EXCEPTION 'Selecione um colaborador ativo e aprovado com o cargo da meta'; END IF;
 INSERT INTO public.company_goals(title,description,period,target,unit,scope,target_role,assignee_id,metric,family_id,version,effective_at,cycle_start,cycle_end,recurring,show_countdown,ticket_reference,enabled,created_by)
 VALUES(btrim(p_data->>'title'),NULLIF(btrim(p_data->>'description'),''),COALESCE(g.period,p_data->>'period'),(p_data->>'target')::numeric,
 CASE WHEN COALESCE(g.scope,p_data->>'scope')='global' THEN 'BRL' ELSE 'points' END,
 COALESCE(g.scope,p_data->>'scope'),COALESCE(g.target_role,NULLIF(p_data->>'target_role','')),
 COALESCE(g.assignee_id,NULLIF(p_data->>'assignee_id','')::uuid),CASE WHEN COALESCE(g.scope,p_data->>'scope')='global' THEN 'revenue' ELSE 'score' END,
 v_family,v_version,COALESCE(NULLIF(p_data->>'effective_at','')::timestamptz,transaction_timestamp()),
 COALESCE(NULLIF(p_data->>'cycle_start','')::timestamptz,g.cycle_start),COALESCE(NULLIF(p_data->>'cycle_end','')::timestamptz,g.cycle_end),
 COALESCE((p_data->>'recurring')::boolean,true),COALESCE((p_data->>'show_countdown')::boolean,true),
 COALESCE((p_data->>'ticket_reference')::numeric,g.ticket_reference,2997),COALESCE((p_data->>'enabled')::boolean,true),auth.uid()) RETURNING id INTO v_id;
 IF (SELECT effective_at FROM public.company_goals WHERE id=v_id)<transaction_timestamp()-interval '1 second' THEN RAISE EXCEPTION 'Não é permitido alterar metas retroativamente'; END IF;
 IF p_previous IS NULL AND NULLIF(p_data->>'cycle_start','')::timestamptz<transaction_timestamp()-interval '1 second' THEN RAISE EXCEPTION 'O início configurado deve estar no futuro'; END IF;
 IF EXISTS(SELECT 1 FROM public.company_goals WHERE id=v_id AND target>='Infinity'::numeric) THEN RAISE EXCEPTION 'Meta inválida'; END IF;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'goal.version',v_id,p_data->>'title',btrim(p_reason),to_jsonb(g),p_data);
 PERFORM public.arena_tick();
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 SELECT DISTINCT user_id,'goal.version:'||v_id,'goal.version','Meta atualizada: '||(p_data->>'title') FROM public.user_roles
 WHERE role::text IN ('sdr','closer','executive','super_admin')
   AND (COALESCE(g.scope,p_data->>'scope')<>'user'
     OR user_id=COALESCE(g.assignee_id,NULLIF(p_data->>'assignee_id','')::uuid)
     OR role::text IN ('executive','super_admin')) ON CONFLICT DO NOTHING;
 RETURN v_id;
END $$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp()
 WHERE topic IN ('arena','goals','sales');
NOTIFY pgrst,'reload schema';
COMMIT;
