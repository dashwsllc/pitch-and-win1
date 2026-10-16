-- Arena, Dashboard, Executive e Rankings passam a contar vendas de Closer e abordagens do mesmo jeito.
--
-- 1) Vendas de Closer. A venda de um Super Admin que tem o papel de Closer já entrava no faturamento da Arena e no feed
--    "Closers · últimos movimentos" (arena_sale_facts a classifica como 'closer'), mas o ranking de Closers e a meta
--    semanal dos Closers excluíam todo Super Admin que não fosse exceção cadastrada. O resultado era uma tela que mostrava
--    R$ 3.267 de vendas de Closer no feed e só R$ 500 no ranking da mesma semana. Decisão do dono (2026-10-16): todo
--    Super Admin que tem venda de Closer na janela entra no ranking e na meta daquele ciclo. Sem venda na janela, a regra
--    antiga continua (só aparece se for exceção). Mudam arena_team_ranking(3) e arena_cycle_result.
--
-- 2) Abordagens. Havia duas contagens: a tabela abordagens (Home, Executive, Conversão da Arena, ranking de Closers: um
--    lead cadastrado = uma linha) e o CRM (ranking de SDRs, metas por turno do CRM: também cada reabordagem). Em 30 dias o
--    Pedro Iago aparecia com 41 numa e 76 na outra. Decisão do dono (2026-10-16): cadastros + reabordagens em todo lugar.
--    Como todas as telas já leem a tabela abordagens, a tabela passa a ter também uma linha por reabordagem:
--      * crm_event_key liga a linha ao evento lead.approached que a originou (NULL = linha de cadastro ou do formulário).
--        O índice único deixa de ser "um por lead" e passa a ser "um por lead e por evento": continua valendo uma linha de
--        cadastro por lead, e cada reabordagem tem a sua. Excluir o lead remove tudo (ON DELETE CASCADE).
--      * arena_approach_event grava a linha junto com o evento, com a mesma data do evento.
--      * O histórico entra pelo mesmo caminho: uma linha por evento de reabordagem já existente e, para os leads cujo
--        approach_count é maior que os eventos (aumentos de antes de a Arena registrar eventos), as linhas que faltam, na
--        data do primeiro contato, que é onde o ranking de SDRs já as contava. Rodar de novo não duplica nada.
--      * arena_sdr_ranking e get_sdr_ranking() passam a ler a mesma tabela, então o número deles é o do Dashboard.
--
-- Os corpos das funções abaixo partem do que está em produção em 2026-10-16 (as migrações antigas do repositório já
-- estavam defasadas: não tinham as exceções de Closer/SDR). Só mudam as linhas marcadas com "-- SYNC".
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2a) Tabela: uma linha por reabordagem
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.abordagens ADD COLUMN IF NOT EXISTS crm_event_key text;
COMMENT ON COLUMN public.abordagens.crm_event_key IS
  'Chave do evento lead.approached do CRM que originou a linha (reabordagem). NULL: cadastro do lead (um por lead) ou formulário Nova abordagem.';
DROP INDEX IF EXISTS public.abordagens_crm_lead_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS abordagens_crm_lead_event_key
  ON public.abordagens (crm_lead_id, (COALESCE(crm_event_key, ''))) WHERE crm_lead_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2b) Cada aumento de approach_count grava o evento da Arena e a linha da tabela, com a mesma data.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arena_approach_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_previous integer; v_step integer; v_event uuid;
