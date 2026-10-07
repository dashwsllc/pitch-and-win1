-- Isolated fixtures. Run using scripts/check-crm-edit-call-db.mjs; always ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ec000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-edit-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Edit QA '||n),'{}',now(),now()
FROM generate_series(1,7) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,raw_user_meta_data->>'display_name',email,'seller','approved',now()
FROM auth.users WHERE id::text LIKE 'ec000000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved',reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ec000000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ec000000-0000-4000-8000-000000000001','executive',true),
('ec000000-0000-4000-8000-000000000002','sdr',true),
('ec000000-0000-4000-8000-000000000003','sdr',true),
('ec000000-0000-4000-8000-000000000004','closer',true),
('ec000000-0000-4000-8000-000000000005','closer',true),
('ec000000-0000-4000-8000-000000000006','seller',false),
('ec000000-0000-4000-8000-000000000007','sdr',true)
ON CONFLICT (user_id,role) DO NOTHING;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE user_id::text LIKE 'ec000000-%') <> 7 THEN RAISE EXCEPTION 'FAIL: fixture profiles'; END IF;
  IF has_function_privilege('anon','public.update_crm_call(uuid,uuid,timestamptz,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can edit calls'; END IF;
  IF NOT has_function_privilege('authenticated','public.update_crm_call(uuid,uuid,timestamptz,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated cannot edit calls'; END IF;
END; $$;
CREATE TEMP TABLE edit_qa_state(lead_id uuid,q_id uuid,q_rev timestamptz,c_id uuid,c_rev timestamptz,
  lead2_id uuid,c2_id uuid,c2_rev timestamptz,events_before bigint);
GRANT ALL ON edit_qa_state TO authenticated;

-- 1. SDR A creates a lead and schedules a qualification call for himself.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; q public.crm_activities;
BEGIN
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('Edit QA Responsável','edit-qa@example.invalid','11999999999','Edit QA Atleta','2012-01-01','Meia') RETURNING * INTO l;
  q:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid(),'Qualificação QA');
  INSERT INTO edit_qa_state(lead_id,q_id,q_rev) VALUES(l.id,q.id,q.updated_at);
END; $$;

-- 2. Another SDR changes who holds the qualification call, then its time.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s record; q public.crm_activities; r public.crm_activities; owner_before uuid;
BEGIN
  SELECT * INTO s FROM edit_qa_state;
  SELECT sdr_id INTO owner_before FROM public.crm_leads WHERE id=s.lead_id;
  q:=public.update_crm_call(s.q_id,'ec000000-0000-4000-8000-000000000007',NULL,s.q_rev);
  IF q.assigned_to<>'ec000000-0000-4000-8000-000000000007' OR q.updated_at=s.q_rev THEN RAISE EXCEPTION 'FAIL: qualification assignee not changed'; END IF;
  IF (SELECT sdr_id FROM public.crm_leads WHERE id=s.lead_id) IS DISTINCT FROM owner_before THEN RAISE EXCEPTION 'FAIL: lead owner changed with the call'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND title='Responsável da call de qualificação alterado'
    AND new_state->>'call_assigned_to'='ec000000-0000-4000-8000-000000000007' AND user_id=auth.uid()) THEN RAISE EXCEPTION 'FAIL: reassignment missing on the timeline'; END IF;
  BEGIN PERFORM public.update_crm_call(s.q_id,'ec000000-0000-4000-8000-000000000002',NULL,s.q_rev); RAISE EXCEPTION 'FAIL: stale revision'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.update_crm_call(s.q_id,'ec000000-0000-4000-8000-000000000006',NULL,q.updated_at); RAISE EXCEPTION 'FAIL: seller received an SDR call'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.update_crm_call(s.q_id,NULL,NULL,q.updated_at); RAISE EXCEPTION 'FAIL: empty edit'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.update_crm_call(s.q_id,NULL,now()-interval '1 hour',q.updated_at); RAISE EXCEPTION 'FAIL: past time'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r:=public.update_crm_call(s.q_id,'ec000000-0000-4000-8000-000000000007',NULL,q.updated_at);
  IF r.updated_at<>q.updated_at THEN RAISE EXCEPTION 'FAIL: no-op edit wrote'; END IF;
  r:=public.update_crm_call(s.q_id,NULL,now()+interval '5 day',q.updated_at);
  IF r.scheduled_at<=now()+interval '4 day' OR r.assigned_to<>'ec000000-0000-4000-8000-000000000007'
    OR (SELECT next_followup_at FROM public.crm_leads WHERE id=s.lead_id) IS DISTINCT FROM r.scheduled_at THEN RAISE EXCEPTION 'FAIL: time-only edit'; END IF;
  UPDATE edit_qa_state SET q_rev=r.updated_at;
