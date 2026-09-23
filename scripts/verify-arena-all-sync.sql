-- Run inside a transaction that always rolls back.
SELECT set_config('request.jwt.claim.sub',(
  SELECT r.user_id::text FROM public.user_roles r JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.role::text='super_admin' AND NOT p.suspended LIMIT 1
),true);

DO $$
DECLARE
 l public.crm_leads;
 v_day timestamptz;
 v_before numeric;
 v_after numeric;
 v_arena_revision bigint;
 v_crm_revision bigint;
 v_expected text[]:=ARRAY['vendas','crm_leads','crm_activities','crm_lead_contexts',
   'abordagens','profiles','user_roles','company_goals','goal_cycles','daily_goal_tasks',
   'traffic_metrics','activity_feed'];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No active Super Admin for verification'; END IF;
 IF EXISTS(SELECT 1 FROM public.vendas v LEFT JOIN public.arena_sale_facts f ON f.sale_id=v.id AND f.active
   WHERE v.approval_status='aprovada' AND (f.sale_id IS NULL OR f.user_id IS DISTINCT FROM v.user_id
     OR f.occurred_at IS DISTINCT FROM v.updated_at OR f.revenue IS DISTINCT FROM v.valor_venda)) THEN
   RAISE EXCEPTION 'An approved sale is stale or missing in Arena';
 END IF;
 IF EXISTS(SELECT 1 FROM public.vendas v WHERE v.approval_status='aprovada' AND NOT EXISTS(
   SELECT 1 FROM public.activity_feed f WHERE f.event_key='sale.approved:'||v.id)) THEN
   RAISE EXCEPTION 'An approved sale is missing its audit event';
 END IF;
 IF EXISTS(SELECT 1 FROM public.crm_activities c WHERE c.call_type IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.event_key=
     CASE WHEN c.call_type='qualificacao' THEN 'q.scheduled:' ELSE 'closing.scheduled:' END||c.id)
   OR (c.performed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.event_key='call.performed:'||c.id))
   OR (c.cancelled_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.event_key='call.cancelled:'||c.id)))) THEN
   RAISE EXCEPTION 'A CRM call is missing an Arena event';
 END IF;
 IF EXISTS(SELECT unnest(v_expected) EXCEPT SELECT c.relname FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_trigger t ON t.tgrelid=c.oid
   WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled<>'D' AND t.tgname LIKE '%signal%') THEN
   RAISE EXCEPTION 'A source table is missing its refresh signal';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
   AND schemaname='public' AND tablename='dashboard_events') THEN
   RAISE EXCEPTION 'The revision table is missing from Realtime';
 END IF;

 SELECT c.* INTO l FROM public.crm_leads c JOIN public.profiles p ON p.user_id=c.sdr_id
 WHERE c.sdr_id IS NOT NULL AND NOT p.arena_hidden AND NOT p.suspended
   AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=c.sdr_id AND r.role::text='sdr')
   AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=c.sdr_id AND r.role::text='super_admin')
 ORDER BY c.created_at DESC LIMIT 1;
 IF l.id IS NULL THEN RAISE EXCEPTION 'No SDR lead for rollback verification'; END IF;
 v_day:=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
 SELECT (x->>'abordagens')::numeric INTO v_before
 FROM jsonb_array_elements(public.arena_sdr_ranking(v_day,v_day+interval '1 day')) x
 WHERE x->>'user_id'=l.sdr_id::text;
 SELECT revision INTO v_arena_revision FROM public.dashboard_events WHERE topic='arena';
 SELECT revision INTO v_crm_revision FROM public.dashboard_events WHERE topic='crm';

 UPDATE public.crm_leads SET approach_count=approach_count+1,
   approach_stage='reabordado',approached=true,approached_at=clock_timestamp()
 WHERE id=l.id;
 SELECT (x->>'abordagens')::numeric INTO v_after
 FROM jsonb_array_elements(public.arena_sdr_ranking(v_day,v_day+interval '1 day')) x
 WHERE x->>'user_id'=l.sdr_id::text;
 IF v_after IS DISTINCT FROM COALESCE(v_before,0)+1 THEN
   RAISE EXCEPTION 'New SDR approach did not reach the current Arena period';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.source_id=l.id
   AND f.action_type='lead.approached' AND f.responsible_id=l.sdr_id
   AND f.occurred_at>=v_day AND f.occurred_at<v_day+interval '1 day') THEN
   RAISE EXCEPTION 'New SDR approach has no Arena event';
 END IF;
 IF (SELECT revision FROM public.dashboard_events WHERE topic='arena')<=v_arena_revision
   OR (SELECT revision FROM public.dashboard_events WHERE topic='crm')<=v_crm_revision THEN
   RAISE EXCEPTION 'SDR update did not signal other open screens';
 END IF;
END $$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
