-- Histórico da pressão do banco (24/10/2026), passivo: só LÊ o catálogo e grava uma linha pequena a cada 5 minutos. Não derruba sessão, não pausa job, não muda nada do app.
-- Por quê: nas quedas de 22-23/10 nunca provamos o gatilho das 14:00Z porque o reinício da instância zerou pg_stat_statements/pg_stat_activity e os logs da Supabase estavam fora
-- do ar justamente no incidente. Com uma foto a cada 5 min guardada numa tabela do próprio banco (sobrevive a reinício), a próxima queda deixa rastro: conexões, quem estava ativo,
-- esperas, jobs do cron rodando/falhando, e contadores de commits/rollbacks para calcular taxa entre fotos.
-- Leitura: scripts/db-pressure-history.sql (só leitura). Retenção: 7 dias (~3.000 linhas), apagada pela própria função.
-- guard-exempt: grava a foto da pressão e por isso precisa rodar justamente quando há pressão; o trabalho é uma leitura do catálogo com statement_timeout de 5 s.
BEGIN;

CREATE TABLE IF NOT EXISTS public.db_pressure_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  pressao jsonb NOT NULL DEFAULT '{}',            -- db_pressure_status(): conexoes, ativas_fora_do_cron, cron_em_execucao, mais_antiga_ativa_s, sob_pressao
  sessoes jsonb NOT NULL DEFAULT '{}',            -- "aplicacao / estado" -> quantidade
  esperas jsonb NOT NULL DEFAULT '{}',            -- "tipo:evento" -> quantidade (so sessoes nao ociosas)
  ativa_mais_antiga jsonb,                        -- {app, seg, espera, q}  (q com literais mascarados)
  cron jsonb NOT NULL DEFAULT '{}',               -- {rodando, falhas_10min, mais_lento_s}
  banco jsonb NOT NULL DEFAULT '{}'               -- contadores ACUMULADOS (a taxa e a diferenca entre fotos): commits, rollbacks, deadlocks, temp_bytes, blks_read
);
CREATE INDEX IF NOT EXISTS db_pressure_history_taken ON public.db_pressure_history (taken_at DESC);
ALTER TABLE public.db_pressure_history ENABLE ROW LEVEL SECURITY;   -- sem politica nenhuma: ninguem da API le
REVOKE ALL ON public.db_pressure_history FROM PUBLIC, anon, authenticated, service_role;

-- Texto de consulta sem dados pessoais: literais entre aspas e sequencias de 4+ digitos (telefone, CPF, id) viram '?'.
CREATE OR REPLACE FUNCTION public.db_pressure_mask(p_query text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT left(regexp_replace(regexp_replace(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'), '''([^'']|'''')*''', '''?''', 'g'), '\d{4,}', '?', 'g'), 120)
$$;
REVOKE ALL ON FUNCTION public.db_pressure_mask(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.db_pressure_snapshot() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id bigint; v_pressao jsonb := '{}'; v_sessoes jsonb := '{}'; v_esperas jsonb := '{}'; v_oldest jsonb; v_cron jsonb := '{}'; v_banco jsonb := '{}'; v_maxrun bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('db-pressure-snapshot', 0)) THEN RETURN NULL; END IF;

  -- Cada bloco e isolado: se um falhar, a foto sai mesmo assim com {"erro": SQLSTATE} naquele campo (o que importa e nao perder a foto de um incidente).
  BEGIN v_pressao := public.db_pressure_status();
  EXCEPTION WHEN OTHERS THEN v_pressao := jsonb_build_object('erro', SQLSTATE); END;

  BEGIN
    SELECT coalesce(jsonb_object_agg(k, n), '{}') INTO v_sessoes FROM (
      SELECT coalesce(nullif(application_name, ''), '(sem nome)') || ' / ' || coalesce(state, '?') AS k, count(*) AS n
        FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid() GROUP BY 1) s;
    SELECT coalesce(jsonb_object_agg(k, n), '{}') INTO v_esperas FROM (
      SELECT coalesce(wait_event_type, '-') || ':' || coalesce(wait_event, '-') AS k, count(*) AS n
        FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND state <> 'idle' AND pid <> pg_backend_pid() GROUP BY 1) s;
    SELECT jsonb_build_object('app', application_name, 'seg', round(extract(epoch FROM clock_timestamp() - query_start)),
             'espera', coalesce(wait_event_type, '') || ':' || coalesce(wait_event, ''), 'q', public.db_pressure_mask(query))
      INTO v_oldest FROM pg_stat_activity
     WHERE datname = current_database() AND backend_type = 'client backend' AND state = 'active' AND pid <> pg_backend_pid() ORDER BY query_start LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_sessoes := jsonb_build_object('erro', SQLSTATE); END;

  BEGIN
    SELECT max(runid) INTO v_maxrun FROM cron.job_run_details;
    SELECT jsonb_build_object(
             'rodando', count(*) FILTER (WHERE status IN ('starting', 'running')),
             'falhas_10min', count(*) FILTER (WHERE status NOT IN ('starting', 'running', 'succeeded') AND start_time > clock_timestamp() - interval '10 minutes'),
             'mais_lento_s', coalesce(max(round(extract(epoch FROM coalesce(end_time, clock_timestamp()) - start_time))) FILTER (WHERE start_time > clock_timestamp() - interval '10 minutes'), 0))
      INTO v_cron FROM cron.job_run_details WHERE runid > coalesce(v_maxrun, 0) - 300;
  EXCEPTION WHEN OTHERS THEN v_cron := jsonb_build_object('erro', SQLSTATE); END;

  BEGIN
    SELECT jsonb_build_object('commits', xact_commit, 'rollbacks', xact_rollback, 'deadlocks', deadlocks, 'temp_bytes', temp_bytes, 'blks_read', blks_read)
      INTO v_banco FROM pg_stat_database WHERE datname = current_database();
  EXCEPTION WHEN OTHERS THEN v_banco := jsonb_build_object('erro', SQLSTATE); END;

  INSERT INTO public.db_pressure_history (pressao, sessoes, esperas, ativa_mais_antiga, cron, banco)
  VALUES (v_pressao, v_sessoes, v_esperas, v_oldest, v_cron, coalesce(v_banco, '{}')) RETURNING id INTO v_id;

  -- Retencao de 7 dias, em lotes pequenos (a tabela e minuscula; o indice por taken_at torna isto barato).
  DELETE FROM public.db_pressure_history WHERE id IN (
    SELECT id FROM public.db_pressure_history WHERE taken_at < clock_timestamp() - interval '7 days' ORDER BY taken_at LIMIT 500);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.db_pressure_snapshot() FROM PUBLIC, anon, authenticated, service_role;

-- Agenda (fora do :00 e dos minutos das varreduras pesadas; idempotente: reaplicar nao duplica o job).
DO $job$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RAISE EXCEPTION 'pg_cron nao instalado'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'db-pressure-snapshot';
  PERFORM cron.schedule('db-pressure-snapshot', '5-55/5 * * * *', $cmd$SET statement_timeout='5s'; SET lock_timeout='1s'; SELECT public.db_pressure_snapshot()$cmd$);
END $job$;

COMMIT;
