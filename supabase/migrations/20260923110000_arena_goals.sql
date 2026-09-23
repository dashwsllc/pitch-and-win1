BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS arena_hidden boolean NOT NULL DEFAULT false;
-- Existing profile RPCs cannot edit this field. Only the audited Arena RPC can.
CREATE OR REPLACE FUNCTION public.arena_profile_visibility_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF ((TG_OP='INSERT' AND NEW.arena_hidden) OR (TG_OP='UPDATE' AND NEW.arena_hidden IS DISTINCT FROM OLD.arena_hidden))
 AND current_setting('arena.visibility',true) IS DISTINCT FROM NEW.user_id::text THEN
   RAISE EXCEPTION 'Use a configuração administrativa de visibilidade' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER arena_profile_visibility BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.arena_profile_visibility_guard();
DO $$ DECLARE d text; sig regprocedure; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.get_team_ranking()'::regprocedure,'public.get_sdr_ranking()'::regprocedure] LOOP
   d:=pg_get_functiondef(sig);
   d:=replace(d,'WHERE NOT p.suspended','WHERE NOT p.arena_hidden');
   EXECUTE d;
 END LOOP;
END $$;

ALTER TABLE public.company_goals DROP CONSTRAINT company_goals_input_secure;
ALTER TABLE public.company_goals ADD CONSTRAINT company_goals_input_secure CHECK(length(btrim(title)) BETWEEN 2 AND 160 AND target>0 AND target<=100000000 AND length(COALESCE(description,''))<=2000);
ALTER TABLE public.company_goals
 ADD COLUMN IF NOT EXISTS family_id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global' CHECK(scope IN ('global','role','user')),
 ADD COLUMN IF NOT EXISTS target_role text CHECK(target_role IN ('sdr','closer')),
 ADD COLUMN IF NOT EXISTS assignee_id uuid,
 ADD COLUMN IF NOT EXISTS metric text NOT NULL DEFAULT 'revenue' CHECK(metric IN ('revenue','score')),
 ADD COLUMN IF NOT EXISTS effective_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS cycle_start timestamptz,
 ADD COLUMN IF NOT EXISTS cycle_end timestamptz,
 ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS show_countdown boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS ticket_reference numeric NOT NULL DEFAULT 2997 CHECK(ticket_reference>0),
 ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.company_goals ADD CONSTRAINT arena_goal_dates CHECK(
 (cycle_start IS NULL AND cycle_end IS NULL) OR (cycle_start IS NOT NULL AND cycle_end IS NOT NULL AND isfinite(cycle_start) AND isfinite(cycle_end) AND cycle_end>cycle_start AND cycle_end-cycle_start<=interval '367 days'));
CREATE UNIQUE INDEX arena_goal_version ON public.company_goals(family_id,version);
ALTER TABLE public.company_goals ADD CONSTRAINT arena_goal_scope CHECK(
 (scope='global' AND metric='revenue' AND assignee_id IS NULL AND target_role IS NULL)
 OR (scope='role' AND metric='score' AND assignee_id IS NULL AND target_role IS NOT NULL)
 OR (scope='user' AND metric='score' AND assignee_id IS NOT NULL AND target_role IS NOT NULL));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.company_goals FROM anon,authenticated;
CREATE TRIGGER arena_goal_versions_immutable BEFORE UPDATE OR DELETE ON public.company_goals FOR EACH ROW EXECUTE FUNCTION public.arena_immutable();
CREATE TRIGGER arena_goals_signal AFTER INSERT ON public.company_goals FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');

