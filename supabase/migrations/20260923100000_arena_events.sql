-- Commercial facts extend the existing feed. Source UUIDs intentionally have
-- no cascading FK: CRM deletion must not erase approved revenue or score.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.arena_has_access(p_admin boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT auth.uid() IS NOT NULL AND public.registration_has_access()
 AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND NOT suspended)
 AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
   AND role::text=ANY(CASE WHEN p_admin THEN ARRAY['executive','super_admin']
     ELSE ARRAY['sdr','closer','executive','super_admin'] END));
$$;
REVOKE ALL ON FUNCTION public.arena_has_access(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arena_has_access(boolean) TO authenticated;

ALTER TABLE public.activity_feed
 ADD COLUMN IF NOT EXISTS event_key text UNIQUE,
 ADD COLUMN IF NOT EXISTS responsible_id uuid,
 ADD COLUMN IF NOT EXISTS responsible_name text,
 ADD COLUMN IF NOT EXISTS responsible_role text,
 ADD COLUMN IF NOT EXISTS actor_id uuid,
 ADD COLUMN IF NOT EXISTS source_type text,
 ADD COLUMN IF NOT EXISTS source_id uuid,
 ADD COLUMN IF NOT EXISTS lead_id uuid,
 ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS score_delta numeric(12,2) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS revenue_delta numeric(18,2) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS reverses_id uuid REFERENCES public.activity_feed(id),
 ADD COLUMN IF NOT EXISTS rule_version integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'live',
 ADD COLUMN IF NOT EXISTS reason text;
CREATE UNIQUE INDEX IF NOT EXISTS arena_event_reversal_unique ON public.activity_feed(reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS arena_events_period ON public.activity_feed(occurred_at DESC,id);
CREATE INDEX IF NOT EXISTS arena_events_person_period ON public.activity_feed(responsible_id,occurred_at) INCLUDE(score_delta,revenue_delta,action_type);
CREATE INDEX IF NOT EXISTS arena_events_source ON public.activity_feed(source_type,source_id);
ALTER TABLE public.activity_feed ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='activity_feed' LOOP
   EXECUTE format('DROP POLICY %I ON public.activity_feed',r.policyname);
 END LOOP;
END $$;
REVOKE ALL ON public.activity_feed FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.activity_feed TO authenticated;
CREATE POLICY arena_read_events ON public.activity_feed FOR SELECT TO authenticated USING(public.arena_has_access());

CREATE OR REPLACE FUNCTION public.arena_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$ BEGIN
 RAISE EXCEPTION 'Histórico imutável. Registre uma correção com motivo.' USING ERRCODE='42501';
END $$;
CREATE TRIGGER arena_events_immutable BEFORE UPDATE OR DELETE ON public.activity_feed FOR EACH ROW EXECUTE FUNCTION public.arena_immutable();

CREATE OR REPLACE FUNCTION public.arena_emit(
 p_key text,p_kind text,p_person uuid,p_role text,p_source text,p_source_id uuid,
 p_at timestamptz,p_score numeric DEFAULT 0,p_revenue numeric DEFAULT 0,
 p_lead uuid DEFAULT NULL,p_reverses uuid DEFAULT NULL,p_reason text DEFAULT NULL,
 p_provenance text DEFAULT 'live',p_actor uuid DEFAULT auth.uid())
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
 -- Serialize commits with cycle closure. A live event that waited for the
 -- deadline worker belongs to the newly open period, never a frozen snapshot.
 PERFORM pg_advisory_xact_lock_shared(23091100);
 IF p_provenance='live' THEN p_at:=clock_timestamp(); END IF;
 INSERT INTO public.activity_feed(event_key,action_type,responsible_id,responsible_name,responsible_role,
 actor_id,actor_name,source_type,source_id,occurred_at,score_delta,revenue_delta,lead_id,reverses_id,reason,provenance,entity_title)
 VALUES(p_key,p_kind,p_person,(SELECT display_name FROM public.profiles WHERE user_id=p_person),p_role,
 p_actor,(SELECT display_name FROM public.profiles WHERE user_id=p_actor),p_source,p_source_id,
 p_at,p_score,p_revenue,p_lead,p_reverses,p_reason,p_provenance,p_kind)
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.arena_emit(text,text,uuid,text,text,uuid,timestamptz,numeric,numeric,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

-- No private customer payload travels through the revision signal.
ALTER TABLE public.dashboard_events DROP CONSTRAINT dashboard_events_topic_check;
ALTER TABLE public.dashboard_events ADD CONSTRAINT dashboard_events_topic_check CHECK(topic IN ('sales','users','audit','goals','products','crm','arena'));
INSERT INTO public.dashboard_events(topic) VALUES('arena') ON CONFLICT DO NOTHING;
CREATE POLICY arena_revision_read ON public.dashboard_events FOR SELECT TO authenticated USING(topic='arena' AND public.arena_has_access());
CREATE TRIGGER arena_event_signal AFTER INSERT ON public.activity_feed FOR EACH ROW EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER arena_profile_signal AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER arena_roles_signal AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER arena_traffic_signal AFTER INSERT OR UPDATE OR DELETE ON public.traffic_metrics FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');

ALTER TABLE public.crm_activities
 ADD COLUMN IF NOT EXISTS performed_at timestamptz,
 ADD COLUMN IF NOT EXISTS performed_by uuid,
 ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
 ADD COLUMN IF NOT EXISTS cancelled_by uuid,
 ADD COLUMN IF NOT EXISTS cancellation_reason text;

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
 IF (TG_OP='DELETE' AND NOT c.is_completed) OR (TG_OP='UPDATE' AND NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL) THEN
   SELECT * INTO e FROM public.activity_feed WHERE event_key='q.scheduled:'||c.id;
   PERFORM public.arena_emit('call.cancelled:'||c.id,'call.cancelled',COALESCE(e.responsible_id,c.assigned_to),
     CASE WHEN c.call_type='qualificacao' THEN 'sdr' ELSE 'closer' END,'crm_activities',c.id,clock_timestamp(),
     CASE WHEN e.id IS NOT NULL THEN -e.score_delta ELSE 0 END,0,c.lead_id,e.id,c.cancellation_reason);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER arena_call_facts AFTER INSERT OR UPDATE OR DELETE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.arena_call_event();

-- Close every legacy insertion path, including reopening a closed lead.
CREATE OR REPLACE FUNCTION public.arena_call_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.call_type='fechamento_closer' AND (
   NEW.assigned_to=auth.uid() OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('sdr','executive','super_admin')))
 THEN RAISE EXCEPTION 'A call de fechamento deve ser agendada pelo SDR para outro colaborador.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER arena_closing_scheduler BEFORE INSERT ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.arena_call_guard();

-- Existing resolution RPCs supply evidence of attendance. Automatic closure on
-- handoff/loss intentionally does not set performed_at.
DO $patch$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.resolve_sdr_qualification_call(uuid,text,timestamptz,jsonb)'::regprocedure);
 IF position('is_completed=true,' IN d)=0 THEN RAISE EXCEPTION 'Qualification RPC changed; inspect before migration'; END IF;
 d:=replace(d,'is_completed=true,','performed_at=clock_timestamp(), performed_by=auth.uid(), is_completed=true,');
 -- Use the same lead -> call locking order as scheduling, cancellation and close.
 d:=replace(d,'SELECT * INTO c FROM public.crm_activities',
   'PERFORM 1 FROM public.crm_leads WHERE id=(SELECT lead_id FROM public.crm_activities WHERE id=p_activity_id) FOR UPDATE; SELECT * INTO c FROM public.crm_activities');
 EXECUTE d;
 d:=pg_get_functiondef('public.crm_transition(uuid,text,bigint,jsonb)'::regprocedure);
 IF position('SET is_completed=true,completed_at=clock_timestamp(),outcome=v_outcome' IN d)=0 THEN RAISE EXCEPTION 'Closing transition changed; inspect before migration'; END IF;
 d:=replace(d,'SET is_completed=true,completed_at=clock_timestamp(),outcome=v_outcome',
   $$SET performed_at=CASE WHEN p_action='close' AND p_data->>'call_performed'='true' AND call_type='fechamento_closer' THEN COALESCE(performed_at,clock_timestamp()) ELSE performed_at END,
   performed_by=CASE WHEN p_action='close' AND p_data->>'call_performed'='true' AND call_type='fechamento_closer' THEN COALESCE(performed_by,auth.uid()) ELSE performed_by END,
   is_completed=true,completed_at=clock_timestamp(),outcome=v_outcome$$);
 EXECUTE d;
 d:=pg_get_functiondef('public.resolve_closer_call(uuid,text,timestamptz)'::regprocedure);
 d:=replace(d,'SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id;',
   'UPDATE public.crm_activities SET performed_at=clock_timestamp(),performed_by=auth.uid() WHERE id=p_activity_id; SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id;');
 EXECUTE d;
 d:=pg_get_functiondef('public.schedule_closer_call(uuid,text,timestamptz,uuid,text)'::regprocedure);
 d:=replace(d, $$CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END$$,
   $$'sdr'$$); -- The caller schedules as SDR; the assignee check is restored below.
 d:=replace(d, $$p_assigned_to,
    'sdr'$$, $$p_assigned_to,
    CASE WHEN p_call_type='qualificacao' THEN 'sdr' ELSE 'closer' END$$);
 d:=regexp_replace(d, '  IF p_call_type=''fechamento_closer'' THEN.*?  END IF;\s+\s*INSERT INTO public.crm_activities',
   E'  IF p_call_type=''fechamento_closer'' THEN\n    UPDATE public.crm_leads SET closer_id=p_assigned_to WHERE id=l.id;\n  END IF;\n\n  INSERT INTO public.crm_activities','s');
 EXECUTE d;
END $patch$;

CREATE OR REPLACE FUNCTION public.arena_cancel_call(p_id uuid,p_revision timestamptz,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.crm_activities; v_lead uuid;
BEGIN
 IF NOT public.arena_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres'; END IF;
 SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_id;
 PERFORM 1 FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
 SELECT * INTO c FROM public.crm_activities WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada'; END IF;
 IF c.cancelled_at IS NOT NULL THEN RETURN; END IF;
 IF c.is_completed OR c.updated_at IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Call alterada. Atualize antes de cancelar.' USING ERRCODE='PT409'; END IF;
 IF NOT public.arena_has_access(true) AND auth.uid() NOT IN (c.user_id,c.assigned_to) THEN RAISE EXCEPTION 'Sem permissão para cancelar esta call' USING ERRCODE='42501'; END IF;
 UPDATE public.crm_activities SET cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_reason=btrim(p_reason),
   is_completed=true,completed_at=clock_timestamp(),outcome='followup' WHERE id=p_id;
 UPDATE public.crm_leads SET next_followup_at=NULL WHERE id=v_lead AND next_followup_at=c.scheduled_at;
END $$;
REVOKE ALL ON FUNCTION public.arena_cancel_call(uuid,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_cancel_call(uuid,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.arena_sale_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.activity_feed; c public.vendas; v_closer boolean;
BEGIN
 IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
 IF TG_OP<>'DELETE' AND c.approval_status='aprovada' AND (TG_OP='INSERT' OR OLD.approval_status<>'aprovada') THEN
   v_closer:=EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id AND role::text='closer');
   PERFORM public.arena_emit('sale.approved:'||c.id,'sale.approved',c.user_id,CASE WHEN v_closer THEN 'closer' ELSE 'seller' END,'vendas',c.id,
     COALESCE(c.reviewed_at,clock_timestamp()),CASE WHEN v_closer THEN 10 ELSE 0 END,c.valor_venda,c.crm_lead_id,NULL,NULL,'live',c.reviewed_by);
 END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.approval_status='aprovada' AND NEW.approval_status<>'aprovada') THEN
   SELECT * INTO e FROM public.activity_feed WHERE event_key='sale.approved:'||c.id;
   IF e.id IS NOT NULL THEN
     PERFORM public.arena_emit('sale.reversed:'||c.id,'sale.reversed',e.responsible_id,e.responsible_role,'vendas',c.id,
       clock_timestamp(),-e.score_delta,0,e.lead_id,e.id,COALESCE(current_setting('arena.sale_reason',true),'Exclusão pelo fluxo administrativo'));
   END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER arena_sale_facts AFTER INSERT OR UPDATE OR DELETE ON public.vendas FOR EACH ROW EXECUTE FUNCTION public.arena_sale_event();

ALTER TABLE public.vendas DROP CONSTRAINT vendas_approval_status_check;
ALTER TABLE public.vendas ADD CONSTRAINT vendas_approval_status_check CHECK(approval_status IN ('pendente','aprovada','rejeitada','cancelada','estornada'));
CREATE OR REPLACE FUNCTION public.arena_reverse_sale(p_id uuid,p_status text,p_reason text,p_revision timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.vendas; v_total numeric; v_committed numeric;
BEGIN
 IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('cancelada','estornada') OR p_status IS NULL OR length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Status ou motivo inválido'; END IF;
 SELECT * INTO s FROM public.vendas WHERE id=p_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.user_id::text,42));
 SELECT * INTO s FROM public.vendas WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
 IF s.approval_status=p_status THEN RETURN; END IF;
 IF s.approval_status<>'aprovada' OR s.updated_at IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Venda alterada. Atualize e confira o status.' USING ERRCODE='PT409'; END IF;
 IF s.withdrawn OR s.withdrawal_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.saques WHERE p_id=ANY(vendas_incluidas) AND status NOT IN ('rejeitado','cancelado')) THEN
   RAISE EXCEPTION 'Regularize o saque vinculado antes de cancelar ou estornar.'; END IF;
 SELECT COALESCE(sum(commission_amount),0) INTO v_total FROM public.vendas WHERE user_id=s.user_id AND approval_status='aprovada' AND id<>p_id;
 SELECT COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)),0) INTO v_committed FROM public.saques WHERE user_id=s.user_id AND status IN ('pendente','processando','aprovado','pago');
 IF v_total<v_committed THEN RAISE EXCEPTION 'A comissão está comprometida com saques. Regularize os saques primeiro.'; END IF;
 PERFORM set_config('dashboard.sale_decision',p_id::text,true);
 PERFORM set_config('arena.sale_reason',btrim(p_reason),true);
 UPDATE public.vendas SET approval_status=p_status,rejection_reason=btrim(p_reason) WHERE id=p_id;
 INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
 VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'sale.'||p_status,p_id,s.nome_produto,btrim(p_reason),
   jsonb_build_object('approval_status',s.approval_status),jsonb_build_object('approval_status',p_status));