BEGIN
 IF TG_OP='INSERT' AND NEW.created_by IS NOT NULL AND COALESCE(NEW.lead_source,'')<>'meta_ads_form' THEN
   PERFORM public.arena_emit('lead.approached:'||NEW.id||':registered','lead.approached',COALESCE(NEW.sdr_id,NEW.created_by),'sdr',
     'crm_leads',NEW.id,NEW.created_at,0,0,NEW.id);
 END IF;
 v_previous:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.approach_count END;
 IF NEW.sdr_id IS NULL OR NEW.approach_count<=v_previous THEN RETURN NULL; END IF;
 FOR v_step IN 1..NEW.approach_count-v_previous LOOP
   v_event:=public.arena_emit('lead.approached:'||NEW.id||':'||NEW.version||':'||v_step,
     'lead.approached',NEW.sdr_id,'sdr','crm_leads',NEW.id,clock_timestamp(),0,0,NEW.id);
   -- SYNC: a tabela abordagens recebe a reabordagem junto com o evento (arena_emit devolve NULL se o evento já existia).
   IF v_event IS NOT NULL THEN
     INSERT INTO public.abordagens (user_id, nomes_abordados, dados_abordados, tempo_medio_abordagem, mostrou_ia, visao_geral, created_at, crm_lead_id, crm_event_key)
     SELECT NEW.sdr_id,
       left(COALESCE(NULLIF(btrim(NEW.name), ''), 'Lead'), 2000),
       left(COALESCE(NULLIF(concat_ws(' · ', 'Atleta ' || NULLIF(btrim(NEW.athlete_name), ''), NULLIF(btrim(NEW.phone), ''), NULLIF(btrim(NEW.email), '')), ''), 'Sem contato'), 5000),
       1, false, 'Reabordagem registrada no CRM', f.occurred_at, NEW.id, f.event_key
     FROM public.activity_feed f WHERE f.id=v_event
     ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 RETURN NULL;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2c) Histórico: eventos de reabordagem que já existem viram linhas.
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO public.abordagens (user_id, nomes_abordados, dados_abordados, tempo_medio_abordagem, mostrou_ia, visao_geral, created_at, crm_lead_id, crm_event_key)
SELECT f.responsible_id,
  left(COALESCE(NULLIF(btrim(l.name), ''), 'Lead'), 2000),
  left(COALESCE(NULLIF(concat_ws(' · ', 'Atleta ' || NULLIF(btrim(l.athlete_name), ''), NULLIF(btrim(l.phone), ''), NULLIF(btrim(l.email), '')), ''), 'Sem contato'), 5000),
  1, false, 'Reabordagem registrada no CRM', f.occurred_at, l.id, f.event_key
FROM public.activity_feed f
JOIN public.crm_leads l ON l.id = f.source_id
WHERE f.action_type = 'lead.approached' AND f.source_type = 'crm_leads' AND f.event_key NOT LIKE '%:registered'
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = f.responsible_id)
ON CONFLICT DO NOTHING;

-- Aumentos de approach_count de antes de existirem eventos: as linhas que faltam, na data do primeiro contato (a mesma
-- que o ranking de SDRs já usava para essas abordagens). A conta é a do ranking: approach_count menos todos os eventos
-- do lead (o de cadastro também), nunca abaixo de zero.
INSERT INTO public.abordagens (user_id, nomes_abordados, dados_abordados, tempo_medio_abordagem, mostrou_ia, visao_geral, created_at, crm_lead_id, crm_event_key)
SELECT l.sdr_id,
  left(COALESCE(NULLIF(btrim(l.name), ''), 'Lead'), 2000),
  left(COALESCE(NULLIF(concat_ws(' · ', 'Atleta ' || NULLIF(btrim(l.athlete_name), ''), NULLIF(btrim(l.phone), ''), NULLIF(btrim(l.email), '')), ''), 'Sem contato'), 5000),
  1, false, 'Reabordagem anterior ao registro por evento (histórico do CRM)',
  COALESCE(l.first_contact_at, l.approached_at, l.created_at), l.id, 'lead.approached:' || l.id || ':history:' || g.k
