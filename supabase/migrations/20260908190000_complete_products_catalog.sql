-- Complete the deployed catalog without rewriting the earlier migration.
BEGIN;

ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS ticket_name text;

-- Preserve the two products and eight prices previously offered in the UI.
INSERT INTO public.products(name)
VALUES ('Mentoria Jogador De Elite'), ('Mentoria Jogador Milionário')
ON CONFLICT DO NOTHING;
INSERT INTO public.product_tickets(product_id, name, price)
SELECT p.id, 'Ticket ' || amount::text, amount
FROM public.products p
CROSS JOIN unnest(ARRAY[2997,1497,1247,987,847,500,275,250]) amount
WHERE p.name IN ('Mentoria Jogador De Elite', 'Mentoria Jogador Milionário')
ON CONFLICT DO NOTHING;

DROP POLICY products_select ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND suspended
  ) AND (active OR public.is_executive(auth.uid())));
DROP POLICY product_tickets_select ON public.product_tickets;
CREATE POLICY product_tickets_select ON public.product_tickets FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND suspended
  ) AND (public.is_executive(auth.uid()) OR (active AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_id AND p.active
  ))));

CREATE OR REPLACE FUNCTION public.enforce_catalog_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_product public.products; v_ticket public.product_tickets;
BEGIN
  PERFORM public.dashboard_require_access();
  IF TG_OP = 'UPDATE' THEN
    IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
      OR NEW.nome_produto IS DISTINCT FROM OLD.nome_produto OR NEW.ticket_name IS DISTINCT FROM OLD.ticket_name
      OR NEW.valor_venda IS DISTINCT FROM OLD.valor_venda THEN
      RAISE EXCEPTION 'Produto, ticket e valor de uma venda registrada são imutáveis. Cancele a solicitação e registre novamente.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.product_id IS NULL OR NEW.ticket_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um produto e um ticket ativo' USING ERRCODE = '22023';
  END IF;
  -- Shared locks serialize registration with product deactivation and repricing.
  SELECT * INTO v_product FROM public.products WHERE id = NEW.product_id FOR SHARE;
  SELECT * INTO v_ticket FROM public.product_tickets WHERE id = NEW.ticket_id FOR SHARE;
  IF v_product.id IS NULL OR NOT v_product.active OR v_ticket.id IS NULL OR NOT v_ticket.active
    OR v_ticket.product_id IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'Produto ou ticket não está disponível. Atualize o catálogo.' USING ERRCODE = '22023';
  END IF;
  -- Require the displayed price to match instead of silently charging a new price.
  IF NEW.valor_venda IS DISTINCT FROM v_ticket.price THEN
    RAISE EXCEPTION 'O preço do ticket mudou. Confira o valor atualizado e registre novamente.' USING ERRCODE = '22023';
  END IF;
  NEW.nome_produto := v_product.name;
  NEW.ticket_name := v_ticket.name;
  NEW.valor_venda := v_ticket.price;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vendas_catalog_on_update BEFORE UPDATE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.enforce_catalog_sale();
REVOKE ALL ON FUNCTION public.enforce_catalog_sale() FROM PUBLIC, anon, authenticated;

-- Replace old signatures so clients cannot bypass optimistic concurrency checks.
DROP FUNCTION public.executive_save_product(uuid, text, text, boolean);
DROP FUNCTION public.executive_save_product_ticket(uuid, uuid, text, numeric, boolean);

