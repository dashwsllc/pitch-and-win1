-- SOMENTE LEITURA. Diagnostico completo do banco do dash quando o dashboard trava (sessoes, esperas, bloqueios, taxa de commits/rollbacks/WAL em 5 s, I/O, tabelas que mais escrevem, cron, pg_stat_statements). Termina SEMPRE em excecao (nada e gravado); o resultado vem no texto "DIAG {json}". Rodar: npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/db-incident-diag.sql --output json
-- Cada bloco é limitado e protegido: se um falhar ou estourar, os outros ainda voltam.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '50s';
do $$
declare r jsonb := '{}'::jsonb; x jsonb; maxrun bigint;
  w0 pg_lsn; w1 pg_lsn; c0 bigint; c1 bigint; b0 bigint; b1 bigint; t0 timestamptz; t1 timestamptz;
begin
  r := r || jsonb_build_object('agora_utc', now()::text, 'no_ar_ha', (now() - pg_postmaster_start_time())::text,
    'max_conexoes', current_setting('max_connections'), 'shared_buffers', current_setting('shared_buffers'),
    'work_mem', current_setting('work_mem'), 'track_io_timing', current_setting('track_io_timing', true));

  begin
    r := r || jsonb_build_object('sessoes', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(nullif(application_name,''),'(sem nome)') || ' / ' || coalesce(state,'?') as k, count(*) as n
        from pg_stat_activity where datname = current_database() group by 1) s));
    r := r || jsonb_build_object('esperas', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(wait_event_type,'-') || ':' || coalesce(wait_event,'-') as k, count(*) as n
        from pg_stat_activity where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid() group by 1) s));
    r := r || jsonb_build_object('bloqueadas', (select count(*) from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0));
    r := r || jsonb_build_object('bloqueadores', (select coalesce(jsonb_agg(jsonb_build_object(
        'pid', a.pid, 'app', a.application_name, 'estado', a.state,
        'xact_s', round(extract(epoch from now() - a.xact_start)), 'q', left(regexp_replace(a.query, '\s+', ' ', 'g'), 110))), '[]'::jsonb)
      from pg_stat_activity a where a.pid in (select unnest(pg_blocking_pids(pid)) from pg_stat_activity)));
    r := r || jsonb_build_object('ativas', (select coalesce(jsonb_agg(jsonb_build_object(
        'app', application_name, 'seg', round(extract(epoch from now() - query_start)),
        'espera', coalesce(wait_event_type, '') || ':' || coalesce(wait_event, ''),
        'q', left(regexp_replace(query, '\s+', ' ', 'g'), 110)) order by query_start), '[]'::jsonb)
      from (select * from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()
             order by query_start limit 12) t));
    r := r || jsonb_build_object('transacoes_longas', (select coalesce(jsonb_agg(jsonb_build_object(
        'app', application_name, 'estado', state, 'xact_s', round(extract(epoch from now() - xact_start)),
        'q', left(regexp_replace(query, '\s+', ' ', 'g'), 80)) order by xact_start), '[]'::jsonb)
      from (select * from pg_stat_activity where datname = current_database() and xact_start < now() - interval '30 seconds'
               and pid <> pg_backend_pid() order by xact_start limit 8) t));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_sessoes', sqlerrm);
  end;

  -- taxas por segundo medidas em 5 s: transações, rollbacks, bytes de WAL
  begin
    select xact_commit, xact_rollback into c0, b0 from pg_stat_database where datname = current_database();
    w0 := pg_current_wal_lsn(); t0 := clock_timestamp();
    perform pg_sleep(5);
    select xact_commit, xact_rollback into c1, b1 from pg_stat_database where datname = current_database();
    w1 := pg_current_wal_lsn(); t1 := clock_timestamp();
    r := r || jsonb_build_object('taxas_por_s', jsonb_build_object(
      'commits', round((c1 - c0) / extract(epoch from t1 - t0), 1), 'rollbacks', round((b1 - b0) / extract(epoch from t1 - t0), 1),
      'wal_kb', round((w1 - w0) / 1024.0 / extract(epoch from t1 - t0), 1)));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_taxas', sqlerrm);
  end;

  begin
    r := r || jsonb_build_object('banco', (select jsonb_build_object('commits', xact_commit, 'rollbacks', xact_rollback, 'deadlocks', deadlocks,
        'conflitos', conflicts, 'temp_mb', round(temp_bytes / 1048576.0), 'blks_lidos', blks_read, 'blks_cache', blks_hit)
      from pg_stat_database where datname = current_database()));
    r := r || jsonb_build_object('checkpoints', (select to_jsonb(c) - 'stats_reset' from pg_stat_checkpointer c));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_banco', sqlerrm);
  end;

  begin
    r := r || jsonb_build_object('io_por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('tipo', backend_type, 'obj', object, 'leituras', rd, 'escritas', wr, 'ms_io', ms) order by rd + wr desc), '[]'::jsonb)
      from (select backend_type, object, sum(coalesce(reads, 0))::bigint as rd, sum(coalesce(writes, 0))::bigint as wr,
                   round(sum(coalesce(read_time, 0) + coalesce(write_time, 0)))::bigint as ms
              from pg_stat_io where object in ('relation', 'wal') group by 1, 2 order by 3 + 4 desc limit 8) s));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_io', sqlerrm);
  end;

  begin
    r := r || jsonb_build_object('tabelas_que_mais_escrevem', (select coalesce(jsonb_agg(jsonb_build_object('tabela', t, 'ins', i, 'upd', u, 'del', d, 'mortas', dead, 'ultimo_autovac', av) order by i + u + d desc), '[]'::jsonb)
      from (select schemaname || '.' || relname as t, n_tup_ins as i, n_tup_upd as u, n_tup_del as d, n_dead_tup as dead, last_autovacuum::text as av
              from pg_stat_all_tables where schemaname not in ('pg_catalog', 'information_schema', 'pg_toast') order by n_tup_ins + n_tup_upd + n_tup_del desc limit 10) s));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_tabelas', sqlerrm);
  end;

  begin
    r := r || jsonb_build_object('tamanhos_mb', (select coalesce(jsonb_object_agg(rel, mb), '{}'::jsonb) from (
      select rel, round(pg_total_relation_size(rel::regclass) / 1048576.0) as mb
        from unnest(array['cron.job_run_details', 'net._http_response', 'net.http_request_queue', 'auth.audit_log_entries', 'auth.refresh_tokens']) rel
       where to_regclass(rel) is not null) s), 'banco_mb', round(pg_database_size(current_database()) / 1048576.0));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_tamanhos', sqlerrm);
  end;

  begin
    select max(runid) into maxrun from cron.job_run_details;
    select coalesce(jsonb_agg(jsonb_build_object('job', j, 'rodadas', n, 'seg_total', s, 'seg_max', m, 'falhas', f) order by s desc), '[]'::jsonb) into x
      from (select left(regexp_replace(d.command, '\s+', ' ', 'g'), 55) as j, count(*) as n,
                   round(sum(extract(epoch from d.end_time - d.start_time))) as s, round(max(extract(epoch from d.end_time - d.start_time))) as m,
                   count(*) filter (where d.status <> 'succeeded') as f
              from cron.job_run_details d where d.runid > maxrun - 3000
             group by 1 order by 4 desc nulls last limit 12) c;
    r := r || jsonb_build_object('cron_ultimas_3000', x, 'cron_janela_inicio', (select start_time::text from cron.job_run_details where runid = maxrun - 3000));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_cron', sqlerrm);
  end;

  begin
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('q', q, 'chamadas', calls, 'seg_total', s, 'ms_medio', ms, 'lidos_blocos', rd) order by s desc), '[]'::jsonb)
      from (select left(regexp_replace(query, '\s+', ' ', 'g'), 80) as q, calls, round((total_exec_time / 1000)::numeric) as s, round(mean_exec_time::numeric) as ms,
                   shared_blks_read as rd
              from extensions.pg_stat_statements order by total_exec_time desc limit 12) t$q$ into x;
    r := r || jsonb_build_object('mais_pesadas', x);
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('q', q, 'chamadas', calls, 'temp_mb', tmp, 'wal_mb', wal, 'lidos_blocos', rd, 'seg_total', s) order by tmp desc), '[]'::jsonb)
      from (select left(regexp_replace(query, '\s+', ' ', 'g'), 80) as q, calls, round(temp_blks_written * 8 / 1024.0) as tmp, round(wal_bytes / 1048576.0) as wal,
                   shared_blks_read as rd, round((total_exec_time / 1000)::numeric) as s
              from extensions.pg_stat_statements where temp_blks_written > 0 order by temp_blks_written desc limit 6) t$q$ into x;
    r := r || jsonb_build_object('quem_escreve_temporarios', x);
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('q', q, 'chamadas', calls, 'wal_mb', wal, 'seg_total', s) order by wal desc), '[]'::jsonb)
      from (select left(regexp_replace(query, '\s+', ' ', 'g'), 80) as q, calls, round(wal_bytes / 1048576.0) as wal, round((total_exec_time / 1000)::numeric) as s
              from extensions.pg_stat_statements order by wal_bytes desc limit 6) t$q$ into x;
    r := r || jsonb_build_object('quem_escreve_wal', x);
  exception when query_canceled or others then r := r || jsonb_build_object('mais_pesadas', 'indisponivel: ' || sqlerrm);
  end;

  begin
    r := r || jsonb_build_object('papeis', (select coalesce(jsonb_object_agg(rolname, rolconfig), '{}'::jsonb) from pg_roles
      where rolname in ('authenticator', 'authenticated', 'anon', 'service_role', 'postgres')));
  exception when query_canceled or others then r := r || jsonb_build_object('erro_papeis', sqlerrm);
  end;

  raise exception 'DIAG %', r::text using errcode = 'P0001';
end $$;
