-- Correções da auditoria de 10/09/2026.
--
-- ATENÇÃO: esta migração ainda NÃO foi aplicada ao projeto mbzwchnxtskysqplqiyy.
-- Aplique com o comando da seção 1 de docs/AUDITORIA_BANCO.md.
-- Não use `supabase db push` geral: o histórico remoto diverge do local.
--
-- As três partes são independentes. A parte 3 apaga linhas; leia o aviso dela
-- antes de executar.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Parte 1: get_pending_commission sempre retornava zero
-- ---------------------------------------------------------------------------
-- A função somava commission_amount das vendas pendentes. Só que
-- enforce_pending_sale_insert zera esse campo na inserção e dashboard_guard_sale
-- impede alterá-lo fora da revisão executiva, então a soma é sempre zero. O card
-- "Pendente de aprovação" em Saques nunca mostrava outro valor, enquanto Minhas
-- Vendas estimava valor_venda * taxa / 100 e exibia um número diferente para a
-- mesma conta.
--
-- Agora a função estima com a mesma taxa, a mesma linha de user_roles e o mesmo
-- arredondamento que executive_review_sale usa para congelar a comissão na
-- aprovação. As três telas passam a concordar, e o valor exibido é o que a
-- aprovação vai efetivar.
--
-- get_available_balance não muda: pendente continua sem gerar saldo sacável.

CREATE OR REPLACE FUNCTION public.get_pending_commission(p_seller_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result numeric;
  v_rate numeric;
BEGIN
  PERFORM public.dashboard_require_access();
  IF p_seller_id <> auth.uid() AND NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;

  -- Mesma linha de papel que executive_review_sale escolhe.
  SELECT COALESCE(commission_rate, 0) INTO v_rate
    FROM public.user_roles
    WHERE user_id = p_seller_id
    ORDER BY updated_at DESC, id
    LIMIT 1;

  -- Um valor já gravado tem precedência sobre a estimativa.
  SELECT COALESCE(sum(
      CASE WHEN commission_amount > 0 THEN commission_amount
           ELSE round(valor_venda * COALESCE(v_rate, 0) / 100, 2) END
    ), 0) INTO result
    FROM public.vendas
    WHERE user_id = p_seller_id AND approval_status = 'pendente';

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Parte 2: log_security_event era chamável por qualquer usuário autenticado
-- ---------------------------------------------------------------------------
-- A função insere linhas livres em security_audit_log. O user_id é forçado para
-- auth.uid(), então ninguém consegue se passar por outro usuário, mas qualquer
-- conta logada podia poluir o log de segurança com registros fabricados, via
-- /rest/v1/rpc/log_security_event.
--
-- Verificado antes de revogar: nenhuma função do banco e nenhuma tela do
-- aplicativo chamam essa função. Ela aparece apenas nos tipos gerados.

REVOKE ALL ON FUNCTION public.log_security_event(text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Parte 3: linhas órfãs em user_roles e a chave estrangeira que faltava
-- ---------------------------------------------------------------------------
-- ESTA PARTE APAGA DADOS. Backup das 123 linhas afetadas, com todas as colunas:
--   .verification.local/backup-user_roles-orfaos-2026-09-10.json
--
-- user_roles é a única tabela com user_id que não tem chave estrangeira para
-- auth.users. profiles, abordagens e vendas têm, todas com ON DELETE CASCADE.
-- Por isso só user_roles acumulou papéis de contas já removidas: 123 linhas
-- órfãs para 13 contas reais.
--
-- O efeito prático era o card "Total de Vendedores" da Central executiva
-- mostrar 90 vendedores onde existem 12. O frontend já foi corrigido para
-- ignorar órfãos, mas a origem do problema é a ausência da chave estrangeira.
--
-- A exclusão é restrita a linhas cujo user_id não existe em auth.users.

DELETE FROM public.user_roles r
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ---------------------------------------------------------------------------
-- Verificação. Rode depois do COMMIT; todos os valores devem ser zero.
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM public.user_roles r
--      WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id))
--     AS orfaos_restantes,
--   (SELECT count(*) FROM pg_constraint
--      WHERE conname = 'user_roles_user_id_fkey') - 1
--     AS chave_estrangeira_faltando,
--   (SELECT count(*) FROM information_schema.role_routine_grants
--      WHERE routine_name = 'log_security_event' AND grantee IN ('anon','authenticated'))
--     AS permissoes_indevidas_no_log;
