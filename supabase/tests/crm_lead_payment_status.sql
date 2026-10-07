-- Isolated fixtures. Run using scripts/check-crm-payment-status-db.mjs; always ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-paystatus-qa-'||n||'@example.invalid',jsonb_build_object('display_name','PayStatus QA '||n),'{}',now(),now()
FROM generate_series(1,9) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,raw_user_meta_data->>'display_name',email,'seller','approved',now()
FROM auth.users WHERE id::text LIKE 'fd000000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved',reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id::text LIKE 'fd000000-%';
-- 1 executive, 2 SDR, 3 Closer, 4 Seller, 5 SDR with explicit Closer access in the CRM.
INSERT INTO public.user_roles(user_id,role,crm_access,crm_closer_access) VALUES
('fd000000-0000-4000-8000-000000000001','executive',true,false),
('fd000000-0000-4000-8000-000000000002','sdr',true,false),
('fd000000-0000-4000-8000-000000000003','closer',true,false),
('fd000000-0000-4000-8000-000000000004','seller',false,false),
('fd000000-0000-4000-8000-000000000005','sdr',true,true),
('fd000000-0000-4000-8000-000000000006','closer',true,false),
('fd000000-0000-4000-8000-000000000007','closer',true,false),
('fd000000-0000-4000-8000-000000000008','traffic_manager',false,false),
('fd000000-0000-4000-8000-000000000009','closer',true,false)
ON CONFLICT (user_id,role) DO NOTHING;
UPDATE public.profiles SET suspended=true WHERE user_id='fd000000-0000-4000-8000-000000000006';
UPDATE public.registration_requests SET status='pending' WHERE user_id='fd000000-0000-4000-8000-000000000007';
UPDATE auth.users SET deleted_at=now() WHERE id='fd000000-0000-4000-8000-000000000009';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE user_id::text LIKE 'fd000000-%') <> 9 THEN RAISE EXCEPTION 'FAIL: fixture profiles'; END IF;
  IF has_function_privilege('anon','public.crm_set_payment_status(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can set the payment status'; END IF;
  IF NOT has_function_privilege('authenticated','public.crm_set_payment_status(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated cannot set the payment status'; END IF;
  IF NOT has_table_privilege('authenticated','public.crm_lead_payment_status','SELECT') THEN RAISE EXCEPTION 'FAIL: authenticated cannot read the payment status'; END IF;
  IF has_table_privilege('authenticated','public.crm_lead_payment_status','INSERT')
    OR has_table_privilege('authenticated','public.crm_lead_payment_status','UPDATE')
    OR has_table_privilege('authenticated','public.crm_lead_payment_status','DELETE')
    OR has_table_privilege('anon','public.crm_lead_payment_status','SELECT') THEN RAISE EXCEPTION 'FAIL: payment status table grants too wide'; END IF;
  -- Legacy readers/data survive; stale clients cannot keep writing to the retired model.
  IF to_regclass('public.crm_lead_payments') IS NULL
    OR to_regprocedure('public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz)') IS NULL
    OR to_regprocedure('public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz)') IS NULL
    OR to_regprocedure('public.crm_payment_delete(uuid,text,timestamptz)') IS NULL
    OR to_regprocedure('public.crm_lead_payment_summaries()') IS NULL THEN RAISE EXCEPTION 'FAIL: legacy payment preservation'; END IF;
  IF has_function_privilege('authenticated','public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz)','EXECUTE')
    OR has_function_privilege('authenticated','public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz)','EXECUTE')
    OR has_function_privilege('authenticated','public.crm_payment_delete(uuid,text,timestamptz)','EXECUTE')
    OR has_function_privilege('anon','public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz)','EXECUTE')
    OR has_function_privilege('anon','public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz)','EXECUTE')
    OR has_function_privilege('anon','public.crm_payment_delete(uuid,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: legacy payment writes enabled'; END IF;
  IF EXISTS(SELECT 1 FROM paystatus_legacy_snapshot old
    FULL JOIN public.crm_lead_payments p ON p.id=old.id
    WHERE old.row_data IS DISTINCT FROM to_jsonb(p)) THEN RAISE EXCEPTION 'FAIL: migration changed legacy payment data'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='crm_lead_payment_status') THEN RAISE EXCEPTION 'FAIL: missing realtime'; END IF;
  IF EXISTS(SELECT 1 FROM paystatus_backfill_expectations e LEFT JOIN public.crm_lead_payment_status s USING(lead_id)
    WHERE s.status IS DISTINCT FROM e.status OR s.updated_by IS DISTINCT FROM e.updated_by OR s.updated_at IS DISTINCT FROM e.updated_at)
    THEN RAISE EXCEPTION 'FAIL: legacy aggregate backfill or author/time'; END IF;
END; $$;
CREATE TEMP TABLE paystatus_qa_state(lead_id uuid,lead2_id uuid);
GRANT ALL ON paystatus_qa_state TO authenticated;

-- 1. The Closer creates a lead. It has no payment status until someone picks one.
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; l2 public.crm_leads;
BEGIN
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('PayStatus QA Responsável','paystatus-qa@example.invalid','11999999999','PayStatus QA Atleta','2012-01-01','Meia') RETURNING * INTO l;
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('PayStatus QA Outro','paystatus-qa2@example.invalid','11888888888','PayStatus QA Outro Atleta','2012-02-02','Zagueiro') RETURNING * INTO l2;
  IF EXISTS(SELECT 1 FROM public.crm_lead_payment_status WHERE lead_id IN (l.id,l2.id)) THEN RAISE EXCEPTION 'FAIL: a new lead already has a payment status'; END IF;
  INSERT INTO paystatus_qa_state(lead_id,lead2_id) VALUES(l.id,l2.id);
END; $$;

-- 2. Picking a status, then changing it: one row per lead, a timeline entry per real change.
DO $$ DECLARE s record; r public.crm_lead_payment_status; v bigint; lead_before jsonb; revision_before bigint;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  SELECT version INTO v FROM public.crm_leads WHERE id=s.lead_id;
  SELECT to_jsonb(l) INTO lead_before FROM public.crm_leads l WHERE id=s.lead_id;
  SELECT revision INTO revision_before FROM public.dashboard_events WHERE topic='crm';
  r:=public.crm_set_payment_status(s.lead_id,'pendente');
  IF r.status<>'pendente' OR r.lead_id<>s.lead_id OR r.updated_by<>auth.uid() OR r.updated_at IS NULL THEN RAISE EXCEPTION 'FAIL: first status not stored'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Pagamento marcado como Pendente'
    AND user_id=auth.uid() AND previous_state IS NULL AND new_state->>'payment_status'='pendente'
    AND created_at IS NOT NULL AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL: first status missing on the timeline'; END IF;
  r:=public.crm_set_payment_status(s.lead_id,'pago');
  IF r.status<>'pago' THEN RAISE EXCEPTION 'FAIL: change to Pago'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Pagamento marcado como Pago'
    AND previous_state->>'payment_status'='pendente' AND new_state->>'payment_status'='pago') THEN RAISE EXCEPTION 'FAIL: change to Pago missing on the timeline'; END IF;
  r:=public.crm_set_payment_status(s.lead_id,'nao_pago');
  IF r.status<>'nao_pago' THEN RAISE EXCEPTION 'FAIL: change to Não pago'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Pagamento marcado como Não pago'
    AND previous_state->>'payment_status'='pago' AND new_state->>'payment_status'='nao_pago') THEN RAISE EXCEPTION 'FAIL: change to Não pago missing on the timeline'; END IF;
  r:=public.crm_set_payment_status(s.lead_id,'pendente');
  IF r.status<>'pendente' THEN RAISE EXCEPTION 'FAIL: back to Pendente'; END IF;
  IF (SELECT count(*) FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id)<>1 THEN RAISE EXCEPTION 'FAIL: more than one status for a lead'; END IF;
  IF (SELECT version FROM public.crm_leads WHERE id=s.lead_id)<>v THEN RAISE EXCEPTION 'FAIL: a payment status must not bump the lead version'; END IF;
  IF (SELECT count(*) FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id AND status='pendente')<>1 THEN RAISE EXCEPTION 'FAIL: the other lead was affected'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_lead_payment_status WHERE lead_id=s.lead2_id) THEN RAISE EXCEPTION 'FAIL: the other lead got a status'; END IF;
  IF (SELECT to_jsonb(l) FROM public.crm_leads l WHERE id=s.lead_id) IS DISTINCT FROM lead_before THEN RAISE EXCEPTION 'FAIL: payment status changed the lead'; END IF;
  IF (SELECT revision FROM public.dashboard_events WHERE topic='crm')<=revision_before THEN RAISE EXCEPTION 'FAIL: no CRM refresh signal'; END IF;
  IF (SELECT count(*) FROM public.crm_activities WHERE lead_id=s.lead_id AND new_state ? 'payment_status')<>4 THEN RAISE EXCEPTION 'FAIL: timeline entries must match actual payment changes'; END IF;
