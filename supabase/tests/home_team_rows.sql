-- Roda dentro de uma transação e termina sempre em ROLLBACK (scripts/check-home-team-rows-db.mjs): nada é gravado.
-- Verifica que a Visão geral lê o time todo por funções restritas, para quem não é Executive também.

-- 1) Os números esperados, calculados como dono do banco (sem RLS), e a conta de teste: ativa, aprovada, SEM papel Executive.
SELECT set_config('t.vendas', (SELECT count(*) FROM public.vendas WHERE approval_status = 'aprovada')::text, true);
SELECT set_config('t.vendas_janela', (SELECT count(*) FROM public.vendas WHERE approval_status = 'aprovada'
  AND created_at >= now() - interval '30 days' AND created_at < now() + interval '1 day')::text, true);
SELECT set_config('t.tardias', (SELECT count(*) FROM public.vendas WHERE approval_status = 'aprovada'
  AND reviewed_at >= now() - interval '10 days' AND reviewed_at < now() + interval '1 day'
  AND created_at < now() - interval '10 days')::text, true);
SELECT set_config('t.abordagens', (SELECT count(*) FROM public.abordagens)::text, true);
SELECT set_config('t.calls', (SELECT count(*) FROM public.crm_activities
  WHERE call_type IN ('qualificacao', 'fechamento_closer') AND is_completed AND cancelled_at IS NULL)::text, true);
SELECT set_config('request.jwt.claim.sub', (
  SELECT p.user_id::text FROM public.profiles p
  WHERE NOT p.suspended
    AND EXISTS (SELECT 1 FROM public.registration_requests r WHERE r.user_id = p.user_id AND r.status = 'approved')
    AND NOT public.is_executive(p.user_id)
  ORDER BY (SELECT count(*) FROM public.vendas v WHERE v.user_id = p.user_id) DESC LIMIT 1
), true);
SELECT set_config('t.suspenso', COALESCE((
  SELECT p.user_id::text FROM public.profiles p WHERE p.suspended LIMIT 1
), ''), true);
SELECT set_config('t.pendente', COALESCE((
  SELECT p.user_id::text FROM public.profiles p
  WHERE NOT p.suspended AND NOT EXISTS (SELECT 1 FROM public.registration_requests r WHERE r.user_id = p.user_id AND r.status = 'approved')
  LIMIT 1
), ''), true);

