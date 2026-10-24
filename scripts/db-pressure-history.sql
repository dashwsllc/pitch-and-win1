-- SOMENTE LEITURA. Histórico da pressão do banco (tabela public.db_pressure_history, uma foto a cada 5 min, 7 dias). Use DEPOIS de uma queda: sobrevive ao reinício da instância.
-- Rodar: npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/db-pressure-history.sql --output json > hist.json && node scripts/show-db-rows.cjs hist.json
-- Ajuste o intervalo em "janela" (padrão: últimas 6 horas). Colunas de taxa = diferença entre fotos vizinhas dos contadores acumulados, dividida pelos segundos entre elas
-- (se a instância reiniciou entre duas fotos o contador volta a zero e a taxa daquela linha fica nula).
begin read only;
set local statement_timeout = '20s';
select (
  select coalesce(jsonb_agg(to_jsonb(t) order by t.taken_at), '[]'::jsonb) from (
    select to_char(taken_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as taken_at_brt,
           (pressao->>'conexoes')::int as conexoes, (pressao->>'ativas_fora_do_cron')::int as ativas, (pressao->>'cron_em_execucao')::int as cron,
           (pressao->>'mais_antiga_ativa_s')::int as mais_antiga_s, (pressao->>'sob_pressao')::boolean as sob_pressao,
           (cron->>'falhas_10min')::int as cron_falhas_10min, (cron->>'mais_lento_s')::int as cron_mais_lento_s,
           case when extract(epoch from taken_at - lag(taken_at) over w) > 0 and (banco->>'commits')::bigint >= (lag(banco->>'commits') over w)::bigint
                then round(((banco->>'commits')::bigint - (lag(banco->>'commits') over w)::bigint) / extract(epoch from taken_at - lag(taken_at) over w), 1) end as commits_por_s,
           case when extract(epoch from taken_at - lag(taken_at) over w) > 0 and (banco->>'rollbacks')::bigint >= (lag(banco->>'rollbacks') over w)::bigint
                then round(((banco->>'rollbacks')::bigint - (lag(banco->>'rollbacks') over w)::bigint) / extract(epoch from taken_at - lag(taken_at) over w), 1) end as rollbacks_por_s,
           esperas::text as esperas, ativa_mais_antiga->>'seg' as ativa_seg, ativa_mais_antiga->>'app' as ativa_app, ativa_mais_antiga->>'q' as ativa_consulta
      from public.db_pressure_history
     where taken_at > now() - interval '6 hours'   -- janela
    window w as (order by taken_at)) t) as fotos,
  (select count(*) from public.db_pressure_history) as total_fotos,
  (select min(taken_at)::text from public.db_pressure_history) as mais_antiga,
  (select jsonb_agg(to_jsonb(s)) from (select to_char(taken_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando, pressao->>'conexoes' as conexoes, pressao->>'ativas_fora_do_cron' as ativas
     from public.db_pressure_history where (pressao->>'sob_pressao')::boolean order by taken_at desc limit 10) s) as ultimas_sob_pressao;
