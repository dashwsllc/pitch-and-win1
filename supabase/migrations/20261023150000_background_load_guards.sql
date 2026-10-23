-- Trabalho de fundo do banco (pg_cron) que NAO pode derrubar o dashboard: pula quando o banco esta ocupado, tem teto de tempo e de espera por trava,
-- nao dispara tudo no mesmo minuto e roda com a frequencia que a funcao realmente precisa.
--
-- Por que: em 22 e 23/10 o banco do projeto dash (instancia Nano, 0,5 GB, ate 60 conexoes) travou tres vezes e so voltou com "Restart project". Em 23/10 o historico do
-- pg_cron mostrou o colapso: 13:52Z uma funcao trivial (arena_tick, normalmente 0,04 s) levou 3 s; 14:01Z "job startup timeout"; jobs de 911 s; 338 falhas; nenhum job rodou por
-- 10 minutos. O pg_cron abre UMA CONEXAO NOVA por execucao (cron.use_background_workers=off): com o banco lento os jobs se empilham, ocupam as 60 conexoes e nada mais entra
-- (nem a API, nem a CLI), ate alguem reiniciar. Aqui:
--  1) public.db_under_pressure(): true quando ha muitas consultas ativas fora do pg_cron ou quase todas as conexoes ocupadas;
--  2) os jobs que sao so "rede de seguranca" ou "manutencao" passam a ser `... WHERE NOT db_under_pressure()` (pulam e tentam no proximo horario);
--  3) as varreduras pesadas ganham statement_timeout e lock_timeout no proprio comando (hoje o usuario postgres nao tem teto: houve execucao de 911 s);
--  4) horarios espalhados (as tres varreduras pesadas colidiam no minuto :00: foi onde o banco colapsou em 23/10 as 14:00Z) e menos CPU por hora: a ponte para a VOXEN e os
--     formularios ja reagem na hora por gatilho, a varredura so pega o que escapou. crm-context-reconcile continua a cada 15 min (a tela de saude da ponte alerta depois de 45) mas
--     com lote de 40 em vez de 150 (rajada de ~15 s em vez de ~36 s; o ciclo completo dos leads escolhidos leva ~1 h), meta-site-form-link 5 -> 10 min (media de 11 s por
--     rodada), meta-form-context-refresh 10 -> 30 min, arena 15 -> 45 s, calendar-reconcile deslocado;
--  5) transacao pendurada da API (PostgREST "idle in transaction") passa a ser encerrada em 20 s: no incidente de 22/10 elas seguravam o pool inteiro por horas.
-- NAO muda o que cada job faz, so quando/como roda. Os jobs de 1 minuto que disparam Edge Functions (leads da Meta, Google Agenda, retomada de insights) so ganham a guarda.
-- Aditiva e idempotente (rodar de novo nao duplica guarda nem muda nada).
BEGIN;
SET LOCAL lock_timeout = '4s';

