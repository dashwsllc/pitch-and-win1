-- Isolated local Supabase fixtures. Runner wraps migrations + fixtures in ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ca000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'calendar-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Calendar QA '||n),'{}',now(),now()
FROM generate_series(1,4) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,raw_user_meta_data->>'display_name',email,'seller','approved',now() FROM auth.users WHERE id::text LIKE 'ca000000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ca000000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ca000000-0000-4000-8000-000000000001','executive',true),
('ca000000-0000-4000-8000-000000000002','sdr',true),
('ca000000-0000-4000-8000-000000000003','closer',true),
('ca000000-0000-4000-8000-000000000004','seller',false);
CREATE TEMP TABLE calendar_qa(lead_id uuid,call_id uuid,binding_id uuid,event_id text,revision bigint,token uuid);
GRANT ALL ON calendar_qa TO authenticated;

DO $$ BEGIN
  IF has_schema_privilege('authenticated','calendar_private','USAGE') THEN RAISE EXCEPTION 'private schema exposed'; END IF;
  IF has_function_privilege('anon','public.google_calendar_claim(integer,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.google_calendar_credential_read(uuid)','EXECUTE') THEN RAISE EXCEPTION 'secret RPC exposed'; END IF;
  IF has_table_privilege('authenticated','public.crm_google_calendar_status','UPDATE') THEN RAISE EXCEPTION 'status writable'; END IF;
END $$;
-- Simulate a validated OAuth connection, without a real token or any HTTP.
UPDATE calendar_private.connection SET connection_status='connected',credential_revision=1;
SELECT public.google_calendar_activate('ca000000-0000-4000-8000-000000000001','test@group.calendar.google.com','QA','America/Sao_Paulo',1);
SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
  VALUES('Calendar QA','calendar@example.invalid','11999999999','Atleta QA','2012-01-01','Meia') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid(),'Qualificação QA');
  INSERT INTO calendar_qa(lead_id) VALUES(l.id);
END $$;
RESET ROLE;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM calendar_private.bindings) THEN RAISE EXCEPTION 'qualification registered'; END IF; END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM calendar_qa);
  c:=public.handoff_and_schedule_closer_call(l.id,l.version,now()+interval '2 days','ca000000-0000-4000-8000-000000000003','QA');
  UPDATE calendar_qa SET call_id=c.id;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET suspended=true WHERE user_id='ca000000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.crm_google_calendar_status) THEN RAISE EXCEPTION 'status leaked to suspended user'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
UPDATE calendar_qa SET binding_id=b.id,event_id=b.event_id,revision=b.revision FROM calendar_private.bindings b WHERE b.call_id=calendar_qa.call_id;
DO $$ BEGIN
  IF (SELECT count(*) FROM calendar_private.bindings)<>1 OR (SELECT count(*) FROM calendar_private.outbox)<>1 THEN RAISE EXCEPTION 'handoff did not queue exactly once'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_activities; BEGIN
  SELECT * INTO c FROM public.crm_activities WHERE id=(SELECT call_id FROM calendar_qa);
  PERFORM public.update_crm_call(c.id,NULL,now()+interval '3 days',c.updated_at);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT event_id FROM calendar_private.bindings)<>(SELECT event_id FROM calendar_qa)
    OR (SELECT revision FROM calendar_private.bindings)<=(SELECT revision FROM calendar_qa) THEN RAISE EXCEPTION 'edit rotated identity or missed revision'; END IF;
END $$;
UPDATE calendar_qa SET revision=(SELECT revision FROM calendar_private.bindings);
UPDATE public.crm_leads SET observations='private note' WHERE id=(SELECT lead_id FROM calendar_qa);
DO $$ BEGIN IF (SELECT revision FROM calendar_private.bindings)<>(SELECT revision FROM calendar_qa) THEN RAISE EXCEPTION 'unrelated notes queued'; END IF; END $$;
DO $$ DECLARE jobs jsonb; BEGIN
  jobs:=public.google_calendar_claim(1,60);
  UPDATE calendar_qa SET token=(jobs->0->>'leaseToken')::uuid,revision=(jobs->0->'binding'->>'revision')::bigint;
  IF jsonb_array_length(public.google_calendar_claim(1,60))<>0 THEN RAISE EXCEPTION 'double claim'; END IF;
