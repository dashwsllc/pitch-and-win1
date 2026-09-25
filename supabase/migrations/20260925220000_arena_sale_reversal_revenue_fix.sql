-- arena_sale_event() computed the reversal's revenue_delta as
-- c.valor_venda-e.revenue_delta ("current price minus what was originally
-- counted"). For the common case — a sale reversed/deleted without ever
-- having its price edited — valor_venda still equals the original
-- revenue_delta, so this nets to exactly 0 instead of fully undoing the
-- counted revenue. The sale.approved event keeps counting its full amount
-- forever in arena_sale_facts (its "historical" branch), inflating
-- Faturamento by every such sale's value with no way to net it out — the
-- score side of the same line was already correct (-e.score_delta).
--
-- This fixes the trigger only, so it cannot recur. One sale already hit the
-- bug (sale.approved:49191f8f-7a89-4cba-87ea-72cebd111776, R$ 2997,00,
-- reversed with revenue_delta=0 instead of -2997): activity_feed is
-- append-only (arena_events_immutable blocks UPDATE/DELETE for everyone,
-- including migrations), so correcting that one historical row is a
-- separate, explicitly reviewed operation — not included here.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.arena_sale_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.activity_feed; c public.vendas; v_closer boolean;
BEGIN
 IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
 IF TG_OP<>'DELETE' AND c.approval_status='aprovada' AND (TG_OP='INSERT' OR OLD.approval_status<>'aprovada') THEN
   v_closer:=EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='closer');
   PERFORM public.arena_emit('sale.approved:'||c.id,'sale.approved',c.user_id,CASE WHEN v_closer THEN 'closer' ELSE 'seller' END,'vendas',c.id,
     COALESCE(c.reviewed_at,clock_timestamp()),CASE WHEN v_closer THEN public.arena_score_weight('sale.approved') ELSE 0 END,c.valor_venda,c.crm_lead_id,NULL,NULL,'live',c.reviewed_by);
 ELSIF TG_OP='UPDATE' AND OLD.approval_status='aprovada' AND NEW.approval_status='aprovada'
   AND ROW(OLD.user_id,OLD.valor_venda,OLD.nome_produto) IS DISTINCT FROM ROW(NEW.user_id,NEW.valor_venda,NEW.nome_produto) THEN
   v_closer:=EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='closer');
   PERFORM public.arena_emit('sale.updated:'||c.id||':'||gen_random_uuid(),'sale.updated',c.user_id,
     CASE WHEN v_closer THEN 'closer' ELSE 'seller' END,'vendas',c.id,
     COALESCE(c.updated_at,clock_timestamp()),0,0,c.crm_lead_id,NULL,NULL,'live',auth.uid());
 END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.approval_status='aprovada' AND NEW.approval_status<>'aprovada') THEN
   SELECT * INTO e FROM public.activity_feed WHERE event_key='sale.approved:'||c.id;
   IF e.id IS NOT NULL THEN
     -- Fully undo the originally counted revenue, not "current price minus
     -- original" — sale.updated never changes revenue_delta, so the original
     -- sale.approved event is always the single source of truth for how
     -- much revenue this sale ever contributed.
     PERFORM public.arena_emit('sale.reversed:'||c.id,'sale.reversed',e.responsible_id,e.responsible_role,'vendas',c.id,
       clock_timestamp(),-e.score_delta,-e.revenue_delta,e.lead_id,e.id,COALESCE(current_setting('arena.sale_reason',true),'Exclusão pelo fluxo administrativo'));
   END IF;
 END IF;
 RETURN NULL;
END $$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('sales','arena','goals');

NOTIFY pgrst, 'reload schema';
COMMIT;
