-- Run inside a transaction that always rolls back. Use an existing approved
-- Closer sale; no synthetic sale or customer record is committed.
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
  v_before numeric;
  v_after numeric;
  v_old_sales numeric;
  v_new_sales numeric;
  v_other uuid;
  v_revision bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No active Super Admin for rollback verification'; END IF;
  SELECT v.* INTO s FROM public.vendas v WHERE v.approval_status='aprovada'
    AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer')
    ORDER BY COALESCE(v.reviewed_at,v.created_at) DESC LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No approved Closer sale for rollback verification'; END IF;
  v_start:=s.created_at-interval '1 second';
  v_end:=s.created_at+interval '1 second';
  v_before:=(public.arena_period_metrics(v_start,v_end)->>'revenue')::numeric;
  SELECT (x->>'totalVendas')::numeric INTO v_old_sales
  FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
  WHERE x->>'user_id'=s.user_id::text;
  SELECT revision INTO v_revision FROM public.dashboard_events WHERE topic='sales';

  PERFORM set_config('dashboard.sale_edit',s.id::text,true);
  PERFORM set_config('dashboard.sale_decision',s.id::text,true);
  UPDATE public.vendas SET valor_venda=valor_venda+1 WHERE id=s.id;
  PERFORM set_config('dashboard.sale_edit','',true);
  PERFORM set_config('dashboard.sale_decision','',true);
  v_after:=(public.arena_period_metrics(v_start,v_end)->>'revenue')::numeric;
  IF v_after IS DISTINCT FROM v_before+1 THEN RAISE EXCEPTION 'Edited sale value did not reach Arena metrics'; END IF;
  SELECT (x->>'totalVendas')::numeric INTO v_new_sales
  FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
  WHERE x->>'user_id'=s.user_id::text;
  IF v_new_sales IS DISTINCT FROM v_old_sales+1 THEN RAISE EXCEPTION 'Edited sale value did not reach Closer ranking'; END IF;
  IF (SELECT revision FROM public.dashboard_events WHERE topic='sales')<=v_revision THEN
    RAISE EXCEPTION 'Sale edit did not move the sync revision';
  END IF;

  SELECT r.user_id INTO v_other FROM public.user_roles r
  JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.role::text='closer' AND r.user_id<>s.user_id AND NOT p.suspended
    AND NOT EXISTS(SELECT 1 FROM public.user_roles x WHERE x.user_id=r.user_id AND x.role::text='super_admin')
  ORDER BY r.user_id LIMIT 1;
  IF v_other IS NOT NULL THEN
    PERFORM set_config('dashboard.sale_edit',s.id::text,true);
    PERFORM set_config('dashboard.sale_decision',s.id::text,true);
    PERFORM set_config('dashboard.sale_reassign',s.id::text,true);
    UPDATE public.vendas SET user_id=v_other WHERE id=s.id;
    PERFORM set_config('dashboard.sale_edit','',true);
    PERFORM set_config('dashboard.sale_decision','',true);
    PERFORM set_config('dashboard.sale_reassign','',true);
    SELECT (x->>'quantidadeVendas')::numeric INTO v_new_sales
    FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
    WHERE x->>'user_id'=v_other::text;
    IF v_new_sales IS NULL OR v_new_sales<1 THEN RAISE EXCEPTION 'Reassigned sale did not reach new Closer'; END IF;
  END IF;

  PERFORM set_config('dashboard.sale_decision',s.id::text,true);
  UPDATE public.vendas SET approval_status='estornada' WHERE id=s.id;
  PERFORM set_config('dashboard.sale_decision','',true);
  IF (public.arena_period_metrics(v_start,v_end)->>'revenue')::numeric IS DISTINCT FROM v_after-(s.valor_venda+1) THEN
    RAISE EXCEPTION 'Reversed sale remains in active Arena revenue';
  END IF;
  IF EXISTS(SELECT 1 FROM public.arena_sale_facts WHERE sale_id=s.id AND active) THEN
    RAISE EXCEPTION 'Reversed sale still counted as active';
  END IF;
END $$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
