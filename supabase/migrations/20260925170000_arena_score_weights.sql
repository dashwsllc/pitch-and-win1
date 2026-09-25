-- Every Arena scoring constant was a literal number scattered across four
-- functions (0.2 for a scheduled qualification call, 0.4 for a call sent to
-- the Closer, 0.5 for a qualification handed off, 10 for an approved Closer
-- sale — the last one duplicated in three separate places: the event itself,
-- the open-cycle live score and the monthly ranking). This makes all of them
-- one editable table, read through a single helper so every consumer agrees.
-- Changing a weight only affects events emitted AFTER the change: activity_feed
-- rows are immutable, so past scoring never moves, same as every other Arena
-- history guarantee.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE public.arena_score_weights(
  action_type text PRIMARY KEY,
  label text NOT NULL,
  weight numeric NOT NULL CHECK(weight>=0 AND weight<=100000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid
);
ALTER TABLE public.arena_score_weights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_score_weights FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.arena_score_weights TO authenticated;
CREATE POLICY arena_score_weights_read ON public.arena_score_weights FOR SELECT TO authenticated USING(public.arena_has_access());

-- Seeded with the exact values already hardcoded today, so applying this
-- migration changes nothing until an executive edits a number.
INSERT INTO public.arena_score_weights(action_type,label,weight) VALUES
  ('q.scheduled','Call de qualificação agendada (SDR)',0.2),
  ('closing.scheduled','Call enviada ao Closer (repasse do SDR)',0.4),
  ('q.handoff','Qualificação encaminhada ao Closer',0.5),
  ('sale.approved','Venda aprovada (Closer)',10);

CREATE OR REPLACE FUNCTION public.arena_score_weight(p_action_type text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE((SELECT weight FROM public.arena_score_weights WHERE action_type=p_action_type),0);
$$;
REVOKE ALL ON FUNCTION public.arena_score_weight(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.arena_score_weights()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.action_type) FROM public.arena_score_weights w),'[]');
END $$;
REVOKE ALL ON FUNCTION public.arena_score_weights() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_score_weights() TO authenticated;

CREATE OR REPLACE FUNCTION public.arena_save_score_weights(p_weights jsonb, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_before jsonb; entry record; v_weight numeric;
BEGIN
  IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da alteração'; END IF;
  IF p_weights IS NULL OR jsonb_typeof(p_weights) <> 'object' THEN RAISE EXCEPTION 'Pesos inválidos' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_object_agg(action_type,weight),'{}') INTO v_before FROM public.arena_score_weights;
  FOR entry IN SELECT key, value FROM jsonb_each(p_weights) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.arena_score_weights WHERE action_type=entry.key) THEN
      RAISE EXCEPTION 'Métrica desconhecida: %', entry.key USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(entry.value) <> 'number' THEN
      RAISE EXCEPTION 'Valor inválido para %', entry.key USING ERRCODE='22023';
    END IF;
    v_weight := (entry.value)::text::numeric;
    IF v_weight < 0 OR v_weight > 100000 THEN
      RAISE EXCEPTION 'Valor fora do intervalo permitido para %', entry.key USING ERRCODE='22023';
    END IF;
    UPDATE public.arena_score_weights SET weight=v_weight,updated_at=clock_timestamp(),updated_by=auth.uid()
      WHERE action_type=entry.key;
  END LOOP;
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
  VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'arena.score_weights',NULL,
    'Pontuação por evento da Arena',btrim(p_reason),v_before,p_weights);
  UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('arena','goals');
END $$;
REVOKE ALL ON FUNCTION public.arena_save_score_weights(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.arena_save_score_weights(jsonb,text) TO authenticated;

-- 1) The events themselves (new calls / qualification handoffs).
CREATE OR REPLACE FUNCTION public.arena_call_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.crm_activities; e public.activity_feed; q public.crm_activities; v_person uuid;
BEGIN
 IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
 IF c.call_type IS NULL THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
   IF c.call_type='qualificacao' THEN
     PERFORM public.arena_emit('q.scheduled:'||c.id,'q.scheduled',c.assigned_to,'sdr','crm_activities',c.id,c.created_at,public.arena_score_weight('q.scheduled'),0,c.lead_id);
   ELSE
     PERFORM public.arena_emit('closing.scheduled:'||c.id,'closing.scheduled',c.user_id,'sdr','crm_activities',c.id,c.created_at,
       CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='sdr') THEN public.arena_score_weight('closing.scheduled') ELSE 0 END,0,c.lead_id);
     -- Only an explicitly performed qualification can earn the handoff milestone.
     SELECT * INTO q FROM public.crm_activities WHERE lead_id=c.lead_id AND call_type='qualificacao'
       AND performed_at IS NOT NULL AND cancelled_at IS NULL AND outcome='avancou'
       ORDER BY performed_at DESC,id LIMIT 1;
     IF FOUND THEN
       PERFORM public.arena_emit('q.handoff:'||q.id,'q.handoff',q.assigned_to,'sdr','crm_activities',q.id,
         c.created_at,public.arena_score_weight('q.handoff'),0,c.lead_id);
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

