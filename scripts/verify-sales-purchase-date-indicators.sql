-- Run in a transaction and always roll back. No sale change is committed.
SELECT set_config('request.jwt.claim.sub', (
  SELECT r.user_id::text FROM public.user_roles r
  JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.role::text = 'super_admin' AND NOT p.suspended LIMIT 1
), true);

DO $$
DECLARE
  s public.vendas;
  moved public.vendas;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_today_revenue numeric;
  v_purchase_revenue numeric;
  v_purchase_start timestamptz;
  v_purchase_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No active Super Admin for verification'; END IF;
  SELECT * INTO s FROM public.vendas WHERE approval_status = 'aprovada' ORDER BY created_at DESC LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No approved sale for verification'; END IF;

  v_today_start := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_today_end := v_today_start + interval '1 day';
  PERFORM public.super_admin_reschedule_sale(
    s.id, s.created_at - interval '2 days',
    'Verificação transacional da data da compra', s.created_at, s.approval_status
  );
  SELECT * INTO moved FROM public.vendas WHERE id = s.id;
  IF NOT EXISTS (SELECT 1 FROM public.arena_sale_facts f WHERE f.sale_id = s.id
    AND f.active AND f.occurred_at = moved.created_at AND f.revenue = moved.valor_venda) THEN
    RAISE EXCEPTION 'Arena did not use the corrected purchase date';
  END IF;

  v_purchase_start := date_trunc('day', moved.created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_purchase_end := v_purchase_start + interval '1 day';
  v_today_revenue := (public.arena_period_metrics(v_today_start, v_today_end)->>'revenue')::numeric;
  v_purchase_revenue := (public.arena_period_metrics(v_purchase_start, v_purchase_end)->>'revenue')::numeric;

  PERFORM set_config('dashboard.sale_edit', s.id::text, true);
  PERFORM set_config('dashboard.sale_decision', s.id::text, true);
  UPDATE public.vendas SET valor_venda = valor_venda + 1 WHERE id = s.id;
  PERFORM set_config('dashboard.sale_edit', '', true);
  PERFORM set_config('dashboard.sale_decision', '', true);

  IF NOT EXISTS (SELECT 1 FROM public.arena_sale_facts f JOIN public.vendas v ON v.id = f.sale_id
    WHERE f.sale_id = s.id AND f.active AND f.occurred_at = v.created_at
      AND f.occurred_at <> v.updated_at AND f.revenue = v.valor_venda) THEN
    RAISE EXCEPTION 'Sale edit moved the fact to its updated date';
  END IF;
  IF (public.arena_period_metrics(v_today_start, v_today_end)->>'revenue')::numeric IS DISTINCT FROM v_today_revenue THEN
    RAISE EXCEPTION 'Old purchase appeared as revenue today after an edit';
  END IF;
  IF (public.arena_period_metrics(v_purchase_start, v_purchase_end)->>'revenue')::numeric IS DISTINCT FROM v_purchase_revenue + 1 THEN
    RAISE EXCEPTION 'Edited value did not update the purchase period';
  END IF;
END $$;

SELECT jsonb_build_object('validation', 'passed', 'committed', false) AS result;