END $$;
UPDATE public.crm_activities SET scheduled_at=scheduled_at+interval '1 hour' WHERE id=(SELECT call_id FROM calendar_qa);
DO $$ DECLARE q calendar_qa; BEGIN SELECT * INTO q FROM calendar_qa;
  IF public.google_calendar_ack(q.binding_id,q.token,q.revision,'old-hash','etag-old',false) THEN RAISE EXCEPTION 'stale ACK accepted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM calendar_private.outbox) THEN RAISE EXCEPTION 'stale ACK lost pending work'; END IF;
END $$;
-- Tombstone must survive commercial deletion; public status may disappear.
DELETE FROM public.crm_activities WHERE id=(SELECT call_id FROM calendar_qa);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM calendar_private.bindings WHERE event_id=(SELECT event_id FROM calendar_qa)) THEN RAISE EXCEPTION 'identity deleted'; END IF;
END $$;
DO $$ BEGIN
  BEGIN PERFORM public.google_calendar_activate('ca000000-0000-4000-8000-000000000001','other@group.calendar.google.com','Other','UTC',1);
  RAISE EXCEPTION 'destination changed'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.crm_google_calendar_status) THEN RAISE EXCEPTION 'status leaked'; END IF;
END $$;
RESET ROLE;
-- Queue CAS, lease expiry, safe identity rotation, and positive client RLS.
SELECT set_config('request.jwt.claims','{}',true);
DO $$ DECLARE jobs jsonb; q calendar_qa; snap jsonb; rotated jsonb; BEGIN
  jobs:=public.google_calendar_claim(1,60);
  UPDATE calendar_qa SET token=(jobs->0->>'leaseToken')::uuid,revision=(jobs->0->'binding'->>'revision')::bigint;
  SELECT * INTO q FROM calendar_qa;
  snap:=public.google_calendar_snapshot(q.binding_id,q.token);
  IF snap->'call' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'deleted call snapshot not null'; END IF;
  IF NOT public.google_calendar_renew(q.binding_id,q.token,60) THEN RAISE EXCEPTION 'valid lease cannot renew'; END IF;
  IF public.google_calendar_rotate_event_id(q.binding_id,q.token,q.revision-1,q.event_id) IS NOT NULL THEN RAISE EXCEPTION 'stale rotation accepted'; END IF;
  rotated:=public.google_calendar_rotate_event_id(q.binding_id,q.token,q.revision,q.event_id);
  IF rotated IS NULL OR rotated->>'eventId'=q.event_id THEN RAISE EXCEPTION 'CAS rotation failed'; END IF;
  IF public.google_calendar_rotate_event_id(q.binding_id,q.token,q.revision,q.event_id) IS NOT NULL THEN RAISE EXCEPTION 'rotation repeated'; END IF;
  IF NOT public.google_calendar_ack(q.binding_id,q.token,(rotated->>'revision')::bigint,'removed',NULL,true) THEN RAISE EXCEPTION 'valid ACK rejected'; END IF;
  IF EXISTS(SELECT 1 FROM calendar_private.outbox) THEN RAISE EXCEPTION 'ACK retained outbox'; END IF;
