-- Execute after the migration inside a transaction that always rolls back.
-- Uses existing records; no commercial fixture is committed.
SELECT set_config('request.jwt.claim.sub',(
  SELECT r.user_id::text FROM public.user_roles r JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.role::text='super_admin' AND NOT p.suspended LIMIT 1
),true);

DO $$
DECLARE
 c public.crm_activities;
 q public.crm_activities;
 s public.vendas;
 f public.activity_feed;
 v_start timestamptz:=now()-interval '365 days';
 v_end timestamptz:=now()+interval '1 second';
 v_score numeric;
 v_count numeric;
 v_appointments numeric;
 v_sales numeric;
 v_revision bigint;
 v_removed_appointments numeric;
 v_sdr_cycle uuid;
 v_closer_cycle uuid;
 v_cycle_actual numeric;
 v_normal_sdr uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Admin context unavailable'; END IF;
 IF has_table_privilege('authenticated','public.arena_counted_call_events','SELECT') THEN
   RAISE EXCEPTION 'Derived call facts are exposed to clients'; END IF;
 INSERT INTO public.goal_cycles(family_id,goal_id,starts_at,ends_at,target)
 SELECT gen_random_uuid(),g.id,v_start,v_end,g.target FROM public.company_goals g
 WHERE g.scope='role' AND g.target_role='sdr' ORDER BY g.version DESC LIMIT 1 RETURNING id INTO v_sdr_cycle;
 INSERT INTO public.goal_cycles(family_id,goal_id,starts_at,ends_at,target)
 SELECT gen_random_uuid(),g.id,v_start,v_end,g.target FROM public.company_goals g
 WHERE g.scope='role' AND g.target_role='closer' ORDER BY g.version DESC LIMIT 1 RETURNING id INTO v_closer_cycle;
 SELECT a.* INTO c FROM public.crm_activities a
 JOIN public.activity_feed e ON e.event_key='closing.scheduled:'||a.id
 WHERE a.call_type='fechamento_closer' AND a.cancelled_at IS NULL AND NOT a.is_completed
   AND e.score_delta>0 AND e.occurred_at>=v_start AND e.occurred_at<v_end
 ORDER BY e.occurred_at DESC LIMIT 1;
 IF c.id IS NULL THEN RAISE EXCEPTION 'No active SDR-created closing call'; END IF;
 SELECT * INTO f FROM public.activity_feed WHERE event_key='closing.scheduled:'||c.id;
 v_normal_sdr:=f.responsible_id;
 SELECT (x->>'score')::numeric,(x->>'repasses')::numeric INTO v_score,v_count
 FROM jsonb_array_elements(public.arena_sdr_ranking(v_start,v_end)) x WHERE x->>'user_id'=f.responsible_id::text;
 v_appointments:=(public.arena_period_metrics(v_start,v_end)->>'appointments')::numeric;
 v_cycle_actual:=(public.arena_cycle_result(v_sdr_cycle)->>'actual')::numeric;
 SELECT revision INTO v_revision FROM public.dashboard_events WHERE topic='arena';
 PERFORM public.arena_cancel_call(c.id,c.updated_at,'Verificação transacional da Arena');
 IF (SELECT (x->>'score')::numeric FROM jsonb_array_elements(public.arena_sdr_ranking(v_start,v_end)) x
   WHERE x->>'user_id'=f.responsible_id::text) IS DISTINCT FROM v_score-f.score_delta THEN
   RAISE EXCEPTION 'SDR percentage did not fall after closing cancellation'; END IF;
 IF (SELECT (x->>'repasses')::numeric FROM jsonb_array_elements(public.arena_sdr_ranking(v_start,v_end)) x
   WHERE x->>'user_id'=f.responsible_id::text) IS DISTINCT FROM v_count-1 THEN
   RAISE EXCEPTION 'Cancelled handoff remains in SDR total'; END IF;
 IF (public.arena_period_metrics(v_start,v_end)->>'appointments')::numeric IS DISTINCT FROM v_appointments-1 THEN
   RAISE EXCEPTION 'Cancelled closing remains in appointments'; END IF;
 IF (public.arena_cycle_result(v_sdr_cycle)->>'actual')::numeric IS DISTINCT FROM v_cycle_actual-f.score_delta THEN
   RAISE EXCEPTION 'SDR goal percentage did not fall after closing cancellation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.activity_feed x WHERE x.event_key='call.cancelled:'||c.id
   AND x.reverses_id=f.id AND x.score_delta=-f.score_delta AND x.responsible_id=f.responsible_id) THEN
   RAISE EXCEPTION 'Closing cancellation audit points to the wrong SDR'; END IF;
 IF (SELECT revision FROM public.dashboard_events WHERE topic='arena')<=v_revision THEN
   RAISE EXCEPTION 'Cancellation did not notify the monitor'; END IF;
 PERFORM public.arena_cancel_call(c.id,c.updated_at,'Verificação transacional da Arena');
 IF (SELECT count(*) FROM public.activity_feed WHERE event_key='call.cancelled:'||c.id)<>1 THEN
   RAISE EXCEPTION 'Repeated cancellation duplicated its audit event'; END IF;

 SELECT a.* INTO q FROM public.crm_activities a
 JOIN public.activity_feed e ON e.event_key='q.scheduled:'||a.id
 WHERE a.call_type='qualificacao' AND a.cancelled_at IS NULL
   AND e.occurred_at>=v_start AND e.occurred_at<v_end
 ORDER BY e.occurred_at DESC LIMIT 1;
 IF q.id IS NULL THEN RAISE EXCEPTION 'No qualification call for rollback verification'; END IF;
 SELECT * INTO f FROM public.activity_feed WHERE event_key='q.scheduled:'||q.id;
 -- A rollback-only Q event assigned to a visible SDR exercises the real goal
 -- percentage; the historical Q calls here belong to the excluded TV admin.
 PERFORM public.arena_emit('verification:q:'||gen_random_uuid(),'q.scheduled',v_normal_sdr,
   'sdr','crm_activities',q.id,clock_timestamp(),0.2,0,q.lead_id);
 SELECT (x->>'score')::numeric,(x->>'scheduled')::numeric INTO v_score,v_count
 FROM jsonb_array_elements(public.arena_sdr_ranking(v_start,v_end)) x WHERE x->>'user_id'=v_normal_sdr::text;
 v_appointments:=(public.arena_period_metrics(v_start,v_end)->>'appointments')::numeric;
 SELECT count(*) INTO v_removed_appointments FROM public.arena_counted_call_events
   WHERE lead_id=q.lead_id AND action_type IN ('q.scheduled','closing.scheduled')
   AND occurred_at>=v_start AND occurred_at<v_end;
 v_cycle_actual:=(public.arena_cycle_result(v_sdr_cycle)->>'actual')::numeric;
 PERFORM public.crm_delete_lead(q.lead_id,(SELECT version FROM public.crm_leads WHERE id=q.lead_id));
 IF (SELECT (x->>'score')::numeric FROM jsonb_array_elements(public.arena_sdr_ranking(v_start,v_end)) x
   WHERE x->>'user_id'=v_normal_sdr::text) IS DISTINCT FROM v_score-0.2 THEN
   RAISE EXCEPTION 'Removed Q call remains in SDR percentage'; END IF;
 IF (SELECT (x->>'scheduled')::numeric FROM jsonb_array_elements(public.arena_sdr_ranking(v_start,v_end)) x
   WHERE x->>'user_id'=v_normal_sdr::text) IS DISTINCT FROM v_count-1 THEN
   RAISE EXCEPTION 'Removed Q call remains in scheduled total'; END IF;
 IF (public.arena_period_metrics(v_start,v_end)->>'appointments')::numeric IS DISTINCT FROM v_appointments-v_removed_appointments THEN
   RAISE EXCEPTION 'Removed lead calls remain in appointments'; END IF;
 IF EXISTS(SELECT 1 FROM public.arena_counted_call_events WHERE lead_id=q.lead_id) THEN
   RAISE EXCEPTION 'Removed lead still contributes call points'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.activity_feed x WHERE x.event_key='call.cancelled:'||q.id
   AND x.reverses_id=f.id AND x.score_delta=-f.score_delta) THEN
   RAISE EXCEPTION 'Removed Q call lacks a correct audit reversal'; END IF;
 IF (public.arena_cycle_result(v_sdr_cycle)->>'actual')::numeric IS DISTINCT FROM v_cycle_actual-0.2 THEN
   RAISE EXCEPTION 'SDR goal percentage did not fall after Q lead removal'; END IF;

 SELECT v.* INTO s FROM public.vendas v WHERE v.approval_status='aprovada'
   AND NOT COALESCE(v.withdrawn,false) AND v.withdrawal_id IS NULL
   AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer')
 ORDER BY v.updated_at DESC LIMIT 1;
 IF s.id IS NULL THEN RAISE EXCEPTION 'No approved Closer sale for rollback verification'; END IF;
 SELECT (x->>'score')::numeric,(x->>'quantidadeVendas')::numeric INTO v_score,v_count
 FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x WHERE x->>'user_id'=s.user_id::text;
 v_sales:=(public.arena_period_metrics(v_start,v_end)->>'sales')::numeric;
 v_cycle_actual:=(public.arena_cycle_result(v_closer_cycle)->>'actual')::numeric;
 PERFORM public.arena_reverse_sale(s.id,'estornada','Verificação transacional da Arena',s.updated_at);
 IF (SELECT (x->>'score')::numeric FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
   WHERE x->>'user_id'=s.user_id::text) IS DISTINCT FROM v_score-10 THEN
   RAISE EXCEPTION 'Closer percentage did not fall after sale reversal'; END IF;
 IF (SELECT (x->>'quantidadeVendas')::numeric FROM jsonb_array_elements(public.arena_team_ranking(v_start,v_end)) x
   WHERE x->>'user_id'=s.user_id::text) IS DISTINCT FROM v_count-1 THEN
   RAISE EXCEPTION 'Reversed sale remains in Closer total'; END IF;
 IF (public.arena_period_metrics(v_start,v_end)->>'sales')::numeric IS DISTINCT FROM v_sales-1 THEN
   RAISE EXCEPTION 'Reversed sale remains in dashboard sales count'; END IF;
 IF (public.arena_cycle_result(v_closer_cycle)->>'actual')::numeric IS DISTINCT FROM v_cycle_actual-10 THEN
   RAISE EXCEPTION 'Closer goal percentage did not fall after sale reversal'; END IF;
END $$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
