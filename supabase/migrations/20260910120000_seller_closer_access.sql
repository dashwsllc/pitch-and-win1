BEGIN;

-- Every active seller can operate the Closer area and complete the linked
-- CRM -> Vendas flow, even when the account also has another commercial role.
CREATE OR REPLACE FUNCTION public.crm_user_can(p_user uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  SELECT p_user IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM public.profiles
      WHERE user_id=p_user AND NOT suspended
    )
    AND (
      EXISTS(
        SELECT 1
        FROM public.user_roles
        WHERE user_id=p_user AND role::text IN ('executive','super_admin')
      )
      OR CASE p_capability
        WHEN 'leads' THEN EXISTS(
          SELECT 1
          FROM public.user_roles
          WHERE user_id=p_user
            AND (role::text IN ('seller','sdr','closer') OR crm_access)
        )
        WHEN 'sdr' THEN
          EXISTS(
            SELECT 1 FROM public.user_roles
            WHERE user_id=p_user AND role::text='sdr'
          )
          OR (
            EXISTS(
              SELECT 1 FROM public.user_roles
              WHERE user_id=p_user AND role::text='seller'
            )
            AND NOT EXISTS(
              SELECT 1 FROM public.user_roles
              WHERE user_id=p_user AND role::text IN ('sdr','closer')
            )
          )
        WHEN 'closer' THEN EXISTS(
          SELECT 1
          FROM public.user_roles
          WHERE user_id=p_user AND role::text IN ('seller','closer')
        )
        WHEN 'sales' THEN EXISTS(
          SELECT 1
          FROM public.user_roles
          WHERE user_id=p_user AND role::text IN ('seller','closer')
        )
        ELSE false
      END
    );
$$;

REVOKE ALL ON FUNCTION public.crm_user_can(uuid,text) FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
