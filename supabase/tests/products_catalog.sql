-- Run only in a transaction that ends in ROLLBACK. All fixtures are isolated.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES ('ac000000-0000-4000-8000-000000000001','catalog-executive@example.invalid','{"display_name":"Catalog QA Executive"}','{}',now(),now()),
('ac000000-0000-4000-8000-000000000002','catalog-seller@example.invalid','{"display_name":"Catalog QA Seller"}','{}',now(),now());
INSERT INTO public.user_roles(user_id,role) VALUES ('ac000000-0000-4000-8000-000000000001','executive');
UPDATE public.user_roles SET commission_rate=20 WHERE user_id='ac000000-0000-4000-8000-000000000002';
CREATE TEMP TABLE catalog_qa_state(product_id uuid, ticket_id uuid, other_id uuid, old_revision timestamptz);
GRANT ALL ON catalog_qa_state TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE p public.products; t public.product_tickets; p2 public.products; rev bigint;
BEGIN
  SELECT revision INTO rev FROM public.dashboard_events WHERE topic='products';
  p := public.executive_create_product('Catalog QA Product','Description','Completo',1497.50,true);
  SELECT * INTO t FROM public.product_tickets WHERE product_id=p.id;
  IF t.id IS NULL OR t.price <> 1497.50 OR t.created_by <> auth.uid() THEN RAISE EXCEPTION 'FAIL: atomic product and ticket creation'; END IF;
  IF (SELECT revision FROM public.dashboard_events WHERE topic='products') <= rev THEN RAISE EXCEPTION 'FAIL: catalog signal missing'; END IF;
  IF (SELECT count(*) FROM public.executive_audit_events WHERE target_id IN (p.id,t.id)) <> 2 THEN RAISE EXCEPTION 'FAIL: creation audit'; END IF;
  p2 := public.executive_create_product('Catalog QA Other',NULL,'Outro',99,true);
  INSERT INTO catalog_qa_state VALUES(p.id,t.id,p2.id,t.updated_at);
  BEGIN
    PERFORM public.executive_create_product('Catalog QA Invalid',NULL,'Ticket',-1,true);
    RAISE EXCEPTION 'FAIL: negative ticket allowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.products WHERE name='Catalog QA Invalid') THEN RAISE EXCEPTION 'FAIL: orphan product after failed ticket'; END IF;
  BEGIN
    PERFORM public.executive_create_product('  catalog qa product  ',NULL,'Ticket',1,true);
    RAISE EXCEPTION 'FAIL: duplicate normalized name';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.executive_save_product_ticket(NULL,p.id,'Invalid',0.001,true);
    RAISE EXCEPTION 'FAIL: fractional cent accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.executive_save_product_ticket(NULL,p.id,'Invalid','NaN'::numeric,true);
    RAISE EXCEPTION 'FAIL: NaN price accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.executive_save_product_ticket(NULL,p.id,'Invalid',100000001,true);
    RAISE EXCEPTION 'FAIL: over maximum accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.executive_save_product_ticket(t.id,p2.id,t.name,10,true,t.updated_at);
    RAISE EXCEPTION 'FAIL: ticket moved across products';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.executive_save_product(p.id,'Catalog QA Renamed','Edited',true,p.updated_at);
  BEGIN
    PERFORM public.executive_save_product(p.id,'Stale overwrite',NULL,true,p.updated_at);
    RAISE EXCEPTION 'FAIL: concurrent product overwrite';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE s record; sale public.vendas;
BEGIN
  SELECT * INTO s FROM catalog_qa_state;
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=s.product_id) THEN RAISE EXCEPTION 'FAIL: seller catalog read'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.dashboard_events WHERE topic='products') THEN RAISE EXCEPTION 'FAIL: seller cannot receive catalog signal'; END IF;
  BEGIN PERFORM public.executive_create_product('Forbidden',NULL,'Ticket',1,true);
    RAISE EXCEPTION 'FAIL: seller created product'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_save_product(s.product_id,'Forbidden',NULL,true,NULL);
    RAISE EXCEPTION 'FAIL: seller edited product'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_save_product_ticket(NULL,s.product_id,'Forbidden',1,true);
    RAISE EXCEPTION 'FAIL: seller created ticket'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.product_tickets SET price=1 WHERE id=s.ticket_id;
    RAISE EXCEPTION 'FAIL: seller directly changed price'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.products(name) VALUES('Forbidden direct');
    RAISE EXCEPTION 'FAIL: seller directly created product'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.products WHERE id=s.product_id;
    RAISE EXCEPTION 'FAIL: seller deleted product'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.vendas(user_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),'Forged',1,'QA Buyer','catalog-buyer@example.invalid','11999999999');
    RAISE EXCEPTION 'FAIL: catalog-less sale accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.other_id,s.ticket_id,'Forged',1497.50,'QA Buyer','catalog-buyer@example.invalid','11999999999');
    RAISE EXCEPTION 'FAIL: cross-product ticket accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'Forged',1,'QA Buyer','catalog-buyer@example.invalid','11999999999');
    RAISE EXCEPTION 'FAIL: forged price accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.vendas(id,user_id,product_id,ticket_id,nome_produto,ticket_name,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
  VALUES('bc000000-0000-4000-8000-000000000001',auth.uid(),s.product_id,s.ticket_id,'Forged name','Forged ticket',1497.50,'QA Buyer','catalog-buyer@example.invalid','11999999999') RETURNING * INTO sale;
  IF sale.nome_produto <> 'Catalog QA Renamed' OR sale.ticket_name <> 'Completo' OR sale.approval_status <> 'pendente' OR sale.commission_amount <> 0 THEN RAISE EXCEPTION 'FAIL: authoritative sale snapshot'; END IF;
  IF public.get_sales_board('pendente','Catalog QA Renamed')->'items'->0->>'ticket_name' <> 'Completo' THEN RAISE EXCEPTION 'FAIL: ticket snapshot missing from board'; END IF;
  IF public.get_sales_board('pendente','Catalog QA Renamed')->'items'->0 ? 'email_comprador' THEN RAISE EXCEPTION 'FAIL: buyer leaked to seller feed'; END IF;
  BEGIN UPDATE public.vendas SET valor_venda=1 WHERE id=sale.id;
    RAISE EXCEPTION 'FAIL: price changed after registration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.vendas SET ticket_id=NULL WHERE id=sale.id;
    RAISE EXCEPTION 'FAIL: catalog reference removed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.vendas SET nome_produto='Forged' WHERE id=sale.id;
    RAISE EXCEPTION 'FAIL: snapshot renamed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_review_sale(sale.id,'approve');
    RAISE EXCEPTION 'FAIL: seller approved sale'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE s record; t public.product_tickets;
