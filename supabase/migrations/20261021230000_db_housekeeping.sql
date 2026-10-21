-- Manutencao do banco: nada de registro de maquina cresce sem teto. ADITIVA e idempotente.
-- Nao toca em dado de negocio (vendas, leads, CRM, metas, metricas publicadas, auditoria de acao humana, decisoes de revisao feitas por pessoa).
-- Cada regra apaga em lotes limitados (p_batch) e protege o que ainda e usado: a ultima execucao de cada tipo, o que esta em andamento,
-- o que tem erro, o que outra tabela referencia e tudo que um humano editou ou decidiu.
--
-- Por que existe VACUUM agendado: os workers do pg_cron e do pg_net gravam sem reportar estatisticas ao autovacuum (n_live_tup=0, autovacuum_count=0
-- desde sempre), entao DELETE sozinho nunca devolve espaco reutilizavel a cron.job_run_details e net._http_response: o arquivo so cresce.
-- Aqui o proprio pg_cron roda VACUUM nas duas (cron.use_background_workers=off, entao o comando roda fora de bloco de transacao).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

DO $guard$
BEGIN
 IF to_regclass('public.meta_sync_runs') IS NULL OR to_regclass('public.meta_audit_events') IS NULL OR to_regclass('public.meta_insights_pages') IS NULL
  OR to_regclass('public.meta_capture_review_rows') IS NULL OR to_regclass('public.meta_capture_reviews') IS NULL
  OR to_regclass('public.meta_import_batches') IS NULL OR to_regclass('public.meta_traffic_daily') IS NULL OR to_regnamespace('cron') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes as migrations do Meta (captura e revisao) e habilite o pg_cron' USING ERRCODE='55000'; END IF;
END $guard$;

DROP FUNCTION IF EXISTS public.db_housekeeping(boolean,integer);

-- p_dry_run (padrao): so conta, nao apaga nada. Retorna a contagem por regra, o tamanho em disco do historico do cron e das respostas do pg_net
-- (cron_heap_bytes / net_heap_bytes: devem ficar na casa de poucos MB) e "more" quando alguma regra bateu no limite do lote.
-- Na contagem, as regras em cascata (revisoes e execucoes de insights) so enxergam o estado de agora: o que depende de uma regra anterior
-- ter apagado antes (linhas da revisao, paginas da captura) so aparece depois da execucao real.
-- Prazos: historico do cron 2 dias; batida de coracao vazia do worker de leads 3 dias; ruido de atualizacao de metrica pela API 30 dias;
-- eventos automaticos de captura 60 dias; paginas brutas e candidatas de revisao ja decididas pelo sistema 7 dias; revisoes e execucoes de captura 30 dias;
-- revisoes superadas ja entregues na ponte dash->VOXEN 14 dias.
CREATE OR REPLACE FUNCTION public.db_housekeeping(p_dry_run boolean DEFAULT true,p_batch integer DEFAULT 10000) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_dry boolean:=coalesce(p_dry_run,true); v_now timestamptz:=clock_timestamp();
 v_cron bigint:=0; v_heartbeats bigint:=0; v_audit bigint:=0; v_audit_capture bigint:=0; v_pages bigint:=0;
 v_rows bigint:=0; v_reviews bigint:=0; v_runs bigint:=0; v_outbox bigint:=0; v_cron_heap bigint; v_net_heap bigint; v_errors jsonb:='{}'::jsonb;
