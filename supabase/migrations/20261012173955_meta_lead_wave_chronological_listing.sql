-- O número identifica a leva; o horário dos leads determina a ordem da lista.
-- Depois de um backfill, uma leva nova pode conter leads mais antigos que uma leva decidida.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.meta_wave_list(p_status text DEFAULT NULL,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pendente','aprovada','rejeitada') THEN RAISE EXCEPTION 'Status de leva inválido' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Paginação inválida' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'count',(SELECT count(*) FROM public.meta_lead_waves WHERE p_status IS NULL OR status=p_status),
    'pending_waves',(SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente'),
    'pending_leads',(SELECT count(*) FROM public.meta_form_leads WHERE approval_status='pendente'),
    'failed_leads',(SELECT count(*) FROM public.meta_form_leads WHERE approval_status='aprovado' AND crm_lead_id IS NULL AND crm_sync_status='falhou'),
    'newest_pending_lead_at',(SELECT max(created_time) FROM public.meta_form_leads WHERE approval_status='pendente'),
    'needs_rebuild',public.meta_wave_needs_rebuild(),
    'waves',coalesce((SELECT jsonb_agg(public.meta_wave_summary(page.id) ORDER BY page.last_lead_at DESC,page.number DESC)
      FROM (
        SELECT w.id,w.number,coalesce(max(l.created_time),w.created_at) AS last_lead_at
        FROM public.meta_lead_waves w LEFT JOIN public.meta_form_leads l ON l.wave_id=w.id
        WHERE p_status IS NULL OR w.status=p_status
        GROUP BY w.id ORDER BY last_lead_at DESC,w.number DESC LIMIT p_limit OFFSET p_offset
      ) page),'[]'))
  INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_list(text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_list(text,integer,integer) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
