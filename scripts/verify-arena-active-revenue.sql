-- Run after the migration inside a transaction that always rolls back.
SELECT set_config('request.jwt.claim.sub', (
  SELECT r.user_id::text
  FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.role::text = 'super_admin' AND NOT p.suspended LIMIT 1
), true);

DO $$
DECLARE
  s public.vendas;
  v_start timestamptz;
  v_end timestamptz;
  v_before numeric;
  v_after numeric;
  v_cycle uuid;
  v_cycle_before numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No active Super Admin for rollback verification'; END IF;
  SELECT v.* INTO s FROM public.vendas v
  WHERE v.approval_status = 'aprovada'
    AND v.created_at >= now() - interval '365 days'
    AND NOT COALESCE(v.withdrawn, false) AND v.withdrawal_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.saques
      WHERE v.id = ANY(vendas_incluidas) AND status NOT IN ('rejeitado', 'cancelado')
    )
  ORDER BY v.created_at DESC LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No eligible approved sale for rollback verification'; END IF;

  v_start := date_trunc('month', s.created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_end := ((v_start AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
  v_before := (public.arena_period_metrics(v_start, v_end)->>'revenue')::numeric;
  SELECT c.id INTO v_cycle
  FROM public.goal_cycles c JOIN public.company_goals g ON g.id = c.goal_id
  WHERE c.closed_at IS NULL AND g.scope = 'global'
    AND s.created_at >= c.starts_at AND s.created_at < c.ends_at
  ORDER BY c.starts_at DESC LIMIT 1;
  IF v_cycle IS NOT NULL THEN
    v_cycle_before := (public.arena_cycle_result(v_cycle)->>'actual')::numeric;
  END IF;

  PERFORM set_config('dashboard.sale_decision', s.id::text, true);
  UPDATE public.vendas SET approval_status = 'cancelada' WHERE id = s.id;
  PERFORM set_config('dashboard.sale_decision', '', true);

  v_after := (public.arena_period_metrics(v_start, v_end)->>'revenue')::numeric;
  IF v_after IS DISTINCT FROM v_before - s.valor_venda THEN
    RAISE EXCEPTION 'Cancelled sale remains in monthly Arena revenue';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arena_sale_facts WHERE sale_id = s.id) THEN
    RAISE EXCEPTION 'Cancelled sale remains in Arena sale facts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_feed a
    JOIN public.activity_feed r ON r.reverses_id = a.id
    WHERE a.event_key = 'sale.approved:' || s.id
      AND r.event_key = 'sale.reversed:' || s.id
  ) THEN RAISE EXCEPTION 'Cancellation audit event missing'; END IF;
  IF v_cycle IS NOT NULL AND
    (public.arena_cycle_result(v_cycle)->>'actual')::numeric IS DISTINCT FROM v_cycle_before - s.valor_venda THEN
    RAISE EXCEPTION 'Open monthly goal did not fall with cancelled sale';
  END IF;
END $$;

SELECT jsonb_build_object('validation', 'passed', 'committed', false) AS result;
