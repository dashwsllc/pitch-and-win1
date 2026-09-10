-- Public dashboard sign-ups are sellers and must be usable immediately.
-- Email confirmation is disabled in auth config, so signUp returns a session.
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);

  INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
  VALUES (NEW.id, 'seller', 10, false)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Repair accounts created by the old trigger, which only created a profile.
INSERT INTO public.user_roles (user_id, role, commission_rate, crm_access)
SELECT p.user_id, 'seller', 10, false
FROM public.profiles p
JOIN auth.users u ON u.id = p.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id
)
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES (
  '20260910140000',
  'signup_auto_login',
  ARRAY['Public sign-ups receive a seller role and existing role-less accounts are repaired']
)
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