-- 2) The sale-approval event.
CREATE OR REPLACE FUNCTION public.arena_sale_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.activity_feed; c public.vendas; v_closer boolean;
BEGIN
 IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
 IF TG_OP<>'DELETE' AND c.approval_status='aprovada' AND (TG_OP='INSERT' OR OLD.approval_status<>'aprovada') THEN
   v_closer:=EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='closer');
   PERFORM public.arena_emit('sale.approved:'||c.id,'sale.approved',c.user_id,CASE WHEN v_closer THEN 'closer' ELSE 'seller' END,'vendas',c.id,
     COALESCE(c.reviewed_at,clock_timestamp()),CASE WHEN v_closer THEN public.arena_score_weight('sale.approved') ELSE 0 END,c.valor_venda,c.crm_lead_id,NULL,NULL,'live',c.reviewed_by);
 ELSIF TG_OP='UPDATE' AND OLD.approval_status='aprovada' AND NEW.approval_status='aprovada'
   AND ROW(OLD.user_id,OLD.valor_venda,OLD.nome_produto) IS DISTINCT FROM ROW(NEW.user_id,NEW.valor_venda,NEW.nome_produto) THEN
   v_closer:=EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='closer');
   PERFORM public.arena_emit('sale.updated:'||c.id||':'||gen_random_uuid(),'sale.updated',c.user_id,
     CASE WHEN v_closer THEN 'closer' ELSE 'seller' END,'vendas',c.id,
     COALESCE(c.updated_at,clock_timestamp()),0,0,c.crm_lead_id,NULL,NULL,'live',auth.uid());
 END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.approval_status='aprovada' AND NEW.approval_status<>'aprovada') THEN
   SELECT * INTO e FROM public.activity_feed WHERE event_key='sale.approved:'||c.id;
   IF e.id IS NOT NULL THEN
     PERFORM public.arena_emit('sale.reversed:'||c.id,'sale.reversed',e.responsible_id,e.responsible_role,'vendas',c.id,
       clock_timestamp(),-e.score_delta,c.valor_venda-e.revenue_delta,e.lead_id,e.id,COALESCE(current_setting('arena.sale_reason',true),'Exclusão pelo fluxo administrativo'));
   END IF;
 END IF;
 RETURN NULL;
END $$;

-- 3) The open (not-yet-closed) cycle's live score for a Closer.
CREATE OR REPLACE FUNCTION public.arena_cycle_result(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
       OR EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.responsible_id=p.user_id AND f.responsible_role=g.target_role AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at)
       OR (g.target_role='closer' AND EXISTS(SELECT 1 FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=p.user_id AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
           AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at)))
     AND (NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text='super_admin') OR (g.target_role='closer' AND public.arena_closer_exception(p.user_id)) OR (g.target_role='sdr' AND public.arena_sdr_exception(p.user_id)))
   ), member_count AS (
     SELECT GREATEST(count(*),1)::numeric AS n FROM members
   ), measured AS (
     SELECT m.*,
       COALESCE((SELECT sum(f.score_delta) FROM public.arena_counted_call_events f WHERE f.responsible_id=m.user_id AND f.responsible_role=g.target_role AND (g.target_role<>'sdr' OR f.action_type NOT LIKE 'q.%' OR NOT public.arena_sdr_exception(m.user_id))
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + COALESCE((SELECT sum(f.score_delta) FROM public.activity_feed f WHERE f.action_type='score.adjusted'
         AND f.responsible_id=m.user_id AND f.responsible_role=g.target_role
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + CASE WHEN g.target_role='closer' THEN public.arena_score_weight('sale.approved')*(SELECT count(*) FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=m.user_id
         AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
         AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at) ELSE 0 END actual,
       COALESCE((SELECT CASE WHEN candidate.enabled THEN candidate.target END FROM (
       SELECT * FROM public.company_goals WHERE scope='user' AND assignee_id=m.user_id AND target_role=g.target_role AND period=g.period
       AND effective_at<=least(now(),c.ends_at) AND (cycle_start IS NULL OR cycle_start<=least(now(),c.ends_at))
       AND (cycle_end IS NULL OR recurring OR cycle_end>=c.ends_at) ORDER BY effective_at DESC,version DESC LIMIT 1) candidate),
       CASE WHEN g.target_role='sdr' THEN c.target/mc.n ELSE c.target END) target
     FROM members m CROSS JOIN member_count mc
   ) SELECT COALESCE(jsonb_agg(to_jsonb(measured)||jsonb_build_object('state',public.arena_classification(actual,target,c.starts_at,c.ends_at,now())) ORDER BY display_name,user_id),'[]'),
     COALESCE(sum(actual),0),COALESCE(sum(target),0) INTO v_members,v_actual,v_target FROM measured;
 END IF;
 v_result:=jsonb_build_object('actual',v_actual,'target',v_target,'members',COALESCE(v_members,'[]'),
 'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE public.arena_classification(v_actual,v_target,c.starts_at,c.ends_at,now()) END);
 IF g.scope='global' AND g.period='monthly' AND c.ends_at<=now() THEN
   v_result:=v_result||jsonb_build_object('closers',public.arena_team_ranking(c.starts_at,c.ends_at),'sdrs',public.arena_sdr_ranking(c.starts_at,c.ends_at));
 END IF;
 RETURN v_result;
END $function$;

-- 4) The monthly/weekly Closer ranking score.
CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamptz,p_end timestamptz,p_weekly_credit boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'Closer') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.revenue,0) AS "totalVendas",COALESCE(s.sales,0) AS "quantidadeVendas",
 COALESCE(e.score,0)+COALESCE(s.sales,0)*public.arena_score_weight('sale.approved') AS score,
 COALESCE(a.total,0) abordagens,CASE WHEN a.total>0 THEN round(COALESCE(s.sales,0)*100.0/a.total,1) ELSE 0 END conversao
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
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='closer')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end)
 OR s.sales>0)
 AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin') OR public.arena_closer_exception(p.user_id))
 ) x;
 RETURN v;
END $$;

UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
