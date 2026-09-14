DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'avatars_executive_insert',
      'avatars_executive_update',
      'avatars_executive_delete'
    );

  IF policy_count <> 3 THEN
    RAISE EXCEPTION 'Executive avatar policies are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE 'avatars_executive_%'
      AND position('executive_can_manage_avatar' IN COALESCE(qual, with_check, '')) = 0
  ) THEN
    RAISE EXCEPTION 'Executive avatar policy is missing its protected target check';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'executive_can_manage_avatar'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Protected avatar target helper is missing';
  END IF;
END;
$$;
