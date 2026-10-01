-- Second manual realignment of public.arena_score_weights (follows
-- 20261001100000). q.handoff drops from 0.70 to 0.30 and closing.scheduled
-- rises from 0.10 to 0.50; q.scheduled and sale.approved stay as already
-- set. Idempotent UPDATEs, same pattern as the first realignment, run
-- outside the app because arena_save_score_weights() requires a live
-- auth.uid() session that a direct DB connection doesn't have.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_actor uuid;
  v_actor_name text;
BEGIN
  SELECT COALESCE(jsonb_object_agg(action_type, weight), '{}') INTO v_before FROM public.arena_score_weights;

  UPDATE public.arena_score_weights SET weight = 0.50, updated_at = clock_timestamp()
    WHERE action_type = 'q.scheduled';
  UPDATE public.arena_score_weights SET weight = 0.50, updated_at = clock_timestamp()
    WHERE action_type = 'closing.scheduled';
  UPDATE public.arena_score_weights SET weight = 0.30, updated_at = clock_timestamp()
    WHERE action_type = 'q.handoff';
  UPDATE public.arena_score_weights SET weight = 5, label = 'Venda aprovada após call de qualificação feita', updated_at = clock_timestamp()
    WHERE action_type = 'sale.approved';

  SELECT COALESCE(jsonb_object_agg(action_type, weight), '{}') INTO v_after FROM public.arena_score_weights;

  SELECT id INTO v_actor FROM auth.users WHERE email = 'fecass1507@gmail.com';
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE user_id = v_actor;

  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
  VALUES(v_actor, COALESCE(v_actor_name, 'Ajuste manual via SQL'), 'arena.score_weights',
    COALESCE(v_actor, gen_random_uuid()), 'Pontuação por evento da Arena',
    'Correção manual: segundo realinhamento de pesos (handoff 0,70→0,30, repasse 0,10→0,50)',
    v_before, v_after);
END $$;

UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp() WHERE topic IN ('arena','goals');
NOTIFY pgrst, 'reload schema';
COMMIT;
