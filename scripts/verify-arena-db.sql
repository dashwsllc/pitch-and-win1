-- Appended to the three migrations inside ONE transaction by check-arena-db.mjs.
-- Uses existing real records only; no fixtures, no committed writes.
DO $$ BEGIN
 IF has_table_privilege('anon','public.activity_feed','SELECT') THEN RAISE EXCEPTION 'Anonymous feed access'; END IF;
 IF has_table_privilege('authenticated','public.activity_feed','INSERT') THEN RAISE EXCEPTION 'Client can forge events'; END IF;
 IF has_function_privilege('authenticated','public.arena_tick()','EXECUTE') THEN RAISE EXCEPTION 'Client can run worker'; END IF;
 IF has_function_privilege('authenticated','public.arena_team_ranking(timestamptz,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Private ranking exposed'; END IF;
 IF public.arena_classification(101,100,now()-interval '1 day',now()+interval '1 day',now())<>'exceeded' THEN RAISE EXCEPTION 'Exceeded classification'; END IF;
 IF public.arena_classification(99,100,now()-interval '2 days',now()-interval '1 day',now())<>'failed' THEN RAISE EXCEPTION 'Deadline classification'; END IF;
 BEGIN
   PERFORM public.arena_dashboard(now()-interval '1 day',now());
   RAISE EXCEPTION 'Unauthenticated dashboard succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM auth.users WHERE lower(email)='fecass1507@gmail.com'),true);
DO $$ DECLARE v jsonb; c public.goal_cycles; e public.activity_feed; v_count integer; v_goal uuid; BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'TV uses normal role access'; END IF;
 v:=public.arena_dashboard(date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo',now()+interval '1 second');
 IF jsonb_array_length(v->'cycles')<>3 THEN RAISE EXCEPTION 'Expected initial daily, weekly and monthly cycles'; END IF;
 PERFORM public.arena_assignees();
 PERFORM public.arena_management('goals');
 PERFORM public.arena_management('history');
 PERFORM public.arena_management('audit');
 PERFORM public.arena_management('reconciliation');
 SELECT * INTO e FROM public.activity_feed WHERE action_type='sale.approved' LIMIT 1;
 IF FOUND THEN
   SELECT count(*) INTO v_count FROM public.activity_feed;
   PERFORM public.arena_emit(e.event_key,e.action_type,e.responsible_id,e.responsible_role,e.source_type,e.source_id,e.occurred_at,e.score_delta,e.revenue_delta);
   IF (SELECT count(*) FROM public.activity_feed)<>v_count THEN RAISE EXCEPTION 'Duplicate event accepted'; END IF;
   BEGIN UPDATE public.activity_feed SET score_delta=0 WHERE id=e.id; RAISE EXCEPTION 'Mutable ledger'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END IF;
 SELECT * INTO c FROM public.goal_cycles LIMIT 1;
 PERFORM public.arena_cycle_result(c.id);
 PERFORM public.arena_tick();
END $$;
SELECT jsonb_build_object('validation','passed','events',(SELECT count(*) FROM public.activity_feed),'cycles',(SELECT count(*) FROM public.goal_cycles),'committed',false) AS result;
DO $$ DECLARE s public.vendas; c public.crm_activities; g public.company_goals; v_revenue numeric; v_score numeric; v_id uuid; v_revision bigint; v_count integer; BEGIN
 SELECT * INTO s FROM public.vendas WHERE approval_status='aprovada' AND NOT COALESCE(withdrawn,false) AND withdrawal_id IS NULL LIMIT 1;
 IF s.id IS NOT NULL THEN
   SELECT sum(revenue_delta),sum(score_delta) INTO v_revenue,v_score FROM public.activity_feed WHERE source_type='vendas' AND source_id=s.id;
   PERFORM public.arena_reverse_sale(s.id,'estornada','Validação transacional sem gravação',s.updated_at);
   PERFORM public.arena_reverse_sale(s.id,'estornada','Validação transacional sem gravação',s.updated_at);
   IF (SELECT sum(revenue_delta) FROM public.activity_feed WHERE source_id=s.id)<>v_revenue THEN RAISE EXCEPTION 'Refund reduced historical gross'; END IF;
   IF (SELECT sum(score_delta) FROM public.activity_feed WHERE source_id=s.id)<>v_score-10 THEN RAISE EXCEPTION 'Refund score was not exactly once'; END IF;
 END IF;
 SELECT * INTO c FROM public.crm_activities WHERE call_type='qualificacao' AND NOT is_completed LIMIT 1;
 IF c.id IS NOT NULL THEN
   SELECT count(*) INTO v_count FROM public.activity_feed WHERE source_id=c.id;
   PERFORM public.reschedule_crm_call(c.id,now()+interval '2 days',c.updated_at);
   IF (SELECT count(*) FROM public.activity_feed WHERE source_id=c.id)<>v_count THEN RAISE EXCEPTION 'Reschedule scored twice'; END IF;
   SELECT * INTO c FROM public.crm_activities WHERE id=c.id;
   PERFORM public.arena_cancel_call(c.id,c.updated_at,'Validação transacional sem gravação');
   PERFORM public.arena_cancel_call(c.id,c.updated_at,'Validação transacional sem gravação');
   IF (SELECT sum(score_delta) FROM public.activity_feed WHERE source_id=c.id)<>0 THEN RAISE EXCEPTION 'Qualification cancellation score'; END IF;
 END IF;
 SELECT * INTO g FROM public.company_goals WHERE scope='global';
 v_id:=public.arena_save_goal(jsonb_build_object('title',g.title,'target',g.target+1),'Validação transacional sem gravação',g.id);
 IF NOT EXISTS(SELECT 1 FROM public.company_goals WHERE id=g.id AND target=g.target) THEN RAISE EXCEPTION 'Goal history rewritten'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.goal_cycles WHERE goal_id=v_id AND target=g.target+1) THEN RAISE EXCEPTION 'Active cycle version not updated'; END IF;
 SELECT revision INTO v_revision FROM public.dashboard_events WHERE topic='arena';
 PERFORM public.arena_tick();
 IF (SELECT revision FROM public.dashboard_events WHERE topic='arena')<>v_revision THEN RAISE EXCEPTION 'Idle deadline tick invalidated dashboard'; END IF;
 PERFORM public.get_sales_board('estornada','',0,12);
END $$;
SELECT jsonb_build_object('validation','passed','checks',ARRAY['RBAC','TV account','immutable ledger','deduplication','refund preserves gross','refund exactly once','reschedule neutral','cancel exactly once','goal versions','idle worker','aggregate RPCs'],'committed',false) AS result;
DO $$ DECLARE p record; permitted boolean; expected boolean; rows_found integer; BEGIN
 FOR p IN SELECT user_id,suspended FROM public.profiles LOOP
   PERFORM set_config('request.jwt.claim.sub',p.user_id::text,true);
   SELECT NOT p.suspended AND EXISTS(SELECT 1 FROM public.registration_requests WHERE user_id=p.user_id AND status='approved')
     AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text IN ('sdr','closer','executive','super_admin')) INTO expected;
   EXECUTE 'SET LOCAL ROLE authenticated';
   permitted:=public.arena_has_access();
   IF permitted IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Role access differs from expected'; END IF;
   IF NOT public.arena_has_access(true) THEN
     BEGIN PERFORM public.arena_save_goal('{}','Verificação de acesso'); RAISE EXCEPTION 'Non-admin changed goals'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
     BEGIN PERFORM public.arena_management('audit'); RAISE EXCEPTION 'Non-admin read administrative audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   END IF;
   IF NOT permitted THEN
     SELECT count(*) INTO rows_found FROM public.activity_feed;
     IF rows_found<>0 THEN RAISE EXCEPTION 'Feed RLS exposed rows'; END IF;
     BEGIN PERFORM public.arena_dashboard(now()-interval '1 day',now()); RAISE EXCEPTION 'Unauthorized dashboard'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   END IF;
   IF NOT public.is_super_admin(auth.uid()) THEN
     SELECT count(*) INTO rows_found FROM public.assinaturas;
     IF rows_found<>0 THEN RAISE EXCEPTION 'Clientes exposed outside Super Admin'; END IF;
   END IF;
   SELECT count(*) INTO rows_found FROM public.arena_notifications WHERE recipient_id<>auth.uid();
   IF rows_found<>0 THEN RAISE EXCEPTION 'Notifications from another user exposed'; END IF;
   BEGIN INSERT INTO public.activity_feed(action_type) VALUES('not allowed'); RAISE EXCEPTION 'Event forgery accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT jsonb_build_object('validation','passed','checks','events, goals, refunds, neutral reschedule, immutable history and RLS for every real profile','committed',false) AS result;

SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM auth.users WHERE lower(email)='fecass1507@gmail.com'),true);
DO $$ DECLARE c public.goal_cycles; g public.company_goals; v_id uuid; revision_before bigint; original_end timestamptz; payload jsonb; BEGIN
 SELECT gc.* INTO c FROM public.goal_cycles gc JOIN public.company_goals cg ON cg.id=gc.goal_id WHERE cg.scope='role' AND cg.period='daily' AND gc.closed_at IS NULL LIMIT 1;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 original_end:=c.ends_at;
 v_id:=public.arena_save_goal(jsonb_build_object('title',g.title,'target',g.target,'cycle_start',c.starts_at,'cycle_end',original_end+interval '1 hour'),'Validação de prazo sem gravação',g.id);
 IF NOT EXISTS(SELECT 1 FROM public.goal_cycles WHERE id=c.id AND starts_at=c.starts_at AND ends_at=original_end+interval '1 hour' AND goal_id=v_id) THEN RAISE EXCEPTION 'Current deadline did not follow its version'; END IF;
 IF (SELECT cycle_end FROM public.company_goals WHERE id=g.id) IS NOT NULL THEN RAISE EXCEPTION 'Deadline edit mutated old goal version'; END IF;
 revision_before:=public.arena_revision();
 UPDATE public.abordagens SET created_at=created_at WHERE false;
 IF public.arena_revision()<=revision_before THEN RAISE EXCEPTION 'Fallback misses legacy approach revision'; END IF;
 payload:=public.arena_dashboard(now()-interval '7 days',now());
 IF (payload->>'revision')::bigint<>public.arena_revision() THEN RAISE EXCEPTION 'Revision cursor differs from aggregate'; END IF;
 IF position('call_performed' IN pg_get_functiondef('public.crm_transition(uuid,text,bigint,jsonb)'::regprocedure))=0 THEN RAISE EXCEPTION 'Closing attendance confirmation missing'; END IF;
