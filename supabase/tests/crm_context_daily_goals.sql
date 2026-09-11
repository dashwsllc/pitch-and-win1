-- Isolated users, leads and tasks, always rolled back by the runner.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'context-daily-qa-'||n||'@example.invalid',
  jsonb_build_object('display_name','Context Daily QA '||n),'{}',now(),now() FROM generate_series(1,6) n;
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ce110000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ce110000-0000-4000-8000-000000000001','sdr',false),
('ce110000-0000-4000-8000-000000000002','closer',false),
('ce110000-0000-4000-8000-000000000003','executive',false),
('ce110000-0000-4000-8000-000000000004','bdr',false),
('ce110000-0000-4000-8000-000000000005','executive',false),
('ce110000-0000-4000-8000-000000000006','bdr',true);
UPDATE public.profiles SET suspended=true WHERE user_id='ce110000-0000-4000-8000-000000000005';
CREATE TEMP TABLE context_daily_state(lead_id uuid, context_id uuid, task_id uuid);
GRANT ALL ON context_daily_state TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ce110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_lead_contexts; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Context QA','Athlete QA','11999999999') RETURNING * INTO l;
  c:=public.crm_add_lead_context(l.id,'whatsapp_summary',E'Primeira linha\r\nSegunda linha'||chr(1)||chr(130));
  IF c.content<>E'Primeira linha\nSegunda linha' OR c.author_id<>auth.uid() OR c.author_role<>'sdr' OR c.author_name<>'Context Daily QA 1' OR c.created_at IS NULL THEN RAISE EXCEPTION 'FAIL SDR import and sanitization'; END IF;
  INSERT INTO context_daily_state VALUES(l.id,c.id,NULL);
  PERFORM public.crm_add_lead_context(l.id,'call_transcript','Transcrição importada por SDR');
  PERFORM public.crm_add_lead_context(l.id,'manual_note','Anotação');
  BEGIN PERFORM public.crm_add_lead_context(l.id,'bad_type','Texto'); RAISE EXCEPTION 'FAIL invalid type'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_add_lead_context(l.id,'call_transcript',''); RAISE EXCEPTION 'FAIL empty context'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_add_lead_context(l.id,'call_transcript',E' \t\n'); RAISE EXCEPTION 'FAIL whitespace context'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_add_lead_context(l.id,'call_transcript',repeat('x',50001)); RAISE EXCEPTION 'FAIL truncated context'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE public.crm_lead_contexts SET author_name='Spoof'; RAISE EXCEPTION 'FAIL direct context update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_create_daily_goal_task(auth.uid(),current_date,'Unauthorized'); RAISE EXCEPTION 'FAIL SDR creates task'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_transition(l.id,'claim',l.version); RAISE EXCEPTION 'FAIL SDR closer capability'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_lead_contexts; l uuid; old_version bigint; BEGIN
  SELECT lead_id INTO l FROM context_daily_state;
  IF (SELECT count(*) FROM public.crm_lead_contexts WHERE lead_id=l)<>3 THEN RAISE EXCEPTION 'FAIL context shared visibility'; END IF;
  c:=public.crm_add_lead_context(l,'whatsapp_summary','Resumo importado por Closer');
  IF c.author_role<>'closer' THEN RAISE EXCEPTION 'FAIL Closer author'; END IF;
  SELECT * INTO c FROM public.crm_lead_contexts WHERE id=(SELECT context_id FROM context_daily_state);
  old_version:=c.version;
  c:=public.crm_update_lead_context(c.id,'whatsapp_summary','<script>alert(1)</script>',c.version);
  IF c.author_id<>'ce110000-0000-4000-8000-000000000001' OR c.updated_by<>auth.uid() OR c.version<>old_version+1 THEN RAISE EXCEPTION 'FAIL cross-role edit attribution'; END IF;
  BEGIN PERFORM public.crm_update_lead_context(c.id,'whatsapp_summary','Stale',old_version); RAISE EXCEPTION 'FAIL concurrent context edit'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce110000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE t public.daily_goal_tasks; today date:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date; BEGIN
  t:=public.executive_create_daily_goal_task('ce110000-0000-4000-8000-000000000001',today,'Primeira tarefa');
  UPDATE context_daily_state SET task_id=t.id;
  BEGIN PERFORM public.executive_create_daily_goal_task(t.assignee_id,today,'Primeira tarefa'); RAISE EXCEPTION 'FAIL duplicate task'; EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN PERFORM public.executive_create_daily_goal_task(t.assignee_id,today-1,'Retroactive'); RAISE EXCEPTION 'FAIL historical creation'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.executive_create_daily_goal_task(t.assignee_id,today,repeat('x',281)); RAISE EXCEPTION 'FAIL title length'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.set_daily_goal_task_completed(t.id,true,t.version); RAISE EXCEPTION 'FAIL executive marks another task'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  t:=public.executive_update_daily_goal_task(t.id,t.assignee_id,today,'Tarefa editada',t.version);
  BEGIN PERFORM public.executive_update_daily_goal_task(t.id,t.assignee_id,today,'Stale',t.version-1); RAISE EXCEPTION 'FAIL concurrent executive edit'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM public.executive_create_daily_goal_task('ce110000-0000-4000-8000-000000000002',today,'Outro colaborador');
  PERFORM public.executive_create_daily_goal_task(t.assignee_id,today+1,'Amanhã');
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ce110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE t public.daily_goal_tasks; future_task public.daily_goal_tasks; BEGIN
  IF EXISTS(SELECT 1 FROM public.daily_goal_tasks WHERE assignee_id<>auth.uid()) THEN RAISE EXCEPTION 'FAIL task RLS'; END IF;
  SELECT * INTO t FROM public.daily_goal_tasks WHERE id=(SELECT task_id FROM context_daily_state);
  t:=public.set_daily_goal_task_completed(t.id,true,t.version);
  IF NOT t.is_completed OR t.completed_by<>auth.uid() OR t.completed_at IS NULL THEN RAISE EXCEPTION 'FAIL task completion'; END IF;
  BEGIN PERFORM public.set_daily_goal_task_completed(t.id,false,t.version-1); RAISE EXCEPTION 'FAIL stale checkbox'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  SELECT * INTO future_task FROM public.daily_goal_tasks WHERE title='Amanhã';
  BEGIN PERFORM public.set_daily_goal_task_completed(future_task.id,true,future_task.version); RAISE EXCEPTION 'FAIL future checkbox'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.daily_goal_tasks SET title='Spoof'; RAISE EXCEPTION 'FAIL direct task edit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_delete_daily_goal_task(t.id,t.version); RAISE EXCEPTION 'FAIL SDR deletes task'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