INSERT INTO public.company_goals(title,period,target,unit,scope,target_role,metric,effective_at)
VALUES ('Faturamento mensal','monthly',60000,'BRL','global',NULL,'revenue',date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
 ('SDR · meta diária','daily',100,'points','role','sdr','score',date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
 ('Closer · meta semanal','weekly',100,'points','role','closer','score',date_trunc('week',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo');

CREATE TABLE public.goal_cycles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 family_id uuid NOT NULL,
 goal_id uuid NOT NULL REFERENCES public.company_goals(id),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 target numeric NOT NULL CHECK(target>0),
 closed_at timestamptz,
 result jsonb,
 evaluation_revision bigint NOT NULL DEFAULT -1,
 UNIQUE(family_id,starts_at),
 CHECK((closed_at IS NULL)=(result IS NULL))
);
CREATE INDEX arena_cycles_due ON public.goal_cycles(ends_at) WHERE closed_at IS NULL;
ALTER TABLE public.goal_cycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goal_cycles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.goal_cycles TO authenticated;
CREATE POLICY arena_cycles_read ON public.goal_cycles FOR SELECT TO authenticated USING(public.arena_has_access());
CREATE OR REPLACE FUNCTION public.arena_cycle_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF OLD.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Ciclo encerrado é imutável' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER arena_cycle_immutable BEFORE UPDATE OR DELETE ON public.goal_cycles FOR EACH ROW EXECUTE FUNCTION public.arena_cycle_guard();
CREATE TRIGGER arena_cycle_insert_signal AFTER INSERT ON public.goal_cycles FOR EACH ROW EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER arena_cycle_update_signal AFTER UPDATE ON public.goal_cycles FOR EACH ROW
 WHEN (OLD.goal_id IS DISTINCT FROM NEW.goal_id OR OLD.closed_at IS DISTINCT FROM NEW.closed_at)
 EXECUTE FUNCTION public.dashboard_signal('arena');

CREATE TABLE public.arena_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_id uuid NOT NULL,
 event_key text NOT NULL,
 kind text NOT NULL,
 title text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 read_at timestamptz,
 UNIQUE(recipient_id,event_key)
);
CREATE INDEX arena_notifications_recipient ON public.arena_notifications(recipient_id,created_at DESC);
ALTER TABLE public.arena_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.arena_notifications TO authenticated;
CREATE POLICY arena_notifications_own ON public.arena_notifications FOR SELECT TO authenticated
 USING(recipient_id=auth.uid() AND public.registration_has_access() AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND suspended));
CREATE TRIGGER arena_notifications_signal AFTER INSERT OR UPDATE ON public.arena_notifications FOR EACH ROW EXECUTE FUNCTION public.dashboard_signal('goals');
ALTER PUBLICATION supabase_realtime ADD TABLE public.arena_notifications;

-- Existing ranking RPCs are extended with an explicit period overload. Their
-- original sort criteria and their original no-argument contract are retained.
CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'Closer') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.revenue,0) AS "totalVendas",COALESCE(s.sales,0) AS "quantidadeVendas",COALESCE(s.score,0) score,
 COALESCE(a.total,0) abordagens,CASE WHEN a.total>0 THEN round(COALESCE(s.sales,0)*100.0/a.total,1) ELSE 0 END conversao
 FROM public.profiles p
 LEFT JOIN LATERAL (SELECT sum(revenue_delta) revenue,count(*) FILTER(WHERE action_type='sale.approved') sales,sum(score_delta) score
 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end) s ON true
 LEFT JOIN LATERAL(SELECT count(*) total FROM public.abordagens WHERE user_id=p.user_id AND created_at>=p_start AND created_at<p_end) a ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='closer')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end))
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin')
 ) x;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.arena_sdr_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.repasses DESC,x.conversao DESC,x.abordagens DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'SDR') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.score,0) score,COALESCE(s.repasses,0) repasses,COALESCE(s.scheduled,0) scheduled,COALESCE(s.performed,0) performed,
 COALESCE(s.cancelled,0) cancelled,COALESCE(s.no_handoff,0) no_handoff,COALESCE(a.total,0) abordagens,
 COALESCE(a.leads_abordados,0) AS "leadsAbordados",
 CASE WHEN a.leads_abordados>0 THEN round(COALESCE(s.repasses,0)*100.0/a.leads_abordados,1) ELSE 0 END conversao
 FROM public.profiles p
 LEFT JOIN LATERAL(SELECT sum(score_delta) score,count(*) FILTER(WHERE action_type='closing.scheduled') repasses,
 count(*) FILTER(WHERE action_type='q.scheduled') scheduled,count(*) FILTER(WHERE action_type='q.performed') performed,
 count(*) FILTER(WHERE action_type='call.cancelled') cancelled,count(*) FILTER(WHERE action_type='q.no_handoff') no_handoff
 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) s ON true
 LEFT JOIN LATERAL(SELECT COALESCE(sum(approach_count),0) total,count(*) FILTER(WHERE approach_stage IN ('abordado','reabordado')) leads_abordados
 FROM public.crm_leads WHERE sdr_id=p.user_id AND created_at>=p_start AND created_at<p_end) a ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='sdr')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end))
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin')
 ) x;
 RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.arena_team_ranking(timestamptz,timestamptz),public.arena_sdr_ranking(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_team_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN public.arena_team_ranking(p_start,p_end);
END $$;
CREATE OR REPLACE FUNCTION public.get_sdr_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 RETURN public.arena_sdr_ranking(p_start,p_end);
END $$;

CREATE OR REPLACE FUNCTION public.arena_classification(p_actual numeric,p_target numeric,p_start timestamptz,p_end timestamptz,p_now timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_actual>p_target THEN 'exceeded' WHEN p_actual>=p_target THEN 'achieved'
 WHEN p_now>=p_end THEN 'failed'
 WHEN p_actual/p_target>=greatest(0,least(1,extract(epoch FROM(p_now-p_start))/extract(epoch FROM(p_end-p_start)))) THEN 'on_track'
 WHEN p_actual/p_target>=0.8*greatest(0,least(1,extract(epoch FROM(p_now-p_start))/extract(epoch FROM(p_end-p_start)))) THEN 'at_risk'
 ELSE 'below' END;
$$;

CREATE OR REPLACE FUNCTION public.arena_cycle_result(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.goal_cycles; g public.company_goals; v_members jsonb; v_actual numeric; v_target numeric; v_result jsonb;
BEGIN
 SELECT * INTO c FROM public.goal_cycles WHERE id=p_id;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 IF c.closed_at IS NOT NULL THEN RETURN c.result; END IF;
 IF g.scope='global' THEN
   SELECT COALESCE(sum(revenue_delta),0) INTO v_actual FROM public.activity_feed WHERE occurred_at>=c.starts_at AND occurred_at<c.ends_at;
   v_target:=c.target;
 ELSE
   WITH members AS (
     SELECT p.user_id,p.display_name,p.avatar_url,p.suspended FROM public.profiles p WHERE NOT p.arena_hidden
     AND (g.scope<>'user' OR p.user_id=g.assignee_id)
     AND (EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=g.target_role)
       OR EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.responsible_id=p.user_id AND f.responsible_role=g.target_role AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at))
     AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text='super_admin')
   ), measured AS (
     SELECT m.*,COALESCE((SELECT sum(score_delta) FROM public.activity_feed WHERE responsible_id=m.user_id AND responsible_role=g.target_role
       AND occurred_at>=c.starts_at AND occurred_at<c.ends_at),0) actual,
       COALESCE((SELECT CASE WHEN candidate.enabled THEN candidate.target END FROM (
       SELECT * FROM public.company_goals WHERE scope='user' AND assignee_id=m.user_id AND target_role=g.target_role AND period=g.period
       AND effective_at<=least(now(),c.ends_at) AND (cycle_start IS NULL OR cycle_start<=least(now(),c.ends_at))
       AND (cycle_end IS NULL OR recurring OR cycle_end>=c.ends_at) ORDER BY effective_at DESC,version DESC LIMIT 1) candidate),c.target) target FROM members m
   ) SELECT COALESCE(jsonb_agg(to_jsonb(measured)||jsonb_build_object('state',public.arena_classification(actual,target,c.starts_at,c.ends_at,now())) ORDER BY display_name,user_id),'[]'),
     COALESCE(sum(actual),0),COALESCE(sum(target),0) INTO v_members,v_actual,v_target FROM measured;
 END IF;
 v_result:=jsonb_build_object('actual',v_actual,'target',v_target,'members',COALESCE(v_members,'[]'),
 'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE public.arena_classification(v_actual,v_target,c.starts_at,c.ends_at,now()) END);
 IF g.scope='global' AND g.period='monthly' AND c.ends_at<=now() THEN
   v_result:=v_result||jsonb_build_object('closers',public.arena_team_ranking(c.starts_at,c.ends_at),'sdrs',public.arena_sdr_ranking(c.starts_at,c.ends_at));
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.arena_cycle_result(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.arena_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE g public.company_goals; c public.goal_cycles; v_start timestamptz; v_end timestamptz; v_unit text; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_revision bigint;
BEGIN
 IF NOT pg_try_advisory_xact_lock(23091100) THEN RETURN; END IF;
 v_now:=clock_timestamp();
 -- Materialize missed cycles too; the worker is independent of the TV/browser.
 FOR g IN SELECT DISTINCT ON(family_id) * FROM public.company_goals WHERE effective_at<=v_now ORDER BY family_id,version DESC LOOP
   v_unit:=CASE g.period WHEN 'daily' THEN 'day' WHEN 'weekly' THEN 'week' ELSE 'month' END;
   SELECT max(ends_at) INTO v_start FROM public.goal_cycles WHERE family_id=g.family_id;
   IF v_start IS NULL THEN v_start:=COALESCE(g.cycle_start,date_trunc(v_unit,g.effective_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'); END IF;
   -- The monthly archive survives a hidden/disabled global goal.
   IF (g.scope='global' AND g.period='monthly') OR
      (g.enabled AND (g.recurring OR NOT EXISTS(SELECT 1 FROM public.goal_cycles WHERE family_id=g.family_id))) THEN
     WHILE v_start<=v_now LOOP
       v_end:=CASE WHEN v_start=g.cycle_start THEN g.cycle_end ELSE ((v_start AT TIME ZONE 'America/Sao_Paulo')+('1 '||v_unit)::interval) AT TIME ZONE 'America/Sao_Paulo' END;
       INSERT INTO public.goal_cycles(family_id,goal_id,starts_at,ends_at,target)
       SELECT family_id,id,v_start,v_end,target FROM public.company_goals WHERE family_id=g.family_id
       AND effective_at<least(v_end,v_now+interval '1 microsecond') ORDER BY version DESC LIMIT 1 ON CONFLICT DO NOTHING;
       v_start:=v_end;
       EXIT WHEN NOT g.recurring AND NOT (g.scope='global' AND g.period='monthly');
     END LOOP;
   END IF;
   UPDATE public.goal_cycles SET goal_id=g.id,target=g.target,
     ends_at=CASE WHEN starts_at=g.cycle_start AND g.cycle_end>v_now THEN g.cycle_end ELSE ends_at END
     WHERE family_id=g.family_id AND closed_at IS NULL AND ends_at>v_now AND (goal_id<>g.id OR target<>g.target);
 END LOOP;
 FOR c IN SELECT * FROM public.goal_cycles WHERE closed_at IS NULL AND ends_at<=v_now ORDER BY ends_at,id FOR UPDATE LOOP
   v_result:=public.arena_cycle_result(c.id);
   UPDATE public.goal_cycles SET result=v_result,closed_at=clock_timestamp() WHERE id=c.id;
   INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
   SELECT DISTINCT r.user_id,'cycle.closed:'||c.id,'cycle.closed',cg.title||CASE WHEN v_result->>'state' IN ('achieved','exceeded') THEN ' · meta alcançada' ELSE ' · meta não alcançada' END
   FROM public.user_roles r JOIN public.company_goals cg ON cg.id=c.goal_id
   WHERE r.role::text IN ('executive','super_admin') OR (cg.scope='global' AND r.role::text IN ('sdr','closer')) OR (cg.scope='role' AND r.role::text=cg.target_role) OR r.user_id=cg.assignee_id ON CONFLICT DO NOTHING;
 END LOOP;
 SELECT revision INTO v_revision FROM public.dashboard_events WHERE topic='arena';
 FOR c IN SELECT * FROM public.goal_cycles gc WHERE closed_at IS NULL AND starts_at<=v_now AND ends_at>v_now
   AND (evaluation_revision<>v_revision OR (ends_at-v_now<=interval '1 hour' AND NOT EXISTS(
     SELECT 1 FROM public.arena_notifications WHERE event_key IN ('cycle.due:'||gc.id,'cycle.achieved:'||gc.id,'cycle.exceeded:'||gc.id)))) LOOP
   SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
   v_result:=public.arena_cycle_result(c.id);
   IF v_result->>'state' IN ('achieved','exceeded') OR c.ends_at-v_now<=interval '1 hour' THEN
     INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
     SELECT DISTINCT r.user_id,'cycle.'||CASE WHEN v_result->>'state' IN ('achieved','exceeded') THEN v_result->>'state' ELSE 'due' END||':'||c.id,
       'cycle.'||CASE WHEN v_result->>'state' IN ('achieved','exceeded') THEN v_result->>'state' ELSE 'due' END,
       g.title||CASE v_result->>'state' WHEN 'achieved' THEN ' · meta atingida' WHEN 'exceeded' THEN ' · meta excedida' ELSE ' · prazo termina em menos de 1 hora' END
     FROM public.user_roles r WHERE r.role::text IN ('executive','super_admin') OR (g.scope='global' AND r.role::text IN ('sdr','closer')) OR (g.scope='role' AND r.role::text=g.target_role) OR r.user_id=g.assignee_id ON CONFLICT DO NOTHING;
   END IF;
   UPDATE public.goal_cycles SET evaluation_revision=v_revision WHERE id=c.id;
 END LOOP;
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 SELECT assignee_id,'task.due:'||id,'task.due','Prazo próximo: '||title FROM public.daily_goal_tasks
 WHERE NOT is_completed AND task_date=(v_now AT TIME ZONE 'America/Sao_Paulo')::date
 AND (v_now AT TIME ZONE 'America/Sao_Paulo')::time>='23:00' ON CONFLICT DO NOTHING;
 INSERT INTO public.arena_notifications(recipient_id,event_key,kind,title)
 SELECT assignee_id,'task.expired:'||id,'task.expired','Prazo encerrado: '||title FROM public.daily_goal_tasks
 WHERE NOT is_completed AND task_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date
 AND task_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date-1 ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.arena_tick() FROM PUBLIC,anon,authenticated;

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
 WHERE role::text IN ('sdr','closer','executive','super_admin') ON CONFLICT DO NOTHING;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.arena_adjust_score(p_person uuid,p_role text,p_delta numeric,p_source uuid,p_reason text,p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_role NOT IN ('sdr','closer') OR p_delta IS NULL OR abs(p_delta)>100 OR p_delta=0 OR length(btrim(COALESCE(p_reason,'')))<5
 OR NOT EXISTS(SELECT 1 FROM public.activity_feed WHERE id=p_source AND responsible_id=p_person AND responsible_role=p_role)
 THEN RAISE EXCEPTION 'A correção exige evento real, responsável, pontuação e motivo'; END IF;
 IF public.arena_emit('adjustment:'||p_request,'score.adjusted',p_person,p_role,'activity_feed',p_source,clock_timestamp(),p_delta,0,NULL,NULL,btrim(p_reason)) IS NOT NULL THEN
   INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,after_data)
   VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'arena.score_adjusted',p_source,p_role,btrim(p_reason),jsonb_build_object('responsible_id',p_person,'delta',p_delta,'request_id',p_request));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.arena_set_visibility(p_person uuid,p_hidden boolean,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<5 OR p_hidden IS NULL THEN RAISE EXCEPTION 'Informe um motivo'; END IF;
 PERFORM set_config('arena.visibility',p_person::text,true);
 UPDATE public.profiles SET arena_hidden=p_hidden WHERE user_id=p_person;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,after_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'arena.visibility',p_person,'Visibilidade na Arena',p_reason,jsonb_build_object('hidden',p_hidden));
END $$;

CREATE OR REPLACE FUNCTION public.arena_assignees()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY display_name,user_id),'[]') INTO v FROM(
 SELECT p.user_id,p.display_name,p.avatar_url,p.suspended,p.arena_hidden,array_agg(DISTINCT r.role::text) roles
 FROM public.profiles p LEFT JOIN public.user_roles r USING(user_id) GROUP BY p.id) x;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.arena_read_notifications(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT public.registration_has_access() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND NOT suspended) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 UPDATE public.arena_notifications SET read_at=COALESCE(read_at,clock_timestamp()) WHERE recipient_id=auth.uid() AND id=ANY(p_ids);
END $$;

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('arena_save_goal','arena_adjust_score','arena_set_visibility','arena_assignees','arena_read_notifications') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',r.sig);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.sig);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_team_ranking(timestamptz,timestamptz),public.get_sdr_ranking(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_team_ranking(timestamptz,timestamptz),public.get_sdr_ranking(timestamptz,timestamptz) TO authenticated;

-- Run at the server, even if every browser is closed. Jobs cannot be configured
-- by authenticated clients. Transactional verification rolls this back too.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('arena-cycle-deadlines','5 seconds','SELECT public.arena_tick()');
SELECT public.arena_tick();
NOTIFY pgrst,'reload schema';
COMMIT;