END $$;
-- OAuth one-use, expiry, credential CAS and disconnect racing an old refresh.
DO $$ DECLARE actor uuid:='ca000000-0000-4000-8000-000000000001'; s jsonb; lease jsonb; scopes text[]:=ARRAY['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly']; BEGIN
  s:=public.google_calendar_oauth_start(actor,repeat('a',64),'https://www.wsltda.com');
  PERFORM public.google_calendar_oauth_consume(repeat('a',64));
  BEGIN PERFORM public.google_calendar_oauth_consume(repeat('a',64)); RAISE EXCEPTION 'OAuth replay accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  lease:=public.google_calendar_credential_claim(45);
  IF public.google_calendar_credential_claim(45) IS NOT NULL THEN RAISE EXCEPTION 'double refresh lease'; END IF;
  IF public.google_calendar_credential_save((lease->>'token')::uuid,0,actor,(s->>'stateId')::uuid,'qa-account','test-access','test-refresh',now()+interval '1 hour',scopes) THEN RAISE EXCEPTION 'stale credential save accepted'; END IF;
  IF NOT public.google_calendar_credential_save((lease->>'token')::uuid,1,actor,(s->>'stateId')::uuid,'qa-account','test-access','test-refresh',now()+interval '1 hour',scopes) THEN RAISE EXCEPTION 'OAuth save failed'; END IF;
  IF (public.google_calendar_credential_read((lease->>'token')::uuid)->>'revision')<>'2' THEN RAISE EXCEPTION 'credential revision wrong'; END IF;
  PERFORM public.google_calendar_disconnect(actor,(lease->>'token')::uuid);
  IF public.google_calendar_credential_save((lease->>'token')::uuid,2,NULL,NULL,'qa-account','late-access','late-refresh',now()+interval '1 hour',scopes) THEN RAISE EXCEPTION 'late refresh undid disconnect'; END IF;
  IF EXISTS(SELECT 1 FROM vault.secrets) THEN RAISE EXCEPTION 'disconnect retained secrets'; END IF;
  IF jsonb_array_length(public.google_calendar_claim(1,60))<>0 THEN RAISE EXCEPTION 'disconnected delivery enabled'; END IF;
  PERFORM public.google_calendar_credential_release((lease->>'token')::uuid);
  PERFORM public.google_calendar_oauth_start(actor,repeat('b',64),'https://www.wsltda.com');
  UPDATE calendar_private.oauth_states SET expires_at=now()-interval '1 minute' WHERE state_hash=repeat('b',64);
  BEGIN PERFORM public.google_calendar_oauth_consume(repeat('b',64)); RAISE EXCEPTION 'expired state accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.google_calendar_admin_status('ca000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'closer admin accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Initial activation cohort survives completion/deletion before the first page.
UPDATE calendar_private.connection SET connection_status='connected',activated_at=NULL;
CREATE TEMP TABLE calendar_seed_qa(call_id uuid,kind integer);
SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE q calendar_qa; a uuid; lid uuid; BEGIN
  SELECT * INTO q FROM calendar_qa;
  FOR n IN 1..3 LOOP
    INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position,pipeline_stage)
    VALUES('QA seed '||n,'seed'||n||'@example.invalid','11999999999','Atleta QA','2012-01-01','Meia','repassado_closer') RETURNING id INTO lid;
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,call_type,assigned_to,scheduled_at)
    VALUES(lid,'ca000000-0000-4000-8000-000000000002','reuniao','QA seed '||n,'fechamento_closer','ca000000-0000-4000-8000-000000000003',now()+interval '5 days') RETURNING id INTO a;
    INSERT INTO calendar_seed_qa VALUES(a,n);
  END LOOP;
END $$;
SELECT public.google_calendar_activate('ca000000-0000-4000-8000-000000000001','test@group.calendar.google.com','QA','America/Sao_Paulo',3);
DO $$ BEGIN IF (SELECT count(*) FROM calendar_private.activation_seeds)<>3 THEN RAISE EXCEPTION 'initial cohort not durable'; END IF; END $$;
UPDATE public.crm_activities SET is_completed=true,completed_at=now(),outcome='venda_perdida' WHERE id=(SELECT call_id FROM calendar_seed_qa WHERE kind=1);
DELETE FROM public.crm_activities WHERE id=(SELECT call_id FROM calendar_seed_qa WHERE kind=2);
DO $$ DECLARE page jsonb; BEGIN
  page:=public.google_calendar_scan_page('backfill',1);
  IF (page->>'processed')::int<>1 OR (page->>'done')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'backfill did not resume'; END IF;
  IF (SELECT count(*) FROM calendar_private.bindings WHERE call_id IN(SELECT call_id FROM calendar_seed_qa))<>3 THEN RAISE EXCEPTION 'cohort final states lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM calendar_private.bindings WHERE call_id=(SELECT call_id FROM calendar_seed_qa WHERE kind=1) AND completed) THEN RAISE EXCEPTION 'completion lost'; END IF;
