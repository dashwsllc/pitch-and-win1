-- Generalizes the Ismael/Pedro backfill (20261001110000) to every SDR and
-- Closer, for every configurable action_type (q.scheduled, closing.scheduled,
-- q.handoff, sale.approved), scoped to TODAY only — by explicit request,
-- after confirming closed cycles (past daily/weekly/monthly competitions and
-- any payouts already decided from them) must stay untouched, since their
-- result snapshot is frozen at close time regardless of activity_feed.
-- Issues a score.adjusted correction per event (same audited mechanism as
-- EventAudit's "Corrigir pontos"), bringing today's score_delta in line with
-- the current arena_score_weights. Only touches score_delta > 0 rows, so
-- intentionally-zero rows (e.g. a non-SDR's closing.scheduled, a non-closer
-- seller's sale.approved) are left alone. Safe to re-run: skips events that
-- already have a correction.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_actor uuid;
  v_actor_name text;
  v_today_start timestamptz := date_trunc('day', clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  r record;
  v_delta numeric;
  v_request uuid;
  v_count int := 0;
BEGIN
  SELECT id INTO v_actor FROM auth.users WHERE email = 'fecass1507@gmail.com';
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE user_id = v_actor;
  v_actor_name := COALESCE(v_actor_name, 'Correção manual via SQL');

  FOR r IN
    SELECT f.id, f.responsible_id, f.responsible_role, f.action_type, f.score_delta,
      w.weight AS current_weight, p.display_name
    FROM public.activity_feed f
    JOIN public.arena_score_weights w ON w.action_type = f.action_type
    JOIN public.profiles p ON p.user_id = f.responsible_id
    WHERE f.occurred_at >= v_today_start
      AND f.score_delta > 0
      AND f.score_delta IS DISTINCT FROM w.weight
      AND NOT EXISTS (
        SELECT 1 FROM public.activity_feed a
        WHERE a.action_type = 'score.adjusted' AND a.source_id = f.id
      )
  LOOP
    v_delta := r.current_weight - r.score_delta;
    v_request := gen_random_uuid();
    PERFORM public.arena_emit('adjustment:'||v_request, 'score.adjusted', r.responsible_id, r.responsible_role,
      'activity_feed', r.id, clock_timestamp(), v_delta, 0, NULL, NULL,
      'Correção manual: alinhar evento de hoje ('||r.action_type||') ao peso atual', 'live', v_actor);
    INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, after_data)
    VALUES(v_actor, v_actor_name, 'arena.score_adjusted', r.id, r.display_name,
      'Correção manual: alinhar evento de hoje ('||r.action_type||') ao peso atual',
      jsonb_build_object('responsible_id', r.responsible_id, 'action_type', r.action_type, 'delta', v_delta, 'request_id', v_request));
    v_count := v_count + 1;
    RAISE NOTICE 'Corrigido % · % (evento %): % -> % (delta %)', r.display_name, r.action_type, r.id, r.score_delta, r.current_weight, v_delta;
  END LOOP;

  RAISE NOTICE '% evento(s) corrigido(s)', v_count;
END $$;

UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
