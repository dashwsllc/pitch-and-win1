-- Grant the SDR head Closer operations in CRM without changing his commercial
-- roles, Arena attribution, or administrative privileges.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.user_roles
  ADD COLUMN crm_closer_access boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.crm_user_can(p_user uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  SELECT p_user IS NOT NULL
    AND EXISTS(
      SELECT 1 FROM public.profiles
      WHERE user_id=p_user AND NOT suspended
    )
    AND CASE p_capability
      WHEN 'admin' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text='super_admin'
      )
      WHEN 'executive' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('executive','super_admin')
      )
      WHEN 'leads' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user
          AND (role::text IN ('seller','sdr','closer','executive','super_admin') OR crm_access)
      )
      WHEN 'sdr' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('sdr','closer','executive','super_admin')
      )
      WHEN 'closer' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND (role::text IN ('closer','executive','super_admin')
          OR (role::text='sdr' AND crm_closer_access))
      )
      WHEN 'sales' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('seller','closer','executive','super_admin')
      )
      ELSE false
    END;
$$;

DO $grant_sdr_head$
DECLARE
  v_user uuid;
  v_updated integer;
BEGIN
  SELECT id INTO STRICT v_user FROM auth.users
  WHERE lower(email)='pedro10@gmail.com' AND deleted_at IS NULL;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id=v_user AND NOT suspended
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id=v_user AND role::text='sdr'
  ) THEN
    RAISE EXCEPTION 'Conta ativa com papel SDR não encontrada para a concessão CRM';
  END IF;

  UPDATE public.user_roles SET crm_closer_access=true
  WHERE user_id=v_user AND role::text='sdr' AND NOT crm_closer_access;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Concessão CRM Closer não alterou exatamente uma função SDR';
  END IF;

  INSERT INTO public.executive_audit_events
    (actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES
    (NULL, 'Sistema', 'permissions.crm_closer_grant', v_user,
     'pedro10@gmail.com', 'Solicitação de acesso do Head de SDR à operação Closer do CRM',
     jsonb_build_object('role','sdr','crm_closer_access',false),
     jsonb_build_object('role','sdr','crm_closer_access',true));
END;
$grant_sdr_head$;

NOTIFY pgrst, 'reload schema';
COMMIT;