END; $$;

-- 3. A seller without SDR or Closer capability cannot edit calls.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM edit_qa_state;
  BEGIN PERFORM public.update_crm_call(s.q_id,'ec000000-0000-4000-8000-000000000007',NULL,s.q_rev); RAISE EXCEPTION 'FAIL: seller edited a call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

-- 4. SDR A hands the lead to Closer X (the closing call fixture) and the executive does the same for a second lead.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE s record; l public.crm_leads; c public.crm_activities;
BEGIN
  SELECT * INTO s FROM edit_qa_state;
  SELECT * INTO l FROM public.crm_leads WHERE id=s.lead_id;
  c:=public.handoff_and_schedule_closer_call(p_lead_id=>l.id,p_expected_version=>l.version,p_scheduled_at=>now()+interval '2 day',
    p_assigned_to=>'ec000000-0000-4000-8000-000000000004'::uuid,p_context=>'Closing QA');
  IF (SELECT closer_id FROM public.crm_leads WHERE id=l.id)<>'ec000000-0000-4000-8000-000000000004'
    OR (SELECT pipeline_stage FROM public.crm_leads WHERE id=l.id)<>'repassado_closer' THEN RAISE EXCEPTION 'FAIL: fixture handoff'; END IF;
  UPDATE edit_qa_state SET c_id=c.id,c_rev=c.updated_at;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE l public.crm_leads; c public.crm_activities;
BEGIN
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('Edit QA Segundo','edit-qa2@example.invalid','11999999998','Edit QA Segundo Atleta','2012-01-01','Goleiro') RETURNING * INTO l;
  c:=public.handoff_and_schedule_closer_call(p_lead_id=>l.id,p_expected_version=>l.version,p_scheduled_at=>now()+interval '2 day',
    p_assigned_to=>'ec000000-0000-4000-8000-000000000004'::uuid,p_context=>'Closing QA 2');
  UPDATE edit_qa_state SET lead2_id=l.id,c2_id=c.id,c2_rev=c.updated_at;
END; $$;

-- Editing calls must not create Arena facts: count them as the owner, edit, count again.
RESET ROLE;
UPDATE edit_qa_state SET events_before=(SELECT count(*) FROM public.activity_feed WHERE lead_id=edit_qa_state.lead_id);
SET LOCAL ROLE authenticated;

-- 5. A plain SDR moves the closing call from Closer X to Closer Y; the lead follows it.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities; l public.crm_leads;
BEGIN
  SELECT * INTO s FROM edit_qa_state;
  c:=public.update_crm_call(s.c_id,'ec000000-0000-4000-8000-000000000005'::uuid,NULL,s.c_rev);
  SELECT * INTO l FROM public.crm_leads WHERE id=s.lead_id;
  IF c.assigned_to<>'ec000000-0000-4000-8000-000000000005' OR l.closer_id<>'ec000000-0000-4000-8000-000000000005'
    OR l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'FAIL: closing call reassignment did not move the lead'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id AND activity_type='transicao'
    AND new_state->>'closer_id'='ec000000-0000-4000-8000-000000000005' AND user_id=auth.uid()) THEN RAISE EXCEPTION 'FAIL: closer change missing on the timeline'; END IF;
  BEGIN PERFORM public.update_crm_call(s.c_id,'ec000000-0000-4000-8000-000000000002'::uuid,NULL,c.updated_at); RAISE EXCEPTION 'FAIL: SDR-only user received a closing call'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE edit_qa_state SET c_rev=c.updated_at;
