-- All fixtures and test-only triggers are rolled back by the runner.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('a9120000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'registration-qa-' || n || '@example.invalid',
  jsonb_build_object('display_name', 'Registration QA ' || n, 'role', 'executive', 'status', 'approved'), '{}', now(), now()
FROM generate_series(1,3) n;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.registration_requests WHERE user_id::text LIKE 'a9120000-%' AND status='pending' AND requested_role='seller') <> 3 THEN RAISE EXCEPTION 'FAIL atomic pending requests'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id::text LIKE 'a9120000-%' AND role::text <> 'seller') THEN RAISE EXCEPTION 'FAIL role spoof'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM public.registration_requests r WHERE r.user_id=u.id)) THEN RAISE EXCEPTION 'FAIL missing request'; END IF;
END; $$;
-- Public metadata never assigns a role. The Super Admin chooses it after
-- approving the account.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES(
  'a9120000-0000-4000-8000-000000000005',
  'registration-role-qa@example.invalid',
  '{"display_name":"Registration Role QA","requested_role":"closer"}',
  '{}', now(), now()
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.registration_requests WHERE user_id='a9120000-0000-4000-8000-000000000005' AND requested_role='seller') THEN RAISE EXCEPTION 'FAIL public role metadata ignored in queue'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='a9120000-0000-4000-8000-000000000005' AND role::text='seller') THEN RAISE EXCEPTION 'FAIL default role provision'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='a9120000-0000-4000-8000-000000000005' AND role::text='closer') THEN RAISE EXCEPTION 'FAIL public operational role assignment'; END IF;
END; $$;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES(
  'a9120000-0000-4000-8000-000000000006',
  'registration-restricted-role-qa@example.invalid',
  '{"display_name":"Restricted Role QA","requested_role":"executive"}',
  '{}', now(), now()
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.registration_requests WHERE user_id='a9120000-0000-4000-8000-000000000006' AND requested_role='seller') THEN RAISE EXCEPTION 'FAIL restricted requested role fallback'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='a9120000-0000-4000-8000-000000000006' AND role::text='seller') THEN RAISE EXCEPTION 'FAIL restricted provision fallback'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='a9120000-0000-4000-8000-000000000006' AND role::text IN ('executive','super_admin')) THEN RAISE EXCEPTION 'FAIL administrative role self assignment'; END IF;
END; $$;
-- Bootstrap only this disposable reviewer; existing accounts are untouched.
UPDATE public.registration_requests SET status='approved' WHERE user_id='a9120000-0000-4000-8000-000000000001';
INSERT INTO public.user_roles(user_id,role) VALUES('a9120000-0000-4000-8000-000000000001','executive');

SELECT set_config('request.jwt.claims','{"sub":"a9120000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_registration_status()->>'status' <> 'pending' THEN RAISE EXCEPTION 'FAIL own pending state'; END IF;
  IF public.registration_has_access() THEN RAISE EXCEPTION 'FAIL pending access'; END IF;
  IF (SELECT count(*) FROM public.registration_requests) <> 1 THEN RAISE EXCEPTION 'FAIL private requests'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM public.products) OR EXISTS(SELECT 1 FROM public.crm_leads) THEN RAISE EXCEPTION 'FAIL pending table reads'; END IF;
  BEGIN UPDATE public.registration_requests SET status='approved' WHERE user_id=auth.uid(); RAISE EXCEPTION 'FAIL self approval'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_review_registration(auth.uid(),'approve'); RAISE EXCEPTION 'FAIL seller review'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.abordagens(user_id,nomes_abordados,tempo_medio_abordagem,visao_geral,dados_abordados,mostrou_ia) VALUES(auth.uid(),'QA',1,'QA','QA',false); RAISE EXCEPTION 'FAIL pending write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.path','/rpc/get_sales_board',true);
  BEGIN PERFORM public.check_registration_access(); RAISE EXCEPTION 'FAIL pending RPC gate'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.path','/rpc/get_my_registration_status',true);
  PERFORM public.check_registration_access();
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"a9120000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE requests jsonb; BEGIN
  requests := public.executive_list_registration_requests();
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(requests) r WHERE r->>'user_id'='a9120000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'FAIL executive queue'; END IF;
  PERFORM public.executive_review_registration('a9120000-0000-4000-8000-000000000002','approve');
  PERFORM public.executive_review_registration('a9120000-0000-4000-8000-000000000003','reject');
  BEGIN PERFORM public.executive_review_registration('a9120000-0000-4000-8000-000000000002','reject'); RAISE EXCEPTION 'FAIL stale decision'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  IF (SELECT count(*) FROM public.executive_audit_events WHERE actor_id=auth.uid() AND action LIKE 'registration.%') <> 2 THEN RAISE EXCEPTION 'FAIL decision audit'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"a9120000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_registration_status()->>'status' <> 'approved' OR NOT public.registration_has_access() THEN RAISE EXCEPTION 'FAIL approval propagation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'FAIL approved access'; END IF;
  PERFORM set_config('request.path','/rpc/get_sales_board',true);
  PERFORM public.check_registration_access();
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a9120000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_registration_status()->>'status' <> 'rejected' OR public.registration_has_access() THEN RAISE EXCEPTION 'FAIL rejection propagation'; END IF;
  BEGIN PERFORM public.check_registration_access(); RAISE EXCEPTION 'FAIL rejected access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);

-- If the queue cannot persist, no orphaned Auth account may survive.
CREATE FUNCTION pg_temp.fail_registration_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.email = 'registration-rollback@example.invalid' THEN RAISE EXCEPTION 'Simulated queue failure' USING ERRCODE='P0002'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER registration_fixture_failure BEFORE INSERT ON public.registration_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_registration_fixture();
DO $$ BEGIN
  BEGIN
    INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    VALUES('a9120000-0000-4000-8000-000000000004','registration-rollback@example.invalid','{}','{}',now(),now());
    RAISE EXCEPTION 'FAIL queue failure accepted';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id='a9120000-0000-4000-8000-000000000004') OR EXISTS(SELECT 1 FROM public.profiles WHERE user_id='a9120000-0000-4000-8000-000000000004') THEN RAISE EXCEPTION 'FAIL orphaned signup'; END IF;
END; $$;
