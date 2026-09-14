BEGIN;

CREATE OR REPLACE FUNCTION public.executive_can_manage_avatar(
  p_actor uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
DECLARE
  folders text[];
  target_user uuid;
BEGIN
  IF p_actor IS NULL OR NOT public.is_executive(p_actor) THEN
    RETURN false;
  END IF;

  folders := storage.foldername(p_object_name);
  IF cardinality(folders) <> 1
    OR folders[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  target_user := folders[1]::uuid;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user) THEN
    RETURN false;
  END IF;

  RETURN public.is_super_admin(p_actor)
    OR NOT public.is_super_admin(target_user);
END;
$$;

REVOKE ALL ON FUNCTION public.executive_can_manage_avatar(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.executive_can_manage_avatar(uuid, text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS avatars_executive_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_executive_update ON storage.objects;
DROP POLICY IF EXISTS avatars_executive_delete ON storage.objects;

CREATE POLICY avatars_executive_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.executive_can_manage_avatar(auth.uid(), name)
    AND lower(storage.extension(name)) IN ('png', 'jpg', 'jpeg', 'webp')
  );

CREATE POLICY avatars_executive_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.executive_can_manage_avatar(auth.uid(), name)
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.executive_can_manage_avatar(auth.uid(), name)
    AND lower(storage.extension(name)) IN ('png', 'jpg', 'jpeg', 'webp')
  );

CREATE POLICY avatars_executive_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.executive_can_manage_avatar(auth.uid(), name)
  );

COMMIT;
