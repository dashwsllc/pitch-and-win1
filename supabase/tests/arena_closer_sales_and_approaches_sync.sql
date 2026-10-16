-- Roda dentro de uma transação e termina sempre em ROLLBACK (scripts/check-arena-closer-approach-sync-db.mjs): nada é gravado.
-- Verifica que a Arena, o Dashboard, o Executive e os Rankings contam vendas de Closer e abordagens do mesmo jeito:
--   A) vendas de Closer: toda venda de Closer do período tem dono no ranking e na meta semanal (inclusive Super Admin),
--      e a soma do ranking é a soma dos fatos de venda;
--   B) abordagens: o número por pessoa e o total do período são os mesmos na tabela, no ranking de SDRs, no ranking de
--      Closers, nas métricas da Arena e na Visão geral;
--   C) o fluxo real: cadastrar, abordar e reabordar um lead grava uma linha por abordagem, com a data do evento da Arena.
SELECT set_config('request.jwt.claim.sub', (
  SELECT r.user_id::text FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.role::text = 'super_admin' AND NOT p.suspended LIMIT 1
), true);

-- ------------------------------------------------------------------------------------------------ A) vendas de Closer
DO $$
DECLARE
  v_ms timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_me timestamptz := (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
  v_ws timestamptz := date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_we timestamptz := (date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') + interval '7 days') AT TIME ZONE 'America/Sao_Paulo';
  v_ranking jsonb; v_members jsonb; v_cycle public.goal_cycles; v_n integer; v_rank numeric; v_fatos numeric; v_qtd integer; v_u uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem Super Admin ativo para a verificação'; END IF;

  -- A1) Ranking do mês (sem crédito semanal): todo dono de venda de Closer aparece e a soma é a dos fatos.
  v_ranking := public.arena_team_ranking(v_ms, v_me, false);
  SELECT count(*) INTO v_n FROM public.arena_closer_weekly_sale_facts f
   WHERE f.occurred_at >= v_ms AND f.occurred_at < v_me
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = f.user_id AND p.arena_hidden)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ranking) x WHERE (x->>'user_id')::uuid = f.user_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % vendas de Closer do mês sem dono no ranking', v_n; END IF;
  SELECT COALESCE(sum((x->>'totalVendas')::numeric), 0), COALESCE(sum((x->>'quantidadeVendas')::integer), 0)
    INTO v_rank, v_qtd FROM jsonb_array_elements(v_ranking) x;
  SELECT COALESCE(sum(f.revenue), 0), count(*) INTO v_fatos, v_n FROM public.arena_closer_weekly_sale_facts f
   WHERE f.occurred_at >= v_ms AND f.occurred_at < v_me
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = f.user_id AND p.arena_hidden);
  IF v_rank <> v_fatos OR v_qtd <> v_n THEN
    RAISE EXCEPTION 'FAIL ranking do mês: % vendas / R$ %, fatos de venda de Closer: % / R$ %', v_qtd, v_rank, v_n, v_fatos; END IF;

  -- A2) Ranking da semana (domingo conta na segunda): mesma conta com o crédito semanal.
  v_ranking := public.arena_team_ranking(v_ws, v_we, true);
  SELECT COALESCE(sum((x->>'totalVendas')::numeric), 0), COALESCE(sum((x->>'quantidadeVendas')::integer), 0)
    INTO v_rank, v_qtd FROM jsonb_array_elements(v_ranking) x;
  SELECT COALESCE(sum(f.revenue), 0), count(*) INTO v_fatos, v_n FROM public.arena_closer_weekly_sale_facts f
   WHERE f.weekly_credit_at >= v_ws AND f.weekly_credit_at < v_we
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = f.user_id AND p.arena_hidden);
  IF v_rank <> v_fatos OR v_qtd <> v_n THEN
    RAISE EXCEPTION 'FAIL ranking da semana: % vendas / R$ %, fatos: % / R$ %', v_qtd, v_rank, v_n, v_fatos; END IF;

  -- A3) Meta semanal dos Closers: todo dono de venda creditada no ciclo aberto é membro da meta.
  SELECT c.* INTO v_cycle FROM public.goal_cycles c JOIN public.company_goals g ON g.id = c.goal_id
   WHERE g.scope = 'role' AND g.target_role = 'closer' AND g.period = 'weekly' AND g.enabled
     AND c.closed_at IS NULL AND c.starts_at <= now() AND c.ends_at > now() ORDER BY c.starts_at DESC LIMIT 1;
  IF v_cycle.id IS NOT NULL THEN
    v_members := public.arena_cycle_result(v_cycle.id)->'members';
    SELECT count(*) INTO v_n FROM (SELECT DISTINCT f.user_id FROM public.arena_closer_weekly_sale_facts f
       WHERE f.weekly_credit_at >= v_cycle.starts_at AND f.weekly_credit_at < v_cycle.ends_at
         AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = f.user_id AND p.arena_hidden)) d
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_members) m WHERE (m->>'user_id')::uuid = d.user_id);
    IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % donos de venda do ciclo fora da meta semanal dos Closers', v_n; END IF;
  END IF;

  -- A4) A regra antiga continua para quem não vendeu: Super Admin sem exceção e sem venda na janela não aparece.
  SELECT p.user_id INTO v_u FROM public.profiles p
   WHERE NOT p.arena_hidden AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id AND r.role::text = 'super_admin')
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id AND r.role::text = 'closer')
     AND NOT public.arena_closer_exception(p.user_id) LIMIT 1;
  IF v_u IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.arena_team_ranking('2020-01-01', '2020-02-01', false)) x WHERE x->>'user_id' = v_u::text) THEN
    RAISE EXCEPTION 'FAIL Super Admin sem venda e sem exceção apareceu no ranking de Closers'; END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------ B) abordagens
