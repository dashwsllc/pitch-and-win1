-- get_team_ranking nunca devolvia avatar_url, então o ranking, o pódio e o
-- resumo de top vendedores sempre caíam no fallback de iniciais, mesmo para
-- quem já tinha foto de perfil cadastrada (o mesmo avatar já exibido em
-- Contas e no menu do usuário, que vem de public.profiles.avatar_url).
-- Único campo adicionado ao retorno; nenhuma outra coluna, filtro ou
-- ordenação foi alterada.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_team_ranking()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();
  SELECT COALESCE(jsonb_agg(x ORDER BY x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]'::jsonb)
    INTO v_result FROM (
      SELECT p.user_id,COALESCE(p.display_name,'Vendedor') AS name,p.avatar_url AS "avatarUrl",
        COALESCE(s.amount,0) AS "totalVendas",COALESCE(s.total,0) AS "quantidadeVendas",
        CASE WHEN COALESCE(a.total,0)>0 THEN round(COALESCE(s.total,0)::numeric/a.total*100,1) ELSE 0 END AS conversao
      FROM public.profiles p
      LEFT JOIN (SELECT user_id,count(*) AS total,sum(valor_venda) AS amount FROM public.vendas WHERE approval_status='aprovada' GROUP BY user_id) s USING(user_id)
      LEFT JOIN (SELECT user_id,count(*) AS total FROM public.abordagens GROUP BY user_id) a USING(user_id)
      WHERE NOT p.suspended AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text IN ('seller','closer','sdr','bdr'))
    ) x;
  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
