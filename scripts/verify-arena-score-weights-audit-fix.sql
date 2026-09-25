-- Execute after the migration in a transaction that always rolls back.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES('ce400000-0000-4000-8000-000000000001','arena-weights-fix-qa@example.invalid',
  jsonb_build_object('display_name','Arena Weights Fix QA'),'{}',now(),now());
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
VALUES('ce400000-0000-4000-8000-000000000001','Arena Weights Fix QA','arena-weights-fix-qa@example.invalid','seller','approved',now())
ON CONFLICT (user_id) DO UPDATE SET status='approved', reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id='ce400000-0000-4000-8000-000000000001';
INSERT INTO public.user_roles(user_id,role) VALUES('ce400000-0000-4000-8000-000000000001','executive');

SELECT set_config('request.jwt.claims','{"sub":"ce400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_key text; v_before numeric; BEGIN
  SELECT action_type,weight INTO v_key,v_before FROM public.arena_score_weights LIMIT 1;
  -- This used to fail with "null value in column target_id ... violates
  -- not-null constraint" before the fix.
  PERFORM public.arena_save_score_weights(jsonb_build_object(v_key,v_before),'Correção do bug de target_id nulo');
  IF NOT EXISTS(
    SELECT 1 FROM public.executive_audit_events
    WHERE action='arena.score_weights' AND reason='Correção do bug de target_id nulo'
      AND target_id='ce400000-0000-4000-8000-000000000001' AND actor_id='ce400000-0000-4000-8000-000000000001'
  ) THEN RAISE EXCEPTION 'FAIL: audit row missing or target_id not set to the acting admin'; END IF;
  RAISE NOTICE 'PASS: arena_save_score_weights no longer violates the target_id not-null constraint.';
END $$;
RESET ROLE;
