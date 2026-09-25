-- Execute after the migration in a transaction that always rolls back.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'arena-revenue-fix-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Arena Revenue Fix QA '||n),'{}',now(),now()
FROM generate_series(1,2) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'display_name','QA'), u.email, 'seller', 'approved', now()
FROM auth.users u WHERE u.id::text LIKE 'ce500000-0000-4000-8000-%'
ON CONFLICT (user_id) DO UPDATE SET status='approved', reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ce500000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role) VALUES
('ce500000-0000-4000-8000-000000000001','closer'),
('ce500000-0000-4000-8000-000000000002','executive');
CREATE TEMP TABLE arena_revenue_fix_qa_state(sale_id uuid,product_id uuid,ticket_id uuid);
GRANT ALL ON arena_revenue_fix_qa_state TO authenticated;

-- Executive publishes a catalog product/ticket for the fixture sale.
SELECT set_config('request.jwt.claims','{"sub":"ce500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE p public.products; t public.product_tickets; BEGIN
  p:=public.executive_create_product('Arena Revenue Fix QA Produto',NULL,'QA Ticket',1234.56,true);
  SELECT * INTO t FROM public.product_tickets WHERE product_id=p.id;
  INSERT INTO arena_revenue_fix_qa_state(product_id,ticket_id) VALUES(p.id,t.id);
END $$;

-- Closer registers and gets an approved sale, never edited afterwards —
-- exactly the case that used to net the reversal to zero.
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; v_sale public.vendas; BEGIN
  SELECT * INTO s FROM arena_revenue_fix_qa_state;
  INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'Arena Revenue Fix QA Produto',1234.56,'QA Comprador','arena-revenue-fix-qa-1@example.invalid','11999999999')
    RETURNING * INTO v_sale;
  UPDATE arena_revenue_fix_qa_state SET sale_id=v_sale.id;
END $$;

-- Executive reverses it through the real admin flow.
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; v_sale public.vendas; v_approved public.activity_feed; v_reversed public.activity_feed; BEGIN
  SELECT * INTO s FROM arena_revenue_fix_qa_state;
  PERFORM public.executive_review_sale(s.sale_id,'approve','');
  SELECT * INTO v_sale FROM public.vendas WHERE id=s.sale_id;
  SELECT * INTO v_approved FROM public.activity_feed WHERE event_key='sale.approved:'||v_sale.id;
  IF v_approved.id IS NULL OR v_approved.revenue_delta<>1234.56 THEN RAISE EXCEPTION 'FAIL: sale.approved not emitted correctly: %',to_jsonb(v_approved); END IF;
  PERFORM public.arena_reverse_sale(v_sale.id,'estornada','Correção QA da reversão de receita',v_sale.updated_at);
  SELECT * INTO v_reversed FROM public.activity_feed WHERE event_key='sale.reversed:'||v_sale.id;
  IF v_reversed.id IS NULL THEN RAISE EXCEPTION 'FAIL: sale.reversed not emitted'; END IF;
  IF v_reversed.revenue_delta<>-1234.56 THEN
    RAISE EXCEPTION 'FAIL: reversal revenue_delta should fully undo the original (-1234.56), got %',v_reversed.revenue_delta;
  END IF;
  IF v_reversed.score_delta<>-v_approved.score_delta THEN RAISE EXCEPTION 'FAIL: score reversal regressed'; END IF;
  IF (SELECT COALESCE(sum(revenue_delta),0) FROM public.activity_feed WHERE source_id=v_sale.id AND source_type='vendas')<>0 THEN
    RAISE EXCEPTION 'FAIL: activity_feed still shows leftover revenue for a reversed sale';
  END IF;
  RAISE NOTICE 'PASS: sale.reversed fully undoes the originally counted revenue, no ghost total left.';
END $$;
RESET ROLE;