END; $$;

-- Legacy writes must fail even for a Closer (a stale browser cannot fork payment truth).
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  BEGIN PERFORM public.crm_payment_save(s.lead_id,NULL,'QA',100,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: legacy save'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_payment_set_status(gen_random_uuid(),'pago',NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: legacy status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_payment_delete(gen_random_uuid(),'QA motivo',NULL); RAISE EXCEPTION 'FAIL: legacy delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

-- 3. Picking the same status again writes nothing.
DO $$ DECLARE s record; r public.crm_lead_payment_status; before_row public.crm_lead_payment_status; acts bigint; revision_before bigint; tuple_before tid;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  SELECT * INTO before_row FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id;
  SELECT count(*) INTO acts FROM public.crm_activities WHERE lead_id=s.lead_id;
  SELECT revision INTO revision_before FROM public.dashboard_events WHERE topic='crm';
  SELECT ctid INTO tuple_before FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id;
  r:=public.crm_set_payment_status(s.lead_id,'pendente');
  IF r IS DISTINCT FROM before_row OR (SELECT count(*) FROM public.crm_activities WHERE lead_id=s.lead_id)<>acts
    OR (SELECT revision FROM public.dashboard_events WHERE topic='crm')<>revision_before
    OR (SELECT ctid FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id)<>tuple_before THEN RAISE EXCEPTION 'FAIL: same status wrote'; END IF;
END; $$;

-- 4. Invalid input is refused with nothing written.
DO $$ DECLARE s record; acts bigint;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  SELECT count(*) INTO acts FROM public.crm_activities WHERE lead_id=s.lead_id;
  BEGIN PERFORM public.crm_set_payment_status(s.lead_id,'quitado'); RAISE EXCEPTION 'FAIL: unknown status'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_set_payment_status(s.lead_id,NULL); RAISE EXCEPTION 'FAIL: null status'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_set_payment_status(s.lead_id,''); RAISE EXCEPTION 'FAIL: empty status'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.crm_set_payment_status(gen_random_uuid(),'pago'); RAISE EXCEPTION 'FAIL: unknown lead'; EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
  IF (SELECT status FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id)<>'pendente'
    OR (SELECT count(*) FROM public.crm_activities WHERE lead_id=s.lead_id)<>acts THEN RAISE EXCEPTION 'FAIL: invalid input wrote'; END IF;
END; $$;

-- 5. SDR without Closer access and the Seller read the status but cannot change it; direct table writes are closed.
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  IF (SELECT status FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id) IS DISTINCT FROM 'pendente' THEN RAISE EXCEPTION 'FAIL: SDR cannot read the status'; END IF;
  BEGIN PERFORM public.crm_set_payment_status(s.lead_id,'pago'); RAISE EXCEPTION 'FAIL: SDR changed the status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  IF (SELECT status FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id) IS DISTINCT FROM 'pendente' THEN RAISE EXCEPTION 'FAIL: Seller cannot read the status'; END IF;
  BEGIN PERFORM public.crm_set_payment_status(s.lead_id,'pago'); RAISE EXCEPTION 'FAIL: Seller changed the status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  BEGIN INSERT INTO public.crm_lead_payment_status(lead_id,status,updated_by) VALUES(s.lead2_id,'pago',auth.uid()); RAISE EXCEPTION 'FAIL: direct insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.crm_lead_payment_status SET status='pago' WHERE lead_id=s.lead_id; RAISE EXCEPTION 'FAIL: direct update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id; RAISE EXCEPTION 'FAIL: direct delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

-- 6. An SDR with explicit Closer access and the executive can set it.
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ DECLARE s record; r public.crm_lead_payment_status;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  r:=public.crm_set_payment_status(s.lead2_id,'nao_pago');
  IF r.status<>'nao_pago' OR r.updated_by<>auth.uid() THEN RAISE EXCEPTION 'FAIL: SDR with Closer access could not set'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s record; r public.crm_lead_payment_status;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  r:=public.crm_set_payment_status(s.lead2_id,'pago');
  IF r.status<>'pago' OR r.updated_by<>auth.uid() THEN RAISE EXCEPTION 'FAIL: executive could not set'; END IF;
END; $$;

-- Suspended, unapproved, non-CRM and deleted users cannot read or mutate status.
DO $$ DECLARE s record; n integer;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  FOR n IN 6..9 LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','fd000000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated')::text,true);
    IF EXISTS(SELECT 1 FROM public.crm_lead_payment_status WHERE lead_id IN(s.lead_id,s.lead2_id)) THEN RAISE EXCEPTION 'FAIL: blocked user % read payment status',n; END IF;
    BEGIN PERFORM public.crm_set_payment_status(s.lead2_id,'nao_pago'); RAISE EXCEPTION 'FAIL: blocked user % changed payment status',n; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

-- 7. The table constraint holds even for the table owner.
RESET ROLE;
-- An old RPC already entered before EXECUTE was revoked still runs as owner. Exercise
-- that path with authenticated claims: retiring writes must be enforced inside the DB too.
DO $$ DECLARE s record; p public.crm_lead_payments;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  BEGIN PERFORM public.crm_payment_save(s.lead2_id,NULL,'Stale browser',100,'pix',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL: in-flight legacy save wrote after migration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT * INTO p FROM public.crm_lead_payments WHERE lead_id='fe100000-0000-4000-8000-000000000001' LIMIT 1;
  IF FOUND THEN
    BEGIN PERFORM public.crm_payment_set_status(p.id,'pendente',NULL,NULL,p.updated_at); RAISE EXCEPTION 'FAIL: in-flight legacy status wrote after migration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.crm_payment_delete(p.id,'Stale browser',p.updated_at); RAISE EXCEPTION 'FAIL: in-flight legacy delete wrote after migration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END IF;
END; $$;
DO $$ DECLARE s record;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  BEGIN UPDATE public.crm_lead_payment_status SET status='quitado' WHERE lead_id=s.lead_id; RAISE EXCEPTION 'FAIL: unknown status row'; EXCEPTION WHEN check_violation THEN NULL; END;
END; $$;

-- 8. Deleting the lead takes its status along (the lead deletion flow stays intact).
SELECT set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; v bigint;
BEGIN
  SELECT * INTO s FROM paystatus_qa_state;
  SELECT version INTO v FROM public.crm_leads WHERE id=s.lead_id;
  PERFORM public.crm_delete_lead(s.lead_id,v);
  IF EXISTS(SELECT 1 FROM public.crm_lead_payment_status WHERE lead_id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: status survived the lead'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_lead_payment_status WHERE lead_id=s.lead2_id) THEN RAISE EXCEPTION 'FAIL: deleting a lead removed another lead''s status'; END IF;
END; $$;
-- The retired write guard must still permit the audited lead cascade with legacy rows.
DO $$ DECLARE v bigint;
BEGIN
  SELECT version INTO v FROM public.crm_leads WHERE id='fe100000-0000-4000-8000-000000000001';
  IF FOUND THEN
    PERFORM public.crm_delete_lead('fe100000-0000-4000-8000-000000000001',v);
    IF EXISTS(SELECT 1 FROM public.crm_lead_payments WHERE lead_id='fe100000-0000-4000-8000-000000000001')
      OR EXISTS(SELECT 1 FROM public.crm_lead_payment_status WHERE lead_id='fe100000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: legacy payment guard blocked lead deletion'; END IF;
  END IF;
END; $$;
RESET ROLE;
