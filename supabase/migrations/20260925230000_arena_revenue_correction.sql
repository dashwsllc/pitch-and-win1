-- Fixes the ghost R$ 2997,00 left by the bug corrected in
-- 20260925220000_arena_sale_reversal_revenue_fix.sql, without touching
-- activity_feed's history: arena_events_immutable blocks UPDATE/DELETE on
-- that table for everyone by design, so the fix is a new, append-only
-- correction event (same non-destructive pattern already used by
-- arena_adjust_score for scoring corrections), never an edit of the
-- existing wrong row.
--
-- arena_sale_facts learns to fold 'revenue.corrected' events (keyed by
-- source_id = the sale's id) into its historical branch, and a new
-- admin-only, audited RPC lets this be done again in the future without a
-- migration. Only the historical (already-settled, no-longer-approved)
-- branch reads corrections; an active approved sale's value is edited
-- through the existing sale-edit flow instead.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE VIEW public.arena_sale_facts AS
SELECT v.id sale_id,v.user_id,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer') THEN 'closer' ELSE 'seller' END responsible_role,
 COALESCE(v.updated_at,v.reviewed_at,v.created_at) occurred_at,v.valor_venda::numeric revenue,true active
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

CREATE OR REPLACE FUNCTION public.arena_correct_sale_revenue(p_sale_id uuid, p_delta numeric, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.activity_feed;
BEGIN
  IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_delta IS NULL OR p_delta=0 OR abs(p_delta)>100000 OR length(btrim(COALESCE(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'Informe o valor e o motivo da correção';
  END IF;
  SELECT * INTO a FROM public.activity_feed WHERE source_id=p_sale_id AND source_type='vendas' AND action_type='sale.approved';
  IF a.id IS NULL THEN RAISE EXCEPTION 'Nenhuma venda aprovada encontrada para este id' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.vendas WHERE id=p_sale_id AND approval_status='aprovada') THEN
    RAISE EXCEPTION 'Venda ainda aprovada: edite pelo fluxo normal de vendas, não por aqui' USING ERRCODE='PT409';
  END IF;
  PERFORM public.arena_emit('revenue-correction:'||p_sale_id||':'||gen_random_uuid(),'revenue.corrected',
    a.responsible_id,a.responsible_role,'vendas',p_sale_id,clock_timestamp(),0,p_delta,a.lead_id,NULL,btrim(p_reason));
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,after_data)
  VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'arena.revenue_correction',p_sale_id,
    COALESCE(a.entity_title,'Venda'),btrim(p_reason),jsonb_build_object('delta',p_delta));
END $$;
REVOKE ALL ON FUNCTION public.arena_correct_sale_revenue(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_correct_sale_revenue(uuid,numeric,text) TO authenticated;

-- One-time, system-initiated fix for the one sale already affected by the
-- bug (approved R$ 2997,00, reversed with revenue_delta=0 instead of
-- -2997.00). Calls arena_emit directly rather than the RPC above: this runs
-- as the migration itself, with no authenticated session for
-- arena_has_access(true) to check, and this exact correction is reviewed
-- here in the migration instead.
DO $fix$
DECLARE a public.activity_feed;
BEGIN
  SELECT * INTO a FROM public.activity_feed
  WHERE source_id='49191f8f-7a89-4cba-87ea-72cebd111776' AND source_type='vendas' AND action_type='sale.approved';
  IF a.id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.activity_feed WHERE action_type='revenue.corrected' AND source_type='vendas' AND source_id=a.source_id
  ) THEN
    PERFORM public.arena_emit(
      'revenue-correction:'||a.source_id||':initial','revenue.corrected',
      a.responsible_id,a.responsible_role,'vendas',a.source_id,clock_timestamp(),0,-a.revenue_delta,a.lead_id,NULL,
      'Corrige o fantasma de R$ 2997,00: a reversão desta venda (evento sale.reversed) gravou revenue_delta=0 em vez de -2997.00, pelo bug corrigido em 20260925220000_arena_sale_reversal_revenue_fix.sql',
      'live',NULL
    );
    INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
    VALUES(NULL,'Migration 20260925230000','arena.revenue_correction',a.source_id,COALESCE(a.entity_title,'Venda'),
      'Corrige o fantasma de R$ 2997,00 no Faturamento, autorizado explicitamente pelo usuário em conversa',
      jsonb_build_object('revenue_delta',0),jsonb_build_object('revenue_delta',-a.revenue_delta));
  END IF;
END
$fix$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('sales','arena','goals');

NOTIFY pgrst, 'reload schema';
COMMIT;