END $$;

-- Exercise the deadline using an existing cycle inside the rollback-only test.
-- No fabricated sale, lead, account or score is inserted.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM auth.users WHERE lower(email)='fecass1507@gmail.com'),true);
DO $$ DECLARE c public.goal_cycles; g public.company_goals; frozen jsonb; v_id uuid; BEGIN
 SELECT gc.* INTO c FROM public.goal_cycles gc JOIN public.company_goals cg ON cg.id=gc.goal_id
 WHERE cg.scope='global' AND cg.period='monthly' AND gc.closed_at IS NULL LIMIT 1;
 UPDATE public.goal_cycles SET ends_at=now()-interval '1 second' WHERE id=c.id;
 PERFORM public.arena_tick();
 SELECT result INTO frozen FROM public.goal_cycles WHERE id=c.id AND closed_at IS NOT NULL;
 IF frozen IS NULL OR NOT (frozen ? 'closers' AND frozen ? 'sdrs') THEN RAISE EXCEPTION 'Deadline did not preserve monthly rankings'; END IF;
 SELECT * INTO g FROM public.company_goals WHERE family_id=c.family_id ORDER BY version DESC LIMIT 1;
 v_id:=public.arena_save_goal(jsonb_build_object('title',g.title,'target',g.target+1,'enabled',false),'Validação transacional de ciclo encerrado',g.id);
 IF (SELECT result FROM public.goal_cycles WHERE id=c.id) IS DISTINCT FROM frozen THEN RAISE EXCEPTION 'New goal rewrote closed result'; END IF;
 BEGIN UPDATE public.goal_cycles SET target=target+1 WHERE id=c.id; RAISE EXCEPTION 'Closed target is mutable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.goal_cycles WHERE id=c.id; RAISE EXCEPTION 'Closed cycle can be deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.arena_tick();
 IF public.arena_cycle_result(c.id) IS DISTINCT FROM frozen THEN RAISE EXCEPTION 'Repeated worker rewrote closed rankings'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.goal_cycles WHERE family_id=c.family_id AND closed_at IS NULL) THEN RAISE EXCEPTION 'Monthly archive stopped with disabled goal'; END IF;
END $$;
SELECT jsonb_build_object('validation','passed','checks','server deadline, monthly ranking snapshot, immutable closed cycle, goal change and disabled-goal archive','committed',false) AS result;
