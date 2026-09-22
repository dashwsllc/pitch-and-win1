-- Rankings comerciais separados por funcao. Contas administrativas nunca
-- participam de premiacoes, mesmo quando acumulam um papel comercial.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_team_ranking()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();

  SELECT COALESCE(
    jsonb_agg(x ORDER BY x."totalVendas" DESC, x."quantidadeVendas" DESC, x.name, x.user_id),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      p.user_id,
      COALESCE(p.display_name, 'Closer') AS name,
      p.avatar_url AS "avatarUrl",
      COALESCE(s.amount, 0) AS "totalVendas",
      COALESCE(s.total, 0) AS "quantidadeVendas",
      COALESCE(a.total, 0) AS abordagens,
      CASE
        WHEN COALESCE(a.total, 0) > 0
          THEN round(COALESCE(s.total, 0)::numeric / a.total * 100, 1)
        ELSE 0
      END AS conversao
    FROM public.profiles p
    LEFT JOIN (
      SELECT user_id, count(*) AS total, sum(valor_venda) AS amount
      FROM public.vendas
      WHERE approval_status = 'aprovada'
      GROUP BY user_id
    ) s USING (user_id)
    LEFT JOIN (
      SELECT user_id, count(*) AS total
      FROM public.abordagens
      GROUP BY user_id
    ) a USING (user_id)
    WHERE NOT p.suspended
      AND EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p.user_id AND r.role::text = 'closer'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p.user_id AND r.role::text = 'super_admin'
      )
  ) x;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sdr_ranking()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      COALESCE(c.abordagens, 0) AS abordagens,
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
        COALESCE(sum(approach_count), 0) AS abordagens,
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
    WHERE NOT p.suspended
      AND EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p.user_id AND r.role::text = 'sdr'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p.user_id AND r.role::text = 'super_admin'
      )
  ) x;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_ranking() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sdr_ranking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_ranking() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sdr_ranking() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