DO $$
DECLARE
  w record; r record; v_tabela integer; v_total integer; v_n integer;
BEGIN
  FOR w IN SELECT * FROM (VALUES
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo', now()),
      (now() - interval '7 days', now()),
      (now() - interval '30 days', now()),
      (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo', now())
    ) AS t(s, e) LOOP
    SELECT count(*) INTO v_total FROM public.abordagens a WHERE a.created_at >= w.s AND a.created_at < w.e;
    -- Ranking de SDRs, por pessoa.
    FOR r IN SELECT (x->>'user_id')::uuid uid, (x->>'abordagens')::integer n FROM jsonb_array_elements(public.arena_sdr_ranking(w.s, w.e)) x LOOP
      SELECT count(*) INTO v_tabela FROM public.abordagens a WHERE a.user_id = r.uid AND a.created_at >= w.s AND a.created_at < w.e;
      IF v_tabela <> r.n THEN RAISE EXCEPTION 'FAIL ranking de SDRs % x tabela % (usuário %, janela % a %)', r.n, v_tabela, r.uid, w.s, w.e; END IF;
    END LOOP;
    -- Ranking de Closers, por pessoa.
    FOR r IN SELECT (x->>'user_id')::uuid uid, (x->>'abordagens')::integer n FROM jsonb_array_elements(public.arena_team_ranking(w.s, w.e, false)) x LOOP
      SELECT count(*) INTO v_tabela FROM public.abordagens a WHERE a.user_id = r.uid AND a.created_at >= w.s AND a.created_at < w.e;
      IF v_tabela <> r.n THEN RAISE EXCEPTION 'FAIL ranking de Closers % x tabela % (usuário %)', r.n, v_tabela, r.uid; END IF;
    END LOOP;
    -- Métricas da Arena e Visão geral: o total do período.
    IF (public.arena_period_metrics(w.s, w.e)->>'approaches')::integer <> v_total THEN
      RAISE EXCEPTION 'FAIL métricas da Arena % x tabela %', public.arena_period_metrics(w.s, w.e)->>'approaches', v_total; END IF;
    SELECT count(*) INTO v_n FROM public.dashboard_home_approaches(w.s, w.e);
    IF v_n <> v_total THEN RAISE EXCEPTION 'FAIL Visão geral % x tabela %', v_n, v_total; END IF;
  END LOOP;

  -- Cada evento de reabordagem tem exatamente uma linha, com a mesma data e a mesma pessoa.
  SELECT count(*) INTO v_n FROM public.activity_feed f JOIN public.crm_leads l ON l.id = f.source_id
   WHERE f.action_type = 'lead.approached' AND f.source_type = 'crm_leads' AND f.event_key NOT LIKE '%:registered'
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = f.responsible_id)
     AND (SELECT count(*) FROM public.abordagens a WHERE a.crm_lead_id = l.id AND a.crm_event_key = f.event_key
            AND a.created_at = f.occurred_at AND a.user_id = f.responsible_id) <> 1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % eventos de reabordagem sem exatamente uma linha igual em abordagens', v_n; END IF;
  -- Continua uma linha de cadastro por lead.
  SELECT count(*) INTO v_n FROM (SELECT crm_lead_id FROM public.abordagens
    WHERE crm_lead_id IS NOT NULL AND crm_event_key IS NULL GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % leads com mais de uma linha de cadastro', v_n; END IF;
END $$;

-- ----------------------------------------------------------------------------------------------- C) o fluxo do CRM
INSERT INTO auth.users(id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
VALUES ('a51c0000-0000-4000-8000-000000000001', 'sync-qa-1@example.invalid', jsonb_build_object('display_name', 'Sync QA SDR'), '{}', now(), now());
UPDATE public.registration_requests SET status = 'approved', reviewed_at = clock_timestamp()
 WHERE user_id = 'a51c0000-0000-4000-8000-000000000001';
DELETE FROM public.user_roles WHERE user_id = 'a51c0000-0000-4000-8000-000000000001';
INSERT INTO public.user_roles(user_id, role, crm_access) VALUES ('a51c0000-0000-4000-8000-000000000001', 'sdr', true);
CREATE TEMP TABLE sync_qa(label text PRIMARY KEY, lead_id uuid, antes bigint);
GRANT ALL ON sync_qa TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"a51c0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  l public.crm_leads; v_antes bigint; v_depois bigint; v_eventos integer; v_linhas integer; v_row public.abordagens; v_evento public.activity_feed;
BEGIN
  SELECT count(*) INTO v_antes FROM public.dashboard_home_approaches();
  INSERT INTO public.crm_leads(name, athlete_name, phone) VALUES ('Lead Sync QA', 'Atleta Sync QA', '11999990101') RETURNING * INTO l;
  INSERT INTO sync_qa(label, lead_id, antes) VALUES ('lead', l.id, v_antes);
  -- Cadastro: uma linha, sem chave de evento.
  SELECT count(*) INTO v_linhas FROM public.abordagens WHERE crm_lead_id = l.id AND crm_event_key IS NULL;
  IF v_linhas <> 1 THEN RAISE EXCEPTION 'FAIL cadastro gerou % linhas, esperado 1', v_linhas; END IF;

  -- Primeira abordagem: um evento e uma linha, com a data e a pessoa do evento.
  l := public.crm_transition(l.id, 'approach', l.version, '{"stage":"abordado"}');
  SELECT count(*) INTO v_eventos FROM public.activity_feed WHERE action_type = 'lead.approached' AND source_id = l.id AND event_key NOT LIKE '%:registered';
  SELECT count(*) INTO v_linhas FROM public.abordagens WHERE crm_lead_id = l.id AND crm_event_key IS NOT NULL;
  IF v_eventos <> 1 OR v_linhas <> 1 THEN RAISE EXCEPTION 'FAIL primeira abordagem: % eventos e % linhas, esperado 1 e 1', v_eventos, v_linhas; END IF;
  SELECT * INTO v_row FROM public.abordagens WHERE crm_lead_id = l.id AND crm_event_key IS NOT NULL;
  SELECT * INTO v_evento FROM public.activity_feed WHERE event_key = v_row.crm_event_key;
  IF v_evento.id IS NULL OR v_row.created_at <> v_evento.occurred_at OR v_row.user_id <> 'a51c0000-0000-4000-8000-000000000001'
     OR v_row.tempo_medio_abordagem <> 1 OR v_row.mostrou_ia OR v_row.visao_geral <> 'Reabordagem registrada no CRM' THEN
    RAISE EXCEPTION 'FAIL linha da abordagem diferente do evento: % x %', to_jsonb(v_row), to_jsonb(v_evento); END IF;

  -- Segunda abordagem (reabordagem): mais um evento e mais uma linha.
  l := public.crm_transition(l.id, 'approach', l.version, '{"stage":"reabordado"}');
  SELECT count(*) INTO v_linhas FROM public.abordagens WHERE crm_lead_id = l.id AND crm_event_key IS NOT NULL;
  IF v_linhas <> 2 THEN RAISE EXCEPTION 'FAIL reabordagem: % linhas, esperado 2', v_linhas; END IF;

  -- Editar o lead não cria abordagem.
  PERFORM public.crm_transition(l.id, 'edit', l.version, '{"name":"Lead Sync QA editado","athlete_name":"Atleta Sync QA","phone":"11999990101"}');
  SELECT count(*) INTO v_linhas FROM public.abordagens WHERE crm_lead_id = l.id;
  IF v_linhas <> 3 THEN RAISE EXCEPTION 'FAIL após editar: % linhas, esperado 3 (cadastro + 2 abordagens)', v_linhas; END IF;

  -- Visão geral: o cadastro e as duas abordagens somam 3.
  SELECT count(*) INTO v_depois FROM public.dashboard_home_approaches();
  IF v_depois <> v_antes + 3 THEN RAISE EXCEPTION 'FAIL Visão geral contou % (antes %), esperado +3', v_depois, v_antes; END IF;
END $$;
RESET ROLE;

-- O ranking de SDRs e o Dashboard enxergam as 3 do SDR do teste, e excluir o lead leva todas as linhas junto.
DO $$
DECLARE v_lead uuid := (SELECT lead_id FROM sync_qa WHERE label = 'lead'); v_n integer;
BEGIN
  SELECT COALESCE((SELECT (x->>'abordagens')::integer FROM jsonb_array_elements(public.arena_sdr_ranking(now() - interval '1 hour', now() + interval '1 hour')) x
     WHERE x->>'user_id' = 'a51c0000-0000-4000-8000-000000000001'), 0) INTO v_n;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FAIL ranking de SDRs contou % abordagens do SDR do teste, esperado 3', v_n; END IF;
  SELECT COALESCE((SELECT (x->>'abordagens')::integer FROM jsonb_array_elements(public.get_sdr_ranking()) x
     WHERE x->>'user_id' = 'a51c0000-0000-4000-8000-000000000001'), 0) INTO v_n;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FAIL Ranking (sem período) contou % abordagens do SDR do teste, esperado 3', v_n; END IF;
  DELETE FROM public.crm_leads WHERE id = v_lead;
  IF EXISTS (SELECT 1 FROM public.abordagens WHERE crm_lead_id = v_lead) THEN RAISE EXCEPTION 'FAIL linhas sobraram depois de excluir o lead'; END IF;
END $$;
