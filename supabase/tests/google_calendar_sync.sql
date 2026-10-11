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
