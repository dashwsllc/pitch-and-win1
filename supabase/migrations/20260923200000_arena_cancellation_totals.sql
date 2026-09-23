-- Open Arena periods reflect the current state of calls and sales.
-- Immutable events continue to record what happened, including cancellations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

CREATE OR REPLACE VIEW public.arena_counted_call_events AS
SELECT f.* FROM public.activity_feed f
JOIN public.crm_activities c ON c.id=f.source_id
WHERE f.source_type='crm_activities' AND c.cancelled_at IS NULL
  AND f.action_type IN ('q.scheduled','closing.scheduled','q.handoff',
    'q.performed','closing.performed','q.no_handoff','closing.no_sale')
  AND (f.action_type<>'q.handoff' OR EXISTS(
    SELECT 1 FROM public.crm_activities h
    WHERE h.lead_id=c.lead_id AND h.call_type='fechamento_closer'
      AND h.cancelled_at IS NULL AND h.created_at>=c.created_at));
REVOKE ALL ON public.arena_counted_call_events FROM PUBLIC,anon,authenticated;

CREATE TRIGGER arena_lead_delete_signal AFTER DELETE ON public.crm_leads
FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');

CREATE OR REPLACE FUNCTION public.arena_call_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.crm_activities; e public.activity_feed; q public.crm_activities; v_person uuid;
BEGIN
 IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
 IF c.call_type IS NULL THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
   IF c.call_type='qualificacao' THEN
     PERFORM public.arena_emit('q.scheduled:'||c.id,'q.scheduled',c.assigned_to,'sdr','crm_activities',c.id,c.created_at,0.2,0,c.lead_id);
   ELSE
     PERFORM public.arena_emit('closing.scheduled:'||c.id,'closing.scheduled',c.user_id,'sdr','crm_activities',c.id,c.created_at,
       CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='sdr') THEN 0.4 ELSE 0 END,0,c.lead_id);
     -- Only an explicitly performed qualification can earn the handoff milestone.
     SELECT * INTO q FROM public.crm_activities WHERE lead_id=c.lead_id AND call_type='qualificacao'
       AND performed_at IS NOT NULL AND cancelled_at IS NULL AND outcome='avancou'
       ORDER BY performed_at DESC,id LIMIT 1;
     IF FOUND THEN
       PERFORM public.arena_emit('q.handoff:'||q.id,'q.handoff',q.assigned_to,'sdr','crm_activities',q.id,
         c.created_at,0.5,0,c.lead_id);
     END IF;
   END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.performed_at IS NOT NULL AND OLD.performed_at IS NULL THEN
     PERFORM public.arena_emit('call.performed:'||c.id,CASE WHEN c.call_type='qualificacao' THEN 'q.performed' ELSE 'closing.performed' END,
       c.assigned_to,CASE WHEN c.call_type='qualificacao' THEN 'sdr' ELSE 'closer' END,'crm_activities',c.id,c.performed_at,0,0,c.lead_id);
   END IF;
   IF NEW.is_completed AND NOT OLD.is_completed AND NEW.outcome IN ('venda_perdida','lead_perdido','followup_sdr') THEN
     PERFORM public.arena_emit('call.no_sale:'||c.id,CASE WHEN c.call_type='qualificacao' THEN 'q.no_handoff' ELSE 'closing.no_sale' END,
       c.assigned_to,CASE WHEN c.call_type='qualificacao' THEN 'sdr' ELSE 'closer' END,'crm_activities',c.id,c.completed_at,0,0,c.lead_id);
   END IF;
 END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL) THEN
   SELECT * INTO e FROM public.activity_feed WHERE event_key=(CASE WHEN c.call_type='qualificacao' THEN 'q.scheduled:' ELSE 'closing.scheduled:' END)||c.id;
   PERFORM public.arena_emit('call.cancelled:'||c.id,'call.cancelled',
     COALESCE(e.responsible_id,CASE WHEN c.call_type='qualificacao' THEN c.assigned_to ELSE c.user_id END),
     COALESCE(e.responsible_role,'sdr'),'crm_activities',c.id,clock_timestamp(),
     CASE WHEN e.id IS NOT NULL THEN -e.score_delta ELSE 0 END,0,c.lead_id,e.id,
     COALESCE(c.cancellation_reason,CASE WHEN TG_OP='DELETE' THEN 'Call removida com o lead' END));
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.arena_sdr_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.repasses DESC,x.conversao DESC,x.abordagens DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'SDR') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.score,0)+COALESCE(adj.score,0) score,COALESCE(s.repasses,0) repasses,COALESCE(s.scheduled,0) scheduled,COALESCE(s.performed,0) performed,
 COALESCE(cancelled.cancelled,0) cancelled,COALESCE(s.no_handoff,0) no_handoff,COALESCE(a.total,0) abordagens,
 COALESCE(a.leads_abordados,0) AS "leadsAbordados",
 CASE WHEN a.leads_abordados>0 THEN round(COALESCE(s.repasses,0)*100.0/a.leads_abordados,1) ELSE 0 END conversao
 FROM public.profiles p
 LEFT JOIN LATERAL(SELECT sum(score_delta) score,count(*) FILTER(WHERE action_type='closing.scheduled') repasses,
 count(*) FILTER(WHERE action_type='q.scheduled') scheduled,count(*) FILTER(WHERE action_type='q.performed') performed,
 count(*) FILTER(WHERE action_type='q.no_handoff') no_handoff
 FROM public.arena_counted_call_events WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) s ON true
 LEFT JOIN LATERAL(SELECT sum(score_delta) score FROM public.activity_feed WHERE action_type='score.adjusted'
   AND responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) adj ON true
 LEFT JOIN LATERAL(SELECT count(*) cancelled FROM public.activity_feed WHERE action_type='call.cancelled'
   AND responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) cancelled ON true
 LEFT JOIN LATERAL(
   SELECT COALESCE(sum(
     CASE WHEN COALESCE(l.first_contact_at,l.approached_at,l.created_at)>=p_start
       AND COALESCE(l.first_contact_at,l.approached_at,l.created_at)<p_end
       THEN greatest(0,l.approach_count-COALESCE(e.all_events,0)) ELSE 0 END
     +COALESCE(e.period_events,0)),0) total,
     count(*) FILTER(WHERE l.approach_stage IN ('abordado','reabordado') AND (
       (l.approach_count>COALESCE(e.all_events,0)
         AND COALESCE(l.first_contact_at,l.approached_at,l.created_at)>=p_start
         AND COALESCE(l.first_contact_at,l.approached_at,l.created_at)<p_end)
       OR COALESCE(e.period_events,0)>0)) leads_abordados
   FROM public.crm_leads l
   LEFT JOIN LATERAL(SELECT count(*) all_events,
     count(*) FILTER(WHERE f.occurred_at>=p_start AND f.occurred_at<p_end) period_events
     FROM public.activity_feed f WHERE f.action_type='lead.approached'
       AND f.source_type='crm_leads' AND f.source_id=l.id) e ON true
   WHERE l.sdr_id=p.user_id
 ) a ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='sdr')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end))
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin')
 ) x;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'Closer') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.revenue,0) AS "totalVendas",COALESCE(s.sales,0) AS "quantidadeVendas",
 COALESCE(e.score,0)+COALESCE(s.sales,0)*10 AS score,
 COALESCE(a.total,0) abordagens,CASE WHEN a.total>0 THEN round(COALESCE(s.sales,0)*100.0/a.total,1) ELSE 0 END conversao
 FROM public.profiles p
 LEFT JOIN LATERAL (SELECT COALESCE(sum(v.revenue),0) revenue,count(*) sales FROM public.arena_sale_facts v
   WHERE v.active AND v.user_id=p.user_id AND v.responsible_role='closer'
   AND v.occurred_at>=p_start AND v.occurred_at<p_end) s ON true
 LEFT JOIN LATERAL (SELECT COALESCE(sum(f.score_delta),0) score FROM public.activity_feed f
   WHERE f.responsible_id=p.user_id AND f.responsible_role='closer'
   AND f.action_type NOT IN ('sale.approved','sale.reversed')
   AND f.occurred_at>=p_start AND f.occurred_at<p_end) e ON true
 LEFT JOIN LATERAL(SELECT count(*) total FROM public.abordagens WHERE user_id=p.user_id AND created_at>=p_start AND created_at<p_end) a ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='closer')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end)
 OR s.sales>0)
 AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin')
 ) x;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.arena_cycle_result(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.goal_cycles; g public.company_goals; v_members jsonb; v_actual numeric; v_target numeric; v_result jsonb;
BEGIN
 SELECT * INTO c FROM public.goal_cycles WHERE id=p_id;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 IF c.closed_at IS NOT NULL THEN RETURN c.result; END IF;
 IF g.scope='global' THEN
   SELECT COALESCE(sum(v.revenue),0) INTO v_actual FROM public.arena_sale_facts v
   WHERE v.occurred_at>=c.starts_at AND v.occurred_at<c.ends_at;
   v_target:=c.target;
 ELSE
   WITH members AS (
     SELECT p.user_id,p.display_name,p.avatar_url,p.suspended FROM public.profiles p WHERE NOT p.arena_hidden
     AND (g.scope<>'user' OR p.user_id=g.assignee_id)
     AND (EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=g.target_role)
       OR EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.responsible_id=p.user_id AND f.responsible_role=g.target_role AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at))
     AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text='super_admin')
   ), measured AS (
     SELECT m.*,
       COALESCE((SELECT sum(f.score_delta) FROM public.arena_counted_call_events f WHERE f.responsible_id=m.user_id AND f.responsible_role=g.target_role
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + COALESCE((SELECT sum(f.score_delta) FROM public.activity_feed f WHERE f.action_type='score.adjusted'
         AND f.responsible_id=m.user_id AND f.responsible_role=g.target_role
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + CASE WHEN g.target_role='closer' THEN 10*(SELECT count(*) FROM public.arena_sale_facts v
         WHERE v.user_id=m.user_id AND v.responsible_role='closer' AND v.active
         AND v.occurred_at>=c.starts_at AND v.occurred_at<c.ends_at) ELSE 0 END actual,
       COALESCE((SELECT CASE WHEN candidate.enabled THEN candidate.target END FROM (
       SELECT * FROM public.company_goals WHERE scope='user' AND assignee_id=m.user_id AND target_role=g.target_role AND period=g.period
       AND effective_at<=least(now(),c.ends_at) AND (cycle_start IS NULL OR cycle_start<=least(now(),c.ends_at))
       AND (cycle_end IS NULL OR recurring OR cycle_end>=c.ends_at) ORDER BY effective_at DESC,version DESC LIMIT 1) candidate),c.target) target FROM members m
   ) SELECT COALESCE(jsonb_agg(to_jsonb(measured)||jsonb_build_object('state',public.arena_classification(actual,target,c.starts_at,c.ends_at,now())) ORDER BY display_name,user_id),'[]'),
     COALESCE(sum(actual),0),COALESCE(sum(target),0) INTO v_members,v_actual,v_target FROM measured;
 END IF;
 v_result:=jsonb_build_object('actual',v_actual,'target',v_target,'members',COALESCE(v_members,'[]'),
 'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE public.arena_classification(v_actual,v_target,c.starts_at,c.ends_at,now()) END);
 IF g.scope='global' AND g.period='monthly' AND c.ends_at<=now() THEN
   v_result:=v_result||jsonb_build_object('closers',public.arena_team_ranking(c.starts_at,c.ends_at),'sdrs',public.arena_sdr_ranking(c.starts_at,c.ends_at));
 END IF;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.arena_period_metrics(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH sales AS (SELECT COALESCE(sum(revenue),0) revenue,count(*) FILTER(WHERE active) sales,
   COALESCE(sum(revenue) FILTER(WHERE active),0) active_revenue FROM public.arena_sale_facts
   WHERE occurred_at>=p_start AND occurred_at<p_end),
 appointments AS (SELECT count(*) n FROM public.arena_counted_call_events WHERE action_type IN ('q.scheduled','closing.scheduled') AND occurred_at>=p_start AND occurred_at<p_end),
 approaches AS (SELECT count(*) n FROM public.abordagens WHERE created_at>=p_start AND created_at<p_end),
 traffic AS (SELECT sum(spend) spend,sum(leads_generated) leads FROM public.traffic_metrics WHERE date>=(p_start AT TIME ZONE 'America/Sao_Paulo')::date
 AND date<(p_end AT TIME ZONE 'America/Sao_Paulo')::date+CASE WHEN (p_end AT TIME ZONE 'America/Sao_Paulo')::time>'00:00'::time THEN 1 ELSE 0 END)
 SELECT jsonb_build_object('revenue',sales.revenue,'sales',sales.sales,'ticket',CASE WHEN sales.sales>0 THEN sales.active_revenue/sales.sales END,
 'conversion',CASE WHEN approaches.n>0 THEN sales.sales*100.0/approaches.n END,'approaches',approaches.n,'cpl',CASE WHEN traffic.leads>0 THEN traffic.spend/traffic.leads END,
 'spend',traffic.spend,'leads',traffic.leads,'appointments',appointments.n) FROM sales,appointments,approaches,traffic;
$$;

CREATE OR REPLACE FUNCTION public.arena_dashboard(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz:=now(); v_end timestamptz; v_previous_end timestamptz; v_series jsonb; v_cycles jsonb; v_feed jsonb; v_unit text;
BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start OR p_end-p_start>interval '367 days' OR p_start>v_now THEN RAISE EXCEPTION 'Escolha um período válido de até um ano'; END IF;
 v_end:=least(p_end,v_now);
 v_previous_end:=CASE WHEN p_end-p_start<=interval '25 hours' AND p_end>v_now THEN p_start-(p_end-v_now) ELSE p_start END;
 v_unit:=CASE WHEN p_end-p_start<=interval '25 hours' THEN 'hour' WHEN p_end-p_start<=interval '62 days' THEN 'day' ELSE 'month' END;
 WITH buckets AS (
   SELECT d AS bucket FROM generate_series(date_trunc(v_unit,p_start AT TIME ZONE 'America/Sao_Paulo'),
     date_trunc(v_unit,v_end AT TIME ZONE 'America/Sao_Paulo'),('1 '||v_unit)::interval) d
 ), sales AS (
   SELECT date_trunc(v_unit,v.occurred_at AT TIME ZONE 'America/Sao_Paulo') bucket,
     COALESCE(sum(v.revenue),0) revenue,count(*) FILTER(WHERE v.active) sales FROM public.arena_sale_facts v
   WHERE v.occurred_at>=p_start AND v.occurred_at<v_end GROUP BY 1
 ), appointments AS (
   SELECT date_trunc(v_unit,f.occurred_at AT TIME ZONE 'America/Sao_Paulo') bucket,count(*) appointments
   FROM public.arena_counted_call_events f WHERE f.action_type IN ('q.scheduled','closing.scheduled')
     AND f.occurred_at>=p_start AND f.occurred_at<v_end GROUP BY 1
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('at',b.bucket,'revenue',COALESCE(s.revenue,0),
   'sales',COALESCE(s.sales,0),'appointments',COALESCE(a.appointments,0)) ORDER BY b.bucket),'[]') INTO v_series
 FROM buckets b LEFT JOIN sales s USING(bucket) LEFT JOIN appointments a USING(bucket);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'goal_id',g.id,'title',g.title,'period',g.period,'scope',g.scope,'role',g.target_role,'metric',g.metric,
 'starts_at',c.starts_at,'ends_at',c.ends_at,'show_countdown',g.show_countdown,'result',public.arena_cycle_result(c.id)) ORDER BY g.scope,g.target_role),'[]') INTO v_cycles
 FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id WHERE c.starts_at<=v_now AND c.ends_at>v_now AND c.closed_at IS NULL AND g.enabled;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY occurred_at DESC,id DESC),'[]') INTO v_feed FROM (
 SELECT f.id,f.action_type,f.responsible_id,f.responsible_name,f.responsible_role,f.score_delta,f.revenue_delta,f.occurred_at,p.avatar_url,f.provenance
 FROM public.activity_feed f LEFT JOIN public.profiles p ON p.user_id=f.responsible_id
 WHERE f.occurred_at>=p_start AND f.occurred_at<v_end AND NOT COALESCE(p.arena_hidden,false)
 ORDER BY f.occurred_at DESC,f.id DESC LIMIT 40) x;
 RETURN jsonb_build_object('server_time',v_now,'revision',public.arena_revision(),
 'metrics',public.arena_period_metrics(p_start,v_end),'previous',public.arena_period_metrics(p_start-(p_end-p_start),v_previous_end),
 'series',v_series,'cycles',v_cycles,'feed',v_feed,'sdrs',public.get_sdr_ranking(p_start,v_end),'closers',public.get_team_ranking(p_start,v_end),
 'ticket_reference',(SELECT ticket_reference FROM public.company_goals WHERE scope='global' AND effective_at<=v_now ORDER BY effective_at DESC,version DESC LIMIT 1));
END $$;
UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic='arena';
COMMIT;