FROM public.crm_leads l
CROSS JOIN LATERAL (
  SELECT count(*)::integer n FROM public.activity_feed f
  WHERE f.action_type = 'lead.approached' AND f.source_type = 'crm_leads' AND f.source_id = l.id
) e
CROSS JOIN LATERAL generate_series(1, GREATEST(0, l.approach_count - e.n)) g(k)
WHERE l.sdr_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.sdr_id)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2d) Ranking de SDRs: abordagens vêm da tabela (a mesma do Dashboard). Leads abordados continuam contados no CRM.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arena_sdr_ranking(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v jsonb; v_cycle_id uuid; v_progress jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT c.id INTO v_cycle_id FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
   WHERE g.scope='role' AND g.target_role='sdr' AND g.period='daily'
   AND c.starts_at<=now() AND c.ends_at>now() AND c.closed_at IS NULL AND g.enabled
   ORDER BY c.starts_at DESC LIMIT 1;
 v_progress:=CASE WHEN v_cycle_id IS NOT NULL THEN COALESCE(public.arena_cycle_result(v_cycle_id)->'members','[]'::jsonb) ELSE '[]'::jsonb END;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.percent DESC NULLS LAST,x.repasses DESC,x.conversao DESC,x.abordagens DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'SDR') name,p.avatar_url AS "avatarUrl",p.suspended, public.arena_sdr_exception(p.user_id) AS "qualificationCallsDisabled",
 COALESCE(s.score,0)+COALESCE(adj.score,0) score,COALESCE(s.repasses,0) repasses,COALESCE(s.scheduled,0) scheduled,COALESCE(s.performed,0) performed,
 COALESCE(cancelled.cancelled,0) cancelled,COALESCE(s.no_handoff,0) no_handoff,COALESCE(ab.total,0) abordagens,
 COALESCE(a.leads_abordados,0) AS "leadsAbordados",
 CASE WHEN a.leads_abordados>0 THEN round(COALESCE(s.repasses,0)*100.0/a.leads_abordados,1) ELSE 0 END conversao,
 CASE WHEN m.value IS NOT NULL AND (m.value->>'target')::numeric>0 THEN (m.value->>'actual')::numeric/(m.value->>'target')::numeric ELSE NULL END percent
 FROM public.profiles p
 LEFT JOIN LATERAL(SELECT sum(score_delta) score,count(*) FILTER(WHERE action_type='closing.scheduled') repasses,
 count(*) FILTER(WHERE action_type='q.scheduled') scheduled,count(*) FILTER(WHERE action_type='q.performed') performed,
 count(*) FILTER(WHERE action_type='q.no_handoff') no_handoff
 FROM public.arena_counted_call_events WHERE responsible_id=p.user_id AND responsible_role='sdr' AND (action_type NOT LIKE 'q.%' OR NOT public.arena_sdr_exception(p.user_id)) AND occurred_at>=p_start AND occurred_at<p_end) s ON true
 LEFT JOIN LATERAL(SELECT sum(score_delta) score FROM public.activity_feed WHERE action_type='score.adjusted'
   AND responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) adj ON true
 LEFT JOIN LATERAL(SELECT count(*) cancelled FROM public.activity_feed WHERE action_type='call.cancelled'
   AND responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end) cancelled ON true
 -- SYNC: abordagens do período = linhas da tabela abordagens (cadastro + reabordagem + formulário), como no Dashboard.
 LEFT JOIN LATERAL(SELECT count(*) total FROM public.abordagens b
   WHERE b.user_id=p.user_id AND b.created_at>=p_start AND b.created_at<p_end) ab ON true
 LEFT JOIN LATERAL(
   SELECT count(*) FILTER(WHERE l.approach_stage IN ('abordado','reabordado') AND (
       (l.approach_count>COALESCE(e.all_events,0)
         AND COALESCE(l.first_contact_at,l.approached_at,l.created_at)>=p_start
         AND COALESCE(l.first_contact_at,l.approached_at,l.created_at)<p_end)
       OR COALESCE(e.period_events,0)>0)) leads_abordados
   FROM public.crm_leads l
   LEFT JOIN LATERAL(SELECT count(*) all_events,
     count(*) FILTER(WHERE f.occurred_at>=p_start AND f.occurred_at<p_end) period_events
     FROM public.activity_feed f WHERE f.action_type='lead.approached'
       AND f.source_type='crm_leads' AND f.source_id=l.id) e ON true
   WHERE l.sdr_id=p.user_id
 ) a ON true
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(v_progress) value WHERE (value->>'user_id')=p.user_id::text LIMIT 1) m ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='sdr')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='sdr' AND occurred_at>=p_start AND occurred_at<p_end))
 AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin') OR public.arena_sdr_exception(p.user_id))
 ) x;
 RETURN v;
END $function$;

