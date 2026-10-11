BEGIN;
-- Statement transition tables suppress empty/no-op writes and emit counters only.
CREATE OR REPLACE FUNCTION public.meta_changed_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE changed boolean; signal_topic text;
BEGIN
 IF TG_OP='INSERT' THEN SELECT EXISTS(SELECT 1 FROM meta_signal_new) INTO changed;
 ELSIF TG_OP='DELETE' THEN SELECT EXISTS(SELECT 1 FROM meta_signal_old) INTO changed;
 ELSE SELECT EXISTS(SELECT to_jsonb(n)-'updated_at' FROM meta_signal_new n EXCEPT SELECT to_jsonb(o)-'updated_at' FROM meta_signal_old o)
   OR EXISTS(SELECT to_jsonb(o)-'updated_at' FROM meta_signal_old o EXCEPT SELECT to_jsonb(n)-'updated_at' FROM meta_signal_new n) INTO changed;
 END IF;
 IF changed THEN FOREACH signal_topic IN ARRAY TG_ARGV LOOP
   UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE dashboard_events.topic=signal_topic;
 END LOOP; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.meta_changed_signal() FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE tab text; old_name text; prefix text; topics text;
BEGIN
 FOR tab,old_name,prefix,topics IN SELECT * FROM (VALUES
   ('meta_traffic_daily','meta_traffic_signal','meta_traffic_signal','''arena'''),
   ('meta_import_batches','meta_import_batch_signal','meta_import_batch_signal','''arena'''),
   ('meta_lead_import_batches','meta_lead_import_batches_signal','meta_lead_import_batches_signal','''arena'',''crm'''),
   ('meta_capture_reviews','meta_capture_reviews_signal','meta_capture_reviews_signal','''arena'''),
   ('meta_form_leads','meta_form_leads_signal','meta_form_leads_signal','''arena'',''crm''')) entries LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',old_name,tab);
   EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',prefix||'_insert',tab);
   EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',prefix||'_update',tab);
   EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',prefix||'_delete',tab);
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON public.%I REFERENCING NEW TABLE AS meta_signal_new FOR EACH STATEMENT EXECUTE FUNCTION public.meta_changed_signal(%s)',prefix||'_insert',tab,topics);
   EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS meta_signal_old NEW TABLE AS meta_signal_new FOR EACH STATEMENT EXECUTE FUNCTION public.meta_changed_signal(%s)',prefix||'_update',tab,topics);
   EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON public.%I REFERENCING OLD TABLE AS meta_signal_old FOR EACH STATEMENT EXECUTE FUNCTION public.meta_changed_signal(%s)',prefix||'_delete',tab,topics);
 END LOOP;
END $$;
DROP POLICY IF EXISTS traffic_revision_read ON public.dashboard_events;
CREATE POLICY traffic_revision_read ON public.dashboard_events FOR SELECT TO authenticated USING(topic IN ('arena','crm') AND public.traffic_has_access());

CREATE OR REPLACE FUNCTION public.meta_audit_metric_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Capture approvals already record the removal with their review/reason.
 IF NOT EXISTS(SELECT 1 FROM public.meta_capture_review_rows candidate JOIN public.meta_capture_reviews review ON review.id=candidate.review_id
   WHERE review.id::text=nullif(current_setting('meta.capture_review',true),'') AND review.status='pendente'
     AND candidate.operation='remove' AND candidate.before_snapshot->>'id'=OLD.id::text) THEN
   PERFORM public.meta_record_edit('metrics_row',OLD.id,'metric.removed',OLD.source,jsonb_build_object('reason','Remoção de métrica publicada','before',to_jsonb(OLD)));
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.meta_audit_metric_delete() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS meta_audit_metric_delete ON public.meta_traffic_daily;
CREATE TRIGGER meta_audit_metric_delete AFTER DELETE ON public.meta_traffic_daily FOR EACH ROW EXECUTE FUNCTION public.meta_audit_metric_delete();

CREATE INDEX IF NOT EXISTS meta_runs_operation ON public.meta_sync_runs(account_id,level,kind,started_at DESC);
CREATE OR REPLACE FUNCTION public.meta_traffic_operation() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 WITH latest AS (SELECT DISTINCT ON(account_id,level,kind) id FROM public.meta_sync_runs ORDER BY account_id,level,kind,started_at DESC,id DESC),
 complete AS (SELECT DISTINCT ON(account_id,level,kind) id FROM public.meta_sync_runs WHERE status='success' AND coverage_state='complete' ORDER BY account_id,level,kind,started_at DESC,id DESC),
 runs AS (SELECT r.id,r.kind,r.account_id,r.level,r.status,r.coverage_state,r.started_at,r.finished_at,r.window_start,r.window_end,r.rows_synced,r.page_count,
   CASE WHEN r.error_message IS NULL THEN NULL WHEN r.error_message ~* 'pages_manage_ads|permission|permiss|oauth|authoriz|autoriz|token' THEN 'Regularize a autorização da Meta e o acesso aos leads da página. A importação manual continua disponível.'
     ELSE 'A sincronização não concluiu. Confira a configuração e tente novamente; a importação manual continua disponível.' END AS error_message
   FROM public.meta_sync_runs r WHERE r.id IN (SELECT id FROM latest UNION SELECT id FROM complete)),
 published AS (SELECT DISTINCT ON(account_id,level) account_id,level,window_start,window_end,reviewed_at FROM public.meta_capture_reviews WHERE status='aprovado' ORDER BY account_id,level,reviewed_at DESC,id DESC)
 SELECT jsonb_build_object('runs',coalesce((SELECT jsonb_agg(to_jsonb(runs)) FROM runs),'[]'),
   'published',coalesce((SELECT jsonb_agg(to_jsonb(published)) FROM published),'[]'),
   'pending',coalesce((SELECT jsonb_object_agg(account_id,levels) FROM (SELECT account_id,jsonb_object_agg(level,n) levels FROM (SELECT account_id,level,count(*) n FROM public.meta_capture_reviews WHERE status='pendente' GROUP BY account_id,level) counts GROUP BY account_id) p),'{}')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_traffic_operation() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_traffic_operation() TO authenticated;
COMMIT;
