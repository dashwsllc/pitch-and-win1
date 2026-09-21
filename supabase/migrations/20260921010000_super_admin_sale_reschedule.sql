-- Allow a Super Admin to correct the commercial date/time of a pending or
-- approved sale. The operation is atomic, concurrency-safe and fully audited.
BEGIN;

CREATE OR REPLACE FUNCTION public.dashboard_guard_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM public.dashboard_require_access();

  -- Only the dedicated RPC can alter created_at. It sets a transaction-local
  -- marker for this exact row, and every other sale field must remain equal.
  IF TG_OP = 'UPDATE'
    AND current_setting('dashboard.sale_reschedule', true) = OLD.id::text
    AND public.is_super_admin(auth.uid())
    AND NEW.created_at IS DISTINCT FROM OLD.created_at
    AND (to_jsonb(NEW) - 'created_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'created_at') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.crm_lead_id IS NULL
    AND OLD.crm_lead_id::text = current_setting('crm.lead_delete', true)
    AND (to_jsonb(NEW) - 'crm_lead_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'crm_lead_id') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE'
    AND OLD.approval_status = 'pendente'
    AND OLD.user_id = auth.uid()
    AND current_setting('dashboard.sale_decision', true) IS DISTINCT FROM OLD.id::text THEN
    INSERT INTO public.executive_audit_events(
      actor_id, actor_name, action, target_id, target_label, reason, before_data
    ) VALUES (
      auth.uid(),
      COALESCE((SELECT display_name FROM public.profiles WHERE user_id = auth.uid()), 'Seller'),
      'sale.cancel',
      OLD.id,
      OLD.nome_produto,
      'Solicitação pendente cancelada pelo Seller',
      to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (
      NEW.approval_status IS DISTINCT FROM OLD.approval_status OR
      NEW.commission_amount IS DISTINCT FROM OLD.commission_amount OR
      NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR
      NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
      NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason OR
      NEW.withdrawn IS DISTINCT FROM OLD.withdrawn OR
      NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id OR
      NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at OR
      OLD.approval_status <> 'pendente')) THEN
    IF NOT public.is_executive(auth.uid())
      OR current_setting('dashboard.sale_decision', true) IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'Utilize a revisão Executive para alterar ou excluir esta venda'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.user_id IS DISTINCT FROM OLD.user_id OR
    NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Seller e data de registro são imutáveis';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_reschedule_sale(
  p_sale_id uuid,
  p_created_at timestamptz,
  p_reason text,
  p_expected_created_at timestamptz,
  p_expected_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sale public.vendas;
  v_after public.vendas;
  v_actor text;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  PERFORM public.dashboard_require_access(true);

  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente o Super Admin pode remarcar a data de uma venda'
      USING ERRCODE = '42501';
  END IF;
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION 'Informe a nova data e horário da compra';
  END IF;
  IF p_created_at > clock_timestamp() THEN
    RAISE EXCEPTION 'A data da compra não pode estar no futuro';
  END IF;
  IF length(v_reason) < 5 OR length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Informe um motivo entre 5 e 2000 caracteres';
  END IF;

  SELECT * INTO v_sale
    FROM public.vendas
    WHERE id = p_sale_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada ou já excluída' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.approval_status NOT IN ('pendente', 'aprovada') THEN
    RAISE EXCEPTION 'Somente vendas pendentes ou aprovadas podem ser remarcadas';
  END IF;
  IF p_expected_status IS DISTINCT FROM v_sale.approval_status THEN
    RAISE EXCEPTION 'Esta venda foi alterada. Atualize a lista e tente novamente.'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_created_at IS DISTINCT FROM v_sale.created_at THEN
    RAISE EXCEPTION 'A data desta venda já foi alterada. Atualize a lista e confira o novo horário.'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_created_at IS NOT DISTINCT FROM v_sale.created_at THEN
    RAISE EXCEPTION 'Escolha uma data ou horário diferente do registro atual';
  END IF;

  SELECT COALESCE(display_name, 'Super Admin') INTO v_actor
    FROM public.profiles
    WHERE user_id = auth.uid();

  PERFORM set_config('dashboard.sale_reschedule', v_sale.id::text, true);
  UPDATE public.vendas
    SET created_at = p_created_at
    WHERE id = v_sale.id
    RETURNING * INTO v_after;
  PERFORM set_config('dashboard.sale_reschedule', '', true);

  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data
  ) VALUES (
    auth.uid(),
    COALESCE(v_actor, 'Super Admin'),
    'sale.reschedule',
    v_sale.id,
    v_sale.nome_produto,
    v_reason,
    jsonb_build_object(
      'created_at', v_sale.created_at,
      'approval_status', v_sale.approval_status,
      'seller_id', v_sale.user_id
    ),
    jsonb_build_object(
      'created_at', v_after.created_at,
      'approval_status', v_after.approval_status,
      'seller_id', v_after.user_id
    )
  );

  RETURN jsonb_build_object(
    'id', v_after.id,
    'created_at', v_after.created_at,
    'approval_status', v_after.approval_status
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('dashboard.sale_reschedule', '', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_guard_sale() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.super_admin_reschedule_sale(uuid, timestamptz, text, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_reschedule_sale(uuid, timestamptz, text, timestamptz, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
