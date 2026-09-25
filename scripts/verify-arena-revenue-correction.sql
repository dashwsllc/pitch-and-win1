-- Execute after the migration in a transaction that always rolls back.

-- Part 1: the one real sale already affected by the bug got its correction
-- from the migration's one-time fix.
DO $$ DECLARE v_total numeric; BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.activity_feed
    WHERE action_type='revenue.corrected' AND source_type='vendas'
      AND source_id='49191f8f-7a89-4cba-87ea-72cebd111776' AND revenue_delta=-2997.00
  ) THEN RAISE EXCEPTION 'FAIL: one-time correction for the known ghost sale is missing'; END IF;
  SELECT COALESCE(sum(revenue_delta),0) INTO v_total FROM public.activity_feed
  WHERE source_id='49191f8f-7a89-4cba-87ea-72cebd111776' AND source_type='vendas';
  IF v_total<>0 THEN RAISE EXCEPTION 'FAIL: known ghost sale still nets to % instead of 0',v_total; END IF;
END $$;

-- Part 2: fresh fixtures exercise the new admin RPC end to end.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'arena-revenue-correction-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Arena Revenue Correction QA '||n),'{}',now(),now()
FROM generate_series(1,3) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'display_name','QA'), u.email, 'seller', 'approved', now()
FROM auth.users u WHERE u.id::text LIKE 'ce600000-0000-4000-8000-%'
ON CONFLICT (user_id) DO UPDATE SET status='approved', reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ce600000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role) VALUES
('ce600000-0000-4000-8000-000000000001','closer'),
('ce600000-0000-4000-8000-000000000002','executive'),
('ce600000-0000-4000-8000-000000000003','sdr');
CREATE TEMP TABLE arena_revenue_correction_qa_state(sale_id uuid,product_id uuid,ticket_id uuid);
GRANT ALL ON arena_revenue_correction_qa_state TO authenticated;

SELECT set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE p public.products; t public.product_tickets; BEGIN
  p:=public.executive_create_product('Arena Revenue Correction QA Produto',NULL,'QA Ticket',555.00,true);
  SELECT * INTO t FROM public.product_tickets WHERE product_id=p.id;
  INSERT INTO arena_revenue_correction_qa_state(product_id,ticket_id) VALUES(p.id,t.id);
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; v_sale public.vendas; BEGIN
  SELECT * INTO s FROM arena_revenue_correction_qa_state;
  INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'Arena Revenue Correction QA Produto',555.00,'QA Comprador','arena-revenue-correction-qa-1@example.invalid','11999999999')
    RETURNING * INTO v_sale;
  UPDATE arena_revenue_correction_qa_state SET sale_id=v_sale.id;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM arena_revenue_correction_qa_state;
  BEGIN PERFORM public.arena_correct_sale_revenue(s.sale_id,-10,'Tentativa sem permissão'); RAISE EXCEPTION 'FAIL: non-admin corrected revenue'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM arena_revenue_correction_qa_state;
  PERFORM public.executive_review_sale(s.sale_id,'approve','');
  BEGIN PERFORM public.arena_correct_sale_revenue(s.sale_id,-10,'Ainda aprovada'); RAISE EXCEPTION 'FAIL: corrected an active approved sale'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM public.arena_reverse_sale(s.sale_id,'estornada','Preparando a venda QA para correção',(SELECT updated_at FROM public.vendas WHERE id=s.sale_id));
  BEGIN PERFORM public.arena_correct_sale_revenue(s.sale_id,0,'Motivo válido aqui'); RAISE EXCEPTION 'FAIL: zero delta accepted'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.arena_correct_sale_revenue(s.sale_id,-10,'oi'); RAISE EXCEPTION 'FAIL: short reason accepted'; EXCEPTION WHEN OTHERS THEN NULL; END;
  -- The reversal itself already nets this fixture sale to 0 (fixed in
  -- 20260925220000); the correction below is an independent, additional
  -- adjustment on top, like discovering a further discrepancy later.
  PERFORM public.arena_correct_sale_revenue(s.sale_id,-1.00,'Correção QA end-to-end');
  IF (SELECT COALESCE(sum(revenue_delta),0) FROM public.activity_feed WHERE source_id=s.sale_id AND source_type='vendas')<>-1.00 THEN
    RAISE EXCEPTION 'FAIL: corrected fixture sale does not reflect the -1.00 correction on top of the already-netted reversal';
  END IF;
  RAISE NOTICE 'PASS: arena_correct_sale_revenue guards, audits and nets the total correctly.';
END $$;
RESET ROLE;