END $$;
-- Revisions above JS's safe integer range remain decimal strings in public DTOs.
UPDATE calendar_private.bindings SET revision=9007199254740993 WHERE call_id=(SELECT call_id FROM calendar_seed_qa WHERE kind=3);
UPDATE public.crm_activities SET scheduled_at=scheduled_at+interval '1 minute' WHERE id=(SELECT call_id FROM calendar_seed_qa WHERE kind=3);
DO $$ BEGIN
  IF (SELECT desired_revision FROM public.crm_google_calendar_status WHERE call_id=(SELECT call_id FROM calendar_seed_qa WHERE kind=3))<>'9007199254740994' THEN RAISE EXCEPTION 'revision precision lost'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM public.crm_google_calendar_status)<>2 THEN RAISE EXCEPTION 'approved closer cannot see call status'; END IF; END $$;
RESET ROLE;

-- A validated reconnect releases connection failures, while ownership/payload blocks stay blocked.
SELECT set_config('request.jwt.claims','{}',true);
DO $$ DECLARE j jsonb; q record; s jsonb; lease jsonb; BEGIN
  SELECT b.id,b.event_id,b.revision INTO q FROM calendar_private.bindings b
    JOIN calendar_seed_qa f ON f.call_id=b.call_id WHERE f.kind=1;
  UPDATE calendar_private.outbox SET available_at=NULL;
  UPDATE calendar_private.outbox SET available_at=clock_timestamp() WHERE binding_id=q.id;
  j:=public.google_calendar_claim(1,60)->0;
  PERFORM public.google_calendar_fail(q.id,(j->>'leaseToken')::uuid,q.revision,'calendar_access',NULL);
  UPDATE calendar_private.outbox SET error_code='ownership_mismatch' WHERE binding_id<>q.id;
  PERFORM public.google_calendar_set_connection_error(3,'permission_denied');
  s:=public.google_calendar_oauth_start('ca000000-0000-4000-8000-000000000001',repeat('c',64),'https://www.wsltda.com');
  PERFORM public.google_calendar_oauth_consume(repeat('c',64));
  lease:=public.google_calendar_credential_claim(45);
  IF NOT public.google_calendar_credential_save((lease->>'token')::uuid,3,'ca000000-0000-4000-8000-000000000001',(s->>'stateId')::uuid,
    'qa-account','qa-access','qa-refresh',now()+interval '1 hour',ARRAY['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly']) THEN RAISE EXCEPTION 'reconnect save failed'; END IF;
  PERFORM public.google_calendar_credential_release((lease->>'token')::uuid);
  j:=public.google_calendar_claim(1,60)->0;
  IF j IS NULL OR j->'binding'->>'eventId' IS DISTINCT FROM q.event_id THEN RAISE EXCEPTION 'reconnect did not release the same persisted event'; END IF;
  IF NOT public.google_calendar_ack(q.id,(j->>'leaseToken')::uuid,q.revision,'reconnected','etag',false) THEN RAISE EXCEPTION 'reconnect cannot acknowledge'; END IF;
  IF EXISTS(SELECT 1 FROM calendar_private.outbox WHERE error_code='ownership_mismatch' AND available_at IS NOT NULL) THEN RAISE EXCEPTION 'reconnect released ownership blocks'; END IF;
END $$;