-- Sessoes do banco, numa funcao a parte (o teste a substitui por sessoes fabricadas; em producao le o catalogo de verdade).
CREATE OR REPLACE FUNCTION public.db_pressure_sessions() RETURNS TABLE(pid integer, app text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.pid, a.application_name::text, a.state::text FROM pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend'
$$;
REVOKE ALL ON FUNCTION public.db_pressure_sessions() FROM PUBLIC, anon, authenticated, service_role;

-- Sob pressao = muitas consultas em andamento FORA do pg_cron (os proprios jobs nao contam, senao se bloqueariam entre si) ou quase todas as conexoes ocupadas.
CREATE OR REPLACE FUNCTION public.db_under_pressure(p_active integer DEFAULT 12, p_total integer DEFAULT 48) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(
           count(*) FILTER (WHERE s.state <> 'idle' AND s.app NOT LIKE 'pg_cron%' AND s.pid <> pg_backend_pid()) >= p_active
        OR count(*) >= p_total, false)
    FROM public.db_pressure_sessions() s
$$;
REVOKE ALL ON FUNCTION public.db_under_pressure(integer, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Foto para diagnostico (so quem tem acesso ao banco): quantas conexoes, quantas ativas, a mais antiga.
CREATE OR REPLACE FUNCTION public.db_pressure_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('sob_pressao', public.db_under_pressure(),
    'conexoes', count(*), 'ativas_fora_do_cron', count(*) FILTER (WHERE a.state <> 'idle' AND a.application_name NOT LIKE 'pg_cron%' AND a.pid <> pg_backend_pid()),
    'cron_em_execucao', count(*) FILTER (WHERE a.application_name LIKE 'pg_cron%' AND a.state <> 'idle'),
    'mais_antiga_ativa_s', coalesce(round(max(extract(epoch FROM now() - a.query_start)) FILTER (WHERE a.state = 'active' AND a.pid <> pg_backend_pid())), 0))
    FROM pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend'
$$;
REVOKE ALL ON FUNCTION public.db_pressure_status() FROM PUBLIC, anon, authenticated, service_role;

-- Jobs do pg_cron. Cada linha: nome, horario novo (NULL = mantem), comando novo (NULL = so acrescenta a guarda ao comando que ja existe).
CREATE TEMP TABLE bg_guard_plan(jobname text PRIMARY KEY, new_schedule text, new_command text) ON COMMIT DROP;
INSERT INTO bg_guard_plan VALUES
  ('arena-cycle-deadlines',            '45 seconds',        'SELECT public.arena_tick() WHERE NOT public.db_under_pressure()'),
  ('crm-context-reconcile',            '7,22,37,52 * * * *', 'SET statement_timeout=''45s''; SET lock_timeout=''3s''; SELECT public.crm_context_reconcile(40) WHERE NOT public.db_under_pressure()'),
  ('meta-form-context-refresh',        '4,34 * * * *',      'SET statement_timeout=''60s''; SET lock_timeout=''3s''; SELECT public.meta_refresh_form_contexts() WHERE NOT public.db_under_pressure()'),
  ('meta-site-form-link',              '3,13,23,33,43,53 * * * *', 'SET statement_timeout=''60s''; SET lock_timeout=''3s''; SELECT public.meta_link_site_answers(true) WHERE NOT public.db_under_pressure()'),
  ('google-calendar-reconcile',        '1,16,31,46 * * * *', NULL),
  ('google-calendar-deliver',          NULL,                NULL),
  ('meta-lead-worker',                 NULL,                NULL),
  ('meta-insights-resume',             NULL,                NULL),
  ('meta-leads-reconciliation-hourly', NULL,                NULL),
  ('meta-insights-sync-frequent',      NULL,                NULL);

DO $cron$
DECLARE p record; j record; v_cmd text; v_sched text; v_changed jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RAISE NOTICE 'background_load_guards: pg_cron ausente, jobs nao alterados'; RETURN; END IF;
  FOR p IN SELECT * FROM bg_guard_plan ORDER BY jobname LOOP
    SELECT * INTO j FROM cron.job WHERE jobname = p.jobname;
    IF NOT FOUND THEN v_skipped := v_skipped || to_jsonb(p.jobname); CONTINUE; END IF;
    v_sched := coalesce(p.new_schedule, j.schedule);
    IF p.new_command IS NOT NULL THEN
      v_cmd := p.new_command;
    ELSIF j.command LIKE '%db_under_pressure%' THEN
      v_cmd := j.command;
    ELSIF j.command ~* '\mWHERE\M' THEN
      v_cmd := regexp_replace(j.command, '\s*;?\s*$', '') || ' AND NOT public.db_under_pressure();';   -- jobs net.http_post: todos terminam num WHERE ... ;
    ELSE
      v_skipped := v_skipped || to_jsonb(p.jobname || ' (comando sem WHERE)'); CONTINUE;
    END IF;
    IF v_sched IS DISTINCT FROM j.schedule OR v_cmd IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(job_id := j.jobid, schedule := v_sched, command := v_cmd);
      v_changed := v_changed || to_jsonb(p.jobname);
    END IF;
  END LOOP;
  RAISE NOTICE 'background_load_guards: alterados % ; ignorados %', v_changed, v_skipped;
END $cron$;

-- A API (PostgREST) usa transacoes de milissegundos; uma "idle in transaction" por mais de 20 s e cliente morto/rede cortada e prende uma das ~10 conexoes do pool.
DO $role$
BEGIN
  EXECUTE 'ALTER ROLE authenticator SET idle_in_transaction_session_timeout = ''20s''';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'background_load_guards: nao consegui ajustar o papel authenticator (%): rode "alter role authenticator set idle_in_transaction_session_timeout = ''20s''" no SQL Editor', SQLERRM;
END $role$;

COMMIT;
