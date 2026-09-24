-- Arena revenue follows currently approved sales. The immutable activity_feed
-- still preserves approvals, reversals, amounts and reasons for audit.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE VIEW public.arena_sale_facts AS
SELECT v.id sale_id, v.user_id,
  CASE WHEN EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = v.user_id AND r.role::text = 'closer'
  ) THEN 'closer' ELSE 'seller' END responsible_role,
  v.created_at occurred_at, v.valor_venda::numeric revenue, true active
FROM public.vendas v
WHERE v.approval_status = 'aprovada';
REVOKE ALL ON public.arena_sale_facts FROM PUBLIC, anon, authenticated;

UPDATE public.dashboard_events
SET revision = revision + 1, updated_at = clock_timestamp()
WHERE topic IN ('sales', 'arena', 'goals');
COMMIT;