END; $$;

-- 6. Closer X, no longer the owner, takes the call back; Closer Y, now a non-owner, changes its time.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities;
BEGIN
  SELECT * INTO s FROM edit_qa_state;
  c:=public.update_crm_call(s.c_id,'ec000000-0000-4000-8000-000000000004'::uuid,NULL,s.c_rev);
  IF c.assigned_to<>'ec000000-0000-4000-8000-000000000004'
    OR (SELECT closer_id FROM public.crm_leads WHERE id=s.lead_id)<>'ec000000-0000-4000-8000-000000000004' THEN RAISE EXCEPTION 'FAIL: non-owner Closer cannot change the call'; END IF;
  UPDATE edit_qa_state SET c_rev=c.updated_at;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities;
BEGIN
  SELECT * INTO s FROM edit_qa_state;
  c:=public.update_crm_call(s.c_id,NULL,now()+interval '3 day',s.c_rev);
  IF c.assigned_to<>'ec000000-0000-4000-8000-000000000004'
    OR (SELECT next_followup_at FROM public.crm_leads WHERE id=s.lead_id) IS DISTINCT FROM c.scheduled_at
    OR (SELECT closer_id FROM public.crm_leads WHERE id=s.lead_id)<>'ec000000-0000-4000-8000-000000000004' THEN RAISE EXCEPTION 'FAIL: non-owner Closer time edit'; END IF;
  UPDATE edit_qa_state SET c_rev=c.updated_at;
END; $$;

-- 7. The person who scheduled a closing call can receive it (an SDR who is also a Closer picks himself): the database only
-- requires the new responsible to hold the Closer capability. The call then goes back to the previous Closer.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities; BEGIN SELECT * INTO s FROM edit_qa_state;
  c:=public.update_crm_call(s.c2_id,'ec000000-0000-4000-8000-000000000001'::uuid,NULL,s.c2_rev);
  IF c.assigned_to<>'ec000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'FAIL: call could not go to its scheduler'; END IF;
  c:=public.update_crm_call(s.c2_id,'ec000000-0000-4000-8000-000000000004'::uuid,NULL,c.updated_at);
  IF c.assigned_to<>'ec000000-0000-4000-8000-000000000004'::uuid
    OR (SELECT closer_id FROM public.crm_leads WHERE id=c.lead_id)<>'ec000000-0000-4000-8000-000000000004'::uuid THEN RAISE EXCEPTION 'FAIL: call did not return to the previous Closer'; END IF;
  UPDATE edit_qa_state SET c2_rev=c.updated_at;
END; $$;

-- 8. A seller cannot edit a closing call either.
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM edit_qa_state;
  BEGIN PERFORM public.update_crm_call(s.c_id,'ec000000-0000-4000-8000-000000000005'::uuid,NULL,s.c_rev); RAISE EXCEPTION 'FAIL: seller edited a closing call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

-- 9. None of the edits above produced an Arena event.
RESET ROLE;
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM edit_qa_state;
  IF (SELECT count(*) FROM public.activity_feed WHERE lead_id=s.lead_id)<>s.events_before THEN RAISE EXCEPTION 'FAIL: editing a call emitted Arena events'; END IF;
END; $$;

-- 10. A finished call can no longer be edited.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ec000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities;
BEGIN
  SELECT * INTO s FROM edit_qa_state;
  c:=public.resolve_closer_call(s.c_id,'venda_perdida',s.c_rev);
  BEGIN PERFORM public.update_crm_call(s.c_id,'ec000000-0000-4000-8000-000000000005'::uuid,NULL,c.updated_at); RAISE EXCEPTION 'FAIL: completed call edited'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END; $$;
RESET ROLE;
