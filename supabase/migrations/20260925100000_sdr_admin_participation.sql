-- The account already has SDR, Executive and Super Admin roles. Give its SDR
-- work a competition entry while keeping its administrative permissions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE public.arena_sdr_exceptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  qualification_calls_disabled boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.arena_sdr_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arena_sdr_exceptions FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_user uuid;
BEGIN
  SELECT id INTO STRICT v_user FROM auth.users
  WHERE lower(email) = 'fecass1507@icloud.com';
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role::text = 'sdr')
    OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role::text = 'executive')
    OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role::text = 'super_admin')
  THEN RAISE EXCEPTION 'Expected SDR, Executive and Super Admin roles for this account'; END IF;

  INSERT INTO public.arena_sdr_exceptions(user_id, qualification_calls_disabled, reason)
  VALUES (v_user, true, 'SDR competition with Closer handoff calls only; retain Executive and Super Admin access');

  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES (v_user, (SELECT display_name FROM public.profiles WHERE user_id = v_user),
    'arena.sdr_exception', v_user, 'fecass1507@icloud.com',
    'Requested SDR competition and Closer handoff scheduling only',
    jsonb_build_object('sdr_role', true, 'super_admin_excluded', true, 'qualification_calls_enabled', true),
    jsonb_build_object('sdr_role', true, 'super_admin_excluded', false, 'qualification_calls_enabled', false));
END $$;

CREATE OR REPLACE FUNCTION public.arena_sdr_exception(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.arena_sdr_exceptions e
    JOIN public.user_roles r ON r.user_id = e.user_id AND r.role::text = 'sdr'
    WHERE e.user_id = p_user
  );
$$;
REVOKE ALL ON FUNCTION public.arena_sdr_exception(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_can_schedule_qualification_call()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.arena_sdr_exceptions e
    WHERE e.user_id = auth.uid() AND e.qualification_calls_disabled
  );
$$;
REVOKE ALL ON FUNCTION public.crm_can_schedule_qualification_call() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_can_schedule_qualification_call() TO authenticated;

-- Also enforce the choice at the database boundary for old clients and RPCs.
CREATE OR REPLACE FUNCTION public.arena_call_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.call_type='qualificacao' AND auth.uid() IS NOT NULL AND NOT public.crm_can_schedule_qualification_call()
 THEN RAISE EXCEPTION 'Esta conta agenda apenas calls para o Closer.' USING ERRCODE='42501'; END IF;
 IF NEW.call_type='fechamento_closer' AND (
   NEW.assigned_to=auth.uid() OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('sdr','executive','super_admin')))
 THEN RAISE EXCEPTION 'A call de fechamento deve ser agendada pelo SDR para outro colaborador.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;

-- Preserve the installed ranking and cycle definitions, including the Closer
-- exception, and change only their explicit Super Admin exclusion.
DO $patch$
DECLARE d text; old_text text; new_text text;
BEGIN
  d := pg_get_functiondef('public.arena_sdr_ranking(timestamptz,timestamptz)'::regprocedure);
  old_text := 'AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text=''super_admin'')';
  new_text := 'AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.user_id AND role::text=''super_admin'') OR public.arena_sdr_exception(p.user_id))';
  IF (length(d)-length(replace(d,old_text,''))) <> length(old_text) THEN
    RAISE EXCEPTION 'Unexpected SDR Arena ranking definition'; END IF;
  d := replace(d,old_text,new_text);
  old_text := 'p.avatar_url AS "avatarUrl",p.suspended,';
  new_text := old_text || ' public.arena_sdr_exception(p.user_id) AS "qualificationCallsDisabled",';
  IF (length(d)-length(replace(d,old_text,''))) <> length(old_text) THEN
    RAISE EXCEPTION 'Unexpected SDR Arena ranking fields'; END IF;
  d := replace(d,old_text,new_text);
  old_text := 'FROM public.arena_counted_call_events WHERE responsible_id=p.user_id AND responsible_role=''sdr''';
  new_text := old_text || ' AND (action_type NOT LIKE ''q.%'' OR NOT public.arena_sdr_exception(p.user_id))';
  IF (length(d)-length(replace(d,old_text,''))) <> length(old_text) THEN
    RAISE EXCEPTION 'Unexpected SDR call metric definition'; END IF;
  EXECUTE replace(d,old_text,new_text);

  d := pg_get_functiondef('public.arena_cycle_result(uuid)'::regprocedure);
  old_text := 'OR (g.target_role=''closer'' AND public.arena_closer_exception(p.user_id)))';
  new_text := 'OR (g.target_role=''closer'' AND public.arena_closer_exception(p.user_id)) OR (g.target_role=''sdr'' AND public.arena_sdr_exception(p.user_id)))';
  IF (length(d)-length(replace(d,old_text,''))) <> length(old_text) THEN
    RAISE EXCEPTION 'Unexpected Arena cycle membership definition'; END IF;
  d := replace(d,old_text,new_text);
  old_text := 'FROM public.arena_counted_call_events f WHERE f.responsible_id=m.user_id AND f.responsible_role=g.target_role';
  new_text := old_text || ' AND (g.target_role<>''sdr'' OR f.action_type NOT LIKE ''q.%'' OR NOT public.arena_sdr_exception(m.user_id))';
  IF (length(d)-length(replace(d,old_text,''))) <> length(old_text) THEN
    RAISE EXCEPTION 'Unexpected Arena cycle score definition'; END IF;
  EXECUTE replace(d,old_text,new_text);

  d := pg_get_functiondef('public.get_sdr_ranking()'::regprocedure);
  old_text := E'AND NOT EXISTS (\n        SELECT 1 FROM public.user_roles r\n        WHERE r.user_id = p.user_id AND r.role::text = ''super_admin''\n      )';
  new_text := 'AND (' || substr(old_text,5) || ' OR public.arena_sdr_exception(p.user_id))';
  IF (length(d)-length(replace(d,old_text,''))) <> length(old_text) THEN
    RAISE EXCEPTION 'Unexpected monthly SDR ranking definition'; END IF;
  EXECUTE replace(d,old_text,new_text);
END $patch$;

UPDATE public.dashboard_events
SET revision = revision + 1, updated_at = clock_timestamp()
WHERE topic IN ('arena', 'goals', 'users', 'crm');
NOTIFY pgrst, 'reload schema';
COMMIT;
