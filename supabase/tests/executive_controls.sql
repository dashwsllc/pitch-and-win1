-- All fixtures run inside the enclosing rollback-only transaction.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES ('aa000000-0000-4000-8000-000000000001','executive-check@example.invalid','{"display_name":"QA Executive"}','{}',now(),now()),
('aa000000-0000-4000-8000-000000000002','seller-check@example.invalid','{"display_name":"QA Seller"}','{}',now(),now());
INSERT INTO public.user_roles(user_id,role) VALUES ('aa000000-0000-4000-8000-000000000001','executive');
UPDATE public.user_roles SET commission_rate=20 WHERE user_id='aa000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
INSERT INTO public.vendas(id,user_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
VALUES ('bb000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002','QA Product',1000,'Private buyer','private@example.invalid','private');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_sales_board('pendente','QA Product');
  IF r->>'total' <> '1' OR r->'items'->0 ? 'email_comprador' THEN RAISE EXCEPTION 'FAIL: pending shared feed privacy'; END IF;
  BEGIN PERFORM public.executive_review_sale('bb000000-0000-4000-8000-000000000001','approve');
    RAISE EXCEPTION 'FAIL: seller could approve'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.vendas SET approval_status='aprovada' WHERE id='bb000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: direct self approval'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_list_users(); RAISE EXCEPTION 'FAIL: seller saw auth data'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.executive_audit_events) THEN RAISE EXCEPTION 'FAIL: seller read private audit'; END IF;
  IF EXISTS(SELECT 1 FROM public.dashboard_events WHERE topic IN ('users','audit')) THEN RAISE EXCEPTION 'FAIL: seller read private events'; END IF;
  BEGIN INSERT INTO public.executive_audit_events(actor_name,action,target_id,target_label,reason) VALUES('spoof','sale.delete',gen_random_uuid(),'spoof','Spoof test');
    RAISE EXCEPTION 'FAIL: audit could be forged'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.executive_review_sale('bb000000-0000-4000-8000-000000000001','approve','','pendente');
DO $$
BEGIN
  IF (SELECT commission_amount FROM public.vendas WHERE id='bb000000-0000-4000-8000-000000000001') <> 200 THEN RAISE EXCEPTION 'FAIL: commission'; END IF;
  IF public.get_available_balance('aa000000-0000-4000-8000-000000000002') <> 200 THEN RAISE EXCEPTION 'FAIL: approved balance'; END IF;
  BEGIN PERFORM public.executive_review_sale('bb000000-0000-4000-8000-000000000001','approve');
    RAISE EXCEPTION 'FAIL: double approval'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
INSERT INTO public.saques(id,user_id,valor_solicitado,status) VALUES
('cc000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002',150,'pendente');
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
BEGIN
  IF public.get_available_balance('aa000000-0000-4000-8000-000000000002') <> 50 THEN RAISE EXCEPTION 'FAIL: reservation'; END IF;
  BEGIN PERFORM public.executive_review_sale('bb000000-0000-4000-8000-000000000001','delete','QA deletion reason','aprovada');
    RAISE EXCEPTION 'FAIL: committed commission deleted'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
END; $$;
SELECT public.executive_cancel_withdrawal('cc000000-0000-4000-8000-000000000001','QA regularize reservation');
SELECT public.executive_review_sale('bb000000-0000-4000-8000-000000000001','delete','QA deletion reason','aprovada');
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.vendas WHERE id='bb000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: approved sale not deleted'; END IF;
  IF public.get_available_balance('aa000000-0000-4000-8000-000000000002') <> 0 THEN RAISE EXCEPTION 'FAIL: deleted balance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.executive_audit_events WHERE target_id='bb000000-0000-4000-8000-000000000001' AND action='sale.delete' AND before_data->>'nome_comprador'='Private buyer') THEN RAISE EXCEPTION 'FAIL: deletion snapshot missing'; END IF;
  IF public.get_sales_board('aprovada','QA Product')->>'total' <> '0' THEN RAISE EXCEPTION 'FAIL: deleted sale still in feed'; END IF;
END; $$;
-- Sellers retain cancellation of their own unreviewed requests.
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
INSERT INTO public.vendas(id,user_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
VALUES ('bb000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000002','QA Cancel',100,'Buyer','private@example.invalid','private');
DELETE FROM public.vendas WHERE id='bb000000-0000-4000-8000-000000000002';
DO $$ BEGIN
  IF public.get_sales_board('pendente','QA Cancel')->>'total'<>'0' THEN RAISE EXCEPTION 'FAIL: own pending cancellation'; END IF;
END; $$;
RESET ROLE;
-- Simulate Auth Admin API trusted metadata. All updates and trigger effects must be atomic.
SELECT set_config('request.jwt.claims','{}',true);
UPDATE auth.users SET email='changed-check@example.invalid',last_sign_in_at='2026-09-07T12:34:56.123456Z',
 raw_app_meta_data=jsonb_build_object('dashboard_account',jsonb_build_object(
 'actor_id','aa000000-0000-4000-8000-000000000001','revision','test-revision','expected_revision','',
 'expected_updated_at',(SELECT updated_at FROM public.profiles WHERE user_id='aa000000-0000-4000-8000-000000000002'),
 'display_name','QA Updated','avatar_url','','roles','["seller","sdr"]'::jsonb,'commission_rate',0,
 'crm_access',true,'can_view_sales',false,'suspended',false,'reason','QA account edit'))
 WHERE id='aa000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE r jsonb;
BEGIN
  SELECT x INTO r FROM jsonb_array_elements(public.executive_list_users()->'users') x WHERE x->>'user_id'='aa000000-0000-4000-8000-000000000002';
  IF r->>'email'<>'changed-check@example.invalid' OR r->>'display_name'<>'QA Updated' OR (r->>'last_sign_in_at')::timestamptz<>'2026-09-07T12:34:56.123456Z'::timestamptz THEN RAISE EXCEPTION 'FAIL: account or exact login'; END IF;
  IF (SELECT count(*) FROM public.user_roles WHERE user_id='aa000000-0000-4000-8000-000000000002' AND commission_rate=0)<>2 THEN RAISE EXCEPTION 'FAIL: roles or zero commission'; END IF;
  BEGIN
    UPDATE auth.users SET email='must-rollback@example.invalid',raw_app_meta_data=jsonb_set(raw_app_meta_data,'{dashboard_account,revision}','"second-revision"')
      WHERE id='aa000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'FAIL: stale edit allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  IF (SELECT email FROM auth.users WHERE id='aa000000-0000-4000-8000-000000000002')<>'changed-check@example.invalid' THEN RAISE EXCEPTION 'FAIL: auth update not rolled back'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET suspended=true WHERE user_id='aa000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claims','{"sub":"aa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.get_sales_board(); RAISE EXCEPTION 'FAIL: suspended account saw feed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SELECT 'PASS: privacy, role enforcement, approval, double review, commission reservation, deletion + audit, atomic account edits, zero commission, stale-write rejection, exact Auth login timestamp' AS verification;
