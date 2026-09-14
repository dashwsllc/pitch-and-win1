BEGIN;

-- Executives can manage a member's avatar through the account editor. Files
-- remain in the member's own folder, so the member can replace them later.
DROP POLICY IF EXISTS avatars_executive_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_executive_update ON storage.objects;
DROP POLICY IF EXISTS avatars_executive_delete ON storage.objects;

CREATE POLICY avatars_executive_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_executive(auth.uid())
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND lower(storage.extension(name)) IN ('png', 'jpg', 'jpeg', 'webp')
  );

CREATE POLICY avatars_executive_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND public.is_executive(auth.uid()))
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_executive(auth.uid())
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND lower(storage.extension(name)) IN ('png', 'jpg', 'jpeg', 'webp')
  );

CREATE POLICY avatars_executive_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND public.is_executive(auth.uid()));

COMMIT;
