-- Read-only context availability. Existing captures, decisions and notes remain intact.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.crm_answer_fields_present(p_fields jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_fields)='array' THEN p_fields ELSE '[]' END)a
  WHERE coalesce(a->>'name',a->>'header','')<>''
  AND lower(replace(coalesce(a->>'name',a->>'header',''),'_',' ')) !~ '^(id|.* id|imported by|imported at|reviewed by|reviewed at|review note|received at|first received at|created at|created time|updated at|source revision|schema version|approval status|status|lead status|crm sync.*|traffic edited at|source file|source row|batch filename|entry channel|import method|time known|source has date|raw notes|complete|warnings|.*count|utm .*|gclid|fbclid|ttclid|ad name|adset name|campaign name|form name|platform|is organic)$'
  AND (EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a->'values')='array' THEN a->'values' ELSE '[]' END)v
    WHERE jsonb_typeof(v) IN('boolean','number') OR (jsonb_typeof(v)='string' AND btrim(v#>>'{}')<>''))
    OR nullif(btrim(a->>'value'),'') IS NOT NULL))
$$;
CREATE FUNCTION public.crm_context_object_present(p_object jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 WITH RECURSIVE nodes(value,key) AS (
  SELECT p_object,''::text
  UNION ALL
  SELECT child.value,CASE WHEN jsonb_typeof(n.value)='object' THEN child.key ELSE n.key END
  FROM nodes n CROSS JOIN LATERAL (
   SELECT x.key,x.value FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object' THEN n.value ELSE '{}' END)x
   UNION ALL
   SELECT NULL::text,x.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]' END)x
  )child
 )
 SELECT EXISTS(SELECT FROM nodes WHERE jsonb_typeof(value) IN('string','number','boolean')
  AND public.crm_answer_fields_present(jsonb_build_array(jsonb_build_object('name',key,'values',jsonb_build_array(value)))))
$$;
CREATE FUNCTION public.crm_source_context_present(p_source jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT public.crm_answer_fields_present(p_source->'field_data')
  OR public.crm_answer_fields_present(p_source#>'{source_snapshot,field_data}')
  OR public.crm_answer_fields_present(p_source#>'{source_snapshot,manual_row,field_data}')
  OR public.crm_answer_fields_present(p_source#>'{source_snapshot,manual_row,raw_cells}')
  OR public.crm_context_object_present((p_source#>'{source_snapshot,site_event,payload}')-'contact'-'attribution'-'source_record')
  OR public.crm_context_object_present((p_source#>'{source_snapshot,site_event,payload,source_record}')
    -ARRAY['name','full_name','phone','phone_number','email','email_address','city','state'])
$$;
CREATE FUNCTION public.crm_context_summary(p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS TABLE(lead_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT c.id FROM public.crm_leads c WHERE
  EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND x.context_type<>'meta_form' AND nullif(btrim(x.content),'') IS NOT NULL)
  OR public.crm_source_context_present(c.import_snapshot)
  OR EXISTS(SELECT FROM public.site_import_events e WHERE e.meta_form_lead_id=c.meta_form_lead_id
    AND e.status IN('pending_review','context_only','superseded')
    AND public.crm_source_context_present(jsonb_build_object('source_snapshot',jsonb_build_object('site_event',e.event))))
  -- Legacy notes with no linked source must remain discoverable.
  OR (c.meta_form_lead_id IS NULL AND EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND nullif(btrim(x.content),'') IS NOT NULL))
 ORDER BY c.id LIMIT least(greatest(coalesce(p_limit,500),1),500) OFFSET greatest(coalesce(p_offset,0),0)
$$;
REVOKE ALL ON FUNCTION public.crm_answer_fields_present(jsonb),public.crm_context_object_present(jsonb),public.crm_source_context_present(jsonb),public.crm_context_summary(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_answer_fields_present(jsonb),public.crm_context_object_present(jsonb),public.crm_source_context_present(jsonb),public.crm_context_summary(integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
