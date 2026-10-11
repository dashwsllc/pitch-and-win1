-- Lists never return embedded import arrays or candidate payloads.
CREATE FUNCTION public.meta_traffic_review_list(p_kind text DEFAULT NULL,p_status text DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 IF (p_kind IS NOT NULL AND p_kind NOT IN ('metrics','leads')) OR (p_status IS NOT NULL AND p_status NOT IN ('pendente','aprovado','rejeitado','substituido'))
   OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Página inválida' USING ERRCODE='22023'; END IF;
 WITH summaries AS (
   SELECT 'legacy'::text AS format,'metrics'::text AS kind,b.id,b.filename,NULL::bigint AS version,b.updated_at,b.created_at,b.status,b.row_count,b.source,
     NULL::date AS window_start,NULL::date AS window_end,b.replaced_by_review_id
   FROM public.meta_import_batches b WHERE (p_kind IS NULL OR p_kind='metrics') AND (p_status IS NULL OR (b.status=p_status AND b.replaced_by_review_id IS NULL))
   UNION ALL
   SELECT 'legacy','leads',b.id,b.filename,NULL::bigint,b.updated_at,b.created_at,b.status,b.row_count,'csv',NULL::date,NULL::date,NULL::uuid
   FROM public.meta_lead_import_batches b WHERE (p_kind IS NULL OR p_kind='leads') AND (p_status IS NULL OR b.status=p_status)
   UNION ALL
   SELECT 'capture-v1','metrics',r.id,'API · '||r.account_id||' · '||r.level,r.version,r.updated_at,r.created_at,r.status,0,'api',r.window_start,r.window_end,NULL::uuid
   FROM public.meta_capture_reviews r WHERE (p_kind IS NULL OR p_kind='metrics') AND (p_status IS NULL OR r.status=p_status)
 ), page AS (SELECT * FROM summaries ORDER BY created_at DESC,id DESC OFFSET p_offset LIMIT p_limit), details AS (
   SELECT (to_jsonb(page)||jsonb_build_object('row_count',CASE WHEN format='capture-v1' THEN counts.total ELSE row_count END,
     'upsert_count',CASE WHEN format='capture-v1' THEN counts.upserts ELSE row_count END,
     'remove_count',CASE WHEN format='capture-v1' THEN counts.removes ELSE 0 END,
     'conflict_count',CASE WHEN format='capture-v1' THEN counts.conflicts ELSE 0 END)) AS value,page.created_at,page.id
   FROM page LEFT JOIN LATERAL (SELECT count(*) AS total,count(*) FILTER(WHERE operation='upsert') AS upserts,
     count(*) FILTER(WHERE operation='remove') AS removes,count(*) FILTER(WHERE conflict_details IS NOT NULL) AS conflicts
     FROM public.meta_capture_review_rows WHERE review_id=page.id AND page.format='capture-v1') counts ON true
 ) SELECT jsonb_build_object('count',(SELECT count(*) FROM summaries),'rows',coalesce(jsonb_agg(value ORDER BY created_at DESC,id DESC),'[]')) INTO result FROM details;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_traffic_review_list(text,text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_traffic_review_list(text,text,integer,integer) TO authenticated;

-- History is readable with the same access and version checks; mutations retain
-- the stricter pending-only check in meta_capture_check_review.
CREATE OR REPLACE FUNCTION public.meta_capture_review_part(p_id uuid,p_version bigint,p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews; total int; part jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.meta_capture_reviews WHERE id=p_id FOR SHARE;
 IF NOT FOUND OR r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Revisão alterada; recarregue' USING ERRCODE='40001'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Parte inválida' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM public.meta_capture_review_rows WHERE review_id=p_id;
 SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.row_no),'[]') INTO part FROM
   (SELECT * FROM public.meta_capture_review_rows WHERE review_id=p_id ORDER BY row_no OFFSET p_offset LIMIT p_limit) page;
 RETURN jsonb_build_object('id',r.id,'version',r.version,'total',total,'rows',part,'manifest',r.manifest,'next_offset',CASE WHEN p_offset+p_limit<total THEN p_offset+p_limit END);
END $$;