CREATE FUNCTION public.executive_save_product(
  p_product_id uuid, p_name text, p_description text DEFAULT NULL,
  p_active boolean DEFAULT true, p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before public.products; v_after public.products;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 160
    OR char_length(COALESCE(p_description, '')) > 2000 OR p_active IS NULL THEN
    RAISE EXCEPTION 'Nome ou descrição do produto inválidos' USING ERRCODE = '22023';
  END IF;
  IF p_product_id IS NULL THEN
    INSERT INTO public.products(name, description, active, created_by)
    VALUES (btrim(p_name), NULLIF(btrim(p_description), ''), p_active, auth.uid()) RETURNING * INTO v_after;
  ELSE
    SELECT * INTO v_before FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = '22023'; END IF;
    IF p_expected_updated_at IS DISTINCT FROM v_before.updated_at THEN
      RAISE EXCEPTION 'Produto alterado por outro executivo. Feche a edição, atualize e tente novamente.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.products SET name = btrim(p_name), description = NULLIF(btrim(p_description), ''),
      active = p_active, updated_at = clock_timestamp() WHERE id = p_product_id RETURNING * INTO v_after;
  END IF;
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES (auth.uid(), COALESCE((SELECT display_name FROM public.profiles WHERE user_id = auth.uid()), 'Executivo'),
    CASE WHEN p_product_id IS NULL THEN 'product.create' ELSE 'product.update' END, v_after.id, v_after.name,
    'Catálogo atualizado pelo painel executivo', CASE WHEN p_product_id IS NULL THEN NULL ELSE to_jsonb(v_before) END, to_jsonb(v_after));
  RETURN v_after;
END;
$$;

CREATE FUNCTION public.executive_save_product_ticket(
  p_ticket_id uuid, p_product_id uuid, p_name text, p_price numeric,
  p_active boolean DEFAULT true, p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS public.product_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before public.product_tickets; v_after public.product_tickets;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF p_product_id IS NULL OR char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 120
    OR p_price IS NULL OR p_price <= 0 OR p_price > 100000000 OR p_price <> round(p_price, 2) OR p_active IS NULL THEN
    RAISE EXCEPTION 'Informe um nome e um preço entre R$ 0,01 e R$ 100.000.000,00, com até duas casas decimais.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.products WHERE id = p_product_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = '22023'; END IF;
  IF p_ticket_id IS NULL THEN
    INSERT INTO public.product_tickets(product_id, name, price, active, created_by)
    VALUES (p_product_id, btrim(p_name), p_price, p_active, auth.uid()) RETURNING * INTO v_after;
  ELSE
    SELECT * INTO v_before FROM public.product_tickets WHERE id = p_ticket_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ticket não encontrado' USING ERRCODE = '22023'; END IF;
    IF v_before.product_id IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'O produto de um ticket existente não pode ser trocado' USING ERRCODE = '22023';
    END IF;
    IF p_expected_updated_at IS DISTINCT FROM v_before.updated_at THEN
      RAISE EXCEPTION 'Ticket alterado por outro executivo. Feche a edição, atualize e tente novamente.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_tickets SET name = btrim(p_name), price = p_price, active = p_active,
      updated_at = clock_timestamp() WHERE id = p_ticket_id RETURNING * INTO v_after;
  END IF;
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES (auth.uid(), COALESCE((SELECT display_name FROM public.profiles WHERE user_id = auth.uid()), 'Executivo'),
    CASE WHEN p_ticket_id IS NULL THEN 'ticket.create' ELSE 'ticket.update' END, v_after.id, v_after.name,
    'Ticket atualizado pelo painel executivo', CASE WHEN p_ticket_id IS NULL THEN NULL ELSE to_jsonb(v_before) END, to_jsonb(v_after));
  RETURN v_after;
END;
$$;

-- Product and first ticket become visible together, or neither is created.
CREATE FUNCTION public.executive_create_product(
  p_name text, p_description text, p_ticket_name text, p_ticket_price numeric, p_active boolean DEFAULT true
)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_product public.products;
BEGIN
  PERFORM public.dashboard_require_access(true);
  v_product := public.executive_save_product(NULL, p_name, p_description, p_active);
  PERFORM public.executive_save_product_ticket(NULL, v_product.id, p_ticket_name, p_ticket_price, true);
  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION public.executive_save_product(uuid,text,text,boolean,timestamptz),
  public.executive_save_product_ticket(uuid,uuid,text,numeric,boolean,timestamptz),
  public.executive_create_product(text,text,text,numeric,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.executive_save_product(uuid,text,text,boolean,timestamptz),
  public.executive_save_product_ticket(uuid,uuid,text,numeric,boolean,timestamptz),
  public.executive_create_product(text,text,text,numeric,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sales_board(p_status text DEFAULT 'pendente',p_search text DEFAULT '',p_page integer DEFAULT 0,p_page_size integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_result jsonb; v_exec boolean;
BEGIN
  PERFORM public.dashboard_require_access();
  v_exec := public.is_executive(auth.uid());
  IF p_status NOT IN ('pendente','aprovada','rejeitada','all') OR (p_status='rejeitada' AND NOT v_exec) THEN
    RAISE EXCEPTION 'Filtro inválido';
  END IF;
  WITH base AS (
    SELECT v.*,COALESCE(p.display_name,'Vendedor') AS seller_name,p.avatar_url AS seller_avatar,
      COALESCE(r.display_name,'Executivo') AS reviewer_name
    FROM public.vendas v LEFT JOIN public.profiles p ON p.user_id=v.user_id
      LEFT JOIN public.profiles r ON r.user_id=v.reviewed_by
    WHERE (v_exec OR v.approval_status IN ('pendente','aprovada'))
      AND (COALESCE(p_search,'')='' OR strpos(lower(COALESCE(p.display_name,'')||' '||v.nome_produto||' '||COALESCE(v.ticket_name,'')),lower(p_search))>0)
  ), filtered AS (
    SELECT * FROM base WHERE p_status='all' OR approval_status=p_status
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN p_status='pendente' THEN created_at END ASC,
      CASE WHEN p_status='aprovada' THEN COALESCE(reviewed_at,created_at) ELSE created_at END DESC,id
      LIMIT greatest(1,least(COALESCE(p_page_size,12),50)) OFFSET greatest(0,COALESCE(p_page,0))*greatest(1,least(COALESCE(p_page_size,12),50))
  ) SELECT jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'seller_name',seller_name,
      'seller_avatar',seller_avatar,'nome_produto',nome_produto,'ticket_name',ticket_name,'valor_venda',valor_venda,'approval_status',approval_status,
      'created_at',created_at,'reviewed_at',reviewed_at) || CASE WHEN v_exec THEN
        jsonb_build_object('nome_comprador',nome_comprador,'email_comprador',email_comprador,'whatsapp_comprador',whatsapp_comprador,
          'commission_amount',commission_amount,'rejection_reason',rejection_reason,'reviewer_name',reviewer_name,
          'withdrawn',withdrawn,'withdrawal_id',withdrawal_id,'consideracoes_gerais',consideracoes_gerais)
        ELSE '{}'::jsonb END) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),
    'summary',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE approval_status='pendente'),
      'approved',count(*) FILTER(WHERE approval_status='aprovada'),'rejected',count(*) FILTER(WHERE approval_status='rejeitada'),
      'pending_value',COALESCE(sum(valor_venda) FILTER(WHERE approval_status='pendente'),0),
      'approved_value',COALESCE(sum(valor_venda) FILTER(WHERE approval_status='aprovada'),0),
      'overdue',count(*) FILTER(WHERE approval_status='pendente' AND created_at<now()-interval '24 hours')) FROM base),
    'fetched_at',clock_timestamp()) INTO v_result;
  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('20260908190000', 'complete_products_catalog', ARRAY['Applied complete product catalog transaction'])
ON CONFLICT (version) DO NOTHING;
COMMIT;
