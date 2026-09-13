-- Only CRM context attachments. Store the UTF-8 Markdown document in the same
-- database row/transaction as the context, avoiding orphaned Storage objects.
BEGIN;

ALTER TABLE public.crm_lead_contexts
  ADD COLUMN file_name text,
  ADD COLUMN file_content text,
  ADD COLUMN file_mime_type text;
ALTER TABLE public.crm_lead_contexts ADD CONSTRAINT crm_context_markdown_file CHECK (
  (file_name IS NULL AND file_content IS NULL AND file_mime_type IS NULL) OR
  (file_name IS NOT NULL AND file_content IS NOT NULL AND file_mime_type IS NOT NULL
    AND file_name ~ '\.md$' AND file_mime_type = 'text/markdown'
    AND char_length(file_name) BETWEEN 4 AND 240
    AND char_length(file_content) BETWEEN 1 AND 50000
    AND octet_length(file_content) <= 262144)
);

CREATE FUNCTION public.crm_import_txt_context(
  p_lead_id uuid, p_context_type text, p_content text,
  p_source_name text, p_source_content text
)
RETURNS public.crm_lead_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result public.crm_lead_contexts; text_value text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF NOT public.registration_has_access() OR NOT (public.crm_can('sdr') OR public.crm_can('closer')) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_source_name IS NULL OR p_source_name !~* '\.txt$'
    OR char_length(p_source_name) NOT BETWEEN 5 AND 240
    OR strpos(p_source_name, '/') > 0 OR strpos(p_source_name, chr(92)) > 0
    OR p_source_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Apenas arquivos .txt são aceitos nesta área' USING ERRCODE = '22023';
  END IF;
  FOREACH text_value IN ARRAY ARRAY[p_source_content, p_content] LOOP
    IF text_value IS NULL OR char_length(text_value) NOT BETWEEN 1 AND 50000
      OR octet_length(text_value) > 262144 THEN
      RAISE EXCEPTION 'Use texto de até 50.000 caracteres e 256 KB' USING ERRCODE = '22023';
    END IF;
    IF btrim(text_value, E' \t\r\n' || chr(65279)) = '' THEN
      RAISE EXCEPTION 'O arquivo está vazio' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM generate_series(1, 31) code
      WHERE code NOT IN (9, 10, 13) AND strpos(text_value, chr(code)) > 0) THEN
      RAISE EXCEPTION 'O arquivo não contém texto válido' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Reuse existing role/type/lead checks and server-owned authorship. Replace
  -- only this import's sanitized copy with the faithful text before committing.
  -- Existing manual notes, edits and other upload areas keep their behavior.
  result := public.crm_add_lead_context(p_lead_id, p_context_type, p_content);
  UPDATE public.crm_lead_contexts SET
    content = p_content,
    file_name = regexp_replace(p_source_name, '\.txt$', '.md', 'i'),
    file_content = p_source_content,
    file_mime_type = 'text/markdown'
  WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_import_txt_context(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import_txt_context(uuid, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
