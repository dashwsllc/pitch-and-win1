-- SOMENTE LEITURA. Pressao atual do banco (db_pressure_status()), jobs do pg_cron com/sem guarda e execucoes dos ultimos 5 min.
-- SOMENTE LEITURA. Confere os jobs depois das guardas: estado atual e execuções desde a aplicação.
set statement_timeout = '25s';
select now()::text as agora_utc,
  (select public.db_pressure_status()) as pressao,
  (select jsonb_agg(jsonb_build_object('job', jobname, 'agenda', schedule, 'guarda', command like '%db_under_pressure%', 'ativo', active) order by jobname) from cron.job) as jobs,
  (select jsonb_agg(to_jsonb(t) order by t.job) from (
     select left(regexp_replace(command, '\s+', ' ', 'g'), 42) as job, count(*) as runs, count(*) filter (where status <> 'succeeded') as falhas,
            round(max(extract(epoch from end_time - start_time))::numeric, 1) as max_s
       from cron.job_run_details where runid > (select max(runid) from cron.job_run_details) - 600 and start_time > now() - interval '5 minutes' group by 1) t) as execucoes_5min;
