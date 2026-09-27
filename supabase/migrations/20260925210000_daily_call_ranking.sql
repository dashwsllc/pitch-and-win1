-- Ranking de calls marcadas no dia de Brasília, creditadas a quem marcou
-- (crm_activities.user_id). Reagendar altera a call existente e não conta
-- como nova marcação; calls canceladas saem dos totais, como na Arena.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_daily_call_ranking()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_day timestamp := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo');
  v_start timestamptz := v_day AT TIME ZONE 'America/Sao_Paulo';
  v_end timestamptz := (v_day + interval '1 day') AT TIME ZONE 'America/Sao_Paulo';
  v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();

  WITH calls AS (
    SELECT a.user_id, a.call_type
    FROM public.crm_activities a
    WHERE a.call_type IN ('qualificacao', 'fechamento_closer')
      AND a.cancelled_at IS NULL
      AND a.created_at >= v_start AND a.created_at < v_end
  ), per_user AS (
    SELECT user_id,
      count(*) FILTER (WHERE call_type = 'qualificacao') AS sdr_calls,
      count(*) FILTER (WHERE call_type = 'fechamento_closer') AS closer_calls,
      count(*) AS total
    FROM calls
    GROUP BY user_id
  )
  SELECT jsonb_build_object(
    'day', to_char(v_day, 'YYYY-MM-DD'),
    'sdrCalls', (SELECT count(*) FROM calls WHERE call_type = 'qualificacao'),
    'closerCalls', (SELECT count(*) FROM calls WHERE call_type = 'fechamento_closer'),
    'ranking', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'user_id', p.user_id,
          'name', COALESCE(p.display_name, 'Colaborador'),
          'avatarUrl', p.avatar_url,
          'sdrCalls', u.sdr_calls,
          'closerCalls', u.closer_calls,
          'total', u.total
        ) ORDER BY u.total DESC, u.closer_calls DESC, p.display_name, p.user_id)
      FROM per_user u
      JOIN public.profiles p ON p.user_id = u.user_id
      WHERE NOT p.arena_hidden
        AND (NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.user_id AND r.role::text = 'super_admin')
          OR public.arena_sdr_exception(p.user_id)
          OR public.arena_closer_exception(p.user_id))
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_call_ranking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_call_ranking() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
