BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE INDEX IF NOT EXISTS goal_cycles_closed_history
  ON public.goal_cycles(ends_at DESC,id DESC) WHERE closed_at IS NOT NULL;

-- Historical outcomes come only from immutable, server-closed cycle snapshots.
-- Ordinary users receive their own participant rows plus collective goals;
-- managers may inspect every participant or filter to one collaborator.
CREATE OR REPLACE FUNCTION public.arena_goal_history(
  p_person uuid DEFAULT NULL,
  p_outcome text DEFAULT 'all',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_manager boolean; v_person uuid; v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();
  IF auth.uid() IS NULL OR NOT public.registration_has_access()
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND NOT suspended)
  THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  v_manager:=public.arena_has_access(true);
  IF p_person IS NOT NULL AND p_person<>auth.uid() AND NOT v_manager THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_outcome NOT IN ('all','achieved','failed','unassigned')
    OR p_outcome IS NULL OR p_offset IS NULL OR p_offset<0 OR p_offset>100000
    OR p_limit IS NULL OR p_limit<1 OR p_limit>50
  THEN RAISE EXCEPTION 'Filtro de histórico inválido' USING ERRCODE='22023'; END IF;
  v_person:=CASE WHEN v_manager THEN p_person ELSE auth.uid() END;

  WITH outcomes AS (
    SELECT c.id AS cycle_id,g.id AS goal_id,g.version AS goal_version,
      g.title,g.scope,g.period,g.target_role,g.metric,
      c.starts_at,c.ends_at,c.closed_at,
      CASE WHEN g.scope='global' THEN NULL::uuid
        ELSE COALESCE((member.item->>'user_id')::uuid,
          CASE WHEN g.scope='user' THEN g.assignee_id END) END AS user_id,
      CASE WHEN g.scope='global' THEN NULL::text
        ELSE COALESCE(member.item->>'display_name',p.display_name,'Sem participantes') END AS display_name,
      CASE WHEN g.scope='global' THEN COALESCE((c.result->>'actual')::numeric,0)
        ELSE COALESCE((member.item->>'actual')::numeric,0) END AS actual,
      CASE WHEN g.scope='global' THEN COALESCE((c.result->>'target')::numeric,c.target)
        ELSE COALESCE((member.item->>'target')::numeric,c.target) END AS target,
      CASE WHEN g.scope='global' THEN COALESCE(c.result->>'state','unassigned')
        ELSE COALESCE(member.item->>'state','unassigned') END AS state
    FROM public.goal_cycles c
    JOIN public.company_goals g ON g.id=c.goal_id
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.result->'members')='array'
        THEN c.result->'members' ELSE '[]'::jsonb END
    ) member(item) ON g.scope<>'global'
    LEFT JOIN public.profiles p ON p.user_id=COALESCE(
      (member.item->>'user_id')::uuid,
      CASE WHEN g.scope='user' THEN g.assignee_id END)
    WHERE c.closed_at IS NOT NULL
  ), visible AS (
    SELECT *,CASE WHEN state IN ('achieved','exceeded') THEN 'achieved'
      WHEN state='unassigned' THEN 'unassigned' ELSE 'failed' END AS outcome
    FROM outcomes
    WHERE v_person IS NULL OR user_id=v_person
      OR (NOT v_manager AND scope='global')
  ), counts AS (
    SELECT count(*)::integer AS total,
      count(*) FILTER(WHERE outcome='achieved')::integer AS achieved,
      count(*) FILTER(WHERE outcome='failed')::integer AS failed,
      count(*) FILTER(WHERE outcome='unassigned')::integer AS unassigned
    FROM visible
  ), page AS (
    SELECT * FROM visible
    WHERE p_outcome='all' OR outcome=p_outcome
    ORDER BY ends_at DESC,cycle_id DESC,user_id NULLS FIRST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'summary',to_jsonb(counts),
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(page)
      ORDER BY ends_at DESC,cycle_id DESC,user_id NULLS FIRST) FROM page),'[]'::jsonb))
  INTO v_result FROM counts;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.arena_goal_history(uuid,text,integer,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.arena_goal_history(uuid,text,integer,integer)
  TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
