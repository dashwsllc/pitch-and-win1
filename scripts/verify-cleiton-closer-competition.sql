-- Execute after the migration in a transaction that always rolls back.
DO $$
DECLARE
  v_user uuid;
  v_week public.goal_cycles;
  v_start timestamptz;
  v_end timestamptz;
  v_month timestamp without time zone;
  v_dashboard jsonb;
  v_other_admin uuid;
BEGIN
  SELECT id INTO STRICT v_user FROM auth.users
  WHERE lower(email) = 'cleitonrodrigues.ads@gmail.com';
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.arena_closer_exceptions WHERE user_id = v_user)
    OR NOT public.arena_closer_exception(v_user)
  THEN RAISE EXCEPTION 'Cleiton is not opted into Closer competition'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_user AND role::text='executive')
    OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_user AND role::text='super_admin')
  THEN RAISE EXCEPTION 'Administrative roles were changed'; END IF;

  v_month := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo');
  v_start := v_month AT TIME ZONE 'America/Sao_Paulo';
  v_end := (v_month + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
  IF (SELECT count(*) FROM jsonb_array_elements(public.get_team_ranking()) x
      WHERE x->>'user_id'=v_user::text) <> 1
    OR (SELECT count(*) FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
      WHERE x->>'user_id'=v_user::text) <> 1
  THEN RAISE EXCEPTION 'Cleiton is missing or duplicated in monthly Closer ranking'; END IF;

  SELECT c.* INTO v_week FROM public.goal_cycles c
  JOIN public.company_goals g ON g.id=c.goal_id
  WHERE g.scope='role' AND g.target_role='closer' AND g.period='weekly'
    AND g.enabled AND c.closed_at IS NULL AND c.starts_at<=now() AND c.ends_at>now()
  ORDER BY c.starts_at DESC LIMIT 1;
  IF v_week.id IS NULL THEN RAISE EXCEPTION 'No open weekly Closer cycle'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(public.arena_cycle_result(v_week.id)->'members') x
      WHERE x->>'user_id'=v_user::text) <> 1
  THEN RAISE EXCEPTION 'Cleiton is missing or duplicated in the Closer goal'; END IF;
  IF (SELECT (x->>'target')::numeric FROM jsonb_array_elements(public.arena_cycle_result(v_week.id)->'members') x
      WHERE x->>'user_id'=v_user::text) <= 0
  THEN RAISE EXCEPTION 'Cleiton has no Closer target'; END IF;

  v_dashboard := public.arena_dashboard(v_start, v_end);
  IF (SELECT count(*) FROM jsonb_array_elements(v_dashboard->'closers') x
      WHERE x->>'user_id'=v_user::text) <> 1
  THEN RAISE EXCEPTION 'Cleiton is missing from Arena Closer standings'; END IF;

  SELECT r.user_id INTO v_other_admin FROM public.user_roles r
  WHERE r.role::text='super_admin' AND r.user_id<>v_user
    AND EXISTS (SELECT 1 FROM public.user_roles c WHERE c.user_id=r.user_id AND c.role::text='closer')
  LIMIT 1;
  IF v_other_admin IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.get_team_ranking()) x
    WHERE x->>'user_id'=v_other_admin::text
  ) THEN RAISE EXCEPTION 'A different Super Admin joined Closer ranking'; END IF;
END $$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
