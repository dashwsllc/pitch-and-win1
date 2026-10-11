BEGIN;
-- Queue/discovery leases own work. Separate operation logs avoid a minute drain
-- blocking the hourly discovery or hiding its permission error.
DROP INDEX IF EXISTS public.meta_sync_runs_one_running;
CREATE UNIQUE INDEX meta_sync_runs_one_running ON public.meta_sync_runs(kind,coalesce(account_id,''),coalesce(request_params->>'discover','legacy')) WHERE status='running' AND level IS NULL;
CREATE OR REPLACE FUNCTION public.meta_lead_run_start(p_page_id text,p_discover boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE id uuid;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Serviço necessário' USING ERRCODE='42501'; END IF;
 IF p_discover IS NULL THEN RAISE EXCEPTION 'Modo necessário' USING ERRCODE='22023'; END IF;
 UPDATE public.meta_sync_runs SET status='error',finished_at=clock_timestamp(),error_message='Execução interrompida; retomada pela fila durável'
 WHERE kind='leads_reconciliation' AND account_id IS NOT DISTINCT FROM p_page_id AND status='running'
   AND request_params->>'discover'=p_discover::text AND started_at<clock_timestamp()-interval '2 minutes';
 INSERT INTO public.meta_sync_runs(kind,account_id,status,triggered_by,request_params)
 VALUES('leads_reconciliation',p_page_id,'running','cron',jsonb_build_object('discover',p_discover)) RETURNING meta_sync_runs.id INTO id;
 RETURN id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Este modo de reconciliação já está em andamento' USING ERRCODE='55006';
END $$;
REVOKE ALL ON FUNCTION public.meta_lead_run_start(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_lead_run_start(text,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.meta_traffic_operation() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 WITH latest AS (SELECT DISTINCT ON(account_id,level,kind,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs ORDER BY account_id,level,kind,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC),
 complete AS (SELECT DISTINCT ON(account_id,level,kind,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE status='success' AND coverage_state='complete' ORDER BY account_id,level,kind,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC),
 runs AS (SELECT r.id,r.kind,r.account_id,r.level,r.status,r.coverage_state,r.started_at,r.finished_at,r.window_start,r.window_end,r.rows_synced,r.page_count,CASE WHEN jsonb_typeof(r.request_params->'discover')='boolean' THEN (r.request_params->>'discover')::boolean END AS discover,
   CASE WHEN r.error_message IS NULL THEN NULL WHEN r.error_message ~* 'pages_manage_ads|permission|permiss|oauth|authoriz|autoriz|token' THEN 'Regularize a autorização da Meta e o acesso aos leads da página. A importação manual continua disponível.'
     ELSE 'A sincronização não concluiu. Confira a configuração e tente novamente; a importação manual continua disponível.' END AS error_message
   FROM public.meta_sync_runs r WHERE r.id IN (SELECT id FROM latest UNION SELECT id FROM complete)),
 published AS (SELECT DISTINCT ON(account_id,level) account_id,level,window_start,window_end,reviewed_at FROM public.meta_capture_reviews WHERE status='aprovado' ORDER BY account_id,level,reviewed_at DESC,id DESC)
 SELECT jsonb_build_object('runs',coalesce((SELECT jsonb_agg(to_jsonb(runs)) FROM runs),'[]'),
   'published',coalesce((SELECT jsonb_agg(to_jsonb(published)) FROM published),'[]'),
   'pending',coalesce((SELECT jsonb_object_agg(account_id,levels) FROM (SELECT account_id,jsonb_object_agg(level,n) levels FROM (SELECT account_id,level,count(*) n FROM public.meta_capture_reviews WHERE status='pendente' GROUP BY account_id,level) counts GROUP BY account_id) p),'{}')) INTO result;
 RETURN result;
END $$;
COMMIT;

-- These five jobs are deliberately PAUSED. Resume only after the selective
-- database -> Edge -> frontend deployment described in the operation runbook.
DO $migration$
DECLARE job record; existing bigint; new_id bigint; command text;
BEGIN
 FOR job IN SELECT * FROM (VALUES
   ('meta-insights-sync-frequent','*/30 * * * *','meta-insights-sync','{}'::jsonb),
   ('meta-insights-sync-deep','0 3 * * *','meta-insights-sync','{"days":8}'::jsonb),
   ('meta-insights-resume','* * * * *','meta-insights-sync','{"resumeOnly":true}'::jsonb),
   ('meta-leads-reconciliation-hourly','15 * * * *','meta-leads-reconciliation','{"discover":true}'::jsonb),
   ('meta-lead-worker','* * * * *','meta-leads-reconciliation','{"discover":false}'::jsonb)) desired(name,schedule,endpoint,body) LOOP
   FOR existing IN SELECT jobid FROM cron.job WHERE jobname=job.name LOOP PERFORM cron.unschedule(existing); END LOOP;
   command:=format($command$
     SELECT net.http_post(url:=%L,
       headers:=jsonb_build_object('Content-Type','application/json',
         'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_cron_anon_key' LIMIT 1),
         'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_sync_cron_secret' LIMIT 1)),
       body:=%L::jsonb,timeout_milliseconds:=60000)
     WHERE (SELECT count(DISTINCT name)=2 FROM vault.decrypted_secrets WHERE name IN ('meta_cron_anon_key','meta_sync_cron_secret') AND length(decrypted_secret)>0);
   $command$,'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/'||job.endpoint,job.body::text);
   new_id:=cron.schedule(job.name,job.schedule,command);
   PERFORM cron.alter_job(new_id,active:=false);
 END LOOP;
END $migration$;
