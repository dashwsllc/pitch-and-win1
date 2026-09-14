-- Sale management is atomic: financial values, commission, audit and existing
-- dashboard/balance triggers are committed together. Rejected sales stay private.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.vendas ADD COLUMN commission_rate_applied numeric;

CREATE POLICY vendas_rejected_admin_only ON public.vendas AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (approval_status <> 'rejeitada' OR public.is_executive(auth.uid()));

-- Preserve the lead's existing sale link without offering a rejected sale
-- outside the administrative panel or suggesting a duplicate registration.
CREATE OR REPLACE FUNCTION public.crm_sale_links() RETURNS TABLE(lead_id uuid,sale_id uuid,can_open boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.crm_require_role('leads');
  RETURN QUERY SELECT v.crm_lead_id,
    CASE WHEN v.approval_status IN ('aprovada','pendente') AND (v.user_id=auth.uid() OR public.crm_user_can(auth.uid(),'admin')) THEN v.id ELSE NULL END,
    v.approval_status IN ('aprovada','pendente') AND (v.user_id=auth.uid() OR public.crm_user_can(auth.uid(),'admin'))
    FROM public.vendas v WHERE v.crm_lead_id IS NOT NULL;
END; $$;

-- Keep historical catalog snapshots on contact-only edits. Financial changes
-- are allowed exclusively through manage_sale, after authorization/validation.
CREATE OR REPLACE FUNCTION public.enforce_catalog_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_product public.products; v_ticket public.product_tickets;
BEGIN
  PERFORM public.dashboard_require_access();
  IF TG_OP = 'UPDATE' THEN
    IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
      OR NEW.nome_produto IS DISTINCT FROM OLD.nome_produto OR NEW.ticket_name IS DISTINCT FROM OLD.ticket_name
      OR NEW.valor_venda IS DISTINCT FROM OLD.valor_venda THEN
      IF current_setting('dashboard.sale_edit',true) IS DISTINCT FROM OLD.id::text THEN
        RAISE EXCEPTION 'Utilize Editar venda no módulo Vendas.' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.product_id IS NULL OR NEW.ticket_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um produto e um ticket ativo' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_product FROM public.products WHERE id = NEW.product_id FOR SHARE;
  SELECT * INTO v_ticket FROM public.product_tickets WHERE id = NEW.ticket_id FOR SHARE;
  IF v_product.id IS NULL OR NOT v_product.active OR v_ticket.id IS NULL OR NOT v_ticket.active
    OR v_ticket.product_id IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'Produto ou ticket não está disponível. Atualize o catálogo.' USING ERRCODE = '22023';
  END IF;
  IF NEW.valor_venda IS DISTINCT FROM v_ticket.price THEN
    RAISE EXCEPTION 'O preço do ticket mudou. Confira o valor atualizado e registre novamente.' USING ERRCODE = '22023';
  END IF;
  NEW.nome_produto := v_product.name;
  NEW.ticket_name := v_ticket.name;
  NEW.valor_venda := v_ticket.price;
  RETURN NEW;
END;
$$;

-- clock_timestamp also distinguishes consecutive edits in one transaction.
CREATE FUNCTION public.sales_set_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF TG_OP='INSERT' THEN
    NEW.commission_rate_applied := NULL;
  ELSIF NEW.approval_status='aprovada' AND OLD.approval_status<>'aprovada' THEN
    SELECT COALESCE(commission_rate,0) INTO NEW.commission_rate_applied FROM public.user_roles
      WHERE user_id=NEW.user_id ORDER BY updated_at DESC,id LIMIT 1;
    NEW.commission_rate_applied := COALESCE(NEW.commission_rate_applied,0);
  ELSE
    -- Legacy approvals lack a saved rate: freeze their effective rate once,
    -- so repeated edits never compound rounding from prior commissions.
    NEW.commission_rate_applied := COALESCE(OLD.commission_rate_applied,
      CASE WHEN OLD.approval_status='aprovada' THEN COALESCE(OLD.commission_amount,0)*100/NULLIF(OLD.valor_venda,0) END);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_sales_set_revision BEFORE INSERT OR UPDATE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.sales_set_revision();
REVOKE ALL ON FUNCTION public.sales_set_revision() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.manage_sale(
  p_sale_id uuid, p_action text, p_expected_updated_at timestamptz,
  p_data jsonb DEFAULT '{}', p_reason text DEFAULT ''
) RETURNS public.vendas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  s public.vendas; d public.vendas; result public.vendas;
  v_exec boolean; v_financial boolean; v_product public.products; v_ticket public.product_tickets;
  v_commission numeric; v_total numeric; v_committed numeric;
BEGIN
  PERFORM public.dashboard_require_access();
  v_exec := public.is_executive(auth.uid());
  IF NOT public.registration_has_access() THEN RAISE EXCEPTION 'Cadastro sem acesso aprovado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.vendas WHERE id=p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada ou já excluída' USING ERRCODE='P0002'; END IF;
  IF NOT v_exec AND (s.user_id IS DISTINCT FROM auth.uid() OR s.approval_status <> 'pendente' OR NOT public.crm_can('sales')) THEN
    RAISE EXCEPTION 'Você pode gerenciar somente suas vendas pendentes. Vendas aprovadas são gerenciadas pela administração.' USING ERRCODE='42501';
  END IF;
  -- Same lock order as review and withdrawal routines.
  PERFORM pg_advisory_xact_lock(hashtextextended(s.user_id::text,42));
  SELECT * INTO s FROM public.vendas WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada ou já excluída' USING ERRCODE='P0002'; END IF;
  IF p_expected_updated_at IS DISTINCT FROM s.updated_at THEN
    RAISE EXCEPTION 'Esta venda foi alterada. Feche a janela, atualize a lista e confira antes de tentar novamente.' USING ERRCODE='PT409';
  END IF;
  IF NOT v_exec AND s.approval_status <> 'pendente' THEN
    RAISE EXCEPTION 'Venda já revisada pela administração.' USING ERRCODE='PT409';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('edit','delete') THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
  IF p_action='delete' THEN
    IF v_exec THEN
      PERFORM public.executive_review_sale(s.id,'delete',p_reason,s.approval_status);
    ELSE
      DELETE FROM public.vendas WHERE id=s.id;
    END IF;
    RETURN s;
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN
      ('product_id','ticket_id','valor_venda','nome_comprador','email_comprador','whatsapp_comprador','consideracoes_gerais')
  ) THEN RAISE EXCEPTION 'Campos de edição inválidos' USING ERRCODE='22023'; END IF;
  IF p_data ? 'valor_venda' AND ((p_data->>'valor_venda')::numeric IS NULL
    OR (p_data->>'valor_venda')::numeric <> round((p_data->>'valor_venda')::numeric,2)) THEN
    RAISE EXCEPTION 'Informe o valor com até duas casas decimais.' USING ERRCODE='22023';
  END IF;
  d := jsonb_populate_record(s,p_data);
  IF length(btrim(COALESCE(d.nome_comprador,''))) NOT BETWEEN 2 AND 160
    OR length(btrim(COALESCE(d.email_comprador,''))) NOT BETWEEN 3 AND 254
    OR btrim(d.email_comprador) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(btrim(COALESCE(d.whatsapp_comprador,''))) NOT BETWEEN 5 AND 32
    OR length(COALESCE(d.consideracoes_gerais,''))>10000 THEN
    RAISE EXCEPTION 'Confira o nome, e-mail, WhatsApp e observações do comprador.' USING ERRCODE='22023';
  END IF;
  IF d.valor_venda IS NULL OR d.valor_venda <= 0 OR d.valor_venda > 100000000
    OR d.valor_venda::text IN ('NaN','Infinity','-Infinity') OR round(d.valor_venda,2)<>d.valor_venda THEN
    RAISE EXCEPTION 'Informe um valor positivo, com até duas casas decimais.' USING ERRCODE='22023';
  END IF;
  v_financial := d.product_id IS DISTINCT FROM s.product_id OR d.ticket_id IS DISTINCT FROM s.ticket_id
    OR d.valor_venda IS DISTINCT FROM s.valor_venda;
  IF v_financial THEN
    IF s.withdrawn OR s.withdrawal_id IS NOT NULL OR EXISTS(
      SELECT 1 FROM public.saques WHERE s.id=ANY(vendas_incluidas) AND status NOT IN ('rejeitado','cancelado')
    ) THEN RAISE EXCEPTION 'Regularize o saque vinculado antes de alterar produto ou valor.' USING ERRCODE='PT409'; END IF;
    SELECT * INTO v_product FROM public.products WHERE id=d.product_id FOR SHARE;
    SELECT * INTO v_ticket FROM public.product_tickets WHERE id=d.ticket_id FOR SHARE;
    IF v_product.id IS NULL OR NOT v_product.active OR v_ticket.id IS NULL OR NOT v_ticket.active
      OR v_ticket.product_id IS DISTINCT FROM d.product_id THEN
      RAISE EXCEPTION 'Selecione um produto e um ticket ativos.' USING ERRCODE='22023';
    END IF;
    IF NOT v_exec AND d.valor_venda IS DISTINCT FROM v_ticket.price THEN
      RAISE EXCEPTION 'O valor deve corresponder ao ticket. Confira o catálogo atualizado.' USING ERRCODE='22023';
    END IF;
    d.nome_produto := v_product.name; d.ticket_name := v_ticket.name;
  END IF;
  -- Preserve the effective commission recorded at approval, including zero.
  v_commission := COALESCE(s.commission_amount,0);
  IF s.approval_status='aprovada' AND d.valor_venda IS DISTINCT FROM s.valor_venda THEN
    v_commission := round(d.valor_venda * COALESCE(s.commission_rate_applied,
      COALESCE(s.commission_amount,0)*100/NULLIF(s.valor_venda,0)) / 100,2);
    SELECT COALESCE(sum(commission_amount),0)+v_commission INTO v_total FROM public.vendas
      WHERE user_id=s.user_id AND approval_status='aprovada' AND id<>s.id;
    SELECT COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)),0) INTO v_committed FROM public.saques
      WHERE user_id=s.user_id AND status IN ('pendente','processando','aprovado','pago');
    IF v_total < v_committed THEN
      RAISE EXCEPTION 'A comissão está comprometida com saques. Regularize-os antes de reduzir o valor.' USING ERRCODE='PT409';
    END IF;
  END IF;
  PERFORM set_config('dashboard.sale_edit',s.id::text,true);
  IF v_exec THEN PERFORM set_config('dashboard.sale_decision',s.id::text,true); END IF;
  UPDATE public.vendas SET product_id=d.product_id,ticket_id=d.ticket_id,nome_produto=d.nome_produto,
    ticket_name=d.ticket_name,valor_venda=d.valor_venda,commission_amount=v_commission,
    nome_comprador=btrim(d.nome_comprador),email_comprador=btrim(d.email_comprador),
    whatsapp_comprador=btrim(d.whatsapp_comprador),consideracoes_gerais=NULLIF(btrim(d.consideracoes_gerais),'')
    WHERE id=s.id RETURNING * INTO result;
  PERFORM set_config('dashboard.sale_edit','',true);
  PERFORM set_config('dashboard.sale_decision','',true);
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
    VALUES(auth.uid(),COALESCE((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Usuário'),
      'sale.edit',s.id,result.nome_produto,'Venda editada no módulo Vendas',to_jsonb(s),to_jsonb(result));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_sale(uuid,text,timestamptz,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_sale(uuid,text,timestamptz,jsonb,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
