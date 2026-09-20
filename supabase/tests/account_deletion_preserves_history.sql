-- Run only inside a transaction that ends in ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES ('de200000-0000-4000-8000-000000000001','delete-admin-qa@example.invalid','{"display_name":"Delete QA Admin"}','{}',now(),now()),
       ('de200000-0000-4000-8000-000000000002','delete-seller-qa@example.invalid','{"display_name":"Delete QA Seller"}','{}',now(),now()),
       ('de200000-0000-4000-8000-000000000003','delete-super-qa@example.invalid','{"display_name":"Delete QA Super"}','{}',now(),now());
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,'Delete QA',email,'seller','approved',now() FROM auth.users WHERE id::text LIKE 'de200000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved';
INSERT INTO public.user_roles(user_id,role)
VALUES ('de200000-0000-4000-8000-000000000001','executive'),
       ('de200000-0000-4000-8000-000000000002','seller'),
       ('de200000-0000-4000-8000-000000000003','super_admin') ON CONFLICT DO NOTHING;
UPDATE public.user_roles SET commission_rate=20 WHERE user_id='de200000-0000-4000-8000-000000000002';

SELECT set_config('request.jwt.claims','{"sub":"de200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
CREATE TEMP TABLE deletion_qa_catalog(product_id uuid,ticket_id uuid);
GRANT ALL ON deletion_qa_catalog TO authenticated;
DO $$ DECLARE p public.products; BEGIN
  p:=public.executive_create_product('Delete QA Product',NULL,'Ticket QA',1000,true);
  INSERT INTO deletion_qa_catalog SELECT p.id,id FROM public.product_tickets WHERE product_id=p.id;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"de200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.vendas(id,user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
SELECT 'de200000-0000-4000-8000-000000000010','de200000-0000-4000-8000-000000000002',product_id,ticket_id,
  'Delete QA Product',1000,'Buyer QA','buyer@example.invalid','11999998888' FROM deletion_qa_catalog;
INSERT INTO public.abordagens(id,user_id,nomes_abordados,dados_abordados,tempo_medio_abordagem,visao_geral)
VALUES ('de200000-0000-4000-8000-000000000011','de200000-0000-4000-8000-000000000002','QA','QA',5,'QA');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"de200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_review_sale('de200000-0000-4000-8000-000000000010','approve');
SELECT set_config('request.jwt.claims','{"sub":"de200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.saques(id,user_id,valor_solicitado,status)
VALUES ('de200000-0000-4000-8000-000000000012','de200000-0000-4000-8000-000000000002',100,'pendente');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);

DO $$ BEGIN
  IF has_function_privilege('authenticated','public.executive_prepare_account_deletion(uuid,uuid,text)','execute') THEN
    RAISE EXCEPTION 'FAIL: authenticated can prepare deletion';
  END IF;
  BEGIN
    PERFORM public.executive_prepare_account_deletion('de200000-0000-4000-8000-000000000001','de200000-0000-4000-8000-000000000001','QA self deletion');
    RAISE EXCEPTION 'FAIL: self deletion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.executive_prepare_account_deletion('de200000-0000-4000-8000-000000000003','de200000-0000-4000-8000-000000000001','QA super deletion');
    RAISE EXCEPTION 'FAIL: executive deleted super admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.executive_prepare_account_deletion('de200000-0000-4000-8000-000000000001','de200000-0000-4000-8000-000000000002','QA seller deletion');
    RAISE EXCEPTION 'FAIL: seller deleted account';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

SELECT public.executive_prepare_account_deletion('de200000-0000-4000-8000-000000000002',
  'de200000-0000-4000-8000-000000000001','QA delete while preserving financial history');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE target_id='de200000-0000-4000-8000-000000000002')
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id='de200000-0000-4000-8000-000000000002' AND suspended) THEN
    RAISE EXCEPTION 'FAIL: account not blocked for deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executive_audit_events WHERE target_id='de200000-0000-4000-8000-000000000002' AND action='account.delete') THEN
    RAISE EXCEPTION 'FAIL: completion audited before Auth deletion';
  END IF;
  BEGIN
    UPDATE public.profiles SET suspended=false WHERE user_id='de200000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'FAIL: pending deletion could be reactivated';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END; $$;

-- A JWT issued before the deletion request must lose direct table access.
SELECT set_config('request.jwt.claims','{"sub":"de200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.vendas WHERE user_id='de200000-0000-4000-8000-000000000002')
    OR EXISTS (SELECT 1 FROM public.saques WHERE user_id='de200000-0000-4000-8000-000000000002')
    OR EXISTS (SELECT 1 FROM public.abordagens WHERE user_id='de200000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL: blocked account retains historical data access';
  END IF;
  BEGIN
    INSERT INTO public.abordagens(user_id,nomes_abordados,dados_abordados,tempo_medio_abordagem,visao_geral)
    VALUES ('de200000-0000-4000-8000-000000000002','QA','QA',5,'QA');
    RAISE EXCEPTION 'FAIL: blocked account can still write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);

-- Simulate the Auth API's deleted_at transition; the whole test rolls back.
UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='de200000-0000-4000-8000-000000000002';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='de200000-0000-4000-8000-000000000002' AND deleted_at IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM public.vendas WHERE id='de200000-0000-4000-8000-000000000010')
    OR NOT EXISTS (SELECT 1 FROM public.abordagens WHERE id='de200000-0000-4000-8000-000000000011')
    OR NOT EXISTS (SELECT 1 FROM public.saques WHERE id='de200000-0000-4000-8000-000000000012') THEN
    RAISE EXCEPTION 'FAIL: financial history or Auth tombstone lost';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE target_id='de200000-0000-4000-8000-000000000002')
    OR (SELECT count(*) FROM public.executive_audit_events
        WHERE target_id='de200000-0000-4000-8000-000000000002' AND action='account.delete') <> 1 THEN
    RAISE EXCEPTION 'FAIL: deletion audit not finalized exactly once';
  END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"de200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  IF (public.executive_list_users()->'users') @> '[{"user_id":"de200000-0000-4000-8000-000000000002"}]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: deleted Auth account still listed';
  END IF;
END; $$;
