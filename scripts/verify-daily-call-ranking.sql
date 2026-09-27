-- Executed after the new migration inside a transaction that always rolls back.
DO $verify$
DECLARE
  v_user uuid;
  v_result jsonb;
  v_day timestamp := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo');
  v_sdr bigint;
  v_closer bigint;
  v_sum bigint;
  v_unsorted boolean;
BEGIN
  SELECT p.user_id INTO v_user FROM public.profiles p
  WHERE NOT p.suspended
    AND EXISTS(SELECT 1 FROM public.registration_requests q WHERE q.user_id=p.user_id AND q.status='approved')
  ORDER BY p.user_id LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'A verificação exige um colaborador aprovado'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_result := public.get_daily_call_ranking();

  SELECT count(*) FILTER (WHERE call_type='qualificacao'), count(*) FILTER (WHERE call_type='fechamento_closer')
    INTO v_sdr, v_closer
  FROM public.crm_activities
  WHERE cancelled_at IS NULL AND call_type IS NOT NULL
    AND created_at >= v_day AT TIME ZONE 'America/Sao_Paulo'
    AND created_at < (v_day + interval '1 day') AT TIME ZONE 'America/Sao_Paulo';
  IF (v_result->>'sdrCalls')::bigint IS DISTINCT FROM v_sdr
     OR (v_result->>'closerCalls')::bigint IS DISTINCT FROM v_closer THEN
    RAISE EXCEPTION 'Totais do dia divergem de crm_activities (%/% vs %/%)',
      v_result->>'sdrCalls', v_result->>'closerCalls', v_sdr, v_closer;
  END IF;
  IF v_result->>'day' IS DISTINCT FROM to_char(v_day, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'Dia de Brasília incorreto: %', v_result->>'day';
  END IF;

  SELECT COALESCE(sum((x->>'total')::bigint), 0) INTO v_sum FROM jsonb_array_elements(v_result->'ranking') x;
  IF v_sum > v_sdr + v_closer THEN RAISE EXCEPTION 'Ranking soma mais calls que o total do dia'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'ranking') x
    WHERE (x->>'total')::bigint <> (x->>'sdrCalls')::bigint + (x->>'closerCalls')::bigint) THEN
    RAISE EXCEPTION 'Total por pessoa difere da soma SDR + Closer';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT (x->>'total')::bigint total, lag((x->>'total')::bigint) OVER (ORDER BY n) previous
      FROM jsonb_array_elements(v_result->'ranking') WITH ORDINALITY AS t(x, n)
    ) s WHERE s.total > s.previous
  ) INTO v_unsorted;
  IF v_unsorted THEN RAISE EXCEPTION 'Ranking fora de ordem'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.get_daily_call_ranking();
    RAISE EXCEPTION 'Consulta sem sessão foi permitida';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $verify$;

SELECT set_config('request.jwt.claim.sub', (
  SELECT p.user_id::text FROM public.profiles p WHERE NOT p.suspended ORDER BY p.user_id LIMIT 1), true);
SELECT r->>'day' AS day, (r->>'sdrCalls')::int AS sdr_calls, (r->>'closerCalls')::int AS closer_calls,
  jsonb_array_length(r->'ranking') AS people
FROM (SELECT public.get_daily_call_ranking() r) x;
