-- Isolated fixtures. Run using scripts/check-crm-payments-db.mjs; always ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('fc000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-pay-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Pay QA '||n),'{}',now(),now()
FROM generate_series(1,5) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,raw_user_meta_data->>'display_name',email,'seller','approved',now()
FROM auth.users WHERE id::text LIKE 'fc000000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved',reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id::text LIKE 'fc000000-%';
-- 1 executive, 2 SDR, 3 Closer, 4 Seller, 5 SDR with explicit Closer access in the CRM.
INSERT INTO public.user_roles(user_id,role,crm_access,crm_closer_access) VALUES
('fc000000-0000-4000-8000-000000000001','executive',true,false),
('fc000000-0000-4000-8000-000000000002','sdr',true,false),
('fc000000-0000-4000-8000-000000000003','closer',true,false),
('fc000000-0000-4000-8000-000000000004','seller',false,false),
('fc000000-0000-4000-8000-000000000005','sdr',true,true)
ON CONFLICT (user_id,role) DO NOTHING;
DO $$
DECLARE f text;
BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE user_id::text LIKE 'fc000000-%') <> 5 THEN RAISE EXCEPTION 'FAIL: fixture profiles'; END IF;
  FOREACH f IN ARRAY ARRAY[
    'public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz)',
    'public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz)',
    'public.crm_payment_delete(uuid,text,timestamptz)',
    'public.crm_lead_payment_summaries()'
  ] LOOP
    IF has_function_privilege('anon',f,'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can execute %',f; END IF;
    IF NOT has_function_privilege('authenticated',f,'EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated cannot execute %',f; END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.crm_lead_payments','SELECT') THEN RAISE EXCEPTION 'FAIL: authenticated cannot read payments'; END IF;
  IF has_table_privilege('authenticated','public.crm_lead_payments','INSERT')
    OR has_table_privilege('authenticated','public.crm_lead_payments','UPDATE')
    OR has_table_privilege('authenticated','public.crm_lead_payments','DELETE')
    OR has_table_privilege('anon','public.crm_lead_payments','SELECT') THEN RAISE EXCEPTION 'FAIL: payments table grants too wide'; END IF;
END; $$;
CREATE TEMP TABLE pay_qa_state(lead_id uuid,p1 uuid,p1_rev timestamptz,p2 uuid,p2_rev timestamptz,p3 uuid,p3_rev timestamptz,due1 date,due2 date);
GRANT ALL ON pay_qa_state TO authenticated;

-- 1. The Closer creates a lead and registers the first payment: it starts pending, with a timeline entry.
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; p public.crm_lead_payments; d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 3;
BEGIN
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('Pay QA Responsável','pay-qa@example.invalid','11999999999','Pay QA Atleta','2012-01-01','Meia') RETURNING * INTO l;
  p:=public.crm_payment_save(l.id,NULL,'Entrada',500,'pix',d,'Sinal combinado',NULL,NULL);
  IF p.status<>'pendente' OR p.paid_at IS NOT NULL OR p.amount<>500 OR p.method<>'pix' OR p.due_date<>d
    OR p.created_by<>auth.uid() OR p.updated_by<>auth.uid() THEN RAISE EXCEPTION 'FAIL: first payment not created pending'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND title='Lançamento de pagamento criado'
    AND user_id=auth.uid() AND new_state->>'payment_status'='pendente' AND description LIKE 'Entrada%') THEN RAISE EXCEPTION 'FAIL: creation missing on the timeline'; END IF;
  INSERT INTO pay_qa_state(lead_id,p1,p1_rev,due1) VALUES(l.id,p.id,p.updated_at,d);
END; $$;

-- 2. Invalid input is refused with nothing written.
DO $$ DECLARE s record; n bigint;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  SELECT count(*) INTO n FROM public.crm_lead_payments WHERE lead_id=s.lead_id;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'Zero',0,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: zero amount'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'Negativo',-10,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: negative amount'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'   ',10,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: blank description'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'Moeda',10,'bitcoin',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: unknown method'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'Link',10,'pix',NULL,NULL,'https://evil.test/comprovante',NULL); RAISE EXCEPTION 'FAIL: non-Drive proof'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'Link',10,'pix',NULL,NULL,'https://drive.google.com.evil.test/x',NULL); RAISE EXCEPTION 'FAIL: lookalike proof host'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(gen_random_uuid(),NULL,'Sem lead',10,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: unknown lead'; EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
  IF (SELECT count(*) FROM public.crm_lead_payments WHERE lead_id=s.lead_id)<>n THEN RAISE EXCEPTION 'FAIL: invalid input wrote rows'; END IF;
END; $$;

-- 3. Second payment (with a Drive proof) and the lead summary.
DO $$ DECLARE s record; p public.crm_lead_payments; sm record;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  p:=public.crm_payment_save(s.lead_id,NULL,'Parcela 2/2',700,'boleto',s.due1+27,NULL,'  https://drive.google.com/file/d/proof/view  ',NULL);
  IF p.proof_url<>'https://drive.google.com/file/d/proof/view' OR p.method<>'boleto' THEN RAISE EXCEPTION 'FAIL: second payment fields'; END IF;
  UPDATE pay_qa_state SET p2=p.id,p2_rev=p.updated_at,due2=s.due1+27;
  SELECT * INTO sm FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id;
  IF sm.total_count<>2 OR sm.paid_count<>0 OR sm.unpaid_count<>0 OR sm.pending_count<>2 OR sm.total_amount<>1200
    OR sm.paid_amount<>0 OR sm.status<>'pendente' OR sm.next_due_date<>s.due1 THEN RAISE EXCEPTION 'FAIL: summary of two pending payments'; END IF;
END; $$;

-- 4. Marking paid / not paid / pending. The status never changes by itself, even after the due date.
DO $$ DECLARE s record; p public.crm_lead_payments; q public.crm_lead_payments; sm record; acts bigint;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  p:=public.crm_payment_set_status(s.p1,'pago',NULL,NULL,s.p1_rev);
  IF p.status<>'pago' OR p.paid_at IS NULL OR p.paid_at>now()+interval '1 minute' OR p.updated_at=s.p1_rev OR p.updated_by<>auth.uid() THEN RAISE EXCEPTION 'FAIL: mark paid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Pagamento marcado como Pago'
    AND previous_state->>'payment_status'='pendente' AND new_state->>'payment_status'='pago') THEN RAISE EXCEPTION 'FAIL: paid missing on the timeline'; END IF;
  UPDATE pay_qa_state SET p1_rev=p.updated_at;
  SELECT * INTO sm FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id;
  IF sm.status<>'pendente' OR sm.paid_count<>1 OR sm.pending_count<>1 OR sm.paid_amount<>500 OR sm.next_due_date<>s.due2 THEN RAISE EXCEPTION 'FAIL: summary with one paid and one pending'; END IF;
  BEGIN PERFORM public.crm_payment_set_status(s.p2,'pago',now()+interval '2 days',NULL,s.p2_rev); RAISE EXCEPTION 'FAIL: future paid date'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_set_status(s.p2,'quitado',NULL,NULL,s.p2_rev); RAISE EXCEPTION 'FAIL: unknown status'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_set_status(s.p2,'nao_pago',NULL,NULL,s.p2_rev); RAISE EXCEPTION 'FAIL: not paid without reason'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_set_status(s.p2,'nao_pago',NULL,'  ',s.p2_rev); RAISE EXCEPTION 'FAIL: not paid with blank reason'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  q:=public.crm_payment_set_status(s.p2,'nao_pago',NULL,'Cartão recusado',s.p2_rev);
  IF q.status<>'nao_pago' OR q.paid_at IS NOT NULL OR q.status_reason<>'Cartão recusado' THEN RAISE EXCEPTION 'FAIL: mark not paid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Pagamento marcado como Não pago'
    AND description LIKE '%Cartão recusado%' AND new_state->>'payment_status'='nao_pago') THEN RAISE EXCEPTION 'FAIL: not paid missing on the timeline'; END IF;
  BEGIN PERFORM public.crm_payment_set_status(s.p2,'pago',NULL,NULL,s.p2_rev); RAISE EXCEPTION 'FAIL: stale revision'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  SELECT * INTO sm FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id;
  IF sm.status<>'nao_pago' OR sm.unpaid_count<>1 OR sm.paid_count<>1 OR sm.pending_count<>0 THEN RAISE EXCEPTION 'FAIL: summary with one not paid'; END IF;
  q:=public.crm_payment_set_status(s.p2,'pago',now()-interval '1 hour',NULL,q.updated_at);
  IF q.status<>'pago' OR q.status_reason IS NOT NULL OR q.paid_at>now()-interval '30 minutes' THEN RAISE EXCEPTION 'FAIL: paid after not paid keeps reason or ignores date'; END IF;
  UPDATE pay_qa_state SET p2_rev=q.updated_at;
  SELECT * INTO sm FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id;
  IF sm.status<>'pago' OR sm.paid_count<>2 OR sm.paid_amount<>1200 OR sm.next_due_date IS NOT NULL THEN RAISE EXCEPTION 'FAIL: summary with everything paid'; END IF;
  p:=public.crm_payment_set_status(s.p1,'pendente',NULL,NULL,p.updated_at);
  IF p.status<>'pendente' OR p.paid_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL: back to pending keeps paid date'; END IF;
  UPDATE pay_qa_state SET p1_rev=p.updated_at;
  SELECT * INTO sm FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id;
  IF sm.status<>'pendente' OR sm.paid_count<>1 OR sm.pending_count<>1 THEN RAISE EXCEPTION 'FAIL: summary after reopening'; END IF;
  SELECT count(*) INTO acts FROM public.crm_activities WHERE lead_id=s.lead_id;
  q:=public.crm_payment_set_status(s.p1,'pendente',NULL,NULL,p.updated_at);
  IF q.updated_at<>p.updated_at OR (SELECT count(*) FROM public.crm_activities WHERE lead_id=s.lead_id)<>acts THEN RAISE EXCEPTION 'FAIL: no-op status change wrote'; END IF;
