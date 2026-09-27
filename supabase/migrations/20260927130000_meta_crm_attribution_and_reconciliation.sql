BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Agregado de vendas reais do CRM ligadas a leads de formulario Meta, por
-- campanha, na coorte de geracao do lead (nao a data do relatorio Meta nem
-- a data de fechamento da venda). Recalculado ao vivo a partir de vendas:
-- cancelamento/estorno reduz o numero automaticamente, sem apagar historico
-- de importacao. Segue o padrao de crm_result_sale_links (agregado, sem PII,
-- SECURITY DEFINER) mas gated por traffic_has_access() — audiencia e Trafego.
CREATE OR REPLACE FUNCTION public.meta_crm_attribution_daily(p_start date,p_end date)
RETURNS TABLE(campaign_id text,campaign_name text,confirmed_sales bigint,confirmed_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end THEN RAISE EXCEPTION 'Período inválido'; END IF;
 RETURN QUERY
 SELECT mfl.campaign_id,max(mfl.campaign_name),
   count(*) FILTER (WHERE v.approval_status='aprovada'),
   coalesce(sum(v.valor_venda) FILTER (WHERE v.approval_status='aprovada'),0)
 FROM public.vendas v
 JOIN public.crm_leads l ON l.id=v.crm_lead_id
 JOIN public.meta_form_leads mfl ON mfl.id=l.meta_form_lead_id
 WHERE (l.lead_generated_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end
 GROUP BY mfl.campaign_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_crm_attribution_daily(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_crm_attribution_daily(date,date) TO authenticated;

-- Contagem de leads individuais recebidos via formulario (fila meta_form_leads)
-- por campanha/periodo, para comparar lado a lado com o agregado do CSV
-- (meta_traffic_daily.leads) sem misturar as duas fontes numa mesma coluna.
CREATE OR REPLACE FUNCTION public.meta_traffic_lead_reconciliation(p_start date,p_end date)
RETURNS TABLE(campaign_id text,campaign_name text,form_leads_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end THEN RAISE EXCEPTION 'Período inválido'; END IF;
 RETURN QUERY
 SELECT mfl.campaign_id,max(mfl.campaign_name),count(*)
 FROM public.meta_form_leads mfl
 WHERE (mfl.created_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end
   AND mfl.campaign_id<>''
 GROUP BY mfl.campaign_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_traffic_lead_reconciliation(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_traffic_lead_reconciliation(date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
