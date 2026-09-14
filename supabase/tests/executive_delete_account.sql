-- Run in an enclosing rollback-only transaction. Only isolated fixture accounts
-- are used; never suspend existing admins to simulate a last-admin condition.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES ('ae140000-0000-4000-8000-000000000001','delete-admin@example.invalid','{"display_name":"Delete QA Admin"}','{}',now(),now()),
('ae140000-0000-4000-8000-000000000002','delete-seller@example.invalid','{"display_name":"Delete QA Seller"}','{}',now(),now()),
('ae140000-0000-4000-8000-000000000003','delete-super@example.invalid','{"display_name":"Delete QA Super"}','{}',now(),now());
INSERT INTO public.user_roles(user_id,role) VALUES ('ae140000-0000-4000-8000-000000000001','executive'),
('ae140000-0000-4000-8000-000000000002','seller'),('ae140000-0000-4000-8000-000000000003','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,'Delete QA',email,'seller','approved',now() FROM auth.users WHERE id::text LIKE 'ae140000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved';
DO $$ BEGIN
  IF has_function_privilege('authenticated','public.executive_delete_account(uuid,uuid,text)','execute')
    OR has_function_privilege('anon','public.executive_delete_account(uuid,uuid,text)','execute') THEN
    RAISE EXCEPTION 'FAIL: deletion callable without edge authentication';
  END IF;
  BEGIN PERFORM public.executive_delete_account('ae140000-0000-4000-8000-000000000001','ae140000-0000-4000-8000-000000000001','Test reason');
    RAISE EXCEPTION 'FAIL: self delete'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.executive_delete_account('ae140000-0000-4000-8000-000000000003','ae140000-0000-4000-8000-000000000001','Test reason');
    RAISE EXCEPTION 'FAIL: executive deleted super admin'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_delete_account('ae140000-0000-4000-8000-000000000001','ae140000-0000-4000-8000-000000000002','Test reason');
    RAISE EXCEPTION 'FAIL: seller deleted account'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_delete_account('ae140000-0000-4000-8000-000000000002','ae140000-0000-4000-8000-000000000001','x');
    RAISE EXCEPTION 'FAIL: empty reason'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  PERFORM public.executive_delete_account('ae140000-0000-4000-8000-000000000002','ae140000-0000-4000-8000-000000000001','Duplicate test account');
  IF EXISTS(SELECT 1 FROM auth.users WHERE id='ae140000-0000-4000-8000-000000000002')
    OR EXISTS(SELECT 1 FROM public.profiles WHERE user_id='ae140000-0000-4000-8000-000000000002')
    OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='ae140000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL: account deletion did not cascade';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.executive_audit_events WHERE target_id='ae140000-0000-4000-8000-000000000002'
    AND action='account.delete' AND actor_id='ae140000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: missing account deletion audit';
  END IF;
END; $$;
