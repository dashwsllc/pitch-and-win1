-- Politicas de acesso (RLS) que chamam funcoes de acesso A CADA LINHA passam a chama-las UMA VEZ POR CONSULTA.
--
-- Por que: as funcoes dashboard_account_active(), crm_has_access(), is_executive(auth.uid()) e afins sao STABLE + SECURITY DEFINER (nao podem ser embutidas
-- pelo planejador) e estavam "soltas" nas politicas: 173 chamadas em 54 tabelas. O Postgres avalia TODAS as politicas permissivas por linha, entao listar 1.000
-- leads chamava essas funcoes ~3.000 vezes (cada chamada roda uma consulta) e a lista levava ~300 ms numa instancia Nano; a tela de auditoria de trafego
-- (17 mil linhas, atualizada a cada 30 s em cada aba aberta) levava 3-4 s. Com varias abas atualizando juntas isso esgota o pool de 10 conexoes da API.
-- Embrulhar em (SELECT fn()) vira um InitPlan: o resultado e calculado uma vez e reaproveitado, com a MESMA semantica (funcoes STABLE que so dependem da
-- sessao). E o ajuste "auth_rls_initplan" recomendado pela Supabase.
--
-- Seguranca da mudanca:
--  * so reescreve chamadas de zero argumentos / auth.uid() / constante, de uma lista fechada, e so se a funcao NAO for VOLATILE;
--  * o que ja esta embrulhado fica como esta (reaplicar nao muda nada);
--  * isolamento REPEATABLE READ: dados que outras pessoas gravam durante a execucao nao aparecem na comparacao;
--  * antes de alterar, grava o que cada tipo de usuario (um por papel + um sem papel) ENXERGA em cada tabela afetada; depois de alterar, confere que e
--    IDENTICO (contagem e hash das linhas). Se qualquer diferenca aparecer, a migration inteira e desfeita;
--  * ALTER POLICY pede bloqueio exclusivo da tabela: cada tentativa espera no maximo 0,8 s e, se a tabela estiver ocupada (consulta longa em andamento),
--    as politicas dela sao PULADAS e listadas no relatorio ("ocupadas"); basta rodar de novo depois (e idempotente). Nada fica esperando na fila de ninguem.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '90s';

