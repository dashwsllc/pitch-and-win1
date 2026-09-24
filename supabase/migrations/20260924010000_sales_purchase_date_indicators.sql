-- A sale's commercial period is its purchase date. Editing its value, owner,
-- or approval status must not make an older purchase appear as a new sale.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE VIEW public.arena_sale_facts AS
SELECT v.id sale_id, v.user_id,
 CASE WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v.user_id AND r.role::text = 'closer') THEN 'closer' ELSE 'seller' END responsible_role,
 v.created_at occurred_at, v.valor_venda revenue, true active
FROM public.vendas v WHERE v.approval_status = 'aprovada'
UNION ALL
SELECT a.source_id, COALESCE(r.responsible_id, a.responsible_id), COALESCE(r.responsible_role, a.responsible_role),
 a.occurred_at, a.revenue_delta + COALESCE(r.revenue_delta, 0), false
FROM public.activity_feed a
LEFT JOIN public.activity_feed r ON r.reverses_id = a.id AND r.action_type = 'sale.reversed'
WHERE a.action_type = 'sale.approved' AND a.source_type = 'vendas'
 AND NOT EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = a.source_id AND v.approval_status = 'aprovada');
REVOKE ALL ON public.arena_sale_facts FROM PUBLIC, anon, authenticated;

-- Signal mounted dashboards, rankings, and Arena to discard their old period
-- totals after this view changes.
UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp()
WHERE topic IN ('sales', 'arena', 'goals');

COMMIT;
