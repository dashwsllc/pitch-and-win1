-- An approved sale belongs to its current owner and to the period of its
-- latest edit. This moves reassigned sales into today's ranking and open goal.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE VIEW public.arena_sale_facts AS
SELECT v.id sale_id,v.user_id,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer') THEN 'closer' ELSE 'seller' END responsible_role,
 COALESCE(v.updated_at,v.reviewed_at,v.created_at) occurred_at,v.valor_venda revenue,true active
FROM public.vendas v WHERE v.approval_status='aprovada'
UNION ALL
SELECT a.source_id,COALESCE(r.responsible_id,a.responsible_id),COALESCE(r.responsible_role,a.responsible_role),
 a.occurred_at,a.revenue_delta+COALESCE(r.revenue_delta,0),false
FROM public.activity_feed a
LEFT JOIN public.activity_feed r ON r.reverses_id=a.id AND r.action_type='sale.reversed'
WHERE a.action_type='sale.approved' AND a.source_type='vendas'
 AND NOT EXISTS(SELECT 1 FROM public.vendas v WHERE v.id=a.source_id AND v.approval_status='aprovada');
REVOKE ALL ON public.arena_sale_facts FROM PUBLIC,anon,authenticated;

-- Keep the approval ledger immutable, but show later owner/value edits in the
-- Arena feed under the current responsible person without awarding extra points.
CREATE OR REPLACE FUNCTION public.arena_sale_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.activity_feed; c public.vendas; v_closer boolean;
BEGIN
 IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
 IF TG_OP<>'DELETE' AND c.approval_status='aprovada' AND (TG_OP='INSERT' OR OLD.approval_status<>'aprovada') THEN
   v_closer:=EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='closer');
   PERFORM public.arena_emit('sale.approved:'||c.id,'sale.approved',c.user_id,CASE WHEN v_closer THEN 'closer' ELSE 'seller' END,'vendas',c.id,
     COALESCE(c.reviewed_at,clock_timestamp()),CASE WHEN v_closer THEN 10 ELSE 0 END,c.valor_venda,c.crm_lead_id,NULL,NULL,'live',c.reviewed_by);
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
     PERFORM public.arena_emit('sale.reversed:'||c.id,'sale.reversed',e.responsible_id,e.responsible_role,'vendas',c.id,
       clock_timestamp(),-e.score_delta,c.valor_venda-e.revenue_delta,e.lead_id,e.id,COALESCE(current_setting('arena.sale_reason',true),'Exclusão pelo fluxo administrativo'));
   END IF;
 END IF;
 RETURN NULL;
END $$;

-- The view correction also needs to reach dashboards already open today.
UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp()
WHERE topic IN ('sales','arena');

COMMIT;
