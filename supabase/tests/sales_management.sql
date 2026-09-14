-- Isolated fixtures; runner must end in ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES ('ad140000-0000-4000-8000-000000000001','sales-admin@example.invalid','{"display_name":"Sales QA Admin"}','{}',now(),now()),
('ad140000-0000-4000-8000-000000000002','sales-owner@example.invalid','{"display_name":"Sales QA Owner"}','{}',now(),now()),
('ad140000-0000-4000-8000-000000000003','sales-other@example.invalid','{"display_name":"Sales QA Other"}','{}',now(),now());
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,'Sales QA',email,'seller','approved',now() FROM auth.users WHERE id::text LIKE 'ad140000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved';
INSERT INTO public.user_roles(user_id,role) VALUES ('ad140000-0000-4000-8000-000000000001','executive'),
('ad140000-0000-4000-8000-000000000002','seller'),('ad140000-0000-4000-8000-000000000003','seller') ON CONFLICT DO NOTHING;
UPDATE public.user_roles SET commission_rate=20 WHERE user_id='ad140000-0000-4000-8000-000000000002';
CREATE TEMP TABLE sales_qa_catalog(product_id uuid,ticket_id uuid);
GRANT ALL ON sales_qa_catalog TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE p public.products; BEGIN
  p:=public.executive_create_product('Sales QA Original',NULL,'Completo',1000,true);
  INSERT INTO sales_qa_catalog SELECT p.id,id FROM public.product_tickets WHERE product_id=p.id;
  p:=public.executive_create_product('Sales QA Updated',NULL,'Novo ticket',2000,true);
  INSERT INTO sales_qa_catalog SELECT p.id,id FROM public.product_tickets WHERE product_id=p.id;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.vendas(id,user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
SELECT 'ad140000-0000-4000-8000-000000000010','ad140000-0000-4000-8000-000000000002',c.product_id,c.ticket_id,'Sales QA Original',1000,'Buyer QA','buyer@example.invalid','11999998888'
FROM sales_qa_catalog c JOIN public.products p ON p.id=c.product_id WHERE p.name='Sales QA Original';
DO $$ DECLARE s public.vendas; edited public.vendas; c record; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000010';
  edited:=public.manage_sale(s.id,'edit',s.updated_at,'{"nome_comprador":"Buyer edited"}');
  IF edited.nome_comprador<>'Buyer edited' OR edited.updated_at=s.updated_at THEN RAISE EXCEPTION 'FAIL: contact edit/revision'; END IF;
  BEGIN PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"nome_comprador":"Stale"}'); RAISE EXCEPTION 'FAIL: lost update'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.manage_sale(s.id,'delete',s.updated_at); RAISE EXCEPTION 'FAIL: stale deletion'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.manage_sale(s.id,'edit',edited.updated_at,'{"approval_status":"aprovada"}'); RAISE EXCEPTION 'FAIL: approval injection'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.manage_sale(s.id,'edit',edited.updated_at,'{"valor_venda":999.999}'); RAISE EXCEPTION 'FAIL: fractional cents'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE public.vendas SET valor_venda=500 WHERE id=s.id; RAISE EXCEPTION 'FAIL: direct financial update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT c0.* INTO c FROM sales_qa_catalog c0 JOIN public.products p ON p.id=c0.product_id WHERE p.name='Sales QA Updated';
  edited:=public.manage_sale(s.id,'edit',edited.updated_at,jsonb_build_object('product_id',c.product_id,'ticket_id',c.ticket_id,'valor_venda',2000));
  IF edited.nome_produto<>'Sales QA Updated' OR edited.ticket_name<>'Novo ticket' OR edited.commission_amount<>0 THEN RAISE EXCEPTION 'FAIL: pending catalog edit'; END IF;
  BEGIN PERFORM public.manage_sale(s.id,'edit',edited.updated_at,'{"valor_venda":500}'); RAISE EXCEPTION 'FAIL: seller arbitrary price'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM public.manage_sale('ad140000-0000-4000-8000-000000000010','edit',now(),'{}'); RAISE EXCEPTION 'FAIL: another seller edit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'FAIL: private buyer visible'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_review_sale('ad140000-0000-4000-8000-000000000010','approve');
