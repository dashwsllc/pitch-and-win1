-- SOMENTE LEITURA. Linha do tempo do pg_cron (execucoes por faixa de 10 min, falhas, jobs mais pesados). Rodar com: npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/db-cron-timeline.sql --output json  e ler com: node scripts/show-db-rows.cjs <saida.json>
-- SOMENTE LEITURA (SELECT). Linha do tempo do pg_cron (últimas ~7000 execuções) e o que mais pesa.
set statement_timeout = '30s';
select
  now()::text as agora_utc,
  (select jsonb_agg(to_jsonb(t) order by t.bucket) from (
     select to_char(date_trunc('hour', start_time) + (extract(minute from start_time)::int / 10) * interval '10 min', 'DD HH24:MI') as bucket,
            count(*) as runs,
            count(*) filter (where status <> 'succeeded') as falhas,
            round(max(extract(epoch from end_time - start_time))) as max_s,
            round(avg(extract(epoch from end_time - start_time)) filter (where command ilike '%arena_tick%')::numeric, 3) as arena_medio_s,
            round(max(extract(epoch from end_time - start_time)) filter (where command ilike '%arena_tick%')::numeric, 2) as arena_max_s
       from cron.job_run_details
      where runid > (select max(runid) from cron.job_run_details) - 7000
      group by 1) t) as linha_do_tempo,
  (select jsonb_agg(to_jsonb(t) order by t.seg_total desc) from (
     select left(regexp_replace(command, '\s+', ' ', 'g'), 62) as job, count(*) as runs,
            round(sum(extract(epoch from end_time - start_time))) as seg_total,
            round(avg(extract(epoch from end_time - start_time))::numeric, 2) as medio_s,
            round(max(extract(epoch from end_time - start_time))) as max_s,
            count(*) filter (where status <> 'succeeded') as falhas
       from cron.job_run_details
      where runid > (select max(runid) from cron.job_run_details) - 7000
      group by 1 order by 3 desc limit 14) t) as jobs_pelo_tempo,
  (select jsonb_agg(to_jsonb(t) order by t.n desc) from (
     select left(coalesce(return_message, '(vazio)'), 90) as msg, count(*) as n, min(start_time)::text as primeira, max(start_time)::text as ultima
       from cron.job_run_details
      where runid > (select max(runid) from cron.job_run_details) - 7000 and status <> 'succeeded'
      group by 1 order by 2 desc limit 8) t) as falhas_por_mensagem,
  (select jsonb_agg(jsonb_build_object('job', jobname, 'ativo', active, 'agenda', schedule) order by jobname) from cron.job) as jobs_agendados;