BEGIN
  SELECT * INTO s FROM catalog_qa_state;
  t := public.executive_save_product_ticket(s.ticket_id,s.product_id,'Renamed ticket',1997.75,true,s.old_revision);
  BEGIN PERFORM public.executive_save_product_ticket(t.id,s.product_id,'Stale price',1,true,s.old_revision);
    RAISE EXCEPTION 'FAIL: concurrent ticket overwrite'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.executive_save_product_ticket(t.id,s.product_id,'Missing revision',1,true);
    RAISE EXCEPTION 'FAIL: missing revision bypass'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM catalog_qa_state;
  IF (SELECT price FROM public.product_tickets WHERE id=s.ticket_id) <> 1997.75 THEN RAISE EXCEPTION 'FAIL: seller sees old price'; END IF;
  BEGIN INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'Old price',1497.50,'QA Buyer','catalog-buyer@example.invalid','11999999999');
    RAISE EXCEPTION 'FAIL: stale sale price accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_save_product_ticket(t.id,t.product_id,t.name,t.price,false,t.updated_at)
FROM public.product_tickets t JOIN catalog_qa_state s ON s.ticket_id=t.id;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM catalog_qa_state;
  IF EXISTS(SELECT 1 FROM public.product_tickets WHERE id=s.ticket_id) THEN RAISE EXCEPTION 'FAIL: seller sees inactive ticket'; END IF;
  BEGIN INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'Inactive',1997.75,'QA Buyer','catalog-buyer@example.invalid','11999999999');
    RAISE EXCEPTION 'FAIL: inactive ticket sold'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_save_product_ticket(t.id,t.product_id,t.name,t.price,true,t.updated_at)
FROM public.product_tickets t JOIN catalog_qa_state s ON s.ticket_id=t.id;
SELECT public.executive_save_product(p.id,p.name,p.description,false,p.updated_at)
FROM public.products p JOIN catalog_qa_state s ON s.product_id=p.id;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM catalog_qa_state;
  IF EXISTS(SELECT 1 FROM public.products WHERE id=s.product_id) OR EXISTS(SELECT 1 FROM public.product_tickets WHERE id=s.ticket_id) THEN RAISE EXCEPTION 'FAIL: seller sees inactive product/tickets'; END IF;
  BEGIN INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'Inactive',1997.75,'QA Buyer','catalog-buyer@example.invalid','11999999999');
    RAISE EXCEPTION 'FAIL: inactive product sold'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;

-- Approval of an existing sale works after repricing/deactivation and keeps its original amount.
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_review_sale('bc000000-0000-4000-8000-000000000001','approve','','pendente');
DO $$
DECLARE v public.vendas;
BEGIN
  SELECT * INTO v FROM public.vendas WHERE id='bc000000-0000-4000-8000-000000000001';
  IF v.valor_venda <> 1497.50 OR v.ticket_name <> 'Completo' OR v.commission_amount <> 299.50 THEN RAISE EXCEPTION 'FAIL: historical sale or commission changed'; END IF;
  IF public.get_available_balance(v.user_id) <> 299.50 THEN RAISE EXCEPTION 'FAIL: balance synchronization'; END IF;
  IF public.get_sales_board('aprovada','Catalog QA Renamed')->>'total' <> '1' THEN RAISE EXCEPTION 'FAIL: sale board synchronization'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.executive_audit_events e JOIN catalog_qa_state s ON e.target_id=s.ticket_id WHERE action='ticket.update' AND (before_data->>'price')::numeric=1497.50 AND (after_data->>'price')::numeric=1997.75) THEN RAISE EXCEPTION 'FAIL: price change audit'; END IF;
END; $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET suspended=true WHERE user_id IN ('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.products) OR EXISTS(SELECT 1 FROM public.product_tickets) THEN RAISE EXCEPTION 'FAIL: suspended seller reads catalog'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM public.executive_create_product('Suspended',NULL,'Ticket',1,true);
    RAISE EXCEPTION 'FAIL: suspended executive creates product'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.products;
    RAISE EXCEPTION 'FAIL: anonymous catalog access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_create_product('Anonymous',NULL,'Ticket',1,true);
    RAISE EXCEPTION 'FAIL: anonymous product creation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SELECT 'PASS: catalog creation, permissions, pricing, concurrency, snapshots, commissions, audit, and signals' AS result;
