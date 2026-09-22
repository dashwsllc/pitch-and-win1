-- Closer inherits SDR operations, while SDR never inherits Closer operations.
-- Qualification results belong to the shared SDR queue and retain actor auditing
-- and optimistic concurrency checks in resolve_sdr_qualification_call.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
        WHERE user_id=p_user AND role::text IN ('closer','executive','super_admin')
      )
      WHEN 'sales' THEN EXISTS(
        SELECT 1 FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('seller','closer','executive','super_admin')
      )
      ELSE false
    END;
$$;

DO $patch_qualification_result$
DECLARE
  definition text;
  owner_check text := E'  IF NOT public.crm_user_can(auth.uid(),\'executive\') AND c.assigned_to IS DISTINCT FROM auth.uid() THEN\n    RAISE EXCEPTION \'Somente o SDR responsável pode concluir esta call\' USING ERRCODE=\'42501\';\n  END IF;\n';
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.resolve_sdr_qualification_call(uuid,text,timestamptz,jsonb)'))
    INTO definition;
  definition := replace(definition, E'\r\n', E'\n');
  IF definition IS NULL OR strpos(definition, owner_check) = 0 THEN
    RAISE EXCEPTION 'Regra de conclusão da qualificação não encontrada';
  END IF;
  EXECUTE replace(definition, owner_check, '');
END;
$patch_qualification_result$;

NOTIFY pgrst,'reload schema';
COMMIT;
