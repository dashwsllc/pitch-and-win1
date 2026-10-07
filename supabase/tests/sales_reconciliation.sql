-- Read-only audit: every approved sale has exactly one matching fact; daily and monthly
-- dashboard aggregates reconcile with the source records. Repeatable read avoids races
-- with approvals arriving while the audit is running. No buyer details are returned.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  period record;
  expected_sales bigint;
  expected_revenue numeric;
  actual jsonb;
BEGIN
  IF EXISTS (
    SELECT v.id FROM public.vendas v
    LEFT JOIN public.arena_sale_facts f ON f.sale_id = v.id AND f.active
    WHERE v.approval_status = 'aprovada'
    GROUP BY v.id, v.user_id, v.created_at, v.valor_venda
    HAVING count(f.sale_id) <> 1
      OR bool_or(f.user_id IS DISTINCT FROM v.user_id
        OR f.occurred_at IS DISTINCT FROM v.created_at
        OR f.revenue IS DISTINCT FROM v.valor_venda)
  ) THEN
    RAISE EXCEPTION 'Approved sales and Arena disagree on count, seller, purchase date or value';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arena_sale_facts f
    LEFT JOIN public.vendas v ON v.id = f.sale_id
    WHERE f.active AND (v.id IS NULL OR v.approval_status <> 'aprovada')
  ) THEN
    RAISE EXCEPTION 'An unapproved or deleted sale still has active credit';
  END IF;

  FOR period IN
    WITH dates AS (
      SELECT created_at AS at FROM public.vendas
      UNION SELECT occurred_at FROM public.arena_sale_facts
    ), windows AS (
      SELECT DISTINCT date_trunc('day', at AT TIME ZONE 'America/Sao_Paulo') AS start_local,
        interval '1 day' AS duration FROM dates
      UNION
      SELECT DISTINCT date_trunc('month', at AT TIME ZONE 'America/Sao_Paulo'), interval '1 month' FROM dates
    )
    SELECT start_local AT TIME ZONE 'America/Sao_Paulo' AS starts_at,
      (start_local + duration) AT TIME ZONE 'America/Sao_Paulo' AS ends_at FROM windows
  LOOP
    SELECT count(*), coalesce(sum(valor_venda), 0) INTO expected_sales, expected_revenue
    FROM public.vendas WHERE approval_status = 'aprovada'
      AND created_at >= period.starts_at AND created_at < period.ends_at;
    actual := public.arena_period_metrics(period.starts_at, period.ends_at);
    IF (actual->>'sales')::bigint IS DISTINCT FROM expected_sales
      OR (actual->>'revenue')::numeric IS DISTINCT FROM expected_revenue THEN
      RAISE EXCEPTION 'Sales reconciliation failed for % to %', period.starts_at, period.ends_at;
    END IF;
  END LOOP;
END $$;

SELECT jsonb_build_object('validation', 'passed', 'read_only', true,
  'approved_sales', count(*) FILTER (WHERE approval_status = 'aprovada'),
  'approved_revenue', coalesce(sum(valor_venda) FILTER (WHERE approval_status = 'aprovada'), 0)) AS result
FROM public.vendas;
ROLLBACK;
