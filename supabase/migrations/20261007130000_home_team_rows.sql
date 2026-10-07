-- A Visão geral mostra o time todo para todo mundo, não só para quem é Executive/Super Admin.
--
-- Até aqui a Home lia vendas e abordagens direto das tabelas, e a política de leitura delas (vendas_select e
-- abordagens_select: "user_id = auth.uid() OR is_executive") devolvia a quem não é Executive só as linhas da própria
-- pessoa. O resultado: os números, os gráficos, o feed e as vendas anteriores só apareciam completos para Executive.
-- Abrir a política não serve: a tabela de vendas carrega nome, e-mail e WhatsApp do comprador. Estas três funções
-- devolvem SÓ as colunas que a Home desenha (nada do comprador, do vendedor nem do lead) e exigem conta ativa e aprovada,
-- como a política de acesso das tabelas. É o mesmo nível de exposição que get_sales_board, get_team_ranking e
-- get_sdr_ranking já dão a qualquer conta ativa (valor, produto, data e contagens do time).
BEGIN;

-- Vendas aprovadas. Por padrão: as COMPRADAS na janela (created_at, a data postada: é ela que dá os totais e os gráficos).
-- Com p_late: as APROVADAS na janela (reviewed_at) e compradas antes dela, que a Home anuncia sem somar aos totais.
-- Janela nula = todo o período.
CREATE OR REPLACE FUNCTION public.dashboard_home_sales(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_late boolean DEFAULT false
) RETURNS TABLE (
  id uuid,
  nome_produto text,
  valor_venda numeric,
  created_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.dashboard_require_access();
  IF NOT public.registration_has_access() THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_late THEN
    IF p_start IS NULL OR p_end IS NULL THEN
      RAISE EXCEPTION 'A busca de aprovações tardias exige a janela inteira' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
      SELECT v.id, v.nome_produto, v.valor_venda, v.created_at, v.reviewed_at
      FROM public.vendas v
      WHERE v.approval_status = 'aprovada'
        AND v.reviewed_at >= p_start AND v.reviewed_at < p_end
        AND v.created_at < p_start
      ORDER BY v.reviewed_at, v.id;
  ELSE
    RETURN QUERY
      SELECT v.id, v.nome_produto, v.valor_venda, v.created_at, v.reviewed_at
      FROM public.vendas v
      WHERE v.approval_status = 'aprovada'
        AND (p_start IS NULL OR v.created_at >= p_start)
        AND (p_end IS NULL OR v.created_at < p_end)
      ORDER BY v.created_at, v.id;
  END IF;
END;
$$;

-- Abordagens do time na janela (created_at), com a resposta "mostrou a IA funcionando?". Sem lead, vendedor ou texto.
CREATE OR REPLACE FUNCTION public.dashboard_home_approaches(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  mostrou_ia boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.dashboard_require_access();
  IF NOT public.registration_has_access() THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT a.id, a.created_at, a.mostrou_ia
    FROM public.abordagens a
    WHERE (p_start IS NULL OR a.created_at >= p_start)
      AND (p_end IS NULL OR a.created_at < p_end)
    ORDER BY a.created_at, a.id;
END;
$$;

-- Calls feitas: de qualificação ou de fechamento, concluídas e não canceladas. A janela pega quem tem a hora marcada OU a do
-- fechamento nela (a Home escolhe o momento exato, o mais cedo dos dois). Só id e horários: nada do lead.
CREATE OR REPLACE FUNCTION public.dashboard_home_calls(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  scheduled_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.dashboard_require_access();
  IF NOT public.registration_has_access() THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT c.id, c.scheduled_at, c.completed_at
    FROM public.crm_activities c
    WHERE c.call_type IN ('qualificacao', 'fechamento_closer')
      AND c.is_completed
      AND c.cancelled_at IS NULL
      AND (
        p_start IS NULL OR p_end IS NULL
        OR (c.scheduled_at >= p_start AND c.scheduled_at < p_end)
        OR (c.completed_at >= p_start AND c.completed_at < p_end)
      )
    ORDER BY c.scheduled_at, c.id;
END;
$$;

REVOKE ALL ON FUNCTION
  public.dashboard_home_sales(timestamptz, timestamptz, boolean),
  public.dashboard_home_approaches(timestamptz, timestamptz),
  public.dashboard_home_calls(timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.dashboard_home_sales(timestamptz, timestamptz, boolean),
  public.dashboard_home_approaches(timestamptz, timestamptz),
  public.dashboard_home_calls(timestamptz, timestamptz)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