END; $$;

-- 5. Editing a payment: revisioned, logged, and a no-op writes nothing.
DO $$ DECLARE s record; p public.crm_lead_payments; q public.crm_lead_payments; acts bigint;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  p:=public.crm_payment_save(s.lead_id,s.p1,'Entrada ajustada',550,'cartao_credito',s.due1+1,NULL,NULL,s.p1_rev);
  IF p.amount<>550 OR p.method<>'cartao_credito' OR p.description<>'Entrada ajustada' OR p.status<>'pendente' OR p.updated_at=s.p1_rev THEN RAISE EXCEPTION 'FAIL: edit payment'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Lançamento de pagamento editado'
    AND previous_state->>'payment_amount'='500.00' AND new_state->>'payment_amount'='550.00') THEN RAISE EXCEPTION 'FAIL: edit missing on the timeline'; END IF;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,s.p1,'Outra',1,'pix',NULL,NULL,NULL,s.p1_rev); RAISE EXCEPTION 'FAIL: stale edit'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_save(gen_random_uuid(),s.p1,'Outra',1,'pix',NULL,NULL,NULL,p.updated_at); RAISE EXCEPTION 'FAIL: payment of another lead'; EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
  SELECT count(*) INTO acts FROM public.crm_activities WHERE lead_id=s.lead_id;
  q:=public.crm_payment_save(s.lead_id,s.p1,'Entrada ajustada',550,'cartao_credito',s.due1+1,NULL,NULL,p.updated_at);
  IF q.updated_at<>p.updated_at OR (SELECT count(*) FROM public.crm_activities WHERE lead_id=s.lead_id)<>acts THEN RAISE EXCEPTION 'FAIL: no-op edit wrote'; END IF;
  UPDATE pay_qa_state SET p1_rev=p.updated_at;