END $$;
REVOKE ALL ON FUNCTION public.arena_reverse_sale(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_reverse_sale(uuid,text,text,timestamptz) TO authenticated;

-- Import only persisted evidence, never infer attendance from auto-completion.
SELECT public.arena_emit('sale.approved:'||v.id,'sale.approved',v.user_id,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer') THEN 'closer' ELSE 'seller' END,'vendas',v.id,v.reviewed_at,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=v.user_id AND r.role::text='closer') THEN 10 ELSE 0 END,
 v.valor_venda,v.crm_lead_id,NULL,NULL,'legacy',v.reviewed_by)
FROM public.vendas v WHERE v.approval_status='aprovada' AND v.reviewed_at IS NOT NULL;
SELECT public.arena_emit('q.scheduled:'||id,'q.scheduled',assigned_to,'sdr','crm_activities',id,created_at,0.2,0,lead_id,NULL,NULL,'legacy',user_id)
FROM public.crm_activities WHERE call_type='qualificacao';
SELECT public.arena_emit('closing.scheduled:'||c.id,'closing.scheduled',c.user_id,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=c.user_id AND r.role::text='sdr') AND c.user_id<>c.assigned_to THEN 'sdr' ELSE 'closer' END,'crm_activities',c.id,c.created_at,
 CASE WHEN EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=c.user_id AND r.role::text='sdr') AND c.user_id<>c.assigned_to THEN 0.4 ELSE 0 END,
 0,c.lead_id,NULL,NULL,'legacy',c.user_id)
FROM public.crm_activities c WHERE c.call_type='fechamento_closer';

-- Clientes is explicitly Super Admin only, including direct API access.
CREATE POLICY arena_clients_admin_only ON public.assinaturas AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.arena_has_access(true) AND public.is_super_admin(auth.uid()))
 WITH CHECK(public.arena_has_access(true) AND public.is_super_admin(auth.uid()));

NOTIFY pgrst,'reload schema';
COMMIT;
