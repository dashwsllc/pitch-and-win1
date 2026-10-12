-- Isolated QA only, run inside a transaction ending in ROLLBACK; no provider HTTP.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('cd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'calendar-details-'||n||'@example.invalid',jsonb_build_object('display_name','Calendar details QA'),'{}',now(),now() FROM generate_series(1,3) n;
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,'Calendar details QA',email,'seller','approved',now() FROM auth.users WHERE id::text LIKE 'cd000000-%' ON CONFLICT(user_id) DO UPDATE SET status='approved';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'cd000000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES('cd000000-0000-4000-8000-000000000001','executive',true),('cd000000-0000-4000-8000-000000000002','closer',true),('cd000000-0000-4000-8000-000000000003','seller',false);
CREATE TEMP TABLE details_qa(lead_id uuid,call_id uuid,event_id text);
GRANT ALL ON details_qa TO authenticated;
UPDATE calendar_private.connection SET connection_status='connected',activated_at=coalesce(activated_at,now()),calendar_id=coalesce(calendar_id,'details-qa@group.calendar.google.com') WHERE singleton;
SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  INSERT INTO public.crm_leads(name,phone,athlete_name) VALUES('Details QA','11999999999','Atleta details') RETURNING * INTO l;
  c:=public.crm_schedule_call_details(l.id,'fechamento_closer',now()+interval '1 day','cd000000-0000-4000-8000-000000000002','Pauta inicial',75,l.version);
  IF c.duration_minutes<>75 THEN RAISE EXCEPTION 'duration not persisted'; END IF;
  INSERT INTO details_qa VALUES(l.id,c.id,NULL);
  c:=public.crm_edit_call_details(c.id,NULL,NULL,c.updated_at,45);
  IF c.duration_minutes<>45 THEN RAISE EXCEPTION 'duration-only edit failed'; END IF;
  BEGIN PERFORM public.crm_edit_call_details(c.id,NULL,NULL,c.updated_at,0); RAISE EXCEPTION 'invalid duration accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
UPDATE details_qa SET event_id=b.event_id FROM calendar_private.bindings b WHERE b.call_id=details_qa.call_id;
DO $$ DECLARE before_revision bigint; j jsonb; s jsonb; cid uuid; BEGIN
  SELECT call_id INTO cid FROM details_qa;
  SELECT revision INTO before_revision FROM calendar_private.bindings WHERE call_id=cid;
  PERFORM public.crm_transition((SELECT lead_id FROM details_qa),'classify',
    (SELECT version FROM public.crm_leads WHERE id=(SELECT lead_id FROM details_qa)),jsonb_build_object('temperature','quente'));
  IF (SELECT revision FROM calendar_private.bindings WHERE call_id=cid)<=before_revision THEN RAISE EXCEPTION 'temperature did not enqueue'; END IF;
  SELECT revision INTO before_revision FROM calendar_private.bindings WHERE call_id=cid;
  PERFORM public.crm_transition((SELECT lead_id FROM details_qa),'classify',
    (SELECT version FROM public.crm_leads WHERE id=(SELECT lead_id FROM details_qa)),jsonb_build_object('temperature','quente'));
  IF (SELECT revision FROM calendar_private.bindings WHERE call_id=cid)<>before_revision THEN RAISE EXCEPTION 'unchanged temperature enqueued'; END IF;
  PERFORM public.crm_transition((SELECT lead_id FROM details_qa),'edit',
    (SELECT version FROM public.crm_leads WHERE id=(SELECT lead_id FROM details_qa)),jsonb_build_object('name','Details QA editado','observations','Informação atualizada'));
  IF (SELECT revision FROM calendar_private.bindings WHERE call_id=cid)<=before_revision THEN RAISE EXCEPTION 'CRM edit did not enqueue'; END IF;
  SELECT revision INTO before_revision FROM calendar_private.bindings WHERE call_id=cid;
  INSERT INTO public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content)
    SELECT lead_id,'cd000000-0000-4000-8000-000000000002','QA','closer','manual_note','Contexto QA' FROM details_qa;
  IF (SELECT revision FROM calendar_private.bindings WHERE call_id=cid)<=before_revision THEN RAISE EXCEPTION 'context did not enqueue'; END IF;
  IF NOT public.google_calendar_request_refresh('cd000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'closer refresh rejected'; END IF;
  IF public.google_calendar_request_refresh('cd000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'refresh not rate limited'; END IF;
  BEGIN PERFORM public.google_calendar_request_refresh('cd000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'seller refresh accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE calendar_private.outbox SET available_at=NULL WHERE binding_id NOT IN(SELECT id FROM calendar_private.bindings WHERE call_id=cid);
  j:=public.google_calendar_claim(1,60)->0;
  s:=public.google_calendar_snapshot((j->'binding'->>'id')::uuid,(j->>'leaseToken')::uuid);
  IF (s->'call'->>'durationMinutes')::integer<>45 OR s->'contexts'->0->>'content'<>'Contexto QA' THEN RAISE EXCEPTION 'snapshot details absent'; END IF;
  IF s->'lead'->>'temperature' IS DISTINCT FROM 'quente' THEN RAISE EXCEPTION 'snapshot classification absent'; END IF;
  IF NOT public.google_calendar_ack_details((j->'binding'->>'id')::uuid,(j->>'leaseToken')::uuid,(j->'binding'->>'revision')::bigint,'hash','etag',false,'https://meet.google.com/abc-defg-hij') THEN RAISE EXCEPTION 'meet ACK failed'; END IF;
  IF (SELECT meeting_url FROM public.crm_google_calendar_status WHERE call_id=cid)<>'https://meet.google.com/abc-defg-hij' THEN RAISE EXCEPTION 'meet link not persisted'; END IF;
  UPDATE public.crm_activities SET scheduled_at=now()+interval '2 days' WHERE id=cid;
  IF (SELECT event_id FROM calendar_private.bindings WHERE call_id=cid)<>(SELECT event_id FROM details_qa) THEN RAISE EXCEPTION 'reschedule duplicated event'; END IF;
  PERFORM public.arena_cancel_call(cid,(SELECT updated_at FROM public.crm_activities WHERE id=cid),'Cancelamento de teste QA');
  IF (SELECT status FROM public.crm_google_calendar_status WHERE call_id=cid)<>'removal_pending' THEN RAISE EXCEPTION 'cancel removal missing'; END IF;
  DELETE FROM public.crm_activities WHERE id=cid;
  IF NOT EXISTS(SELECT 1 FROM calendar_private.outbox o JOIN calendar_private.bindings b ON b.id=o.binding_id WHERE b.call_id=cid) THEN RAISE EXCEPTION 'deleted call removal lost'; END IF;
END $$;
-- Exercise the same versioned CRM actions used by the Closer screen.
DO $$ DECLARE l public.crm_leads; c public.crm_activities; b calendar_private.bindings; j jsonb; s jsonb; scenario text; BEGIN
  FOREACH scenario IN ARRAY ARRAY['return','delete'] LOOP
    INSERT INTO public.crm_leads(name,phone,athlete_name) VALUES('Lifecycle QA '||scenario,'11999999999','Atleta lifecycle') RETURNING * INTO l;
    c:=public.crm_schedule_call_details(l.id,'fechamento_closer',now()+interval '1 day','cd000000-0000-4000-8000-000000000002','Pauta lifecycle',30,l.version);
    SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
    SELECT * INTO b FROM calendar_private.bindings WHERE call_id=c.id;
    IF scenario='return' THEN
      PERFORM public.crm_transition(l.id,'return',l.version,jsonb_build_object('note','Retorno QA para SDR'));
      IF (SELECT status FROM public.crm_google_calendar_status WHERE call_id=c.id)<>'removal_pending' THEN RAISE EXCEPTION 'CRM return did not queue removal'; END IF;
    ELSE
      PERFORM public.crm_delete_lead(l.id,l.version);
      IF EXISTS(SELECT 1 FROM public.crm_activities WHERE id=c.id) OR EXISTS(SELECT 1 FROM public.crm_leads WHERE id=l.id) THEN RAISE EXCEPTION 'CRM lead deletion did not cascade'; END IF;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM calendar_private.outbox WHERE binding_id=b.id) THEN RAISE EXCEPTION 'CRM removal lost durable queue'; END IF;
    IF (SELECT event_id FROM calendar_private.bindings WHERE id=b.id)<>b.event_id THEN RAISE EXCEPTION 'CRM removal rotated identity'; END IF;
    UPDATE calendar_private.outbox SET available_at=NULL WHERE binding_id<>b.id;
    j:=public.google_calendar_claim(1,60)->0;
    s:=public.google_calendar_snapshot(b.id,(j->>'leaseToken')::uuid);
    IF scenario='return' AND s->'call'->>'outcome' IS DISTINCT FROM 'devolvido_sdr' THEN RAISE EXCEPTION 'return snapshot did not request removal'; END IF;
    IF scenario='delete' AND (s->'call' IS DISTINCT FROM 'null'::jsonb OR s->'lead' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'deleted lead snapshot did not request removal'; END IF;
    IF NOT public.google_calendar_ack_details(b.id,(j->>'leaseToken')::uuid,(j->'binding'->>'revision')::bigint,'removed',NULL,true,NULL) THEN RAISE EXCEPTION 'CRM removal ACK failed'; END IF;
  END LOOP;
END $$;
DO $$ BEGIN
  IF has_function_privilege('authenticated','public.google_calendar_request_refresh(uuid)','execute') OR has_function_privilege('anon','public.crm_edit_call_details(uuid,uuid,timestamptz,timestamptz,integer)','execute') THEN RAISE EXCEPTION 'RPC grants too broad'; END IF;
END $$;
