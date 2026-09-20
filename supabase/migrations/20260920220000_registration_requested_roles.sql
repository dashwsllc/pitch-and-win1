-- Preserve the collaborator's requested company role through signup and the
-- Executive approval queue. Super Admin remains a protected technical grant.
BEGIN;

ALTER TABLE public.registration_requests
  DROP CONSTRAINT IF EXISTS registration_requests_requested_role_check;
ALTER TABLE public.registration_requests
  ADD CONSTRAINT registration_requests_requested_role_check
  CHECK (requested_role IN ('seller', 'closer', 'sdr', 'bdr', 'traffic_manager', 'executive'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
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
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);

  INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
  VALUES (NEW.id, requested_role::public.app_role, 10, false)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_registration_request()
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

  INSERT INTO public.registration_requests(user_id, display_name, email, requested_role)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''), ''),
    COALESCE(NEW.email, ''),
    requested_role
  );
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