END; $$;

-- 6. SDR without Closer access and the Seller read everything but cannot write; direct table writes are closed.
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  IF (SELECT count(*) FROM public.crm_lead_payments WHERE lead_id=s.lead_id)<>2 THEN RAISE EXCEPTION 'FAIL: SDR cannot read payments'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: SDR cannot read the summary'; END IF;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'SDR',10,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: SDR created a payment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_payment_set_status(s.p1,'pago',NULL,NULL,s.p1_rev); RAISE EXCEPTION 'FAIL: SDR changed a status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_payment_delete(s.p1,'Teste de SDR',s.p1_rev); RAISE EXCEPTION 'FAIL: SDR deleted a payment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  IF (SELECT count(*) FROM public.crm_lead_payments WHERE lead_id=s.lead_id)<>2 THEN RAISE EXCEPTION 'FAIL: Seller cannot read payments'; END IF;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'Seller',10,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: Seller created a payment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_payment_set_status(s.p1,'pago',NULL,NULL,s.p1_rev); RAISE EXCEPTION 'FAIL: Seller changed a status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,created_by,updated_by) VALUES(s.lead_id,'Direto',1,auth.uid(),auth.uid()); RAISE EXCEPTION 'FAIL: direct insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.crm_lead_payments SET status='pago',paid_at=now() WHERE id=s.p1; RAISE EXCEPTION 'FAIL: direct update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.crm_lead_payments WHERE id=s.p1; RAISE EXCEPTION 'FAIL: direct delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

