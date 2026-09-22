-- Allow a Super Admin to correct who made a sale. Reassignment updates
-- attribution, commission, balances and every dashboard consumer atomically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.sales_set_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF TG_OP = 'INSERT' THEN
    NEW.commission_rate_applied := NULL;
  ELSIF NEW.approval_status = 'aprovada' AND OLD.approval_status <> 'aprovada' THEN
    SELECT COALESCE(commission_rate, 0) INTO NEW.commission_rate_applied
      FROM public.user_roles
      WHERE user_id = NEW.user_id
      ORDER BY updated_at DESC, id
      LIMIT 1;
    NEW.commission_rate_applied := COALESCE(NEW.commission_rate_applied, 0);
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id
    AND current_setting('dashboard.sale_reassign', true) = OLD.id::text THEN
    -- manage_sale already selected and froze the new responsible person's rate.
    NEW.commission_rate_applied := CASE
      WHEN NEW.approval_status = 'aprovada' THEN COALESCE(NEW.commission_rate_applied, 0)
      ELSE NULL
    END;
  ELSE
    NEW.commission_rate_applied := COALESCE(
      OLD.commission_rate_applied,
      CASE WHEN OLD.approval_status = 'aprovada'
        THEN COALESCE(OLD.commission_amount, 0) * 100 / NULLIF(OLD.valor_venda, 0)
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

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
      'Solicitacao pendente cancelada pelo Seller',
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
      RAISE EXCEPTION 'Utilize a revisao Executive para alterar ou excluir esta venda'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    (NEW.user_id IS DISTINCT FROM OLD.user_id AND (
      NOT public.is_super_admin(auth.uid()) OR
      current_setting('dashboard.sale_reassign', true) IS DISTINCT FROM OLD.id::text
    ))) THEN
    RAISE EXCEPTION 'Responsavel e data de registro so podem ser alterados pelo fluxo administrativo';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_commission_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.dashboard_refresh_balance(OLD.user_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    PERFORM public.dashboard_refresh_balance(OLD.user_id);
    PERFORM public.dashboard_refresh_balance(NEW.user_id);
  ELSE
    PERFORM public.dashboard_refresh_balance(NEW.user_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_sale(
  p_sale_id uuid,
  p_action text,
  p_expected_updated_at timestamptz,
  p_data jsonb DEFAULT '{}',
  p_reason text DEFAULT ''
) RETURNS public.vendas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
    OR length(btrim(COALESCE(d.email_comprador, ''))) NOT BETWEEN 3 AND 254
    OR btrim(d.email_comprador) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(btrim(COALESCE(d.whatsapp_comprador, ''))) NOT BETWEEN 5 AND 32
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
    SELECT * INTO v_product FROM public.products WHERE id = d.product_id FOR SHARE;
    SELECT * INTO v_ticket FROM public.product_tickets WHERE id = d.ticket_id FOR SHARE;
    IF v_product.id IS NULL OR NOT v_product.active OR v_ticket.id IS NULL OR NOT v_ticket.active
      OR v_ticket.product_id IS DISTINCT FROM d.product_id THEN
      RAISE EXCEPTION 'Selecione um produto e um ticket ativos.' USING ERRCODE = '22023';
    END IF;
    IF NOT v_exec AND d.valor_venda IS DISTINCT FROM v_ticket.price THEN
      RAISE EXCEPTION 'O valor deve corresponder ao ticket. Confira o catalogo atualizado.'
        USING ERRCODE = '22023';
    END IF;
    d.nome_produto := v_product.name;
    d.ticket_name := v_ticket.name;
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
    email_comprador = btrim(d.email_comprador),
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
$$;

-- Include the revision timestamp in the executive board so optimistic
-- concurrency also protects reassignment from that screen.
CREATE OR REPLACE FUNCTION public.get_sales_board(
  p_status text DEFAULT 'pendente',
  p_search text DEFAULT '',
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_result jsonb; v_exec boolean;
BEGIN
  PERFORM public.dashboard_require_access();
  v_exec := public.is_executive(auth.uid());
  IF p_status NOT IN ('pendente', 'aprovada', 'rejeitada', 'all')
    OR (p_status = 'rejeitada' AND NOT v_exec) THEN
    RAISE EXCEPTION 'Filtro invalido';
  END IF;
  WITH base AS (
    SELECT v.*, COALESCE(p.display_name, 'Vendedor') AS seller_name,
      p.avatar_url AS seller_avatar,
      COALESCE(r.display_name, 'Executivo') AS reviewer_name
    FROM public.vendas v
    LEFT JOIN public.profiles p ON p.user_id = v.user_id
    LEFT JOIN public.profiles r ON r.user_id = v.reviewed_by
    WHERE (v_exec OR v.approval_status IN ('pendente', 'aprovada'))
      AND (
        COALESCE(p_search, '') = '' OR
        strpos(lower(COALESCE(p.display_name, '') || ' ' || v.nome_produto || ' ' || COALESCE(v.ticket_name, '')), lower(p_search)) > 0
      )
  ), filtered AS (
    SELECT * FROM base WHERE p_status = 'all' OR approval_status = p_status
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN p_status = 'pendente' THEN created_at END ASC,
      CASE WHEN p_status = 'aprovada' THEN COALESCE(reviewed_at, created_at) ELSE created_at END DESC,
      id
      LIMIT greatest(1, least(COALESCE(p_page_size, 12), 50))
      OFFSET greatest(0, COALESCE(p_page, 0)) * greatest(1, least(COALESCE(p_page_size, 12), 50))
  ) SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'user_id', user_id,
        'seller_name', seller_name,
        'seller_avatar', seller_avatar,
        'nome_produto', nome_produto,
        'ticket_name', ticket_name,
        'valor_venda', valor_venda,
        'approval_status', approval_status,
        'created_at', created_at,
        'reviewed_at', reviewed_at
      ) || CASE WHEN v_exec THEN jsonb_build_object(
        'updated_at', updated_at,
        'nome_comprador', nome_comprador,
        'email_comprador', email_comprador,
        'whatsapp_comprador', whatsapp_comprador,
        'commission_amount', commission_amount,
        'rejection_reason', rejection_reason,
        'reviewer_name', reviewer_name,
        'withdrawn', withdrawn,
        'withdrawal_id', withdrawal_id,
        'consideracoes_gerais', consideracoes_gerais
      ) ELSE '{}'::jsonb END
    ) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'summary', (SELECT jsonb_build_object(
      'pending', count(*) FILTER (WHERE approval_status = 'pendente'),
      'approved', count(*) FILTER (WHERE approval_status = 'aprovada'),
      'rejected', count(*) FILTER (WHERE approval_status = 'rejeitada'),
      'pending_value', COALESCE(sum(valor_venda) FILTER (WHERE approval_status = 'pendente'), 0),
      'approved_value', COALESCE(sum(valor_venda) FILTER (WHERE approval_status = 'aprovada'), 0),
      'overdue', count(*) FILTER (WHERE approval_status = 'pendente' AND created_at < now() - interval '24 hours')
    ) FROM base),
    'fetched_at', clock_timestamp()
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_set_revision(), public.dashboard_guard_sale(),
  public.update_commission_on_sale() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_sale(uuid, text, timestamptz, jsonb, text),
  public.get_sales_board(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_sale(uuid, text, timestamptz, jsonb, text),
  public.get_sales_board(text, text, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
