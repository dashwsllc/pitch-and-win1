-- Ismael Mesquita and Pedro Iago each have a today-dated "closing.scheduled"
-- (repasse) event locked in at the weight that was active before
-- 20261001100000 changed it to 0.10. arena_save_score_weights never rewrites
-- past activity_feed rows (by design), so this issues a score.adjusted
-- correction for each one — the same mechanism EventAudit's "Corrigir
-- pontos" button uses (arena_adjust_score) — bringing today's repasse score
-- in line with the current weight. Scoped to today and to these two people
-- only; skips any event that already has a correction, so reruns are safe.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_actor uuid;
  v_actor_name text;
  v_today_start timestamptz := date_trunc('day', clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_weight numeric;
  r record;
  v_delta numeric;
  v_request uuid;
  v_count int := 0;
BEGIN
  SELECT id INTO v_actor FROM auth.users WHERE email = 'fecass1507@gmail.com';
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE user_id = v_actor;
  v_actor_name := COALESCE(v_actor_name, 'Correção manual via SQL');

  SELECT weight INTO v_weight FROM public.arena_score_weights WHERE action_type = 'closing.scheduled';
  IF v_weight IS NULL THEN RAISE EXCEPTION 'closing.scheduled weight not found'; END IF;

  FOR r IN
    SELECT f.id, f.responsible_id, f.responsible_role, f.score_delta, p.display_name
    FROM public.activity_feed f
    JOIN public.profiles p ON p.user_id = f.responsible_id
    WHERE f.action_type = 'closing.scheduled'
      AND btrim(p.display_name) ILIKE ANY (ARRAY['Ismael Mesquita', 'Pedro Iago'])
      AND f.occurred_at >= v_today_start
      AND f.score_delta IS DISTINCT FROM v_weight
      AND NOT EXISTS (
        SELECT 1 FROM public.activity_feed a
        WHERE a.action_type = 'score.adjusted' AND a.source_id = f.id
      )
  LOOP
    v_delta := v_weight - r.score_delta;
    v_request := gen_random_uuid();
    PERFORM public.arena_emit('adjustment:'||v_request, 'score.adjusted', r.responsible_id, r.responsible_role,
      'activity_feed', r.id, clock_timestamp(), v_delta, 0, NULL, NULL,
      'Correção manual: alinhar repasse de hoje ao novo peso de closing.scheduled (0,10)', 'live', v_actor);
    INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, after_data)
    VALUES(v_actor, v_actor_name, 'arena.score_adjusted', r.id, r.display_name,
      'Correção manual: alinhar repasse de hoje ao novo peso de closing.scheduled (0,10)',
      jsonb_build_object('responsible_id', r.responsible_id, 'delta', v_delta, 'request_id', v_request));
    v_count := v_count + 1;
    RAISE NOTICE 'Corrigido % (evento %): delta %', r.display_name, r.id, v_delta;
  END LOOP;

  RAISE NOTICE '% evento(s) corrigido(s)', v_count;
END $$;

UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
