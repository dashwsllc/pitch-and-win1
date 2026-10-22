-- Estado dos leads no envio para a VOXEN, sem uma consulta por lead.
-- A versao anterior de crm_voxen_sync_states perguntava "este lead ja tem cadastro na VOXEN?" lead por lead (crm_context_lead_has_voxen: ~2 ms de planejamento cada;
-- medido em producao em 22/10: 0,5 s com o banco aquecido e 2,1 s com ele frio para os 230 leads de hoje, e cresce com o CRM). A aba VOXEN e a ficha do lead chamam isso
-- a cada mudanca no CRM, e a sessao do app corta em 8 s. Agora a lista dos ja cadastrados sai de UMA consulta (~7 ms), com a MESMA regra de crm_context_lead_has_voxen:
-- registro do site com ID valido da VOXEN, ligado ao lead pelo site, pelo formulario ou por crm_form_answer_links. Em producao a lista nova e a antiga deram os mesmos
-- 73 leads (0 de diferenca nos dois sentidos). Nada e gravado nem enfileirado; crm_context_lead_has_voxen continua existindo (envio, corpo do evento).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.crm_context_registered_leads() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT c.id FROM public.crm_leads c JOIN public.meta_form_leads w ON w.id=c.meta_form_lead_id
  WHERE w.entry_channel='website' AND w.meta_lead_id ~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 UNION
 SELECT c.id FROM public.crm_leads c JOIN public.meta_form_leads w ON w.answers_form_lead_id=c.meta_form_lead_id
  WHERE w.entry_channel='website' AND w.meta_lead_id ~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 UNION
 SELECT c.id FROM public.crm_form_answer_links k JOIN public.crm_leads c ON c.id=k.crm_lead_id JOIN public.meta_form_leads w ON w.answers_form_lead_id=k.form_lead_id
  WHERE w.entry_channel='website' AND w.meta_lead_id ~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- Leads do CRM com contexto (icone aceso) e sem cadastro na VOXEN. Mesma regra de antes; a lista dos cadastrados e calculada uma vez.
CREATE OR REPLACE FUNCTION public.crm_context_prospect_candidates() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_off integer:=0; v_page uuid[]; v_reg uuid[]:=ARRAY(SELECT public.crm_context_registered_leads());
BEGIN
 LOOP
  SELECT array_agg(s.lead_id ORDER BY s.lead_id) INTO v_page FROM public.crm_context_summary(v_off,500) s;
  EXIT WHEN v_page IS NULL;
  RETURN QUERY SELECT x FROM unnest(v_page) x WHERE x<>ALL(v_reg);
  EXIT WHEN array_length(v_page,1)<500;
  v_off:=v_off+500;
 END LOOP;
END $$;

-- Estado de cada lead para o app: so ids e estados (nenhum dado pessoal). Igual a versao anterior, exceto a origem da lista de cadastrados.
CREATE OR REPLACE FUNCTION public.crm_voxen_sync_states() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso ao CRM necessário' USING ERRCODE='42501'; END IF;
 RETURN (
  WITH reg AS (SELECT r AS lead_id FROM public.crm_context_registered_leads() r),
  latest AS (SELECT DISTINCT ON (o.source_lead_id) o.source_lead_id,o.state,o.receipt->>'status' AS receipt_status,coalesce(o.delivered_at,o.updated_at) AS at
    FROM public.crm_context_outbox o
    WHERE o.payload->>'kind'='prospect_context' AND coalesce(o.payload->'link'->>'basis','')<>'teste de integração'
    ORDER BY o.source_lead_id,o.source_revision DESC),
  items AS (
   SELECT r.lead_id,'registered'::text AS state,NULL::timestamptz AS at FROM reg r
   UNION ALL
   SELECT p.lead_id,
    CASE WHEN NOT p.enabled THEN 'stopped' WHEN l.state IS NULL THEN 'waiting' WHEN l.state IN('pending','processing') THEN 'pending'
     WHEN l.state='blocked' THEN 'blocked' WHEN l.receipt_status='quarantined' THEN 'quarantined' ELSE 'sent' END,
    coalesce(l.at,p.enabled_at)
   FROM public.crm_voxen_prospects p LEFT JOIN latest l ON l.source_lead_id=p.lead_id
   WHERE NOT EXISTS(SELECT 1 FROM reg r WHERE r.lead_id=p.lead_id))
  SELECT jsonb_build_object('ready',public.crm_context_rehearsal_accepted(),
   'rows',coalesce(jsonb_agg(jsonb_build_object('lead_id',i.lead_id,'state',i.state,'at',i.at) ORDER BY i.lead_id),'[]'::jsonb))
  FROM items i);
END $$;

-- A nova e interna (so as funcoes SECURITY DEFINER a chamam); as outras duas mantem as permissoes que ja tinham.
REVOKE ALL ON FUNCTION public.crm_context_registered_leads(),public.crm_context_prospect_candidates(),public.crm_voxen_sync_states() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_voxen_sync_states() TO authenticated;
COMMIT;