BEGIN
 IF p_batch IS NULL OR p_batch NOT BETWEEN 100 AND 50000 THEN RAISE EXCEPTION 'Invalid housekeeping batch' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('db-housekeeping',0)) THEN RETURN jsonb_build_object('skipped','running'); END IF;

 -- 1. Historico de execucoes do pg_cron (so diagnostico; nenhuma funcao do app le). DELETE aqui + o VACUUM agendado logo depois.
 BEGIN
  IF v_dry THEN SELECT count(*) INTO v_cron FROM cron.job_run_details WHERE end_time<v_now-interval '2 days';
  ELSE WITH d AS (DELETE FROM cron.job_run_details WHERE ctid IN(SELECT ctid FROM cron.job_run_details WHERE end_time<v_now-interval '2 days' LIMIT p_batch) RETURNING 1)
   SELECT count(*) INTO v_cron FROM d; END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('cron_history',SQLSTATE); END;

 -- 2. Batida de coracao vazia do worker de leads: "sucesso, 0 linhas, sem erro". Fica a mais recente de cada (conta, modo) e a ultima com sucesso,
 --    que sao as que a tela de Trafego e os alertas leem; erro, parcial, em andamento e qualquer execucao com linhas ficam.
 BEGIN
  IF v_dry THEN
   SELECT count(*) INTO v_heartbeats FROM public.meta_sync_runs x
   WHERE x.kind='leads_reconciliation' AND x.status='success' AND coalesce(x.rows_synced,0)=0 AND x.error_message IS NULL AND x.finished_at IS NOT NULL
    AND x.started_at<v_now-interval '3 days'
    AND x.id NOT IN(SELECT DISTINCT ON(coalesce(account_id,''),coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='leads_reconciliation'
      ORDER BY coalesce(account_id,''),coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
    AND x.id NOT IN(SELECT DISTINCT ON(coalesce(account_id,''),coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='leads_reconciliation' AND status='success'
      ORDER BY coalesce(account_id,''),coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
    AND NOT EXISTS(SELECT 1 FROM public.meta_capture_reviews c WHERE c.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_import_batches b WHERE b.sync_run_id=x.id)
    AND NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily t WHERE t.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_insights_pages p WHERE p.run_id=x.id);
  ELSE
   WITH e AS (SELECT x.id FROM public.meta_sync_runs x
    WHERE x.kind='leads_reconciliation' AND x.status='success' AND coalesce(x.rows_synced,0)=0 AND x.error_message IS NULL AND x.finished_at IS NOT NULL
     AND x.started_at<v_now-interval '3 days'
     AND x.id NOT IN(SELECT DISTINCT ON(coalesce(account_id,''),coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='leads_reconciliation'
       ORDER BY coalesce(account_id,''),coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
     AND x.id NOT IN(SELECT DISTINCT ON(coalesce(account_id,''),coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='leads_reconciliation' AND status='success'
       ORDER BY coalesce(account_id,''),coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
     AND NOT EXISTS(SELECT 1 FROM public.meta_capture_reviews c WHERE c.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_import_batches b WHERE b.sync_run_id=x.id)
     AND NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily t WHERE t.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_insights_pages p WHERE p.run_id=x.id)
    ORDER BY x.started_at LIMIT p_batch),
   d AS (DELETE FROM public.meta_sync_runs WHERE id IN(SELECT id FROM e) RETURNING 1) SELECT count(*) INTO v_heartbeats FROM d;
  END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('idle_heartbeats',SQLSTATE); END;

 -- 3. Ruido de auditoria: o gatilho grava "metric.updated" (origem api) a cada mudanca de valor do dia corrente, de meia em meia hora.
 --    Publicacao, edicao manual, remocao, leads, levas e decisoes de revisao feitas por pessoa NAO entram: ficam sem prazo.
 BEGIN
  IF v_dry THEN SELECT count(*) INTO v_audit FROM public.meta_audit_events WHERE entity_type='metrics_row' AND action='metric.updated' AND origin='api' AND created_at<v_now-interval '30 days';
  ELSE WITH d AS (DELETE FROM public.meta_audit_events WHERE id IN(SELECT id FROM public.meta_audit_events
     WHERE entity_type='metrics_row' AND action='metric.updated' AND origin='api' AND created_at<v_now-interval '30 days' ORDER BY created_at LIMIT p_batch) RETURNING 1)
   SELECT count(*) INTO v_audit FROM d; END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('audit_noise',SQLSTATE); END;

 -- 3b. Eventos automaticos da captura (preparada / aprovada pelo sistema), cada um com o manifest inteiro: 60 dias. As decisoes de pessoa
 --     (capture.aprovado / capture.rejeitado ...) tem outros nomes de acao e ficam sem prazo.
 BEGIN
  IF v_dry THEN SELECT count(*) INTO v_audit_capture FROM public.meta_audit_events
   WHERE entity_type='capture_review' AND action IN('capture.prepared','capture.auto_approved') AND origin='api' AND created_at<v_now-interval '60 days';
  ELSE WITH d AS (DELETE FROM public.meta_audit_events WHERE id IN(SELECT id FROM public.meta_audit_events
     WHERE entity_type='capture_review' AND action IN('capture.prepared','capture.auto_approved') AND origin='api' AND created_at<v_now-interval '60 days' ORDER BY created_at LIMIT p_batch) RETURNING 1)
   SELECT count(*) INTO v_audit_capture FROM d; END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('audit_capture',SQLSTATE); END;

 -- 4. Paginas brutas da API de uma captura JA concluida: a preparacao da revisao le so as paginas da propria captura, nunca as de capturas antigas.
 BEGIN
  IF v_dry THEN SELECT count(*) INTO v_pages FROM public.meta_insights_pages p JOIN public.meta_sync_runs r ON r.id=p.run_id WHERE r.status='success' AND r.finished_at<v_now-interval '7 days';
  ELSE WITH d AS (DELETE FROM public.meta_insights_pages WHERE (run_id,page_no) IN(SELECT p.run_id,p.page_no FROM public.meta_insights_pages p JOIN public.meta_sync_runs r ON r.id=p.run_id
     WHERE r.status='success' AND r.finished_at<v_now-interval '7 days' LIMIT p_batch) RETURNING 1)
   SELECT count(*) INTO v_pages FROM d; END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('capture_pages',SQLSTATE); END;

 -- 5. Candidatas de revisao ja decididas PELO SISTEMA (aprovada automaticamente ou substituida): o que mudou fica em meta_traffic_daily e na auditoria
 --    (metric.updated/removed com antes e depois). Ficam as linhas editadas ou em conflito e toda revisao aprovada ou rejeitada por uma pessoa.
 BEGIN
  IF v_dry THEN SELECT count(*) INTO v_rows FROM public.meta_capture_review_rows x JOIN public.meta_capture_reviews r ON r.id=x.review_id
   WHERE r.status IN('aprovado','substituido') AND r.reviewed_by IS NULL AND r.updated_at<v_now-interval '7 days' AND NOT x.edited AND x.conflict_details IS NULL;
  ELSE WITH d AS (DELETE FROM public.meta_capture_review_rows WHERE (review_id,row_no) IN(SELECT x.review_id,x.row_no FROM public.meta_capture_review_rows x
     JOIN public.meta_capture_reviews r ON r.id=x.review_id
     WHERE r.status IN('aprovado','substituido') AND r.reviewed_by IS NULL AND r.updated_at<v_now-interval '7 days' AND NOT x.edited AND x.conflict_details IS NULL LIMIT p_batch) RETURNING 1)
   SELECT count(*) INTO v_rows FROM d; END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('review_rows',SQLSTATE); END;

 -- 6. A propria revisao decidida pelo sistema, 30 dias depois e ja sem linhas: some o cabecalho (e o manifest). Ficam as que ainda tem linha editada ou em conflito,
 --    as decididas por pessoa e as que uma metrica publicada ou um lote ainda referenciam (origem do dado).
 BEGIN
  IF v_dry THEN SELECT count(*) INTO v_reviews FROM public.meta_capture_reviews r
   WHERE r.status IN('aprovado','substituido') AND r.reviewed_by IS NULL AND r.updated_at<v_now-interval '30 days'
    AND NOT EXISTS(SELECT 1 FROM public.meta_capture_review_rows x WHERE x.review_id=r.id) AND NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily t WHERE t.capture_review_id=r.id)
    AND NOT EXISTS(SELECT 1 FROM public.meta_import_batches b WHERE b.replaced_by_review_id=r.id);
  ELSE WITH d AS (DELETE FROM public.meta_capture_reviews WHERE id IN(SELECT r.id FROM public.meta_capture_reviews r
     WHERE r.status IN('aprovado','substituido') AND r.reviewed_by IS NULL AND r.updated_at<v_now-interval '30 days'
      AND NOT EXISTS(SELECT 1 FROM public.meta_capture_review_rows x WHERE x.review_id=r.id) AND NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily t WHERE t.capture_review_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM public.meta_import_batches b WHERE b.replaced_by_review_id=r.id) ORDER BY r.updated_at LIMIT p_batch) RETURNING 1)
   SELECT count(*) INTO v_reviews FROM d; END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('reviews',SQLSTATE); END;

 -- 7. Execucao de captura de insights concluida ha 30 dias e que nada mais referencia (revisao, lote, metrica publicada, pagina). Fica a mais recente
 --    de cada (conta, nivel) e a ultima captura COMPLETA, que a tela de Trafego usa para dizer ate quando os dados estao em dia; erro e parcial ficam.
 BEGIN
  IF v_dry THEN
   SELECT count(*) INTO v_runs FROM public.meta_sync_runs x
   WHERE x.kind='insights' AND x.status='success' AND x.finished_at IS NOT NULL AND x.finished_at<v_now-interval '30 days'
    AND x.id NOT IN(SELECT DISTINCT ON(account_id,level,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='insights'
      ORDER BY account_id,level,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
    AND x.id NOT IN(SELECT DISTINCT ON(account_id,level,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='insights' AND status='success' AND coverage_state='complete'
      ORDER BY account_id,level,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
    AND NOT EXISTS(SELECT 1 FROM public.meta_capture_reviews c WHERE c.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_import_batches b WHERE b.sync_run_id=x.id)
    AND NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily t WHERE t.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_insights_pages p WHERE p.run_id=x.id);
  ELSE
   WITH e AS (SELECT x.id FROM public.meta_sync_runs x
    WHERE x.kind='insights' AND x.status='success' AND x.finished_at IS NOT NULL AND x.finished_at<v_now-interval '30 days'
     AND x.id NOT IN(SELECT DISTINCT ON(account_id,level,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='insights'
       ORDER BY account_id,level,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
     AND x.id NOT IN(SELECT DISTINCT ON(account_id,level,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE kind='insights' AND status='success' AND coverage_state='complete'
       ORDER BY account_id,level,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC)
     AND NOT EXISTS(SELECT 1 FROM public.meta_capture_reviews c WHERE c.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_import_batches b WHERE b.sync_run_id=x.id)
     AND NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily t WHERE t.sync_run_id=x.id) AND NOT EXISTS(SELECT 1 FROM public.meta_insights_pages p WHERE p.run_id=x.id)
    ORDER BY x.started_at LIMIT p_batch),
   d AS (DELETE FROM public.meta_sync_runs WHERE id IN(SELECT id FROM e) RETURNING 1) SELECT count(*) INTO v_runs FROM d;
  END IF;
 EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('insights_runs',SQLSTATE); END;

 -- 8. Ponte dash->VOXEN: revisao SUPERADA (existe uma mais nova do mesmo atleta) e ja entregue ha 14 dias. A mais recente de cada atleta nunca sai:
 --    e ela que da o proximo numero de revisao e a comparacao de conteudo igual. Pendente, em processamento e bloqueada tambem ficam.
 IF to_regclass('public.crm_context_outbox') IS NOT NULL THEN
  BEGIN
   IF v_dry THEN EXECUTE $q$SELECT count(*) FROM public.crm_context_outbox x WHERE x.state='delivered' AND x.delivered_at<$1-interval '14 days'
     AND EXISTS(SELECT 1 FROM public.crm_context_outbox y WHERE y.source_lead_id=x.source_lead_id AND y.source_revision>x.source_revision)$q$ INTO v_outbox USING v_now;
   ELSE EXECUTE $q$WITH d AS (DELETE FROM public.crm_context_outbox WHERE event_id IN(SELECT x.event_id FROM public.crm_context_outbox x
     WHERE x.state='delivered' AND x.delivered_at<$1-interval '14 days'
      AND EXISTS(SELECT 1 FROM public.crm_context_outbox y WHERE y.source_lead_id=x.source_lead_id AND y.source_revision>x.source_revision) ORDER BY x.delivered_at LIMIT $2) RETURNING 1)
     SELECT count(*) FROM d$q$ INTO v_outbox USING v_now,p_batch; END IF;
  EXCEPTION WHEN OTHERS THEN v_errors:=v_errors||jsonb_build_object('crm_outbox',SQLSTATE); END;
 END IF;

 -- Tamanho em disco das duas tabelas que o autovacuum nao enxerga (o VACUUM agendado as mantem pequenas; acima de ~50 MB algo falhou).
 BEGIN v_cron_heap:=pg_relation_size('cron.job_run_details'); EXCEPTION WHEN OTHERS THEN v_cron_heap:=NULL; END;
 BEGIN IF to_regclass('net._http_response') IS NOT NULL THEN v_net_heap:=pg_relation_size('net._http_response'); END IF; EXCEPTION WHEN OTHERS THEN v_net_heap:=NULL; END;

 RETURN jsonb_build_object('dry_run',v_dry,'batch',p_batch,'cron_history',v_cron,'idle_heartbeats',v_heartbeats,
  'audit_noise',v_audit,'audit_capture',v_audit_capture,'capture_pages',v_pages,'review_rows',v_rows,'reviews',v_reviews,'insights_runs',v_runs,'crm_outbox',v_outbox,
  'cron_heap_bytes',v_cron_heap,'net_heap_bytes',v_net_heap,
  'more',NOT v_dry AND greatest(v_cron,v_heartbeats,v_audit,v_audit_capture,v_pages,v_rows,v_reviews,v_runs,v_outbox)>=p_batch,'errors',v_errors);
END $$;

-- Roda a manutencao ate esvaziar o atraso (ate 6 lotes), numa unica chamada do agendador.
CREATE OR REPLACE FUNCTION public.db_housekeeping_run() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i integer; r jsonb;
BEGIN
 FOR i IN 1..6 LOOP
  r:=public.db_housekeeping(false,10000);
  EXIT WHEN NOT coalesce((r->>'more')::boolean,false);
 END LOOP;
 RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.db_housekeeping(boolean,integer),public.db_housekeeping_run() FROM PUBLIC,anon,authenticated,service_role;

-- Agendamento (UTC; Brasilia = UTC-3). A manutencao as 03:17, o VACUUM do historico do cron logo depois, e o das respostas do pg_net de 6 em 6 horas
-- (e a tabela que mais gira: ~5 mil respostas por dia).
DO $job$
DECLARE existing bigint;
BEGIN
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname IN('db-housekeeping','db-vacuum-cron-history','db-vacuum-net-responses') LOOP PERFORM cron.unschedule(existing); END LOOP;
 PERFORM cron.schedule('db-housekeeping','17 6 * * *','SELECT public.db_housekeeping_run()');
 PERFORM cron.schedule('db-vacuum-cron-history','27 6 * * *','VACUUM cron.job_run_details');
 IF to_regclass('net._http_response') IS NOT NULL THEN PERFORM cron.schedule('db-vacuum-net-responses','7 */6 * * *','VACUUM net._http_response'); END IF;
END $job$;

-- Job de 1 minuto que so retoma captura de insights em andamento: sem execucao "running"/"partial" a Edge Function nao faz nada (le exatamente essa condicao e sai),
-- entao a chamada HTTP (1.440 por dia, com resposta gravada no pg_net e execucao da Edge Function) so sai quando ha o que retomar. O comando so e alterado se
-- terminar na clausula WHERE conhecida e se o resultado for um SELECT valido; do contrario fica como esta.
DO $resume$
DECLARE j record; novo text;
BEGIN
 FOR j IN SELECT jobid,command FROM cron.job WHERE jobname='meta-insights-resume' AND command NOT LIKE '%meta_sync_runs%'
   AND command ~* 'WHERE\s*\(SELECT count\(DISTINCT name\)=2 FROM vault\.decrypted_secrets[^;]*\)\s*;\s*$' LOOP
  novo:=regexp_replace(j.command,';\s*$','')||E'\n AND EXISTS (SELECT 1 FROM public.meta_sync_runs WHERE kind=''insights'' AND status IN (''running'',''partial'') AND level IS NOT NULL);';
  BEGIN
   EXECUTE 'EXPLAIN '||novo;
   PERFORM cron.alter_job(j.jobid,command:=novo);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
 END LOOP;
END $resume$;
COMMIT;
