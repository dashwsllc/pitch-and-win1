-- Isolated fixtures; runner must end in ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES
  ('ad220000-0000-4000-8000-000000000001','reassign-admin@example.invalid','{"display_name":"Reassign Admin"}','{}',now(),now()),
  ('ad220000-0000-4000-8000-000000000002','reassign-old@example.invalid','{"display_name":"Seller Original"}','{}',now(),now()),
  ('ad220000-0000-4000-8000-000000000003','reassign-new@example.invalid','{"display_name":"Seller Correto"}','{}',now(),now()),
  ('ad220000-0000-4000-8000-000000000004','reassign-executive@example.invalid','{"display_name":"Executive QA"}','{}',now(),now());

UPDATE public.profiles SET display_name = CASE user_id
  WHEN 'ad220000-0000-4000-8000-000000000001' THEN 'Reassign Admin'
  WHEN 'ad220000-0000-4000-8000-000000000002' THEN 'Seller Original'
  WHEN 'ad220000-0000-4000-8000-000000000003' THEN 'Seller Correto'
  ELSE 'Executive QA' END
WHERE user_id::text LIKE 'ad220000-%';

INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,raw_user_meta_data->>'display_name',email,'seller','approved',now()
FROM auth.users WHERE id::text LIKE 'ad220000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved';

INSERT INTO public.user_roles(user_id,role,commission_rate) VALUES
  ('ad220000-0000-4000-8000-000000000001','super_admin',0),
  ('ad220000-0000-4000-8000-000000000002','seller',20),
  ('ad220000-0000-4000-8000-000000000003','seller',10),
  ('ad220000-0000-4000-8000-000000000004','executive',0)
ON CONFLICT(user_id,role) DO UPDATE SET commission_rate=EXCLUDED.commission_rate;

CREATE TEMP TABLE sale_reassign_catalog(product_id uuid,ticket_id uuid);
GRANT ALL ON sale_reassign_catalog TO authenticated;

SELECT set_config('request.jwt.claims','{"sub":"ad220000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE p public.products; BEGIN
  p := public.executive_create_product('Reassign QA Product',NULL,'Ticket QA',1000,true);
  INSERT INTO sale_reassign_catalog
    SELECT p.id,id FROM public.product_tickets WHERE product_id=p.id;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ad220000-0000-4000-8000-000000000002","role":"authenticated"}',true);
INSERT INTO public.vendas(
  id,user_id,product_id,ticket_id,nome_produto,valor_venda,
  nome_comprador,email_comprador,whatsapp_comprador
)
SELECT
  'ad220000-0000-4000-8000-000000000010',
  'ad220000-0000-4000-8000-000000000002',
  product_id,ticket_id,'Reassign QA Product',1000,
  'Buyer QA','buyer-reassign@example.invalid','11999998888'
FROM sale_reassign_catalog;

SELECT set_config('request.jwt.claims','{"sub":"ad220000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_review_sale('ad220000-0000-4000-8000-000000000010','approve');

SELECT set_config('request.jwt.claims','{"sub":"ad220000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s public.vendas; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad220000-0000-4000-8000-000000000010';
  BEGIN
    PERFORM public.manage_sale(s.id,'edit',s.updated_at,
      '{"user_id":"ad220000-0000-4000-8000-000000000003"}',
      'Executive nao pode reatribuir');
    RAISE EXCEPTION 'FAIL: executive reassigned sale';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ad220000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s public.vendas; edited public.vendas; board jsonb; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='ad220000-0000-4000-8000-000000000010';
  edited := public.manage_sale(
    s.id,'edit',s.updated_at,
    '{"user_id":"ad220000-0000-4000-8000-000000000003"}',
    'Venda registrada no usuario incorreto'
  );
  IF edited.user_id::text <> 'ad220000-0000-4000-8000-000000000003'
    OR edited.commission_rate_applied <> 10
    OR edited.commission_amount <> 100 THEN
    RAISE EXCEPTION 'FAIL: attribution or commission was not updated';
  END IF;
  IF public.get_available_balance('ad220000-0000-4000-8000-000000000002') <> 0
    OR public.get_available_balance('ad220000-0000-4000-8000-000000000003') <> 100 THEN
    RAISE EXCEPTION 'FAIL: seller balances were not synchronized';
  END IF;
  board := public.get_sales_board('aprovada','Seller Correto');
  IF board->>'total' <> '1'
    OR board->'items'->0->>'seller_name' <> 'Seller Correto'
    OR board->'items'->0->>'updated_at' IS NULL THEN
    RAISE EXCEPTION 'FAIL: executive sales board attribution/revision';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.executive_audit_events
    WHERE target_id=s.id AND action='sale.reassign'
  ) THEN
    RAISE EXCEPTION 'FAIL: reassignment audit missing';
  END IF;
END; $$;

RESET ROLE;
