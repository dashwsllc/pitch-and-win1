-- This entire regression fixture rolls back, including audit and notification rows.
BEGIN;
DO $test$
DECLARE
 v_exec uuid;
 v_person uuid;
 v_other uuid;
 v_goal uuid;
 v_before bigint;
 v_after bigint;
 v_bad boolean:=false;
 v_today date:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 SELECT user_id INTO v_exec FROM public.user_roles WHERE role::text='executive' LIMIT 1;
 SELECT p.user_id INTO v_person FROM public.profiles p JOIN public.user_roles r USING(user_id)
 WHERE r.role::text='sdr' AND NOT p.suspended AND p.user_id<>v_exec LIMIT 1;
 SELECT p.user_id INTO v_other FROM public.profiles p JOIN public.user_roles r USING(user_id)
 WHERE r.role::text='sdr' AND NOT p.suspended AND p.user_id<>v_person AND p.user_id<>v_exec LIMIT 1;
 IF v_exec IS NULL OR v_person IS NULL OR v_other IS NULL THEN
   RAISE EXCEPTION 'QA requires one Executive and two active SDRs';
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_exec,'role','authenticated')::text,true);
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'QA Executive lacks Arena access'; END IF;

 BEGIN
   PERFORM public.arena_assign_tasks('QA isolation',v_today,ARRAY[v_person],ARRAY['sdr'],'not_scheduled');
   v_bad:=true;
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF v_bad THEN RAISE EXCEPTION 'Named task expanded to a role'; END IF;
 v_bad:=false;
 BEGIN
   PERFORM public.arena_assign_tasks('QA isolation',v_today,ARRAY[v_person,v_other],'{}'::text[],'not_scheduled');
   v_bad:=true;
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF v_bad THEN RAISE EXCEPTION 'Multiple recipients accepted'; END IF;

 IF public.arena_create_shift_approach_goals('QA shift',ARRAY[v_person],'{}'::text[],
   clock_timestamp()-interval '1 minute',10,50,'manual')<>1 THEN
   RAISE EXCEPTION 'Shift goal count mismatch';
 END IF;
 SELECT id INTO v_goal FROM public.arena_shift_approach_goals
 WHERE title='QA shift' AND assignee_id=v_person ORDER BY created_at DESC LIMIT 1;
 IF v_goal IS NULL OR EXISTS(SELECT 1 FROM public.arena_shift_approach_goals
   WHERE title='QA shift' AND assignee_id<>v_person) THEN
   RAISE EXCEPTION 'Shift goal leaked to another person';
 END IF;

 SELECT (x.value->>'actual')::bigint INTO v_before
 FROM jsonb_array_elements(public.arena_shift_approach_progress(v_today,v_person,0)) x
 WHERE x.value->>'id'=v_goal::text;
 INSERT INTO public.abordagens(user_id,nomes_abordados,dados_abordados,
   tempo_medio_abordagem,mostrou_ia,visao_geral,created_at)
 VALUES(v_person,'QA shift approach','QA',1,false,'QA',now()-interval '1 second');
 SELECT (x.value->>'actual')::bigint INTO v_after
 FROM jsonb_array_elements(public.arena_shift_approach_progress(v_today,v_person,0)) x
 WHERE x.value->>'id'=v_goal::text;
 IF v_after<>v_before+1 THEN
   RAISE EXCEPTION 'Approach did not advance progress: % -> %',v_before,v_after;
 END IF;

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_shift_approach_progress(v_today,NULL,0)) x
   WHERE x.value->>'id'=v_goal::text) THEN
   RAISE EXCEPTION 'Another employee can read the shift goal';
 END IF;
END $test$;
ROLLBACK;
SELECT 'targeted_shift_goals_passed' result;
