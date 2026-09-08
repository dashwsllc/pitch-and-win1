-- Business conflicts must return HTTP 409, not retryable database serialization errors.
BEGIN;

CREATE OR REPLACE FUNCTION public.executive_save_product(
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
      RAISE EXCEPTION 'Produto alterado por outro executivo. Feche a edição, atualize e tente novamente.' USING ERRCODE = 'PT409';
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

CREATE OR REPLACE FUNCTION public.executive_save_product_ticket(
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
      RAISE EXCEPTION 'Ticket alterado por outro executivo. Feche a edição, atualize e tente novamente.' USING ERRCODE = 'PT409';
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

INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260908193000','catalog_conflict_responses',ARRAY['Applied catalog conflict responses']) ON CONFLICT (version) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
