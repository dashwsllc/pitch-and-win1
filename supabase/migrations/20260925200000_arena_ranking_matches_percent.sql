-- The ranking list ("SDRs · hoje" / "Closers · semana") and the % progress
-- bar shown on each row (PersonGoalProgress) came from two independent
-- calculations: the list sorted by a raw count (repasses / totalVendas in
-- R$), while the bar used the weighted score divided by that person's target
-- (arena_cycle_result, which already accounts for individual overrides and
-- the SDR daily-goal dilution). A colleague with fewer raw repasses/sales but
-- a higher percent of their own target was showing up BELOW someone with
-- more raw activity but a lower percent — list order and the % badge
-- disagreeing on the same row.
--
-- Both ranking functions now look up the currently open matching role cycle
-- (daily for SDR, weekly for Closer), reuse arena_cycle_result's per-member
-- actual/target for that cycle (single source of truth, respects dilution
-- and individual overrides), and sort by that percent first. The previous
-- raw-count order becomes the tiebreaker for equal/undefined percent (no
-- open cycle, or target=0).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.arena_sdr_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb; v_cycle_id uuid; v_progress jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT c.id INTO v_cycle_id FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
   WHERE g.scope='role' AND g.target_role='sdr' AND g.period='daily'
   AND c.starts_at<=now() AND c.ends_at>now() AND c.closed_at IS NULL AND g.enabled
   ORDER BY c.starts_at DESC LIMIT 1;
 v_progress:=CASE WHEN v_cycle_id IS NOT NULL THEN COALESCE(public.arena_cycle_result(v_cycle_id)->'members','[]'::jsonb) ELSE '[]'::jsonb END;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.percent DESC NULLS LAST,x.repasses DESC,x.conversao DESC,x.abordagens DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'SDR') name,p.avatar_url AS "avatarUrl",p.suspended, public.arena_sdr_exception(p.user_id) AS "qualificationCallsDisabled",
 COALESCE(s.score,0)+COALESCE(adj.score,0) score,COALESCE(s.repasses,0) repasses,COALESCE(s.scheduled,0) scheduled,COALESCE(s.performed,0) performed,
 COALESCE(cancelled.cancelled,0) cancelled,COALESCE(s.no_handoff,0) no_handoff,COALESCE(a.total,0) abordagens,
 COALESCE(a.leads_abordados,0) AS "leadsAbordados",
 CASE WHEN a.leads_abordados>0 THEN round(COALESCE(s.repasses,0)*100.0/a.leads_abordados,1) ELSE 0 END conversao,
 CASE WHEN m.value IS NOT NULL AND (m.value->>'target')::numeric>0 THEN (m.value->>'actual')::numeric/(m.value->>'target')::numeric ELSE NULL END percent
 FROM public.profiles p
 LEFT JOIN LATERAL(SELECT sum(score_delta) score,count(*) FILTER(WHERE action_type='closing.scheduled') repasses,
 count(*) FILTER(WHERE action_type='q.scheduled') scheduled,count(*) FILTER(WHERE action_type='q.performed') performed,
 count(*) FILTER(WHERE action_type='q.no_handoff') no_handoff
 FROM public.arena_counted_call_events WHERE responsible_id=p.user_id AND responsible_role='sdr' AND (action_type NOT LIKE 'q.%' OR NOT public.arena_sdr_exception(p.user_id)) AND occurred_at>=p_start AND occurred_at<p_end) s ON true
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
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(v_progress) value WHERE (value->>'user_id')=p.user_id::text LIMIT 1) m ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='sdr')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end))
 AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin') OR public.arena_sdr_exception(p.user_id))
 ) x;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamptz,p_end timestamptz,p_weekly_credit boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb; v_cycle_id uuid; v_progress jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT c.id INTO v_cycle_id FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
   WHERE g.scope='role' AND g.target_role='closer' AND g.period='weekly'
   AND c.starts_at<=now() AND c.ends_at>now() AND c.closed_at IS NULL AND g.enabled
   ORDER BY c.starts_at DESC LIMIT 1;
 v_progress:=CASE WHEN v_cycle_id IS NOT NULL THEN COALESCE(public.arena_cycle_result(v_cycle_id)->'members','[]'::jsonb) ELSE '[]'::jsonb END;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.percent DESC NULLS LAST,x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'Closer') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.revenue,0) AS "totalVendas",COALESCE(s.sales,0) AS "quantidadeVendas",
 COALESCE(e.score,0)+COALESCE(s.sales,0)*public.arena_score_weight('sale.approved') AS score,
 COALESCE(a.total,0) abordagens,CASE WHEN a.total>0 THEN round(COALESCE(s.sales,0)*100.0/a.total,1) ELSE 0 END conversao,
 CASE WHEN m.value IS NOT NULL AND (m.value->>'target')::numeric>0 THEN (m.value->>'actual')::numeric/(m.value->>'target')::numeric ELSE NULL END percent
 FROM public.profiles p
 LEFT JOIN LATERAL (SELECT COALESCE(sum(v.revenue),0) revenue,count(*) sales FROM public.arena_closer_weekly_sale_facts v
   WHERE v.user_id=p.user_id
   AND (CASE WHEN p_weekly_credit THEN v.weekly_credit_at ELSE v.occurred_at END)>=p_start
   AND (CASE WHEN p_weekly_credit THEN v.weekly_credit_at ELSE v.occurred_at END)<p_end) s ON true
 LEFT JOIN LATERAL (SELECT COALESCE(sum(f.score_delta),0) score FROM public.activity_feed f
   WHERE f.responsible_id=p.user_id AND f.responsible_role='closer'
   AND f.action_type NOT IN ('sale.approved','sale.reversed')
   AND f.occurred_at>=p_start AND f.occurred_at<p_end) e ON true
 LEFT JOIN LATERAL(SELECT count(*) total FROM public.abordagens WHERE user_id=p.user_id AND created_at>=p_start AND created_at<p_end) a ON true
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(v_progress) value WHERE (value->>'user_id')=p.user_id::text LIMIT 1) m ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='closer')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end)
 OR s.sales>0)
 AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin') OR public.arena_closer_exception(p.user_id))
 ) x;
 RETURN v;
END $$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic='arena';
NOTIFY pgrst, 'reload schema';
COMMIT;
