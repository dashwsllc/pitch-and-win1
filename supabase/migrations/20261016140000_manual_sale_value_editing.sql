-- Align editing with manual BRL sale registration. Keep approval, ownership, stale-write,
-- withdrawal, frozen commission, balance, audit and realtime protections unchanged.
-- Reversible by restoring the prior manage_sale definition; no stored data is rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.manage_sale(p_sale_id uuid, p_action text, p_expected_updated_at timestamp with time zone, p_data jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT ''::text)
 RETURNS vendas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  s public.vendas;
  d public.vendas;
  result public.vendas;
  v_exec boolean;
  v_financial boolean;
  v_owner_changed boolean;
  v_product public.products;
  v_ticket public.product_tickets;
  v_commission numeric;
  v_rate numeric;
  v_total numeric;
  v_committed numeric;
  v_new_user_id uuid;
  v_old_name text;
  v_new_name text;
  v_old_lock bigint;
  v_new_lock bigint;
  v_audit_reason text;
BEGIN
  PERFORM public.dashboard_require_access();
  v_exec := public.is_executive(auth.uid());
  IF NOT public.registration_has_access() THEN
    RAISE EXCEPTION 'Cadastro sem acesso aprovado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO s FROM public.vendas WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda nao encontrada ou ja excluida' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_exec AND (
    s.user_id IS DISTINCT FROM auth.uid() OR
    s.approval_status <> 'pendente' OR
    NOT public.crm_can('sales')
  ) THEN
    RAISE EXCEPTION 'Voce pode gerenciar somente suas vendas pendentes. Vendas aprovadas sao gerenciadas pela administracao.'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_new_user_id := CASE
      WHEN p_action = 'edit' AND p_data ? 'user_id' THEN (p_data->>'user_id')::uuid
      ELSE s.user_id
    END;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Responsavel pela venda invalido' USING ERRCODE = '22023';
  END;
  IF v_new_user_id IS NULL THEN
    RAISE EXCEPTION 'Selecione quem realizou a venda' USING ERRCODE = '22023';
  END IF;

  -- Lock both ledgers in a stable order so opposite reassignments cannot deadlock.
  v_old_lock := hashtextextended(s.user_id::text, 42);
  v_new_lock := hashtextextended(v_new_user_id::text, 42);
  PERFORM pg_advisory_xact_lock(least(v_old_lock, v_new_lock));
  IF v_new_lock <> v_old_lock THEN
    PERFORM pg_advisory_xact_lock(greatest(v_old_lock, v_new_lock));
  END IF;

  SELECT * INTO s FROM public.vendas WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda nao encontrada ou ja excluida' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS DISTINCT FROM s.updated_at THEN
    RAISE EXCEPTION 'Esta venda foi alterada. Feche a janela, atualize a lista e confira antes de tentar novamente.'
      USING ERRCODE = 'PT409';
  END IF;
  IF NOT v_exec AND s.approval_status <> 'pendente' THEN
    RAISE EXCEPTION 'Venda ja revisada pela administracao.' USING ERRCODE = 'PT409';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('edit', 'delete') THEN
    RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'delete' THEN
    IF v_exec THEN
      PERFORM public.executive_review_sale(s.id, 'delete', p_reason, s.approval_status);
    ELSE
      DELETE FROM public.vendas WHERE id = s.id;
    END IF;
    RETURN s;
  END IF;

  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN (
      'user_id', 'product_id', 'ticket_id', 'valor_venda', 'nome_comprador',
      'email_comprador', 'whatsapp_comprador', 'consideracoes_gerais'
    )
  ) THEN
    RAISE EXCEPTION 'Campos de edicao invalidos' USING ERRCODE = '22023';
  END IF;
  IF p_data ? 'valor_venda' AND (
    (p_data->>'valor_venda')::numeric IS NULL OR
    (p_data->>'valor_venda')::numeric <> round((p_data->>'valor_venda')::numeric, 2)
  ) THEN
    RAISE EXCEPTION 'Informe o valor com ate duas casas decimais.' USING ERRCODE = '22023';
  END IF;

  d := jsonb_populate_record(s, p_data);
  v_owner_changed := d.user_id IS DISTINCT FROM s.user_id;
  IF v_owner_changed THEN
    IF NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Somente o Super Admin pode alterar quem realizou a venda'
        USING ERRCODE = '42501';
    END IF;
    IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
      RAISE EXCEPTION 'Informe o motivo da alteracao do responsavel (entre 5 e 2000 caracteres)'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = d.user_id
        AND NOT p.suspended
        AND EXISTS (
          SELECT 1 FROM public.user_roles r
          WHERE r.user_id = p.user_id
            AND r.role::text IN ('seller', 'closer', 'executive', 'super_admin')
        )
    ) THEN
      RAISE EXCEPTION 'Selecione uma conta ativa com permissao para registrar vendas'
        USING ERRCODE = '22023';
    END IF;
    IF s.withdrawn OR s.withdrawal_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.saques
      WHERE s.id = ANY(vendas_incluidas)
        AND status NOT IN ('rejeitado', 'cancelado')
    ) THEN
      RAISE EXCEPTION 'Regularize o saque vinculado antes de alterar o responsavel pela venda'
        USING ERRCODE = 'PT409';
    END IF;
  END IF;

  IF length(btrim(COALESCE(d.nome_comprador, ''))) NOT BETWEEN 2 AND 160
    OR length(btrim(COALESCE(d.email_comprador, ''))) > 254
    OR (btrim(COALESCE(d.email_comprador, '')) <> ''
      AND btrim(d.email_comprador) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    OR length(btrim(COALESCE(d.whatsapp_comprador, ''))) NOT BETWEEN 8 AND 32
    OR length(COALESCE(d.consideracoes_gerais, '')) > 10000 THEN
    RAISE EXCEPTION 'Confira o nome, e-mail, WhatsApp e observacoes do comprador.'
      USING ERRCODE = '22023';
  END IF;
  IF d.valor_venda IS NULL OR d.valor_venda <= 0 OR d.valor_venda > 100000000
    OR d.valor_venda::text IN ('NaN', 'Infinity', '-Infinity')
    OR round(d.valor_venda, 2) <> d.valor_venda THEN
    RAISE EXCEPTION 'Informe um valor positivo, com ate duas casas decimais.' USING ERRCODE = '22023';
  END IF;

  v_financial := d.product_id IS DISTINCT FROM s.product_id
    OR d.ticket_id IS DISTINCT FROM s.ticket_id
    OR d.valor_venda IS DISTINCT FROM s.valor_venda;
  IF v_financial THEN
    IF s.withdrawn OR s.withdrawal_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.saques
      WHERE s.id = ANY(vendas_incluidas)
        AND status NOT IN ('rejeitado', 'cancelado')
    ) THEN
      RAISE EXCEPTION 'Regularize o saque vinculado antes de alterar produto ou valor.'
        USING ERRCODE = 'PT409';
    END IF;
    -- Preserve historical catalog metadata during value-only corrections.
    IF d.product_id IS DISTINCT FROM s.product_id OR d.ticket_id IS DISTINCT FROM s.ticket_id THEN
      IF d.ticket_id IS NOT NULL THEN
        SELECT * INTO v_ticket FROM public.product_tickets WHERE id = d.ticket_id FOR SHARE;
        IF v_ticket.id IS NULL OR NOT v_ticket.active THEN
          RAISE EXCEPTION 'Ticket nao esta disponivel. Atualize o catalogo.' USING ERRCODE = '22023';
        END IF;
        d.product_id := COALESCE(d.product_id, v_ticket.product_id);
      END IF;
      IF d.product_id IS NOT NULL THEN
        SELECT * INTO v_product FROM public.products WHERE id = d.product_id FOR SHARE;
        IF v_product.id IS NULL OR NOT v_product.active
          OR (v_ticket.id IS NOT NULL AND v_ticket.product_id IS DISTINCT FROM d.product_id) THEN
          RAISE EXCEPTION 'Produto ou ticket nao esta disponivel. Atualize o catalogo.' USING ERRCODE = '22023';
        END IF;
      END IF;
      d.nome_produto := COALESCE(v_product.name, NULLIF(btrim(d.nome_produto), ''), 'Produto não informado');
      d.ticket_name := v_ticket.name;
    END IF;
  END IF;

  v_commission := COALESCE(s.commission_amount, 0);
  d.commission_rate_applied := s.commission_rate_applied;
  IF s.approval_status = 'aprovada' AND v_owner_changed THEN
    SELECT COALESCE(commission_rate, 0) INTO v_rate
      FROM public.user_roles
      WHERE user_id = d.user_id
      ORDER BY updated_at DESC, id
      LIMIT 1;
    v_rate := COALESCE(v_rate, 0);
    v_commission := round(d.valor_venda * v_rate / 100, 2);
    d.commission_rate_applied := v_rate;

    SELECT COALESCE(sum(commission_amount), 0) INTO v_total
      FROM public.vendas
      WHERE user_id = s.user_id AND approval_status = 'aprovada' AND id <> s.id;
    SELECT COALESCE(sum(COALESCE(valor_aprovado, valor_solicitado)), 0) INTO v_committed
      FROM public.saques
      WHERE user_id = s.user_id AND status IN ('pendente', 'processando', 'aprovado', 'pago');
    IF v_total < v_committed THEN
      RAISE EXCEPTION 'A comissao desta venda esta comprometida com saques. Regularize-os antes de trocar o responsavel.'
        USING ERRCODE = 'PT409';
    END IF;
  ELSIF s.approval_status = 'aprovada' AND d.valor_venda IS DISTINCT FROM s.valor_venda THEN
    v_commission := round(
      d.valor_venda * COALESCE(
        s.commission_rate_applied,
        COALESCE(s.commission_amount, 0) * 100 / NULLIF(s.valor_venda, 0)
      ) / 100,
      2
    );
    SELECT COALESCE(sum(commission_amount), 0) + v_commission INTO v_total
      FROM public.vendas
      WHERE user_id = s.user_id AND approval_status = 'aprovada' AND id <> s.id;
    SELECT COALESCE(sum(COALESCE(valor_aprovado, valor_solicitado)), 0) INTO v_committed
      FROM public.saques
      WHERE user_id = s.user_id AND status IN ('pendente', 'processando', 'aprovado', 'pago');
    IF v_total < v_committed THEN
      RAISE EXCEPTION 'A comissao esta comprometida com saques. Regularize-os antes de reduzir o valor.'
        USING ERRCODE = 'PT409';
    END IF;
  END IF;

  PERFORM set_config('dashboard.sale_edit', s.id::text, true);
  IF v_exec THEN
    PERFORM set_config('dashboard.sale_decision', s.id::text, true);
  END IF;
  IF v_owner_changed THEN
    PERFORM set_config('dashboard.sale_reassign', s.id::text, true);
  END IF;

  UPDATE public.vendas SET
    user_id = d.user_id,
    product_id = d.product_id,
    ticket_id = d.ticket_id,
    nome_produto = d.nome_produto,
    ticket_name = d.ticket_name,
    valor_venda = d.valor_venda,
    commission_amount = v_commission,
    commission_rate_applied = d.commission_rate_applied,
    nome_comprador = btrim(d.nome_comprador),
    email_comprador = btrim(COALESCE(d.email_comprador, '')),
    whatsapp_comprador = btrim(d.whatsapp_comprador),
    consideracoes_gerais = NULLIF(btrim(d.consideracoes_gerais), '')
    WHERE id = s.id
    RETURNING * INTO result;

  PERFORM set_config('dashboard.sale_edit', '', true);
  PERFORM set_config('dashboard.sale_decision', '', true);
  PERFORM set_config('dashboard.sale_reassign', '', true);

  SELECT display_name INTO v_old_name FROM public.profiles WHERE user_id = s.user_id;
  SELECT display_name INTO v_new_name FROM public.profiles WHERE user_id = result.user_id;
  v_audit_reason := CASE WHEN v_owner_changed
    THEN 'Responsavel alterado de ' || COALESCE(v_old_name, 'Usuario anterior') || ' para '
      || COALESCE(v_new_name, 'Novo usuario') || ': ' || btrim(p_reason)
    ELSE 'Venda editada no modulo Vendas'
  END;
  INSERT INTO public.executive_audit_events(
    actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data
  ) VALUES (
    auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE user_id = auth.uid()), 'Usuario'),
    CASE WHEN v_owner_changed THEN 'sale.reassign' ELSE 'sale.edit' END,
    s.id,
    result.nome_produto,
    v_audit_reason,
    to_jsonb(s),
    to_jsonb(result)
  );
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('dashboard.sale_edit', '', true);
  PERFORM set_config('dashboard.sale_decision', '', true);
  PERFORM set_config('dashboard.sale_reassign', '', true);
  RAISE;
END;
$function$;

COMMIT;
