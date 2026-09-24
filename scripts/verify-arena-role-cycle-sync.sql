-- Execute after the migration in a transaction that always rolls back.
DO $verify$
DECLARE
  v_admin uuid;
  v_sale public.vendas;
  v_week public.goal_cycles;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_sunday timestamptz;
  v_before_count integer;
  v_after_count integer;
  v_before_points numeric;
  v_after_points numeric;
  v_expected_count integer;
  v_dashboard jsonb;
  v_other_range jsonb;
BEGIN
  SELECT r.user_id INTO v_admin FROM public.user_roles r JOIN public.profiles p USING(user_id)
  WHERE r.role::text='super_admin' AND NOT p.suspended LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'No active Super Admin for rollback verification'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  SELECT c.* INTO v_week FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
  WHERE g.scope='role' AND g.target_role='closer' AND g.period='weekly' AND g.enabled
    AND c.closed_at IS NULL AND c.starts_at<=now() AND c.ends_at>now()
  ORDER BY c.starts_at DESC LIMIT 1;
  IF v_week.id IS NULL THEN RAISE EXCEPTION 'No open weekly Closer cycle'; END IF;
  SELECT v.* INTO v_sale FROM public.vendas v
  WHERE v.approval_status='aprovada'
    AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer')
    AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='super_admin')
  ORDER BY v.created_at DESC LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No approved Closer sale for rollback verification'; END IF;
  v_day_start:=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_day_end:=((v_day_start AT TIME ZONE 'America/Sao_Paulo')+interval '1 day') AT TIME ZONE 'America/Sao_Paulo';
  v_sunday:=((v_week.starts_at AT TIME ZONE 'America/Sao_Paulo')-interval '1 day'+interval '12 hours') AT TIME ZONE 'America/Sao_Paulo';
  IF extract(isodow FROM v_sunday AT TIME ZONE 'America/Sao_Paulo')<>7 THEN
    RAISE EXCEPTION 'Weekly Closer cycle must start on Monday in Brasilia';
  END IF;
  SELECT count(*) INTO v_expected_count FROM public.arena_closer_weekly_sale_facts
  WHERE sale_id=v_sale.id AND weekly_credit_at>=v_week.starts_at AND weekly_credit_at<v_week.ends_at;
  SELECT (r->>'quantidadeVendas')::integer INTO v_before_count
  FROM jsonb_array_elements(public.arena_team_ranking(v_week.starts_at,v_week.ends_at,true)) r
  WHERE r->>'user_id'=v_sale.user_id::text;
  SELECT (m->>'actual')::numeric INTO v_before_points
  FROM jsonb_array_elements(public.arena_cycle_result(v_week.id)->'members') m
  WHERE m->>'user_id'=v_sale.user_id::text;

  IF v_sale.created_at IS DISTINCT FROM v_sunday THEN
    PERFORM public.super_admin_reschedule_sale(v_sale.id,v_sunday,
      'Verificação transacional do crédito semanal de domingo',v_sale.created_at,v_sale.approval_status);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_closer_weekly_sale_facts f
    WHERE f.sale_id=v_sale.id AND f.occurred_at=v_sunday AND f.weekly_credit_at=v_week.starts_at) THEN
    RAISE EXCEPTION 'Sunday purchase was not credited to the following weekly cycle';
  END IF;
  SELECT (r->>'quantidadeVendas')::integer INTO v_after_count
  FROM jsonb_array_elements(public.arena_team_ranking(v_week.starts_at,v_week.ends_at,true)) r
  WHERE r->>'user_id'=v_sale.user_id::text;
  SELECT (m->>'actual')::numeric INTO v_after_points
  FROM jsonb_array_elements(public.arena_cycle_result(v_week.id)->'members') m
  WHERE m->>'user_id'=v_sale.user_id::text;
  IF v_after_count IS DISTINCT FROM COALESCE(v_before_count,0)+1-v_expected_count
    OR v_after_points IS DISTINCT FROM COALESCE(v_before_points,0)+10*(1-v_expected_count) THEN
    RAISE EXCEPTION 'Closer ranking and weekly goal disagree on Sunday sale';
  END IF;

  v_dashboard:=public.arena_dashboard(v_day_start,v_day_end);
  v_other_range:=public.arena_dashboard(v_day_start-interval '6 days',v_day_end);
  IF v_dashboard->'closers' IS DISTINCT FROM public.arena_team_ranking(v_week.starts_at,v_week.ends_at,true)
    OR v_other_range->'closers' IS DISTINCT FROM v_dashboard->'closers' THEN
    RAISE EXCEPTION 'Closer ranking changed with the indicator date filter';
  END IF;
  IF v_other_range->'sdrs' IS DISTINCT FROM v_dashboard->'sdrs' THEN
    RAISE EXCEPTION 'SDR ranking changed with the indicator date filter';
  END IF;
  IF (SELECT (c->'result'->>'actual')::numeric FROM jsonb_array_elements(v_dashboard->'cycles') c
      WHERE c->>'goal_id'=v_week.goal_id::text LIMIT 1) IS DISTINCT FROM
     (public.arena_cycle_result(v_week.id)->>'actual')::numeric THEN
    RAISE EXCEPTION 'Arena card and weekly Closer cycle disagree';
  END IF;
  IF (SELECT count(*) FROM public.arena_closer_weekly_sale_facts) IS DISTINCT FROM
     (SELECT count(DISTINCT sale_id) FROM public.arena_closer_weekly_sale_facts) THEN
    RAISE EXCEPTION 'A sale was duplicated in weekly Closer facts';
  END IF;
END $verify$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
