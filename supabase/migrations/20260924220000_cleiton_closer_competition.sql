-- Cleiton keeps his administrative roles but participates in Closer standings.
-- Exceptions are explicit, so other Super Admin accounts remain excluded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE public.arena_closer_exceptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arena_closer_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_closer_exceptions FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_user uuid;
BEGIN
  SELECT u.id INTO STRICT v_user FROM auth.users u
  WHERE lower(u.email) = 'cleitonrodrigues.ads@gmail.com';
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = v_user AND r.role::text = 'closer'
  ) THEN RAISE EXCEPTION 'Cleiton must have the Closer role before joining the competition'; END IF;
  INSERT INTO public.arena_closer_exceptions(user_id, reason)
  VALUES (v_user, 'Requested participation in the Closer Arena and ranking while retaining Executive and Super Admin access');
END $$;

CREATE OR REPLACE FUNCTION public.arena_closer_exception(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.arena_closer_exceptions e
    JOIN public.user_roles r ON r.user_id = e.user_id AND r.role::text = 'closer'
    WHERE e.user_id = p_user
  );
$$;
REVOKE ALL ON FUNCTION public.arena_closer_exception(uuid) FROM PUBLIC, anon, authenticated;

-- These are the two current source-of-truth queries for the live Closer list
-- and its weekly goal. Fail if their expected exclusion changed upstream.
DO $$
DECLARE
  v_definition text;
  v_before text;
  v_after text;
BEGIN
  v_definition := pg_get_functiondef('public.arena_team_ranking(timestamptz,timestamptz,boolean)'::regprocedure);
  v_before := 'AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text=''super_admin'')';
  v_after := 'AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text=''super_admin'') OR public.arena_closer_exception(p.user_id))';
  IF (length(v_definition) - length(replace(v_definition, v_before, ''))) <> length(v_before) THEN
    RAISE EXCEPTION 'Unexpected Closer ranking definition';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);

  v_definition := pg_get_functiondef('public.arena_cycle_result(uuid)'::regprocedure);
  v_before := 'AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=''super_admin'')';
  v_after := 'AND (NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text=''super_admin'') OR (g.target_role=''closer'' AND public.arena_closer_exception(p.user_id)))';
  IF (length(v_definition) - length(replace(v_definition, v_before, ''))) <> length(v_before) THEN
    RAISE EXCEPTION 'Unexpected Arena goal definition';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END $$;

UPDATE public.dashboard_events
SET revision = revision + 1, updated_at = clock_timestamp()
WHERE topic IN ('arena', 'goals', 'users');
COMMIT;
