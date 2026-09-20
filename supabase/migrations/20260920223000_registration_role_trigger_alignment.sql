-- Some production environments use the legacy assign_default_role trigger
-- name. Keep it aligned with the requested-role signup flow as well.
BEGIN;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requested_role text := COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'requested_role'), ''), 'seller');
BEGIN
  IF requested_role NOT IN ('seller', 'closer', 'sdr', 'bdr', 'traffic_manager', 'executive') THEN
    requested_role := 'seller';
  END IF;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
  VALUES (NEW.id, requested_role::public.app_role, 10, false)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