-- Ranking da página Ranking (sem período): abordagens da mesma tabela. Leads, abordados, repasses e vendas originadas
-- seguem vindo do CRM.
CREATE OR REPLACE FUNCTION public.get_sdr_ranking()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();

  SELECT COALESCE(
    jsonb_agg(x ORDER BY x.repasses DESC, x.conversao DESC, x.abordagens DESC, x.name, x.user_id),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      p.user_id,
      COALESCE(p.display_name, 'SDR') AS name,
      p.avatar_url AS "avatarUrl",
      COALESCE(c.total_leads, 0) AS "totalLeads",
      COALESCE(c.leads_abordados, 0) AS "leadsAbordados",
      COALESCE(ab.total, 0) AS abordagens, -- SYNC: tabela abordagens, a mesma do Dashboard
      COALESCE(c.repasses, 0) AS repasses,
      COALESCE(v.total, 0) AS "vendasOriginadas",
      COALESCE(v.amount, 0) AS "receitaOriginada",
      CASE
        WHEN COALESCE(c.leads_abordados, 0) > 0
          THEN round(COALESCE(c.repasses, 0)::numeric / c.leads_abordados * 100, 1)
        ELSE 0
      END AS conversao
    FROM public.profiles p
    LEFT JOIN (
      SELECT
        sdr_id AS user_id,
        count(*) AS total_leads,
        count(*) FILTER (WHERE approach_stage IN ('abordado', 'reabordado')) AS leads_abordados,
        count(*) FILTER (WHERE handed_off_at IS NOT NULL) AS repasses
      FROM public.crm_leads
      WHERE sdr_id IS NOT NULL
      GROUP BY sdr_id
    ) c USING (user_id)
    LEFT JOIN (
      SELECT l.sdr_id AS user_id, count(v.id) AS total, COALESCE(sum(v.valor_venda), 0) AS amount
      FROM public.crm_leads l
      JOIN public.vendas v ON v.crm_lead_id = l.id AND v.approval_status = 'aprovada'
      WHERE l.sdr_id IS NOT NULL
      GROUP BY l.sdr_id
    ) v USING (user_id)
    LEFT JOIN (
      SELECT b.user_id, count(*) AS total FROM public.abordagens b GROUP BY b.user_id
    ) ab USING (user_id)
    WHERE NOT p.arena_hidden
      AND EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p.user_id AND r.role::text = 'sdr'
      )
      AND (NOT EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p.user_id AND r.role::text = 'super_admin'
      ) OR public.arena_sdr_exception(p.user_id))
  ) x;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Ranking de Closers: Super Admin com venda de Closer na janela aparece (s.sales>0).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arena_team_ranking(p_start timestamp with time zone, p_end timestamp with time zone, p_weekly_credit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v jsonb; v_cycle_id uuid; v_progress jsonb;
BEGIN
 IF p_end<=p_start OR p_end-p_start>interval '367 days' THEN RAISE EXCEPTION 'Período inválido'; END IF;
 SELECT c.id INTO v_cycle_id FROM public.goal_cycles c JOIN public.company_goals g ON g.id=c.goal_id
   WHERE g.scope='role' AND g.target_role='closer' AND g.period='weekly'
   AND c.starts_at<=now() AND c.ends_at>now() AND c.closed_at IS NULL AND g.enabled
   ORDER BY c.starts_at DESC LIMIT 1;
 v_progress:=CASE WHEN v_cycle_id IS NOT NULL THEN COALESCE(public.arena_cycle_result(v_cycle_id)->'members','[]'::jsonb) ELSE '[]'::jsonb END;
 SELECT COALESCE(jsonb_agg(x ORDER BY x.percent DESC NULLS LAST,x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]') INTO v FROM (
 SELECT p.user_id,COALESCE(p.display_name,'Closer') name,p.avatar_url AS "avatarUrl",p.suspended,
 COALESCE(s.revenue,0) AS "totalVendas",COALESCE(s.sales,0) AS "quantidadeVendas",
 COALESCE(e.score,0)+COALESCE(s.sales,0)*public.arena_score_weight('sale.approved') AS score,
 COALESCE(a.total,0) abordagens,CASE WHEN a.total>0 THEN round(COALESCE(s.sales,0)*100.0/a.total,1) ELSE 0 END conversao,
 CASE WHEN m.value IS NOT NULL AND (m.value->>'target')::numeric>0 THEN (m.value->>'actual')::numeric/(m.value->>'target')::numeric ELSE NULL END percent
 FROM public.profiles p
 LEFT JOIN LATERAL (SELECT COALESCE(sum(v.revenue),0) revenue,count(*) sales FROM public.arena_closer_weekly_sale_facts v
   WHERE v.user_id=p.user_id
   AND (CASE WHEN p_weekly_credit THEN v.weekly_credit_at ELSE v.occurred_at END)>=p_start
   AND (CASE WHEN p_weekly_credit THEN v.weekly_credit_at ELSE v.occurred_at END)<p_end) s ON true
 LEFT JOIN LATERAL (SELECT COALESCE(sum(f.score_delta),0) score FROM public.activity_feed f
   WHERE f.responsible_id=p.user_id AND f.responsible_role='closer'
   AND f.action_type NOT IN ('sale.approved','sale.reversed')
   AND f.occurred_at>=p_start AND f.occurred_at<p_end) e ON true
 LEFT JOIN LATERAL(SELECT count(*) total FROM public.abordagens WHERE user_id=p.user_id AND created_at>=p_start AND created_at<p_end) a ON true
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(v_progress) value WHERE (value->>'user_id')=p.user_id::text LIMIT 1) m ON true
 WHERE NOT p.arena_hidden AND (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='closer')
 OR EXISTS(SELECT 1 FROM public.activity_feed WHERE responsible_id=p.user_id AND responsible_role='closer' AND occurred_at>=p_start AND occurred_at<p_end)
 OR s.sales>0)
 -- SYNC: Super Admin só fica de fora se não tiver exceção de Closer e nenhuma venda de Closer na janela.
 AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text='super_admin') OR public.arena_closer_exception(p.user_id) OR s.sales>0)
 ) x;
 RETURN v;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Meta de papel: o Super Admin com venda de Closer no ciclo é membro da meta dos Closers.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arena_cycle_result(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.goal_cycles; g public.company_goals; v_members jsonb; v_actual numeric; v_target numeric; v_result jsonb;
BEGIN
 SELECT * INTO c FROM public.goal_cycles WHERE id=p_id;
 SELECT * INTO g FROM public.company_goals WHERE id=c.goal_id;
 IF c.closed_at IS NOT NULL THEN RETURN c.result; END IF;
 IF g.scope='global' THEN
   SELECT COALESCE(sum(v.revenue),0) INTO v_actual FROM public.arena_sale_facts v
   WHERE v.occurred_at>=c.starts_at AND v.occurred_at<c.ends_at;
   v_target:=c.target;
 ELSE
   WITH members AS (
     SELECT p.user_id,p.display_name,p.avatar_url,p.suspended FROM public.profiles p WHERE NOT p.arena_hidden
     AND (g.scope<>'user' OR p.user_id=g.assignee_id)
     AND (EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=g.target_role)
       OR EXISTS(SELECT 1 FROM public.activity_feed f WHERE f.responsible_id=p.user_id AND f.responsible_role=g.target_role AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at)
       OR (g.target_role='closer' AND EXISTS(SELECT 1 FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=p.user_id AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
           AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at)))
     AND (NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text='super_admin') OR (g.target_role='closer' AND public.arena_closer_exception(p.user_id)) OR (g.target_role='sdr' AND public.arena_sdr_exception(p.user_id))
       -- SYNC: Super Admin com venda de Closer creditada neste ciclo entra na meta dos Closers.
       OR (g.target_role='closer' AND EXISTS(SELECT 1 FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=p.user_id AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
           AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at)))
   ), member_count AS (
     SELECT GREATEST(count(*),1)::numeric AS n FROM members
   ), measured AS (
     SELECT m.*,
       COALESCE((SELECT sum(f.score_delta) FROM public.arena_counted_call_events f WHERE f.responsible_id=m.user_id AND f.responsible_role=g.target_role AND (g.target_role<>'sdr' OR f.action_type NOT LIKE 'q.%' OR NOT public.arena_sdr_exception(m.user_id))
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + COALESCE((SELECT sum(f.score_delta) FROM public.activity_feed f WHERE f.action_type='score.adjusted'
         AND f.responsible_id=m.user_id AND f.responsible_role=g.target_role
         AND f.occurred_at>=c.starts_at AND f.occurred_at<c.ends_at),0)
       + CASE WHEN g.target_role='closer' THEN public.arena_score_weight('sale.approved')*(SELECT count(*) FROM public.arena_closer_weekly_sale_facts v
         WHERE v.user_id=m.user_id
         AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)>=c.starts_at
         AND (CASE WHEN g.period='weekly' THEN v.weekly_credit_at ELSE v.occurred_at END)<c.ends_at) ELSE 0 END actual,
       COALESCE((SELECT CASE WHEN candidate.enabled THEN candidate.target END FROM (
       SELECT * FROM public.company_goals WHERE scope='user' AND assignee_id=m.user_id AND target_role=g.target_role AND period=g.period
       AND effective_at<=least(now(),c.ends_at) AND (cycle_start IS NULL OR cycle_start<=least(now(),c.ends_at))
       AND (cycle_end IS NULL OR recurring OR cycle_end>=c.ends_at) ORDER BY effective_at DESC,version DESC LIMIT 1) candidate),
       CASE WHEN g.target_role='sdr' THEN c.target/mc.n ELSE c.target END) target
     FROM members m CROSS JOIN member_count mc
   ) SELECT COALESCE(jsonb_agg(to_jsonb(measured)||jsonb_build_object('state',public.arena_classification(actual,target,c.starts_at,c.ends_at,now())) ORDER BY display_name,user_id),'[]'),
     COALESCE(sum(actual),0),COALESCE(sum(target),0) INTO v_members,v_actual,v_target FROM measured;
 END IF;
 v_result:=jsonb_build_object('actual',v_actual,'target',v_target,'members',COALESCE(v_members,'[]'),
 'state',CASE WHEN v_target=0 THEN 'unassigned' ELSE public.arena_classification(v_actual,v_target,c.starts_at,c.ends_at,now()) END);
 IF g.scope='global' AND g.period='monthly' AND c.ends_at<=now() THEN
   v_result:=v_result||jsonb_build_object('closers',public.arena_team_ranking(c.starts_at,c.ends_at),'sdrs',public.arena_sdr_ranking(c.starts_at,c.ends_at));
 END IF;
 RETURN v_result;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Conferência: se qualquer uma falhar, a migração inteira é desfeita.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE v_n integer; r record; v_tabela integer; v_periodo jsonb;
BEGIN
  -- Todo evento de reabordagem (de lead e autor existentes) virou exatamente uma linha.
  SELECT count(*) INTO v_n FROM public.activity_feed f JOIN public.crm_leads l ON l.id = f.source_id
   WHERE f.action_type = 'lead.approached' AND f.source_type = 'crm_leads' AND f.event_key NOT LIKE '%:registered'
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = f.responsible_id)
     AND (SELECT count(*) FROM public.abordagens a WHERE a.crm_lead_id = l.id AND a.crm_event_key = f.event_key) <> 1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % eventos de reabordagem sem exatamente uma linha em abordagens', v_n; END IF;

  -- A lacuna histórica (approach_count acima dos eventos) está coberta.
  SELECT count(*) INTO v_n FROM public.crm_leads l
   WHERE l.sdr_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.sdr_id)
     AND (SELECT count(*) FROM public.abordagens a WHERE a.crm_lead_id = l.id AND a.crm_event_key LIKE '%:history:%')
       <> GREATEST(0, l.approach_count - (SELECT count(*) FROM public.activity_feed f
            WHERE f.action_type = 'lead.approached' AND f.source_type = 'crm_leads' AND f.source_id = l.id));
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % leads com a lacuna histórica de abordagens mal coberta', v_n; END IF;

  -- Ainda existe exatamente uma linha de cadastro por lead.
  SELECT count(*) INTO v_n FROM (SELECT crm_lead_id FROM public.abordagens
    WHERE crm_lead_id IS NOT NULL AND crm_event_key IS NULL GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL % leads com mais de uma linha de cadastro', v_n; END IF;

  -- O ranking de SDRs mostra o mesmo número que a tabela, em 30 dias, para cada SDR.
  FOR r IN SELECT (x->>'user_id')::uuid uid, (x->>'abordagens')::integer n
           FROM jsonb_array_elements(public.arena_sdr_ranking(now() - interval '30 days', now())) x LOOP
    SELECT count(*) INTO v_tabela FROM public.abordagens a
     WHERE a.user_id = r.uid AND a.created_at >= now() - interval '30 days' AND a.created_at < now();
    IF v_tabela <> r.n THEN RAISE EXCEPTION 'FAIL ranking de SDRs % x tabela % (usuário %)', r.n, v_tabela, r.uid; END IF;
  END LOOP;

  -- O total do período na Arena (e no Dashboard) é a soma da tabela.
  v_periodo := public.arena_period_metrics(now() - interval '30 days', now());
  SELECT count(*) INTO v_tabela FROM public.abordagens a WHERE a.created_at >= now() - interval '30 days' AND a.created_at < now();
  IF (v_periodo->>'approaches')::integer <> v_tabela THEN
    RAISE EXCEPTION 'FAIL abordagens do período % x tabela %', v_periodo->>'approaches', v_tabela;
  END IF;
END $$;

-- Painéis abertos descartam os totais antigos e se atualizam sozinhos.
UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp() WHERE topic IN ('sales', 'arena', 'goals');

NOTIFY pgrst, 'reload schema';
COMMIT;