-- Simulate a day transition on isolated rows, keeping the recorded result.
UPDATE public.daily_goal_tasks SET task_date=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date-1 WHERE id=(SELECT task_id FROM context_daily_state);
SELECT set_config('request.jwt.claims','{"sub":"ce110000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE t public.daily_goal_tasks; BEGIN
  SELECT * INTO t FROM public.daily_goal_tasks WHERE id=(SELECT task_id FROM context_daily_state);
  IF NOT t.is_completed THEN RAISE EXCEPTION 'FAIL historical completion lost'; END IF;
  BEGIN PERFORM public.executive_delete_daily_goal_task(t.id,t.version); RAISE EXCEPTION 'FAIL history removed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.executive_update_daily_goal_task(t.id,t.assignee_id,t.task_date,'Changed',t.version); RAISE EXCEPTION 'FAIL history edited'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
DO $$ DECLARE actor uuid; n integer; BEGIN
  FOR n IN 4..6 LOOP
    actor:=('ce110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF n<>6 AND EXISTS(SELECT 1 FROM public.crm_lead_contexts) THEN RAISE EXCEPTION 'FAIL unauthorized context read'; END IF;
    BEGIN PERFORM public.crm_add_lead_context((SELECT lead_id FROM context_daily_state),'manual_note','Unauthorized'); RAISE EXCEPTION 'FAIL unauthorized import'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.executive_create_daily_goal_task(actor,current_date,'Unauthorized'); RAISE EXCEPTION 'FAIL unauthorized task creation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
  END LOOP;
  IF has_table_privilege('anon','public.crm_lead_contexts','SELECT') OR has_table_privilege('anon','public.daily_goal_tasks','SELECT') THEN RAISE EXCEPTION 'FAIL anonymous table grants'; END IF;
  IF has_function_privilege('anon','public.crm_add_lead_context(uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL anonymous RPC'; END IF;
  IF (SELECT count(*) FROM public.executive_audit_events WHERE actor_id='ce110000-0000-4000-8000-000000000003' AND action LIKE 'daily_goal.%')<4 THEN RAISE EXCEPTION 'FAIL daily goal audit'; END IF;
END; $$;
