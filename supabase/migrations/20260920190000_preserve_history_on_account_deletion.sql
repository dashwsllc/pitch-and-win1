-- Remove account access through Supabase Auth soft deletion. The auth.users row
-- remains so sales, approaches, withdrawals and CRM foreign keys retain their
-- original owner. The Auth API removes identities and sessions after this RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.account_deletion_requests (
  target_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  actor_name text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 2000),
  target_label text NOT NULL,
  before_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC, anon, authenticated;

-- An unexpired JWT must not retain direct table or Storage access after the
-- account is prepared for deletion. Existing service-role work bypasses RLS.
CREATE FUNCTION public.dashboard_account_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.suspended);
$$;
REVOKE ALL ON FUNCTION public.dashboard_account_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_account_active() TO authenticated, service_role;

DO $$
DECLARE v_table record;
BEGIN
  FOR v_table IN SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity
  LOOP
    EXECUTE format(
      'CREATE POLICY dashboard_active_account ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.dashboard_account_active()) WITH CHECK (public.dashboard_account_active())',
      v_table.schemaname, v_table.tablename
    );
  END LOOP;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    CREATE POLICY dashboard_active_account ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.dashboard_account_active()) WITH CHECK (public.dashboard_account_active());
  END IF;
END;
$$;

CREATE FUNCTION public.executive_prepare_account_deletion(p_user_id uuid, p_actor_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_email text;
  v_deleted_at timestamptz;
  v_display_name text;
  v_actor_name text;
  v_before jsonb;
BEGIN
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'Você não pode excluir sua própria conta' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Informe um motivo de 5 a 2000 caracteres' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent removals of executives, including the last-admin check.
  PERFORM pg_advisory_xact_lock(927463002);
  IF NOT public.is_executive(p_actor_id) THEN
    RAISE EXCEPTION 'Acesso executivo necessário' USING ERRCODE = '42501';
  END IF;
  SELECT u.email, u.deleted_at INTO v_email, v_deleted_at
    FROM auth.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF public.is_super_admin(p_user_id) AND NOT public.is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'Somente super admin pode excluir uma conta super admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_executive(p_user_id) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
    WHERE r.user_id <> p_user_id AND r.role::text IN ('executive', 'super_admin') AND NOT p.suspended
  ) THEN
    RAISE EXCEPTION 'É necessário manter ao menos um administrador ativo' USING ERRCODE = 'PT409';
  END IF;

  SELECT p.display_name INTO v_display_name FROM public.profiles p WHERE p.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.display_name INTO v_actor_name FROM public.profiles p WHERE p.user_id = p_actor_id;
  v_before := jsonb_build_object(
    'display_name', v_display_name,
    'roles', (SELECT jsonb_agg(r) FROM public.user_roles r WHERE r.user_id = p_user_id),
    'sales_count', (SELECT count(*) FROM public.vendas WHERE user_id = p_user_id),
    'approaches_count', (SELECT count(*) FROM public.abordagens WHERE user_id = p_user_id),
    'withdrawals_count', (SELECT count(*) FROM public.saques WHERE user_id = p_user_id)
  );

  INSERT INTO public.account_deletion_requests(target_id, actor_id, actor_name, reason, target_label, before_data)
    VALUES (p_user_id, p_actor_id, COALESCE(v_actor_name, 'Executivo'), btrim(p_reason),
      COALESCE(v_display_name, v_email, p_user_id::text), v_before)
    ON CONFLICT(target_id) DO UPDATE SET actor_id = EXCLUDED.actor_id, actor_name = EXCLUDED.actor_name,
      reason = EXCLUDED.reason, target_label = EXCLUDED.target_label, before_data = EXCLUDED.before_data,
      created_at = clock_timestamp();
  -- Prevent still-valid JWTs from using policies based only on auth.uid().
  UPDATE public.profiles SET suspended = true, updated_at = clock_timestamp() WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.executive_prepare_account_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.executive_prepare_account_deletion(uuid, uuid, text) TO service_role;

CREATE FUNCTION public.dashboard_guard_pending_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.suspended = false AND EXISTS (
    SELECT 1 FROM public.account_deletion_requests WHERE target_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'A exclusão desta conta está em andamento' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dashboard_guard_pending_deletion BEFORE UPDATE OF suspended ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_guard_pending_deletion();

-- The final audit event is committed in the same Auth transaction that marks
-- the user deleted. An Auth API failure leaves a visible, blocked account that
-- can be retried; it never writes a false completed-deletion event.
CREATE FUNCTION public.executive_audit_soft_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE target_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO public.executive_audit_events
    (actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES (v_request.actor_id, v_request.actor_name, 'account.delete', NEW.id,
    v_request.target_label, v_request.reason, v_request.before_data,
    jsonb_build_object('deleted_at', NEW.deleted_at, 'history_retained', true));
  DELETE FROM public.account_deletion_requests WHERE target_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER executive_audit_soft_deletion AFTER UPDATE OF deleted_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.executive_audit_soft_deletion();

-- Soft-deleted Auth rows remain for foreign keys but are no longer managed accounts.
CREATE OR REPLACE FUNCTION public.executive_list_users()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access(true);
  SELECT jsonb_build_object('users',COALESCE(jsonb_agg(jsonb_build_object(
      'id',p.id,'user_id',u.id,'display_name',p.display_name,'avatar_url',p.avatar_url,
      'suspended',COALESCE(p.suspended,false) OR COALESCE(u.banned_until>now(),false),
      'email',u.email,'phone',u.phone,'email_confirmed_at',u.email_confirmed_at,'phone_confirmed_at',u.phone_confirmed_at,
      'created_at',u.created_at,'updated_at',p.updated_at,'last_sign_in_at',u.last_sign_in_at,
      'account_revision',COALESCE(u.raw_app_meta_data->'dashboard_account'->>'revision',''),
      'user_roles',COALESCE((SELECT jsonb_agg(r ORDER BY r.created_at,r.id) FROM public.user_roles r WHERE r.user_id=u.id),'[]'::jsonb)
    ) ORDER BY u.created_at DESC),'[]'::jsonb),'fetched_at',clock_timestamp()) INTO v_result
    FROM auth.users u LEFT JOIN public.profiles p ON p.user_id=u.id
    WHERE u.deleted_at IS NULL;
  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
