-- arena_save_score_weights inserted target_id=NULL into executive_audit_events,
-- but that column is uuid NOT NULL: every save failed with "null value in
-- column target_id ... violates not-null constraint". There is no single
-- entity being targeted by a bulk weight change, so target_id becomes the
-- acting admin (auth.uid()), the same value already used for actor_id.
-- Nothing else in the function changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.arena_save_score_weights(p_weights jsonb, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_before jsonb; entry record; v_weight numeric;
BEGIN
  IF NOT public.arena_has_access(true) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da alteração'; END IF;
  IF p_weights IS NULL OR jsonb_typeof(p_weights) <> 'object' THEN RAISE EXCEPTION 'Pesos inválidos' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_object_agg(action_type,weight),'{}') INTO v_before FROM public.arena_score_weights;
  FOR entry IN SELECT key, value FROM jsonb_each(p_weights) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.arena_score_weights WHERE action_type=entry.key) THEN
      RAISE EXCEPTION 'Métrica desconhecida: %', entry.key USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(entry.value) <> 'number' THEN
      RAISE EXCEPTION 'Valor inválido para %', entry.key USING ERRCODE='22023';
    END IF;
    v_weight := (entry.value)::text::numeric;
    IF v_weight < 0 OR v_weight > 100000 THEN
      RAISE EXCEPTION 'Valor fora do intervalo permitido para %', entry.key USING ERRCODE='22023';
    END IF;
    UPDATE public.arena_score_weights SET weight=v_weight,updated_at=clock_timestamp(),updated_by=auth.uid()
      WHERE action_type=entry.key;
  END LOOP;
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
  VALUES(auth.uid(),(SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'arena.score_weights',auth.uid(),
    'Pontuação por evento da Arena',btrim(p_reason),v_before,p_weights);
  UPDATE public.dashboard_events SET revision=revision+1,updated_at=clock_timestamp() WHERE topic IN ('arena','goals');
END
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
