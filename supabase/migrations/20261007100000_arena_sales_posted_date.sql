-- Toda venda conta na data em que foi postada: vendas.created_at, a "data da compra" que o Super Admin pode corrigir
-- em "Remarcar data da compra". Essa é a regra do dono desde 2026-09-23 (commit 76e530b, migração
-- 20260924010000_sales_purchase_date_indicators.sql) e a que a Home, a Central Executive, a documentação e os avisos
-- da tela já seguem.
--
-- A migração 20260925190000_restore_sale_edit_history.sql a desfez só na Arena: voltou a creditar a venda no período
-- da última edição (COALESCE(updated_at, reviewed_at, created_at)). Como sales_set_revision grava updated_at a cada
-- UPDATE, aprovar, editar o valor, trocar o responsável, remarcar a data ou cancelar um saque faziam a venda "pular"
-- para agora na Arena (e na meta semanal do Closer), enquanto a Home a deixava no dia postado. Foi o que aconteceu com a
-- venda aprovada em 06/10 de uma compra postada em 02/10: a Arena a contou em 06/10 e a Home, em 02/10.
--
-- Só muda o ramo ativo da visão (venda ainda aprovada). O ramo histórico (venda que deixou de estar aprovada) segue
-- como está: a reversão grava o valor negativo, então ele soma zero, com a correção append-only de 25/09 por cima.
-- arena_closer_weekly_sale_facts é derivada desta visão e acompanha, inclusive a regra do domingo para a segunda.
-- Ciclos já encerrados não são recalculados; a venda postada numa semana que já fechou conta nessa semana, nunca na
-- semana aberta.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE VIEW public.arena_sale_facts AS
SELECT v.id sale_id,v.user_id,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer') THEN 'closer' ELSE 'seller' END responsible_role,
 v.created_at occurred_at,v.valor_venda::numeric revenue,true active
FROM public.vendas v WHERE v.approval_status='aprovada'
UNION ALL
SELECT a.source_id,COALESCE(r.responsible_id,a.responsible_id),COALESCE(r.responsible_role,a.responsible_role),
 a.occurred_at,a.revenue_delta+COALESCE(r.revenue_delta,0)+COALESCE(corr.total,0),false
FROM public.activity_feed a
LEFT JOIN public.activity_feed r ON r.reverses_id=a.id AND r.action_type='sale.reversed'
LEFT JOIN LATERAL (
  SELECT sum(c.revenue_delta) total FROM public.activity_feed c
  WHERE c.action_type='revenue.corrected' AND c.source_type='vendas' AND c.source_id=a.source_id
) corr ON true
WHERE a.action_type='sale.approved' AND a.source_type='vendas'
 AND NOT EXISTS(SELECT 1 FROM public.vendas v WHERE v.id=a.source_id AND v.approval_status='aprovada');
REVOKE ALL ON public.arena_sale_facts FROM PUBLIC,anon,authenticated;
COMMENT ON VIEW public.arena_sale_facts IS 'Fatos de venda da Arena. Venda ativa: occurred_at = vendas.created_at (a data postada, corrigível por super_admin_reschedule_sale). Nunca usar updated_at: ele muda a cada edição, aprovação ou remarcação e moveria a venda para agora.';

-- Painéis, rankings e metas abertas descartam os totais antigos.
UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('sales','arena','goals');
COMMIT;
