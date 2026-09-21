-- Runs against a linked database. Every test write is rolled back.
BEGIN;

DO $$
DECLARE
  v_sale public.vendas;
  v_after public.vendas;
  v_admin uuid;
  v_executive uuid;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles
    WHERE role::text = 'super_admin' LIMIT 1;
  SELECT user_id INTO v_executive FROM public.user_roles
    WHERE role::text = 'executive' AND user_id <> v_admin LIMIT 1;
  IF v_admin IS NULL OR v_executive IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vendas WHERE approval_status IN ('pendente', 'aprovada')
  ) THEN
    RAISE EXCEPTION 'Missing verification prerequisites';
  END IF;

  FOR v_sale IN SELECT DISTINCT ON (approval_status) * FROM public.vendas
    WHERE approval_status IN ('pendente', 'aprovada')
    ORDER BY approval_status, id LOOP
    PERFORM set_config('request.jwt.claim.sub', v_executive::text, true);
    v_denied := false;
    BEGIN
      PERFORM public.super_admin_reschedule_sale(
        v_sale.id, v_sale.created_at - interval '2 seconds',
        'Verificação transacional de permissão', v_sale.created_at, v_sale.approval_status
      );
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'Executive was allowed to reschedule'; END IF;

    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    v_denied := false;
    BEGIN
      UPDATE public.vendas SET created_at = v_sale.created_at - interval '2 seconds'
        WHERE id = v_sale.id;
    EXCEPTION WHEN OTHERS THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'Direct date update was allowed'; END IF;

    PERFORM public.super_admin_reschedule_sale(
      v_sale.id, v_sale.created_at - interval '2 seconds',
      'Verificação transacional de auditoria', v_sale.created_at, v_sale.approval_status
    );
    SELECT * INTO v_after FROM public.vendas WHERE id = v_sale.id;
    IF v_after.created_at IS DISTINCT FROM v_sale.created_at - interval '2 seconds'
      OR v_after.reviewed_at IS DISTINCT FROM v_sale.reviewed_at
      OR v_after.approval_status IS DISTINCT FROM v_sale.approval_status THEN
      RAISE EXCEPTION 'Sale correction modified unexpected fields';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.executive_audit_events
        WHERE target_id = v_sale.id AND action = 'sale.reschedule'
          AND reason = 'Verificação transacional de auditoria'
    ) THEN
      RAISE EXCEPTION 'Reschedule audit was not recorded';
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;
SELECT 'PASS: permissions, guarded update, correction and audit verified; transaction rolled back' AS result;
