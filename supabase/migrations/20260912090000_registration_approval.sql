-- Registration and its Executive approval request commit together. Existing
-- collaborators keep their current access; only new accounts start pending.
BEGIN;
-- Close the installation race between backfilling existing users and attaching
-- the trigger: no concurrent signup can commit without a request.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.registration_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email text NOT NULL,
  requested_role text NOT NULL DEFAULT 'seller' CHECK (requested_role = 'seller'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX registration_pending_time ON public.registration_requests(created_at, user_id) WHERE status = 'pending';

INSERT INTO public.registration_requests(user_id, display_name, email, status, created_at)
SELECT u.id, COALESCE(p.display_name, u.raw_user_meta_data->>'display_name', ''),
  COALESCE(u.email, ''), 'approved', u.created_at
FROM auth.users u LEFT JOIN public.profiles p ON p.user_id = u.id;

ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.registration_requests TO authenticated;

CREATE FUNCTION public.registration_has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.registration_requests WHERE user_id = auth.uid() AND status = 'approved');
$$;
REVOKE ALL ON FUNCTION public.registration_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registration_has_access() TO authenticated;

CREATE POLICY registration_read ON public.registration_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (public.registration_has_access() AND public.is_executive(auth.uid())));

CREATE FUNCTION public.create_registration_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Never accept role/status supplied in user-editable signup metadata.
  INSERT INTO public.registration_requests(user_id, display_name, email)
  VALUES (NEW.id, COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'display_name'), ''), ''), COALESCE(NEW.email, ''));
  RETURN NEW;
END;
$$;
-- Independent of the existing profile/default-role trigger's name. Both run
-- inside Auth's INSERT transaction; any failure rolls back the entire signup.
CREATE TRIGGER registration_request_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_registration_request();

CREATE FUNCTION public.get_my_registration_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('status', status, 'created_at', created_at, 'reviewed_at', reviewed_at)
    INTO result FROM public.registration_requests WHERE user_id = auth.uid();
  IF result IS NULL THEN RAISE EXCEPTION 'Não foi possível verificar o cadastro' USING ERRCODE = '42501'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.executive_list_registration_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF NOT public.registration_has_access() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501'; END IF;
  -- A single JSON result avoids PostgREST's row limit silently omitting requests.
  RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.user_id), '[]'::jsonb)
    FROM public.registration_requests r WHERE r.status = 'pending');
END;
$$;

CREATE FUNCTION public.executive_review_registration(p_user_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE request public.registration_requests; actor_name text;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF NOT public.registration_has_access() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Decisão inválida' USING ERRCODE = '22023'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Não é possível revisar o próprio cadastro' USING ERRCODE = '42501'; END IF;
  SELECT * INTO request FROM public.registration_requests WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR request.status <> 'pending' THEN
    RAISE EXCEPTION 'Este cadastro já foi analisado. A lista será atualizada.' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.registration_requests SET status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_at = clock_timestamp(), reviewed_by = auth.uid() WHERE user_id = p_user_id;
  SELECT COALESCE(display_name, 'Executive') INTO actor_name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES (auth.uid(), COALESCE(actor_name, 'Executive'), 'registration.' || p_action, p_user_id, request.display_name,
    CASE p_action WHEN 'approve' THEN 'Cadastro aprovado manualmente pelo Executive' ELSE 'Cadastro rejeitado manualmente pelo Executive' END,
    to_jsonb(request), (SELECT to_jsonb(r) FROM public.registration_requests r WHERE r.user_id = p_user_id));
  RETURN (SELECT to_jsonb(r) FROM public.registration_requests r WHERE r.user_id = p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_registration_status(), public.executive_list_registration_requests(),
  public.executive_review_registration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_registration_status(), public.executive_list_registration_requests(),
  public.executive_review_registration(uuid, text) TO authenticated;

CREATE TRIGGER dashboard_registration_signal AFTER INSERT OR UPDATE OR DELETE ON public.registration_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('users');
ALTER PUBLICATION supabase_realtime ADD TABLE public.registration_requests;

-- Authenticated does not mean approved. Restrictive policies preserve every
-- existing permission while preventing pending/rejected accounts from using
-- REST, Realtime or Storage to bypass the authentication screen.
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity AND
      ((n.nspname = 'public' AND c.relname <> 'registration_requests') OR (n.nspname = 'storage' AND c.relname = 'objects'))
  LOOP
    EXECUTE format('CREATE POLICY registration_access ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.registration_has_access())) WITH CHECK ((SELECT public.registration_has_access()))', target.nspname, target.relname);
  END LOOP;
END;
$$;

-- Security-definer RPCs also pass this gate before PostgREST executes them.
CREATE FUNCTION public.check_registration_access()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.registration_has_access()
    AND COALESCE(current_setting('request.path', true), '') <> '/rpc/get_my_registration_status' THEN
    RAISE EXCEPTION 'Seu cadastro aguarda aprovação de um administrador' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.check_registration_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_registration_access() TO anon, authenticated, service_role;
-- Do not silently replace an unrelated pre-request hook if one is introduced.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles r, unnest(r.rolconfig) setting
    WHERE r.rolname = 'authenticator' AND setting LIKE 'pgrst.db_pre_request=%'
      AND setting <> 'pgrst.db_pre_request=public.check_registration_access') THEN
    RAISE EXCEPTION 'An existing pre-request hook needs to be preserved';
  END IF;
END; $$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_registration_access';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
COMMIT;
