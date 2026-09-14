-- Exclusão de conta pelo painel executivo, além da suspensão já existente.
--
-- Só pode ser chamada pela função de borda executive-delete-account, com a
-- SERVICE_ROLE_KEY: a exclusão precisa apagar a linha em auth.users, e as
-- travas de proteção em user_roles/profiles/vendas (dashboard_guard_role,
-- dashboard_guard_profile, dashboard_guard_sale) bloqueiam qualquer DELETE em
-- cascata quando auth.uid() não é nulo. auth.uid() só é nulo quando a chamada
-- vem de um contexto sem JWT de usuário, como o client service-role da função
-- de borda — o mesmo motivo pelo qual apply_executive_account_patch consegue
-- reescrever user_roles ao editar uma conta. Por isso o parâmetro p_actor_id é
-- explícito e validado aqui, em vez de usar auth.uid().
--
-- Histórico financeiro nunca é apagado em silêncio: a exclusão é recusada
-- enquanto a conta tiver vendas, abordagens ou saques registrados. Use
-- Suspender acesso para bloquear login preservando esse histórico.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.executive_delete_account(p_user_id uuid, p_actor_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text;
  v_display_name text;
  v_actor_name text;
  v_before jsonb;
BEGIN
  IF NOT public.is_executive(p_actor_id) THEN
    RAISE EXCEPTION 'Acesso executivo necessário' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'Você não pode excluir sua própria conta';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 5 caracteres)';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_super_admin(p_user_id) AND NOT public.is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Somente super admin pode excluir uma conta super admin' USING ERRCODE = '42501';
  END IF;

  -- Mesma trava usada por apply_executive_account_patch, para que uma
  -- exclusão concorrente com uma edição de papéis não derrube o último
  -- administrador ativo.
  PERFORM pg_advisory_xact_lock(927463002);
  IF public.is_executive(p_user_id) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
    WHERE r.user_id <> p_user_id AND r.role::text IN ('executive', 'super_admin') AND NOT p.suspended
  ) THEN
    RAISE EXCEPTION 'É necessário manter ao menos um administrador ativo';
  END IF;

  -- Vendas, comissões e abordagens são preservadas mesmo quando a conta sai.
  -- A UI deve orientar Suspender acesso nesses casos.
  IF EXISTS (SELECT 1 FROM public.vendas WHERE user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.abordagens WHERE user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.saques WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Esta conta tem vendas, abordagens ou saques registrados. Use Suspender acesso para preservar o histórico.' USING ERRCODE = 'PT409';
  END IF;

  SELECT display_name INTO v_display_name FROM public.profiles WHERE user_id = p_user_id;
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE user_id = p_actor_id;

  v_before := jsonb_build_object(
    'display_name', v_display_name,
    'email', v_email,
    'roles', (SELECT jsonb_agg(r) FROM public.user_roles r WHERE user_id = p_user_id)
  );

  -- Auditoria é gravada antes da exclusão, na mesma transação: se a exclusão
  -- falhar adiante (por exemplo por FK de CRM), o handler abaixo desfaz este
  -- INSERT junto, e nenhum registro de exclusão fica órfão.
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES (p_actor_id, COALESCE(v_actor_name, 'Executivo'), 'account.delete', p_user_id,
    COALESCE(v_display_name, v_email), btrim(p_reason), v_before, NULL);

  DELETE FROM auth.users WHERE id = p_user_id;
EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'Esta conta ainda está referenciada em leads, calls ou outros registros do sistema. Reatribua-os antes de excluir.' USING ERRCODE = 'PT409';
END;
$$;

REVOKE ALL ON FUNCTION public.executive_delete_account(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.executive_delete_account(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
