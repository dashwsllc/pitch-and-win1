-- Keep the role rankings and activity feed on their own open goal cycles.
-- The selected chart/indicator range must never reset a Closer's weekly sales.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Keep the purchase timestamp intact for revenue, chart and monthly ranking.
-- A Sunday purchase earns Closer's weekly credit at the following Monday's
-- Brasilia midnight, independent of edits or approval time.
CREATE OR REPLACE VIEW public.arena_closer_weekly_sale_facts AS
SELECT v.sale_id,v.user_id,v.responsible_role,v.occurred_at,v.revenue,v.active,
  CASE WHEN extract(isodow FROM v.occurred_at AT TIME ZONE 'America/Sao_Paulo')=7
    THEN (date_trunc('week',v.occurred_at AT TIME ZONE 'America/Sao_Paulo')+interval '1 week') AT TIME ZONE 'America/Sao_Paulo'
    ELSE v.occurred_at END weekly_credit_at
FROM public.arena_sale_facts v
WHERE v.active AND v.responsible_role='closer';
REVOKE ALL ON public.arena_closer_weekly_sale_facts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamptz,p_end timestamptz,p_weekly_credit boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'Closer') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.revenue,0) AS "totalVendas",COALESCE(s.sales,0) AS "quantidadeVendas",
 COALESCE(e.score,0)+COALESCE(s.sales,0)*10 AS score,
 COALESCE(a.total,0) abordagens,CASE WHEN a.total>0 THEN round(COALESCE(s.sales,0)*100.0/a.total,1) ELSE 0 END conversao
 FROM public.profiles p
 LEFT JOIN LATERAL (SELECT COALESCE(sum(v.revenue),0) revenue,count(*) sales FROM public.arena_closer_weekly_sale_facts v
   WHERE v.user_id=p.user_id
   AND (CASE WHEN p_weekly_credit THEN v.weekly_credit_at ELSE v.occurred_at END)>=p_start
   AND (CASE WHEN p_weekly_credit THEN v.weekly_credit_at ELSE v.occurred_at END)<p_end) s ON true
 LEFT JOIN LATERAL (SELECT COALESCE(sum(f.score_delta),0) score FROM public.activity_feed f
   WHERE f.responsible_id=p.user_id AND f.responsible_role='closer'
   AND f.action_type NOT IN ('sale.approved','sale.reversed')
   AND f.occurred_at>=p_start AND f.occurred_at<p_end) e ON true
 LEFT JOIN LATERAL(SELECT count(*) total FROM public.abordagens WHERE user_id=p.user_id AND created_at>=p_start AND created_at<p_end) a ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='closer')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end)
 OR s.sales>0)
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin')
 ) x;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.arena_team_ranking(timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated;

-- Existing monthly/selected-period callers retain purchase-date semantics.
CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.arena_team_ranking(p_start,p_end,false);
$$;

CREATE OR REPLACE FUNCTION public.arena_cycle_result(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
     AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text='super_admin')
   ), measured AS (
     SELECT m.*,
       COALESCE((SELECT sum(f.score_delta) FROM public.arena_counted_call_events f WHERE f.responsible_id=m.user_id AND f.responsible_role=g.target_role
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

CREATE OR REPLACE FUNCTION public.arena_dashboard(p_start timestamptz, p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_now timestamptz := now();
  v_end timestamptz;
  v_previous_end timestamptz;
  v_series jsonb;
  v_cycles jsonb;
  v_feed jsonb;
  v_unit text;
  v_sdr_start timestamptz;
  v_sdr_end timestamptz;
  v_closer_start timestamptz;
  v_closer_end timestamptz;
BEGIN
  IF NOT public.arena_has_access() THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR p_end<=p_start OR p_end-p_start>interval '367 days' OR p_start>v_now THEN
    RAISE EXCEPTION 'Escolha um período válido de até um ano';
  END IF;
  v_end := least(p_end,v_now);
  v_previous_end := CASE WHEN p_end-p_start<=interval '25 hours' AND p_end>v_now
    THEN p_start-(p_end-v_now) ELSE p_start END;
  v_unit := CASE WHEN p_end-p_start<=interval '25 hours' THEN 'hour'
    WHEN p_end-p_start<=interval '62 days' THEN 'day' ELSE 'month' END;

  -- Use the same boundaries as the progress cards, including an explicitly
  -- configured cycle extension. Default to Brasilia calendar boundaries if a
  -- goal is temporarily disabled or its next cycle has not been created yet.
  SELECT c.starts_at,c.ends_at INTO v_sdr_start,v_sdr_end
  FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
  WHERE c.closed_at IS NULL AND c.starts_at<=v_now AND c.ends_at>v_now
    AND g.enabled AND g.scope='role' AND g.target_role='sdr' AND g.period='daily'
  ORDER BY c.starts_at DESC,c.id DESC LIMIT 1;
  IF v_sdr_start IS NULL THEN
    v_sdr_start := date_trunc('day',v_now AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
    v_sdr_end := ((v_sdr_start AT TIME ZONE 'America/Sao_Paulo')+interval '1 day') AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  SELECT c.starts_at,c.ends_at INTO v_closer_start,v_closer_end
  FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
  WHERE c.closed_at IS NULL AND c.starts_at<=v_now AND c.ends_at>v_now
    AND g.enabled AND g.scope='role' AND g.target_role='closer' AND g.period='weekly'
  ORDER BY c.starts_at DESC,c.id DESC LIMIT 1;
  IF v_closer_start IS NULL THEN
    v_closer_start := date_trunc('week',v_now AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
    v_closer_end := ((v_closer_start AT TIME ZONE 'America/Sao_Paulo')+interval '1 week') AT TIME ZONE 'America/Sao_Paulo';
  END IF;

  WITH buckets AS (
    SELECT d AS bucket FROM generate_series(date_trunc(v_unit,p_start AT TIME ZONE 'America/Sao_Paulo'),
      date_trunc(v_unit,v_end AT TIME ZONE 'America/Sao_Paulo'),('1 '||v_unit)::interval) d
  ), sales AS (
    SELECT date_trunc(v_unit,v.occurred_at AT TIME ZONE 'America/Sao_Paulo') bucket,
      COALESCE(sum(v.revenue),0) revenue,count(*) FILTER(WHERE v.active) sales
    FROM public.arena_sale_facts v
    WHERE v.occurred_at>=p_start AND v.occurred_at<v_end GROUP BY 1
  ), appointments AS (
    SELECT date_trunc(v_unit,f.occurred_at AT TIME ZONE 'America/Sao_Paulo') bucket,count(*) appointments
    FROM public.arena_counted_call_events f
    WHERE f.action_type IN ('q.scheduled','closing.scheduled')
      AND f.occurred_at>=p_start AND f.occurred_at<v_end GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at',b.bucket,'revenue',COALESCE(s.revenue,0),
    'sales',COALESCE(s.sales,0),'appointments',COALESCE(a.appointments,0)) ORDER BY b.bucket),'[]') INTO v_series
  FROM buckets b LEFT JOIN sales s USING(bucket) LEFT JOIN appointments a USING(bucket);

  v_cycles := public.arena_visible_goals();
  -- Limit each role independently. A Sunday approval follows its weekly sale
  -- credit into the next Closer feed while retaining its real event timestamp.
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.cycle_at DESC,x.id DESC),'[]') INTO v_feed
  FROM (
    SELECT * FROM (
      SELECT f.id,f.action_type,f.responsible_id,f.responsible_name,f.responsible_role,
        f.score_delta,f.revenue_delta,f.occurred_at,p.avatar_url,f.provenance,
        f.occurred_at cycle_at
      FROM public.activity_feed f LEFT JOIN public.profiles p ON p.user_id=f.responsible_id
      WHERE f.responsible_role='sdr' AND f.occurred_at>=v_sdr_start AND f.occurred_at<v_sdr_end
        AND NOT COALESCE(p.arena_hidden,false)
      ORDER BY f.occurred_at DESC,f.id DESC LIMIT 10
    ) sdr_events
    UNION ALL
    SELECT * FROM (
      SELECT f.id,f.action_type,COALESCE(v.user_id,f.responsible_id) responsible_id,
        COALESCE(p.display_name,f.responsible_name) responsible_name,
        CASE WHEN v.sale_id IS NOT NULL THEN 'closer' ELSE f.responsible_role END responsible_role,
        CASE WHEN v.sale_id IS NOT NULL THEN 10 ELSE f.score_delta END score_delta,
        f.revenue_delta,f.occurred_at,p.avatar_url,f.provenance,
        COALESCE(v.weekly_credit_at,f.occurred_at) cycle_at
      FROM public.activity_feed f LEFT JOIN public.arena_closer_weekly_sale_facts v
        ON f.action_type='sale.approved' AND f.source_type='vendas' AND v.sale_id=f.source_id
      LEFT JOIN public.profiles p ON p.user_id=COALESCE(v.user_id,f.responsible_id)
      WHERE (f.responsible_role='closer' OR v.sale_id IS NOT NULL)
        AND COALESCE(v.weekly_credit_at,f.occurred_at)>=v_closer_start
        AND COALESCE(v.weekly_credit_at,f.occurred_at)<v_closer_end
        AND NOT COALESCE(p.arena_hidden,false)
      ORDER BY cycle_at DESC,f.id DESC LIMIT 10
    ) closer_events
  ) x;

  RETURN jsonb_build_object('server_time',v_now,'revision',public.arena_revision(),
    'metrics',public.arena_period_metrics(p_start,v_end),
    'previous',public.arena_period_metrics(p_start-(p_end-p_start),v_previous_end),
    'series',v_series,'cycles',v_cycles,'feed',v_feed,
    'sdrs',public.arena_sdr_ranking(v_sdr_start,v_sdr_end),
    'closers',public.arena_team_ranking(v_closer_start,v_closer_end,true),
    'ticket_reference',(SELECT ticket_reference FROM public.company_goals
      WHERE scope='global' AND effective_at<=v_now ORDER BY effective_at DESC,version DESC LIMIT 1));
END $$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp()
WHERE topic IN ('arena','goals');
COMMIT;
