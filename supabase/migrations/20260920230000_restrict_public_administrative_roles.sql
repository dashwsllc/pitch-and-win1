-- Public signup never chooses permissions. Every request starts as Seller and
-- the Super Admin assigns the definitive company role after approval.
BEGIN;

CREATE TEMP TABLE public_signup_non_default_roles ON COMMIT DROP AS
SELECT user_id, requested_role, status
FROM public.registration_requests
WHERE requested_role <> 'seller';

DELETE FROM public.user_roles r
USING public_signup_non_default_roles blocked
WHERE r.user_id = blocked.user_id
  AND r.role::text = blocked.requested_role
  AND blocked.status = 'pending';

UPDATE public.registration_requests
SET requested_role = 'seller'
WHERE requested_role <> 'seller';

INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
SELECT user_id, 'seller'::public.app_role, 10, false
FROM public_signup_non_default_roles
WHERE status = 'pending'
ON CONFLICT (user_id, role) DO NOTHING;

ALTER TABLE public.registration_requests
  DROP CONSTRAINT IF EXISTS registration_requests_requested_role_check;
ALTER TABLE public.registration_requests
  ADD CONSTRAINT registration_requests_requested_role_check
  CHECK (requested_role = 'seller');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''))
  ON CONFLICT (user_id) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);
  INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
  VALUES (NEW.id, 'seller'::public.app_role, 10, false)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name), updated_at = now();
  INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
  VALUES (NEW.id, 'seller'::public.app_role, 10, false)
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
BEGIN
  INSERT INTO public.registration_requests(user_id, display_name, email)
  VALUES (NEW.id, COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''), ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_administrative_role_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  account_patch jsonb;
  actor_id uuid;
  requested_roles text[];
  executive_changed boolean;
  super_admin_changed boolean;
BEGIN
  account_patch := NEW.raw_app_meta_data -> 'dashboard_account';
  IF account_patch IS NULL OR account_patch IS NOT DISTINCT FROM OLD.raw_app_meta_data -> 'dashboard_account' THEN
    RETURN NEW;
  END IF;

  actor_id := NULLIF(account_patch ->> 'actor_id', '')::uuid;
  SELECT ARRAY(SELECT jsonb_array_elements_text(account_patch -> 'roles')) INTO requested_roles;
  executive_changed := ('executive' = ANY(requested_roles)) IS DISTINCT FROM public.has_role(NEW.id, 'executive');
  super_admin_changed := ('super_admin' = ANY(requested_roles)) IS DISTINCT FROM public.has_role(NEW.id, 'super_admin');

  IF (executive_changed OR super_admin_changed) AND NOT public.is_super_admin(actor_id) THEN
    RAISE EXCEPTION 'Somente Super Admin pode conceder ou remover acesso administrativo' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_administrative_role_grants ON auth.users;
CREATE TRIGGER enforce_administrative_role_grants
  BEFORE UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_administrative_role_grants();

NOTIFY pgrst, 'reload schema';
COMMIT;
