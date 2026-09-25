-- The SDR goal (daily or weekly) is one shared company-wide number that gets
-- split across every active SDR in the cycle, so the team's combined target
-- stays at the configured value instead of being multiplied per head. A
-- super admin/executive can still override one specific SDR's own target via
-- a scope='user' goal, which keeps taking priority over the diluted share.
-- The Closer goal is untouched: it stays a full, individual target per person.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.arena_cycle_result(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.goal_cycles; g public.company_goals; v_members jsonb; v_actual numeric; v_target numeric; v_result jsonb;
BEGIN
 SELECT * INTO c FROM public.goal_cycles WHERE id=p_id;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 IF c.closed_at IS NOT NULL THEN RETURN c.result; END IF;
 IF g.scope='global' THEN
   SELECT COALESCE(sum(v.revenue),0) INTO v_actual FROM public.arena_sale_facts v
   WHERE v.occurred_at>=c.starts_at AND v.occurred_at<c.ends_at;
   v_target:=c.target;
 ELSE
   WITH members AS (
     SELECT p.user_id,p.display_name,p.avatar_url,p.suspended FROM public.profiles p WHERE NOT p.arena_hidden
     AND (g.scope<>'user' OR p.user_id=g.assignee_id)
     AND (EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=g.target_role)
       OR EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.responsible_id=p.user_id AND f.responsible_role=g.target_role AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at)
       OR (g.target_role='closer' AND EXISTS(SELECT 1 FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=p.user_id AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
           AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at)))
     AND (NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text='super_admin') OR (g.target_role='closer' AND public.arena_closer_exception(p.user_id)) OR (g.target_role='sdr' AND public.arena_sdr_exception(p.user_id)))
   ), member_count AS (
     SELECT GREATEST(count(*),1)::numeric AS n FROM members
   ), measured AS (
     SELECT m.*,
       COALESCE((SELECT sum(f.score_delta) FROM public.arena_counted_call_events f WHERE f.responsible_id=m.user_id AND f.responsible_role=g.target_role AND (g.target_role<>'sdr' OR f.action_type NOT LIKE 'q.%' OR NOT public.arena_sdr_exception(m.user_id))
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + COALESCE((SELECT sum(f.score_delta) FROM public.activity_feed f WHERE f.action_type='score.adjusted'
         AND f.responsible_id=m.user_id AND f.responsible_role=g.target_role
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + CASE WHEN g.target_role='closer' THEN 10*(SELECT count(*) FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=m.user_id
         AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
         AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at) ELSE 0 END actual,
       COALESCE((SELECT CASE WHEN candidate.enabled THEN candidate.target END FROM (
       SELECT * FROM public.company_goals WHERE scope='user' AND assignee_id=m.user_id AND target_role=g.target_role AND period=g.period
       AND effective_at<=least(now(),c.ends_at) AND (cycle_start IS NULL OR cycle_start<=least(now(),c.ends_at))
       AND (cycle_end IS NULL OR recurring OR cycle_end>=c.ends_at) ORDER BY effective_at DESC,version DESC LIMIT 1) candidate),
       CASE WHEN g.target_role='sdr' THEN c.target/mc.n ELSE c.target END) target
     FROM members m CROSS JOIN member_count mc
   ) SELECT COALESCE(jsonb_agg(to_jsonb(measured)||jsonb_build_object('state',public.arena_classification(actual,target,c.starts_at,c.ends_at,now())) ORDER BY display_name,user_id),'[]'),
     COALESCE(sum(actual),0),COALESCE(sum(target),0) INTO v_members,v_actual,v_target FROM measured;
 END IF;
 v_result:=jsonb_build_object('actual',v_actual,'target',v_target,'members',COALESCE(v_members,'[]'),
 'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE public.arena_classification(v_actual,v_target,c.starts_at,c.ends_at,now()) END);
 IF g.scope='global' AND g.period='monthly' AND c.ends_at<=now() THEN
   v_result:=v_result||jsonb_build_object('closers',public.arena_team_ranking(c.starts_at,c.ends_at),'sdrs',public.arena_sdr_ranking(c.starts_at,c.ends_at));
 END IF;
 RETURN v_result;
END $function$;

-- arena_visible_goals()/GoalOverview reads this wrapper. It used to force every
-- member back to the raw goal target and multiply by headcount for any 'role'
-- scope; that undid the SDR dilution above. Closer keeps that original
-- per-head multiplication, since its target stays individual.
CREATE OR REPLACE FUNCTION public.arena_collective_result(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.goal_cycles; g public.company_goals; v_result jsonb; v_members jsonb; v_target numeric;
BEGIN
 SELECT * INTO c FROM public.goal_cycles WHERE id=p_id;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 v_result:=public.arena_cycle_result(p_id);
 IF g.scope<>'role' OR g.target_role='sdr' THEN RETURN v_result; END IF;
 SELECT COALESCE(jsonb_agg(m.value||jsonb_build_object('target',c.target,
   'state',public.arena_classification((m.value->>'actual')::numeric,c.target,c.starts_at,c.ends_at,now()))
   ORDER BY m.ordinality),'[]') INTO v_members
 FROM jsonb_array_elements(v_result->'members') WITH ORDINALITY AS m(value,ordinality);
 v_target:=c.target*jsonb_array_length(v_members);
 RETURN v_result||jsonb_build_object('members',v_members,'target',v_target,
   'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE
     public.arena_classification((v_result->>'actual')::numeric,v_target,c.starts_at,c.ends_at,now()) END);
END $function$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
