-- Roda dentro de uma transação e termina sempre em ROLLBACK (scripts/check-arena-posted-date-db.mjs): nenhuma venda,
-- evento ou auditoria é gravado. Verifica a regra "toda venda conta na data postada (vendas.created_at)" na Arena.
SELECT set_config('request.jwt.claim.sub', (
  SELECT r.user_id::text FROM public.user_roles r
  JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.role::text = 'super_admin' AND NOT p.suspended LIMIT 1
), true);

DO $$
DECLARE
  late public.vendas;
  s public.vendas;
  moved public.vendas;
  v_closer boolean;
  v_expected_weekly timestamptz;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_today_revenue numeric;
  v_posted_start timestamptz;
  v_posted_end timestamptz;
  v_posted_revenue numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No active Super Admin for verification'; END IF;

  -- 1) Aprovada bem depois de postada (o caso real de 06/10): a Arena conta na data postada, não na aprovação.
  SELECT * INTO late FROM public.vendas
    WHERE approval_status = 'aprovada' AND reviewed_at > created_at + interval '1 hour'
    ORDER BY reviewed_at DESC LIMIT 1;
  IF late.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.arena_sale_facts f
    WHERE f.sale_id = late.id AND f.active AND f.occurred_at = late.created_at AND f.occurred_at <> late.reviewed_at
  ) THEN
    RAISE EXCEPTION 'Arena credited a late-approved sale outside its posted date';
  END IF;

  -- 2) Todas as vendas ativas: o fato nasce sempre na data postada.
  IF EXISTS (
    SELECT 1 FROM public.arena_sale_facts f JOIN public.vendas v ON v.id = f.sale_id
    WHERE f.active AND f.occurred_at IS DISTINCT FROM v.created_at
  ) THEN
    RAISE EXCEPTION 'An active sale fact is not on its posted date';
  END IF;

  -- 3) Remarcar a data da compra move a venda para o período corrigido, na Arena também.
  SELECT * INTO s FROM public.vendas WHERE approval_status = 'aprovada' ORDER BY created_at DESC LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No approved sale for verification'; END IF;
  v_today_start := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_today_end := v_today_start + interval '1 day';
  PERFORM public.super_admin_reschedule_sale(
    s.id, s.created_at - interval '2 days',
    'Verificação transacional da data postada', s.created_at, s.approval_status
  );
  SELECT * INTO moved FROM public.vendas WHERE id = s.id;
  IF NOT EXISTS (
    SELECT 1 FROM public.arena_sale_facts f
    WHERE f.sale_id = s.id AND f.active AND f.occurred_at = moved.created_at AND f.revenue = moved.valor_venda
  ) THEN
    RAISE EXCEPTION 'Arena did not use the corrected posted date';
  END IF;

  -- 4) A regra do domingo para a segunda da meta semanal do Closer segue a data postada.
  v_closer := EXISTS (SELECT 1 FROM public.arena_sale_facts f WHERE f.sale_id = s.id AND f.responsible_role = 'closer');
  IF v_closer THEN
    v_expected_weekly := CASE
      WHEN EXTRACT(isodow FROM (moved.created_at AT TIME ZONE 'America/Sao_Paulo')) = 7
        THEN ((date_trunc('week', (moved.created_at AT TIME ZONE 'America/Sao_Paulo')) + interval '7 days') AT TIME ZONE 'America/Sao_Paulo')
      ELSE moved.created_at
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.arena_closer_weekly_sale_facts w WHERE w.sale_id = s.id AND w.weekly_credit_at = v_expected_weekly
    ) THEN
      RAISE EXCEPTION 'Weekly Closer credit did not follow the posted date';
    END IF;
  END IF;

  -- 5) Editar a venda atualiza o período em que ela foi postada e não cria venda nova hoje.
  v_posted_start := date_trunc('day', moved.created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_posted_end := v_posted_start + interval '1 day';
  v_today_revenue := (public.arena_period_metrics(v_today_start, v_today_end)->>'revenue')::numeric;
  v_posted_revenue := (public.arena_period_metrics(v_posted_start, v_posted_end)->>'revenue')::numeric;

  PERFORM set_config('dashboard.sale_edit', s.id::text, true);
  PERFORM set_config('dashboard.sale_decision', s.id::text, true);
  UPDATE public.vendas SET valor_venda = valor_venda + 1 WHERE id = s.id;
  PERFORM set_config('dashboard.sale_edit', '', true);
  PERFORM set_config('dashboard.sale_decision', '', true);

  IF NOT EXISTS (
    SELECT 1 FROM public.arena_sale_facts f JOIN public.vendas v ON v.id = f.sale_id
    WHERE f.sale_id = s.id AND f.active AND f.occurred_at = v.created_at
      AND f.occurred_at <> v.updated_at AND f.revenue = v.valor_venda
  ) THEN
    RAISE EXCEPTION 'Sale edit moved the fact to its updated date';
  END IF;
  IF (public.arena_period_metrics(v_today_start, v_today_end)->>'revenue')::numeric IS DISTINCT FROM v_today_revenue THEN
    RAISE EXCEPTION 'An old sale appeared as revenue today after an edit';
  END IF;
  IF (public.arena_period_metrics(v_posted_start, v_posted_end)->>'revenue')::numeric IS DISTINCT FROM v_posted_revenue + 1 THEN
    RAISE EXCEPTION 'Edited value did not update the posted period';
  END IF;
END $$;

SELECT jsonb_build_object('validation', 'passed', 'committed', false) AS result;