DO $$ DECLARE s public.vendas; edited public.vendas; c record; r jsonb; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000010';
  SELECT c0.* INTO c FROM sales_qa_catalog c0 JOIN public.products p ON p.id=c0.product_id WHERE p.name='Sales QA Original';
  edited:=public.manage_sale(s.id,'edit',s.updated_at,jsonb_build_object('product_id',c.product_id,'ticket_id',c.ticket_id,'valor_venda',1500));
  IF edited.approval_status<>'aprovada' OR edited.commission_amount<>300 OR edited.nome_produto<>'Sales QA Original' THEN RAISE EXCEPTION 'FAIL: approved edit recalculation'; END IF;
  IF public.get_available_balance(s.user_id)<>300 THEN RAISE EXCEPTION 'FAIL: balance stale after edit'; END IF;
  r:=public.get_sales_board('aprovada','Sales QA');
  IF (r->'summary'->>'approved_value')::numeric<>1500 OR r->>'total'<>'1' THEN RAISE EXCEPTION 'FAIL: home board stale'; END IF;
  IF (SELECT sum(valor_venda) FROM public.vendas WHERE user_id=s.user_id AND approval_status='aprovada')<>1500 THEN RAISE EXCEPTION 'FAIL: dashboard aggregates'; END IF;
  IF (SELECT count(*) FROM public.executive_audit_events WHERE target_id=s.id AND action='sale.edit')<>3 THEN RAISE EXCEPTION 'FAIL: edit audit'; END IF;
  IF edited.commission_rate_applied<>20 THEN RAISE EXCEPTION 'FAIL: approval rate not frozen'; END IF;
  edited:=public.manage_sale(s.id,'edit',edited.updated_at,'{"valor_venda":0.03}');
  IF edited.commission_amount<>0.01 THEN RAISE EXCEPTION 'FAIL: commission rounding'; END IF;
  edited:=public.manage_sale(s.id,'edit',edited.updated_at,'{"valor_venda":1500}');
  IF edited.commission_amount<>300 THEN RAISE EXCEPTION 'FAIL: repeated edits drift commission'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE s public.vendas; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000010';
  BEGIN PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":2000}'); RAISE EXCEPTION 'FAIL: seller edited approved'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
INSERT INTO public.saques(id,user_id,valor_solicitado,status) VALUES ('ad140000-0000-4000-8000-000000000020','ad140000-0000-4000-8000-000000000002',250,'pendente');
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s public.vendas; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000010';
  BEGIN PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":1000}'); RAISE EXCEPTION 'FAIL: reserved commission reduction'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.manage_sale(s.id,'delete',s.updated_at,'{}','QA deletion'); RAISE EXCEPTION 'FAIL: reserved sale deleted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
END; $$;
SELECT public.executive_cancel_withdrawal('ad140000-0000-4000-8000-000000000020','QA release reservation');
DO $$ DECLARE s public.vendas; r jsonb; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000010';
  PERFORM public.manage_sale(s.id,'delete',s.updated_at,'{}','QA deletion');
  IF EXISTS(SELECT 1 FROM public.vendas WHERE id=s.id) OR public.get_available_balance(s.user_id)<>0 THEN RAISE EXCEPTION 'FAIL: deleted sale/balance'; END IF;
  r:=public.get_sales_board('aprovada','Sales QA');
  IF r->>'total'<>'0' OR (r->'summary'->>'approved_value')::numeric<>0 THEN RAISE EXCEPTION 'FAIL: deleted sale in home totals'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.executive_audit_events WHERE target_id=s.id AND action='sale.delete') THEN RAISE EXCEPTION 'FAIL: delete audit'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000002","role":"authenticated"}',true);
INSERT INTO public.vendas(id,user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
SELECT 'ad140000-0000-4000-8000-000000000011','ad140000-0000-4000-8000-000000000002',c.product_id,c.ticket_id,'Sales QA Original',1000,'Rejected buyer','rejected@example.invalid','11999998888'
FROM sales_qa_catalog c JOIN public.products p ON p.id=c.product_id WHERE p.name='Sales QA Original';
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_review_sale('ad140000-0000-4000-8000-000000000011','reject','QA reject');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'FAIL: admin cannot read rejection'; END IF;
  IF public.get_sales_board('rejeitada','Sales QA')->>'total'<>'1' THEN RAISE EXCEPTION 'FAIL: admin rejection panel'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ad140000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.vendas WHERE id='ad140000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'FAIL: owner sees rejection'; END IF;
  IF public.get_sales_board('all','Sales QA')->>'total'<>'0' THEN RAISE EXCEPTION 'FAIL: rejection in shared feed'; END IF;
END; $$;
RESET ROLE;