-- 2) A partir daqui a sessão é a de uma conta comum do app (papel authenticated, com RLS).
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_user uuid := auth.uid();
  v_visiveis_vendas bigint;
  v_visiveis_abordagens bigint;
  v_n bigint;
  v_n2 bigint;
  v_sql_state text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Nenhuma conta comum ativa para o teste'; END IF;
  IF public.is_executive(v_user) THEN RAISE EXCEPTION 'A conta de teste não pode ser Executive'; END IF;

  -- a) Sem a função, a RLS entrega a essa conta só as linhas dela (é o que escondia o time).
  SELECT count(*) INTO v_visiveis_vendas FROM public.vendas WHERE approval_status = 'aprovada';
  SELECT count(*) INTO v_visiveis_abordagens FROM public.abordagens;

  -- b) Com as funções: o time todo.
  SELECT count(*) INTO v_n FROM public.dashboard_home_sales();
  IF v_n <> current_setting('t.vendas')::bigint THEN
    RAISE EXCEPTION 'dashboard_home_sales devolveu % vendas aprovadas, o time tem %', v_n, current_setting('t.vendas');
  END IF;
  IF v_visiveis_vendas > v_n THEN RAISE EXCEPTION 'A leitura direta não pode ver mais que a função'; END IF;

  SELECT count(*) INTO v_n FROM public.dashboard_home_approaches();
  IF v_n <> current_setting('t.abordagens')::bigint THEN
    RAISE EXCEPTION 'dashboard_home_approaches devolveu % abordagens, o time tem %', v_n, current_setting('t.abordagens');
  END IF;
  IF v_visiveis_abordagens > v_n THEN RAISE EXCEPTION 'A leitura direta não pode ver mais que a função'; END IF;

  SELECT count(*) INTO v_n FROM public.dashboard_home_calls();
  IF v_n <> current_setting('t.calls')::bigint THEN
    RAISE EXCEPTION 'dashboard_home_calls devolveu % calls, o time tem %', v_n, current_setting('t.calls');
  END IF;

  -- c) Janela de 30 dias e aprovações tardias (compradas antes da janela, aprovadas dentro dela).
  SELECT count(*) INTO v_n FROM public.dashboard_home_sales(now() - interval '30 days', now() + interval '1 day');
  IF v_n <> current_setting('t.vendas_janela')::bigint THEN
    RAISE EXCEPTION 'A janela de 30 dias devolveu % vendas, esperado %', v_n, current_setting('t.vendas_janela');
  END IF;
  SELECT count(*) INTO v_n FROM public.dashboard_home_sales(now() - interval '10 days', now() + interval '1 day', true);
  IF v_n <> current_setting('t.tardias')::bigint THEN
    RAISE EXCEPTION 'As aprovações tardias devolveram %, esperado %', v_n, current_setting('t.tardias');
  END IF;
  -- Nenhuma venda tardia entra também na lista normal da mesma janela.
  SELECT count(*) INTO v_n FROM public.dashboard_home_sales(now() - interval '10 days', now() + interval '1 day', true) t
    WHERE t.created_at >= now() - interval '10 days';
  IF v_n <> 0 THEN RAISE EXCEPTION 'Venda comprada dentro da janela não é aprovação tardia'; END IF;
  -- A busca tardia exige a janela inteira.
  BEGIN
    PERFORM * FROM public.dashboard_home_sales(NULL, NULL, true);
    RAISE EXCEPTION 'A busca tardia sem janela deveria falhar';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- d) Só aprovadas, e as calls só concluídas e não canceladas.
  IF EXISTS (SELECT 1 FROM public.dashboard_home_sales() s JOIN public.vendas v ON v.id = s.id WHERE v.approval_status <> 'aprovada') THEN
    RAISE EXCEPTION 'A função devolveu venda que não está aprovada';
  END IF;
  SELECT count(*) INTO v_n FROM public.dashboard_home_calls() c JOIN public.crm_activities a ON a.id = c.id
    WHERE NOT a.is_completed OR a.cancelled_at IS NOT NULL OR a.call_type NOT IN ('qualificacao', 'fechamento_closer');
  IF v_n <> 0 THEN RAISE EXCEPTION 'A função devolveu call que não conta como feita'; END IF;

  -- e) Conta suspensa e conta sem cadastro aprovado continuam sem nada.
  IF current_setting('t.suspenso') <> '' THEN
    PERFORM set_config('request.jwt.claim.sub', current_setting('t.suspenso'), true);
    BEGIN
      PERFORM * FROM public.dashboard_home_sales();
      RAISE EXCEPTION 'Conta suspensa leu as vendas do time';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
  IF current_setting('t.pendente') <> '' THEN
    PERFORM set_config('request.jwt.claim.sub', current_setting('t.pendente'), true);
    BEGIN
      PERFORM * FROM public.dashboard_home_approaches();
      RAISE EXCEPTION 'Conta sem cadastro aprovado leu as abordagens do time';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
END;
$$;

-- 3) Visitante sem login não executa nenhuma delas, e a lista de colunas não carrega dado do comprador.
RESET ROLE;
DO $$
DECLARE
  v_colunas text;
BEGIN
  IF has_function_privilege('anon', 'public.dashboard_home_sales(timestamptz, timestamptz, boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.dashboard_home_approaches(timestamptz, timestamptz)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.dashboard_home_calls(timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar as funções da Home';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.dashboard_home_sales(timestamptz, timestamptz, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated tem de executar as funções da Home';
  END IF;
  -- As colunas de saída (modo 't') de cada função, direto do catálogo.
  FOR v_colunas IN
    SELECT p.proname || ':' || string_agg(u.nome, ',' ORDER BY u.ordem)
    FROM pg_proc p
    CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS u(nome, modo, ordem)
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('dashboard_home_sales', 'dashboard_home_approaches', 'dashboard_home_calls')
      AND u.modo = 't'
    GROUP BY p.proname
  LOOP
    IF v_colunas ~* '(nome_comprador|email|whatsapp|user_id|lead_id|consideracoes|commission)' THEN
      RAISE EXCEPTION 'A função expõe dado que a Home não usa: %', v_colunas;
    END IF;
  END LOOP;
END;
$$;
