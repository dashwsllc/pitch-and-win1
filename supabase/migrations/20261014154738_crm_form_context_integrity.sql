-- Form context must contain the submitted answers, not just contact fields or staff notes.
-- Approval copies the full source atomically through crm_preserve_import_origin.
-- This migration only changes read functions; source records and snapshots stay intact.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.crm_form_answers_present(p_source jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 WITH captures(fields) AS (
  VALUES (p_source->'field_data'),(p_source#>'{source_snapshot,field_data}'),
   (p_source#>'{source_snapshot,manual_row,field_data}'),
   (p_source#>'{source_snapshot,manual_row,raw_cells}'),(p_source#>'{source_snapshot,raw_cells}')
 ), answers(field) AS (
  SELECT a FROM captures c CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(c.fields)='array' THEN c.fields ELSE '[]' END)a
  UNION ALL
  SELECT jsonb_build_object('name',a.key,'value',a.value)
   FROM captures c CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(c.fields)='object' THEN c.fields ELSE '{}' END)a
 ), names AS (
  SELECT field,coalesce(field->>'name',field->>'header','') AS name FROM answers
 ), normalized AS (
  SELECT field,
   btrim(lower(regexp_replace(translate(regexp_replace(name,'([a-z])([A-Z])','\1 \2','g'),
    'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucAAAAEEIOOOUUC'),'[_?.,/[:space:]]+',' ','g'))) AS key,
   btrim(lower(regexp_replace(translate(regexp_replace(regexp_replace(name,'^.* / ',''),'([a-z])([A-Z])','\1 \2','g'),
    'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucAAAAEEIOOOUUC'),'[_?.,/[:space:]]+',' ','g'))) AS leaf_key
  FROM names
 )
 SELECT EXISTS(SELECT FROM normalized a
  WHERE public.crm_answer_fields_present(jsonb_build_array(
   (CASE WHEN jsonb_typeof(a.field->'value')='array' THEN (a.field-'value')||jsonb_build_object('values',a.field->'value') ELSE a.field END)
   ||jsonb_build_object('name',a.leaf_key)))
  AND regexp_replace(a.key,'^(registro original|dados revisados) ','') !~ '^(consentimentos|origem|attribution|utm)( |$)'
  AND a.leaf_key
   NOT IN('full name','name','nome','nome completo','phone','phone number','telefone','whatsapp',
    'email','email address','e mail','date of birth','data de nascimento','state','estado','uf','city','cidade'))
$$;
CREATE OR REPLACE FUNCTION public.crm_context_summary(p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS TABLE(lead_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT c.id FROM public.crm_leads c WHERE CASE WHEN c.import_channel='form' THEN
  public.crm_form_answers_present(c.import_snapshot)
 ELSE
  EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND x.context_type<>'meta_form' AND nullif(btrim(x.content),'') IS NOT NULL)
  OR public.crm_source_context_present(c.import_snapshot)
  OR EXISTS(SELECT FROM public.site_import_events e WHERE e.meta_form_lead_id=c.meta_form_lead_id
    AND e.status IN('pending_review','context_only','superseded')
    AND public.crm_source_context_present(jsonb_build_object('source_snapshot',jsonb_build_object('site_event',e.event))))
  OR (c.meta_form_lead_id IS NULL AND EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND nullif(btrim(x.content),'') IS NOT NULL))
 END
 ORDER BY c.id LIMIT least(greatest(coalesce(p_limit,500),1),500) OFFSET greatest(coalesce(p_offset,0),0)
$$;
REVOKE ALL ON FUNCTION public.crm_form_answers_present(jsonb),public.crm_context_summary(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_form_answers_present(jsonb),public.crm_context_summary(integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
