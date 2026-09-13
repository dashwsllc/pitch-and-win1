-- Optional Google Drive reference for videos, audio and other heavy media in
-- CRM lead context. Existing upload surfaces and the TXT archive stay intact.
BEGIN;

ALTER TABLE public.crm_lead_contexts ADD COLUMN media_url text;
ALTER TABLE public.crm_lead_contexts ADD CONSTRAINT crm_context_media_url CHECK (
  media_url IS NULL OR (
    char_length(media_url) BETWEEN 1 AND 2048
    AND media_url ~ '^https://drive[.]google[.]com/[^[:space:]]+$'
  )
);

CREATE FUNCTION private.crm_normalize_drive_url(p_media_url text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE normalized text := NULLIF(btrim(p_media_url), '');
BEGIN
  IF normalized IS NULL THEN RETURN NULL; END IF;
  IF char_length(normalized) > 2048
    OR normalized !~ '^https://drive[.]google[.]com/[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Use um link compartilhável válido do Google Drive'
      USING ERRCODE = '22023';
  END IF;
  RETURN normalized;
END;
$$;
REVOKE ALL ON FUNCTION private.crm_normalize_drive_url(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_add_lead_context_with_media(
  p_lead_id uuid, p_context_type text, p_content text, p_media_url text
)
RETURNS public.crm_lead_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE result public.crm_lead_contexts; normalized_url text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF NOT public.registration_has_access() OR NOT (public.crm_can('sdr') OR public.crm_can('closer')) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  normalized_url := private.crm_normalize_drive_url(p_media_url);
  result := public.crm_add_lead_context(p_lead_id, p_context_type, p_content);
  UPDATE public.crm_lead_contexts SET media_url = normalized_url
    WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.crm_import_txt_context_with_media(
  p_lead_id uuid, p_context_type text, p_content text,
  p_source_name text, p_source_content text, p_media_url text
)
RETURNS public.crm_lead_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE result public.crm_lead_contexts; normalized_url text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF NOT public.registration_has_access() OR NOT (public.crm_can('sdr') OR public.crm_can('closer')) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  normalized_url := private.crm_normalize_drive_url(p_media_url);
  result := public.crm_import_txt_context(
    p_lead_id, p_context_type, p_content, p_source_name, p_source_content
  );
  UPDATE public.crm_lead_contexts SET media_url = normalized_url
    WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.crm_update_lead_context_with_media(
  p_context_id uuid, p_context_type text, p_content text,
  p_media_url text, p_expected_version bigint
)
RETURNS public.crm_lead_contexts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE result public.crm_lead_contexts; normalized_url text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF NOT public.registration_has_access() OR NOT (public.crm_can('sdr') OR public.crm_can('closer')) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  normalized_url := private.crm_normalize_drive_url(p_media_url);
  result := public.crm_update_lead_context(
    p_context_id, p_context_type, p_content, p_expected_version
  );
  UPDATE public.crm_lead_contexts SET media_url = normalized_url
    WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_add_lead_context_with_media(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_import_txt_context_with_media(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_update_lead_context_with_media(uuid, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_add_lead_context_with_media(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_import_txt_context_with_media(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_lead_context_with_media(uuid, text, text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