-- 7. An SDR with explicit Closer access and the executive can write.
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ DECLARE s record; p public.crm_lead_payments;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  p:=public.crm_payment_save(s.lead_id,NULL,'Parcela extra',90,'dinheiro',NULL,NULL,NULL,NULL);
  IF p.created_by<>auth.uid() THEN RAISE EXCEPTION 'FAIL: SDR with Closer access did not create'; END IF;
  UPDATE pay_qa_state SET p3=p.id,p3_rev=p.updated_at;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s record; p public.crm_lead_payments;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  p:=public.crm_payment_set_status(s.p3,'pago',NULL,NULL,s.p3_rev);
  IF p.status<>'pago' OR p.updated_by<>auth.uid() THEN RAISE EXCEPTION 'FAIL: executive could not mark paid'; END IF;
  UPDATE pay_qa_state SET p3_rev=p.updated_at;
END; $$;

-- 8. Removing a payment needs a reason, is revisioned and stays on the timeline.
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  BEGIN PERFORM public.crm_payment_delete(s.p3,NULL,s.p3_rev); RAISE EXCEPTION 'FAIL: delete without reason'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_delete(s.p3,'  ',s.p3_rev); RAISE EXCEPTION 'FAIL: delete with blank reason'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_payment_delete(s.p3,'Lançado por engano',s.p3_rev-interval '1 second'); RAISE EXCEPTION 'FAIL: stale delete'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM public.crm_payment_delete(s.p3,'Lançado por engano',s.p3_rev);
  IF EXISTS(SELECT 1 FROM public.crm_lead_payments WHERE id=s.p3) THEN RAISE EXCEPTION 'FAIL: payment not removed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Lançamento de pagamento removido'
    AND description LIKE 'Parcela extra%Lançado por engano%' AND user_id=auth.uid()) THEN RAISE EXCEPTION 'FAIL: removal missing on the timeline'; END IF;
  BEGIN PERFORM public.crm_payment_delete(s.p3,'Segunda vez',s.p3_rev); RAISE EXCEPTION 'FAIL: deleted twice'; EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
END; $$;

-- 9. Table constraints hold even for the table owner.
RESET ROLE;
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,status,created_by,updated_by) VALUES(s.lead_id,'Pago sem data',1,'pago','fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: paid without date'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,status,paid_at,created_by,updated_by) VALUES(s.lead_id,'Pendente com data',1,'pendente',now(),'fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: pending with paid date'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,status,created_by,updated_by) VALUES(s.lead_id,'Não pago sem motivo',1,'nao_pago','fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: not paid without reason'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,created_by,updated_by) VALUES(s.lead_id,'Valor zero',0,'fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: zero amount row'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,method,created_by,updated_by) VALUES(s.lead_id,'Forma inválida',1,'bitcoin','fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: unknown method row'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.crm_lead_payments(lead_id,description,amount,proof_url,created_by,updated_by) VALUES(s.lead_id,'Link ruim',1,'http://drive.google.com/x','fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: insecure proof row'; EXCEPTION WHEN check_violation THEN NULL; END;
END; $$;

-- 10. Deleting the lead takes its payments along (the lead deletion flow stays intact).
SELECT set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; v bigint;
BEGIN
  SELECT * INTO s FROM pay_qa_state;
  SELECT version INTO v FROM public.crm_leads WHERE id=s.lead_id;
  PERFORM public.crm_delete_lead(s.lead_id,v);
  IF EXISTS(SELECT 1 FROM public.crm_lead_payments WHERE lead_id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: payments survived the lead'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_lead_payment_summaries() WHERE lead_id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: summary survived the lead'; END IF;
END; $$;
RESET ROLE;