CREATE TEMP TABLE rls_wrap_report(k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

-- Lista fechada das chamadas que podem ser embrulhadas (formas exatas que o Postgres escreve nas politicas).
CREATE OR REPLACE FUNCTION pg_temp.rls_call_re() RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT '(?:dashboard_account_active\(\)|crm_has_access\(\)|traffic_has_access\(\)|registration_has_access\(\)|meta_lead_inbox_access\(\)|arena_has_access\((?:true)?\)|is_executive\(auth\.uid\(\)\)|is_super_admin\(auth\.uid\(\)\)|get_user_role\(auth\.uid\(\)\)|crm_can\(''[a-z_]+''::text\))'
$f$;

-- 1) marca o que ja esta como "SELECT fn()"; 2) embrulha o resto; 3) tira a marca. Entrada/saida NULL fica NULL.
CREATE OR REPLACE FUNCTION pg_temp.rls_wrap(e text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT replace(
           regexp_replace(
             regexp_replace(e, '(select\s+)(' || pg_temp.rls_call_re() || ')', '\1zzwrapzz\2', 'gi'),
             '([^A-Za-z0-9_.]|^)(' || pg_temp.rls_call_re() || ')', '\1(SELECT \2)', 'g'),
           'zzwrapzz', '')
$f$;

-- Politicas que mudam.
CREATE TEMP TABLE rls_wrap_todo ON COMMIT DROP AS
SELECT n.nspname AS sch, c.relname AS rel, p.polname,
       pg_get_expr(p.polqual, p.polrelid) AS q,      pg_temp.rls_wrap(pg_get_expr(p.polqual, p.polrelid)) AS nq,
       pg_get_expr(p.polwithcheck, p.polrelid) AS wc, pg_temp.rls_wrap(pg_get_expr(p.polwithcheck, p.polrelid)) AS nwc
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public';
DELETE FROM rls_wrap_todo WHERE nq IS NOT DISTINCT FROM q AND nwc IS NOT DISTINCT FROM wc;

-- Prova ESTRUTURAL (deterministica): tirando os embrulhos "(SELECT fn())", o texto novo tem que ser IGUAL ao original, em todas as politicas. Ou seja, a reescrita so
-- acrescentou embrulho em torno das chamadas da lista fechada, nada mais. Vale para todas as tabelas, inclusive as grandes demais para a comparacao de dados abaixo.
CREATE OR REPLACE FUNCTION pg_temp.rls_unwrap(e text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(e, '\(\s*SELECT\s+(' || pg_temp.rls_call_re() || ')(?:\s+AS\s+[A-Za-z_0-9]+)?\s*\)', '\1', 'gi')
$f$;
DO $struct$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(rel || '.' || polname, ', ') INTO v_bad FROM rls_wrap_todo
   WHERE pg_temp.rls_unwrap(nq) IS DISTINCT FROM pg_temp.rls_unwrap(q) OR pg_temp.rls_unwrap(nwc) IS DISTINCT FROM pg_temp.rls_unwrap(wc);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS_ESTRUTURA: a reescrita mudou mais do que o embrulho em: %', left(v_bad, 300) USING ERRCODE = '55000';
  END IF;
END $struct$;

-- Tabelas "quentes": TODA funcao de acesso le profiles / user_roles / registration_requests, entao ALTER POLICY nelas (bloqueio exclusivo) pararia o app inteiro por instantes,
-- e sao minusculas (nao ganham nada). Ficam adiadas; para incluir, numa janela tranquila: SET LOCAL app.rls_include_hot = 'on' (o script apply-rls-initplan-migration.mjs faz isso
-- com RLS_INCLUDE_HOT=1).
CREATE TEMP TABLE rls_wrap_deferred ON COMMIT DROP AS
SELECT rel, polname FROM rls_wrap_todo WHERE rel IN ('profiles', 'user_roles', 'registration_requests') AND coalesce(current_setting('app.rls_include_hot', true), 'off') <> 'on';
DELETE FROM rls_wrap_todo t USING rls_wrap_deferred d WHERE t.rel = d.rel AND t.polname = d.polname;

-- Quem e o que sera comparado: um usuario por papel (+ um sem papel nenhum) x tabelas afetadas legiveis pelo papel "authenticated" (ate 30 mil linhas).
-- Por papel, o usuario com MENOS papeis (fica mais "puro"), sem repetir a mesma pessoa.
CREATE TEMP TABLE rls_wrap_principals ON COMMIT DROP AS
SELECT DISTINCT ON (s.uid) s.uid, s.papel FROM (
  SELECT DISTINCT ON (r.role) r.user_id AS uid, r.role::text AS papel
    FROM public.user_roles r ORDER BY r.role, (SELECT count(*) FROM public.user_roles x WHERE x.user_id = r.user_id), r.user_id) s
 ORDER BY s.uid;
INSERT INTO rls_wrap_principals VALUES ('00000000-0000-4000-8000-0000000000aa', 'sem_papel');

CREATE TEMP TABLE rls_wrap_tables ON COMMIT DROP AS
SELECT DISTINCT t.sch, t.rel, c.reltuples::bigint AS aprox
  FROM rls_wrap_todo t JOIN pg_class c ON c.oid = format('%I.%I', t.sch, t.rel)::regclass
 WHERE has_table_privilege('authenticated', format('%I.%I', t.sch, t.rel), 'SELECT') AND c.reltuples <= 10000;   -- as maiores ficam so com a prova estrutural (ler 17 mil linhas x 11 usuarios pesaria no banco)

CREATE TEMP TABLE rls_wrap_snap(fase text, uid uuid, tbl text, n bigint, h text, ms numeric) ON COMMIT DROP;

-- Le cada tabela como cada usuario (papel authenticated + JWT simulado). Contagem cronometrada (mede o custo da politica) e hash das linhas (<= 3 mil).
-- O papel "authenticated" nao enxerga as tabelas temporarias do postgres: so a leitura em si roda com ele; listas e gravacao do resultado ficam fora.
CREATE OR REPLACE FUNCTION pg_temp.rls_wrap_snapshot(p_fase text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE pr record; tb record; t0 timestamptz; v_n bigint; v_h text; v_ms numeric; v_full text;
BEGIN
  FOR pr IN SELECT uid FROM rls_wrap_principals ORDER BY uid LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pr.uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', pr.uid::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    FOR tb IN SELECT * FROM rls_wrap_tables ORDER BY sch, rel LOOP
      v_full := format('%I.%I', tb.sch, tb.rel);
      EXECUTE 'SET LOCAL ROLE authenticated';
      BEGIN
        t0 := clock_timestamp();
        EXECUTE format('SELECT count(*) FROM %s', v_full) INTO v_n;
        v_ms := round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 2);
        IF tb.aprox <= 3000 THEN
          EXECUTE format('SELECT md5(coalesce(string_agg(t::text, '','' ORDER BY t::text), '''')) FROM %s t', v_full) INTO v_h;
        ELSE v_h := 'so_contagem'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN v_n := -1; v_h := 'sem_permissao'; v_ms := 0;
      END;
      EXECUTE 'RESET ROLE';
      INSERT INTO rls_wrap_snap VALUES (p_fase, pr.uid, v_full, v_n, v_h, v_ms);
    END LOOP;
  END LOOP;
END $f$;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.provolatile = 'v'
             AND p.proname IN ('dashboard_account_active', 'crm_has_access', 'traffic_has_access', 'registration_has_access', 'meta_lead_inbox_access',
                               'arena_has_access', 'is_executive', 'is_super_admin', 'get_user_role', 'crm_can')) THEN
    RAISE EXCEPTION 'Uma funcao de acesso e VOLATILE: embrulhar em (SELECT ...) mudaria o resultado; revise antes' USING ERRCODE = '55000';
  END IF;
END $guard$;

SELECT pg_temp.rls_wrap_snapshot('antes');

DO $apply$
DECLARE r record; v_sql text; v_n int := 0; v_busy text[] := '{}'; v_busy_tables text[] := '{}';
BEGIN
  PERFORM set_config('lock_timeout', '800ms', true);   -- ALTER POLICY pede bloqueio exclusivo: espera pouco e desiste (nao segura a fila de ninguem)
  FOR r IN SELECT * FROM rls_wrap_todo ORDER BY sch, rel, polname LOOP
    IF (r.sch || '.' || r.rel) = ANY (v_busy_tables) THEN v_busy := v_busy || (r.rel || '.' || r.polname); CONTINUE; END IF;
    v_sql := format('ALTER POLICY %I ON %I.%I', r.polname, r.sch, r.rel)
      || CASE WHEN r.nq IS DISTINCT FROM r.q THEN ' USING (' || r.nq || ')' ELSE '' END
      || CASE WHEN r.nwc IS DISTINCT FROM r.wc THEN ' WITH CHECK (' || r.nwc || ')' ELSE '' END;
    BEGIN
      EXECUTE v_sql;
      v_n := v_n + 1;
    EXCEPTION WHEN lock_not_available THEN
      v_busy := v_busy || (r.rel || '.' || r.polname);
      v_busy_tables := v_busy_tables || (r.sch || '.' || r.rel);
    END;
  END LOOP;
  INSERT INTO rls_wrap_report VALUES ('politicas', to_jsonb(v_n));
  INSERT INTO rls_wrap_report VALUES ('ocupadas', to_jsonb(coalesce(array_length(v_busy, 1), 0)));
  INSERT INTO rls_wrap_report VALUES ('adiadas_tabelas_quentes', to_jsonb((SELECT count(*) FROM rls_wrap_deferred)));
  IF cardinality(v_busy) > 0 THEN
    INSERT INTO rls_wrap_report VALUES ('tabelas_ocupadas', to_jsonb(v_busy_tables[1:6]));
    RAISE NOTICE 'rls_initplan: % politica(s) puladas por tabela ocupada (rode de novo): %', cardinality(v_busy), left(array_to_string(v_busy, ', '), 300);
  END IF;
END $apply$;

SELECT pg_temp.rls_wrap_snapshot('depois');

DO $verify$
DECLARE v_bad text; v_expected int; v_a int; v_d int;
BEGIN
  SELECT count(*) INTO v_a FROM rls_wrap_snap WHERE fase = 'antes';
  SELECT count(*) INTO v_d FROM rls_wrap_snap WHERE fase = 'depois';
  v_expected := (SELECT count(*) FROM rls_wrap_principals) * (SELECT count(*) FROM rls_wrap_tables);
  IF v_a <> v_expected OR v_d <> v_expected THEN
    RAISE EXCEPTION 'RLS_EQUIVALENCIA: comparacao incompleta (esperado %, antes %, depois %)', v_expected, v_a, v_d USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(a.tbl || ' como ' || a.uid::text || ' (' || a.n || ' -> ' || d.n || ')', '; ') INTO v_bad
    FROM rls_wrap_snap a JOIN rls_wrap_snap d ON d.fase = 'depois' AND d.uid = a.uid AND d.tbl = a.tbl
   WHERE a.fase = 'antes' AND (a.n, a.h) IS DISTINCT FROM (d.n, d.h)
     -- unica diferenca aceita: ANTES dava erro de permissao (nada visivel) e DEPOIS enxerga 0 linhas (nada visivel). Acontece com conta suspensa: get_user_role()
     -- lanca "Acesso nao autorizado" e, solta, o planejador a executa ja no PLANEJAMENTO (erro ate em tabela vazia); embrulhada, so roda se houver linha a avaliar.
     -- Erro -> linhas visiveis (ganho de acesso) e qualquer outra mudanca continuam reprovando.
     AND NOT (a.n = -1 AND d.n = 0);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS_EQUIVALENCIA_FALHOU: alguem passaria a enxergar algo diferente: %', left(v_bad, 600) USING ERRCODE = '55000';
  END IF;
  INSERT INTO rls_wrap_report VALUES ('comparacoes', to_jsonb(v_expected));
  INSERT INTO rls_wrap_report
  SELECT 'ms_por_tabela', coalesce(jsonb_object_agg(rel, jsonb_build_array(ms_antes, ms_depois)), '{}'::jsonb)
    FROM (SELECT split_part(tbl, '.', 2) AS rel,
                 round(sum(ms) FILTER (WHERE fase = 'antes'))::int AS ms_antes, round(sum(ms) FILTER (WHERE fase = 'depois'))::int AS ms_depois
            FROM rls_wrap_snap GROUP BY tbl ORDER BY sum(ms) FILTER (WHERE fase = 'antes') DESC NULLS LAST LIMIT 7) x;
END $verify$;

-- Funcoes temporarias vivem ate o fim da SESSAO (nao da transacao): limpa para a migration poder rodar de novo na mesma conexao.
DROP FUNCTION pg_temp.rls_wrap_snapshot(text);
DROP FUNCTION pg_temp.rls_unwrap(text);
DROP FUNCTION pg_temp.rls_wrap(text);
DROP FUNCTION pg_temp.rls_call_re();

COMMIT;
