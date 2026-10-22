-- Diagnostico SOMENTE LEITURA do banco do dash (nada e gravado: termina sempre em RAISE EXCEPTION). Cada bloco falha isolado.
-- Rodar: npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/crm-context-bridge-diag.sql --output json   (o resultado vem no texto do erro: "DIAG {json}")
DO $d$
DECLARE r jsonb := '{}'::jsonb; j jsonb; uid uuid; t0 timestamptz;
BEGIN
 SET LOCAL statement_timeout = '25s';
 SET LOCAL lock_timeout = '2s';
 BEGIN
  SELECT jsonb_build_object('agora', now(),
   'max_conexoes', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
   'sessoes', (SELECT count(*) FROM pg_stat_activity),
   'por_estado', (SELECT coalesce(jsonb_object_agg(s, n), '{}') FROM (SELECT coalesce(state, '-') s, count(*) n FROM pg_stat_activity GROUP BY 1) x),
   'por_usuario_app', (SELECT coalesce(jsonb_agg(jsonb_build_object('u', usename, 'app', left(application_name, 30), 'n', n) ORDER BY n DESC), '[]') FROM (SELECT usename, application_name, count(*) n FROM pg_stat_activity GROUP BY 1, 2) x),
   'idle_tx_timeout', (SELECT setting FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout'),
   'papeis', (SELECT coalesce(jsonb_object_agg(rolname, rolconfig), '{}') FROM pg_roles WHERE rolname IN ('authenticator', 'authenticated', 'anon', 'service_role', 'postgres'))
  ) INTO j; r := r || j;
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_base', SQLERRM); END;
 BEGIN
  SELECT jsonb_build_object('atividade', (SELECT coalesce(jsonb_agg(jsonb_build_object('pid', pid, 'user', usename, 'estado', state,
     'espera', coalesce(wait_event_type, '') || ':' || coalesce(wait_event, ''), 'query_ha', (now() - query_start)::text, 'xact_ha', (now() - xact_start)::text,
     'bloqueado_por', pg_blocking_pids(pid), 'q', left(regexp_replace(query, '\s+', ' ', 'g'), 300)) ORDER BY xact_start NULLS LAST), '[]')
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND (state <> 'idle' OR xact_start IS NOT NULL)),
   'travas_pendentes', (SELECT count(*) FROM pg_locks WHERE NOT granted)) INTO j; r := r || j;
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_atividade', SQLERRM); END;
 BEGIN
  SELECT jsonb_build_object('cron_jobs', (SELECT coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'ativo', active, 'agenda', schedule) ORDER BY jobname), '[]') FROM cron.job),
   'cron_ultimas', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT d.runid, j2.jobname, d.status, left(d.return_message, 100) msg, d.start_time, (d.end_time - d.start_time)::text dur
      FROM cron.job_run_details d LEFT JOIN cron.job j2 ON j2.jobid = d.jobid ORDER BY d.runid DESC LIMIT 40) x)) INTO j; r := r || j;
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_cron', SQLERRM); END;
 BEGIN
  SELECT jsonb_build_object('net_fila', (SELECT count(*) FROM net.http_request_queue),
   'net_respostas_estimadas', (SELECT reltuples::bigint FROM pg_class WHERE oid = 'net._http_response'::regclass),
   'net_ultimas', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT id, status_code, left(error_msg, 80) erro, created FROM net._http_response ORDER BY id DESC LIMIT 15) x)) INTO j; r := r || j;
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_net', SQLERRM); END;
 BEGIN
  EXECUTE $q$SELECT jsonb_build_object('stmts_crm', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 90) q, calls, round(total_exec_time::numeric) total_ms,
      round(mean_exec_time::numeric, 1) mean_ms, round(max_exec_time::numeric) max_ms FROM extensions.pg_stat_statements WHERE query ILIKE '%crm_voxen%' OR query ILIKE '%crm_context%' ORDER BY total_exec_time DESC LIMIT 12) x),
    'stmts_topo', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 90) q, calls, round(total_exec_time::numeric) total_ms,
      round(mean_exec_time::numeric, 1) mean_ms, round(max_exec_time::numeric) max_ms FROM extensions.pg_stat_statements ORDER BY total_exec_time DESC LIMIT 8) x))$q$ INTO j; r := r || j;
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_stmts', SQLERRM); END;
 BEGIN
  SELECT jsonb_build_object('escolhidos', (SELECT count(*) FROM public.crm_voxen_prospects),
   'fila', (SELECT coalesce(jsonb_object_agg(k, n), '{}') FROM (SELECT concat(state, '/', coalesce(payload->>'kind', '?')) k, count(*) n FROM public.crm_context_outbox GROUP BY 1) x),
   'controle', (SELECT to_jsonb(c) - 'last_trigger_error' FROM public.crm_context_delivery_control c WHERE singleton)) INTO j; r := r || j;
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_fila', SQLERRM); END;
 BEGIN
  SELECT u.id INTO uid FROM auth.users u WHERE public.is_executive(u.id) LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t0 := clock_timestamp(); PERFORM public.crm_voxen_sync_states();
  r := r || jsonb_build_object('tempo_sync_states_1_ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp(); PERFORM public.crm_voxen_sync_states();
  r := r || jsonb_build_object('tempo_sync_states_2_ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  r := r || jsonb_build_object('leads_total', (SELECT count(*) FROM public.crm_leads), 'leads_cadastrados_voxen', (SELECT count(*) FROM public.crm_leads c WHERE public.crm_context_lead_has_voxen(c.id)));
  r := r || jsonb_build_object('tempo_cadastrados_ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000));
 EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('erro_tempos', SQLERRM); END;
 RAISE EXCEPTION 'DIAG %', r::text USING ERRCODE = 'P0001';
END $d$;
