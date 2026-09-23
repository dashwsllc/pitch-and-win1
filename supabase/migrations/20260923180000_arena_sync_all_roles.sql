-- Track each new CRM approach at the time it is posted. Existing cumulative
-- counts remain available without inventing dates for historical attempts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

CREATE OR REPLACE FUNCTION public.arena_approach_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_previous integer; v_step integer;
BEGIN
 v_previous:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.approach_count END;
 IF NEW.sdr_id IS NULL OR NEW.approach_count<=v_previous THEN RETURN NULL; END IF;
 FOR v_step IN 1..NEW.approach_count-v_previous LOOP
   PERFORM public.arena_emit('lead.approached:'||NEW.id||':'||NEW.version||':'||v_step,
     'lead.approached',NEW.sdr_id,'sdr','crm_leads',NEW.id,clock_timestamp(),0,0,NEW.id);
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.arena_approach_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER arena_approach_facts AFTER INSERT OR UPDATE ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.arena_approach_event();

CREATE OR REPLACE FUNCTION public.arena_sdr_ranking(p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.repasses DESC,x.conversao DESC,x.abordagens DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'SDR') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.score,0) score,COALESCE(s.repasses,0) repasses,COALESCE(s.scheduled,0) scheduled,COALESCE(s.performed,0) performed,
 COALESCE(s.cancelled,0) cancelled,COALESCE(s.no_handoff,0) no_handoff,COALESCE(a.total,0) abordagens,
 COALESCE(a.leads_abordados,0) AS "leadsAbordados",
 CASE WHEN a.leads_abordados>0 THEN round(COALESCE(s.repasses,0)*100.0/a.leads_abordados,1) ELSE 0 END conversao
 FROM public.profiles p
 LEFT JOIN LATERAL(SELECT sum(score_delta) score,count(*) FILTER(WHERE action_type='closing.scheduled') repasses,
 count(*) FILTER(WHERE action_type='q.scheduled') scheduled,count(*) FILTER(WHERE action_type='q.performed') performed,
 count(*) FILTER(WHERE action_type='call.cancelled') cancelled,count(*) FILTER(WHERE action_type='q.no_handoff') no_handoff
 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) s ON true
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
REVOKE ALL ON FUNCTION public.arena_sdr_ranking(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp()
WHERE topic IN ('arena','crm');
COMMIT;
