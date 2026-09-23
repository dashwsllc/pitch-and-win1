-- Run in a transaction that always rolls back; no commercial edit is saved.
SELECT set_config('request.jwt.claim.sub',(
  SELECT r.user_id::text FROM public.user_roles r
  JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.role::text='super_admin' AND NOT p.suspended LIMIT 1
),true);

DO $$
DECLARE
  s public.vendas;
  v_start timestamptz;
  v_end timestamptz;
  v_sales numeric;
  v_revenue numeric;
  v_score numeric;
  v_revision bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No active Super Admin for verification'; END IF;
  SELECT * INTO s FROM public.vendas WHERE id='8820534c-ae72-452d-8d57-3a95a04842f2';
  IF s.id IS NULL OR s.approval_status<>'aprovada' THEN RAISE EXCEPTION 'David sale is missing or unapproved'; END IF;
  IF s.user_id<>'0fbdb2c5-adb7-4379-9cf1-14fe60417e2a' THEN RAISE EXCEPTION 'David is not the current owner'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_sale_facts f WHERE f.sale_id=s.id
      AND f.user_id=s.user_id AND f.occurred_at=s.updated_at AND f.revenue=s.valor_venda AND f.active) THEN
    RAISE EXCEPTION 'Arena sale fact still uses stale date, owner, or value';
  END IF;
  v_start:=date_trunc('day',s.updated_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_end:=v_start+interval '1 day';
  SELECT (x->>'quantidadeVendas')::numeric,(x->>'totalVendas')::numeric,(x->>'score')::numeric
    INTO v_sales,v_revenue,v_score
    FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
    WHERE x->>'user_id'=s.user_id::text;
  IF v_sales<1 OR v_revenue<s.valor_venda OR v_score<10 THEN
    RAISE EXCEPTION 'David sale did not reach Arena ranking for the updated day';
  END IF;
  SELECT revision INTO v_revision FROM public.dashboard_events WHERE topic='sales';
  PERFORM set_config('dashboard.sale_edit',s.id::text,true);
  PERFORM set_config('dashboard.sale_decision',s.id::text,true);
  UPDATE public.vendas SET valor_venda=valor_venda+1 WHERE id=s.id;
  PERFORM set_config('dashboard.sale_edit','',true);
  PERFORM set_config('dashboard.sale_decision','',true);
  IF NOT EXISTS(SELECT 1 FROM public.arena_sale_facts f JOIN public.vendas v ON v.id=f.sale_id
      WHERE f.sale_id=s.id AND f.occurred_at=v.updated_at AND f.revenue=v.valor_venda) THEN
    RAISE EXCEPTION 'New edit did not reach Arena fact';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.source_id=s.id AND f.action_type='sale.updated'
      AND f.responsible_id=s.user_id AND f.score_delta=0 AND f.revenue_delta=0) THEN
    RAISE EXCEPTION 'New edit did not reach Arena feed';
  END IF;
  IF (SELECT revision FROM public.dashboard_events WHERE topic='sales')<=v_revision THEN
    RAISE EXCEPTION 'New edit did not signal an automatic refresh';
  END IF;
END $$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
