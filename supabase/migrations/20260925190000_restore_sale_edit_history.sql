-- Restores the behavior from 20260923170000_arena_sale_updated_date.sql,
-- which 20260924180000_arena_active_revenue.sql silently undid a few hours
-- later: an approved sale is credited to the period of its latest edit
-- (COALESCE(updated_at,reviewed_at,created_at)) instead of always created_at,
-- and a later-reversed sale keeps appearing in the historical window it
-- originally occurred in (as an inactive row) instead of vanishing
-- retroactively from past-period Arena queries. arena_sale_event() itself was
-- never reverted (it already emits sale.reversed with the correct historical
-- credit), so only the view needs restoring. arena_closer_weekly_sale_facts
-- already filters WHERE active, so this has no effect on Closer scoring or
-- ranking — only ad-hoc period queries (chart, "30 dias" filter, global
-- monthly goal actual) regain their historical accuracy.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE VIEW public.arena_sale_facts AS
SELECT v.id sale_id,v.user_id,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer') THEN 'closer' ELSE 'seller' END responsible_role,
 COALESCE(v.updated_at,v.reviewed_at,v.created_at) occurred_at,v.valor_venda::numeric revenue,true active
FROM public.vendas v WHERE v.approval_status='aprovada'
UNION ALL
SELECT a.source_id,COALESCE(r.responsible_id,a.responsible_id),COALESCE(r.responsible_role,a.responsible_role),
 a.occurred_at,a.revenue_delta+COALESCE(r.revenue_delta,0),false
FROM public.activity_feed a
LEFT JOIN public.activity_feed r ON r.reverses_id=a.id AND r.action_type='sale.reversed'
WHERE a.action_type='sale.approved' AND a.source_type='vendas'
 AND NOT EXISTS(SELECT 1 FROM public.vendas v WHERE v.id=a.source_id AND v.approval_status='aprovada');
REVOKE ALL ON public.arena_sale_facts FROM PUBLIC,anon,authenticated;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('sales','arena','goals');
COMMIT;
