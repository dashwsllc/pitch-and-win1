BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE INDEX meta_cohort_generated_campaign ON public.meta_form_leads(((created_time AT TIME ZONE 'America/Sao_Paulo')::date),campaign_id);
CREATE INDEX meta_cohort_campaign_accounts ON public.meta_traffic_daily(campaign_id,account_id);
CREATE INDEX meta_cohort_approved_reviews ON public.meta_capture_reviews(account_id,level,status);

-- Commercial facts keep the generated-lead calendar. A metric source never
-- invents a source for a contact, sale or revenue amount.
CREATE FUNCTION public.meta_traffic_cohort(p_start date,p_end date,p_account_id text DEFAULT NULL,p_campaign_id text DEFAULT NULL,p_source text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account text; result jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>3660
  OR p_source IS NOT NULL AND p_source NOT IN ('api','csv','manual_legacy') THEN RAISE EXCEPTION 'Filtro de coorte inválido' USING ERRCODE='22023'; END IF;
 account:=CASE WHEN p_account_id IS NOT NULL THEN public.meta_normalize_account_id(p_account_id) END;
 WITH identities AS (
  SELECT d.campaign_id,array_agg(DISTINCT d.account_id) accounts,max(d.campaign_name) campaign_name
  FROM public.meta_traffic_daily d WHERE d.campaign_id<>'' GROUP BY d.campaign_id
 ), contacts AS (
  SELECT m.id contact_id,m.campaign_id,m.campaign_name,m.approval_status,l.id crm_id
  FROM public.meta_form_leads m LEFT JOIN public.crm_leads l ON l.id=m.crm_lead_id AND l.meta_form_lead_id=m.id
  WHERE (m.created_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end
   AND (p_campaign_id IS NULL OR m.campaign_id=p_campaign_id)
 ), commercial AS (
  SELECT c.campaign_id,max(c.campaign_name) campaign_name,count(DISTINCT c.contact_id) received,
   count(DISTINCT c.contact_id) FILTER(WHERE c.approval_status='pendente') pending,count(DISTINCT c.contact_id) FILTER(WHERE c.approval_status='aprovado') approved,
   count(DISTINCT c.contact_id) FILTER(WHERE c.crm_id IS NOT NULL AND c.approval_status='aprovado') linked_crm,
   count(v.id) FILTER(WHERE c.approval_status='aprovado' AND v.approval_status='aprovada') confirmed_sales,
   coalesce(sum(v.valor_venda) FILTER(WHERE c.approval_status='aprovado' AND v.approval_status='aprovada'),0) confirmed_revenue
  FROM contacts c LEFT JOIN public.vendas v ON v.crm_lead_id=c.crm_id GROUP BY c.campaign_id
 ), scoped_spend AS (
  SELECT d.* FROM public.meta_traffic_daily d WHERE d.level='campaign' AND d.date BETWEEN p_start AND p_end
   AND (account IS NULL OR d.account_id=account) AND (p_campaign_id IS NULL OR d.campaign_id=p_campaign_id)
 ), universe AS (
  SELECT campaign_id FROM scoped_spend UNION
  SELECT c.campaign_id FROM commercial c JOIN identities i USING(campaign_id)
   WHERE c.campaign_id<>'' AND (account IS NULL OR account=ANY(i.accounts))
 ), coverage AS (
  SELECT u.campaign_id,i.campaign_name,i.accounts,
   -- Complete API segments can cover zero-spend days, including an empty capture.
   coalesce((SELECT range_agg(daterange((segment->>'start')::date,(segment->>'end')::date+1,'[)')) @> daterange(p_start,p_end+1,'[)')
     FROM public.meta_capture_reviews r CROSS JOIN LATERAL jsonb_array_elements(r.manifest->'segments') segment
     JOIN public.meta_sync_runs run ON run.id=(segment->>'run_id')::uuid
     WHERE r.account_id=i.accounts[1] AND r.level='campaign' AND r.status='aprovado'
      AND r.manifest->>'definition_version'='canonical-v1' AND r.manifest->'account'->>'id'=i.accounts[1]
      AND r.manifest->'account'->>'currency'='BRL' AND r.manifest->'account'->>'timezone'='America/Sao_Paulo'
      AND segment->>'coverage'='complete' AND run.coverage_state='complete' AND run.status='success'),false) full_api,
   EXISTS(SELECT 1 FROM scoped_spend d WHERE d.campaign_id=u.campaign_id AND (d.source<>'api' OR p_source IS NOT NULL AND d.source<>p_source)) other_source,
   EXISTS(SELECT 1 FROM scoped_spend d WHERE d.campaign_id=u.campaign_id AND d.source='api'
     AND (d.capture_review_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.meta_capture_reviews r WHERE r.id=d.capture_review_id AND r.status='aprovado')
       OR d.available_metrics IS NULL OR NOT 'spend'=ANY(d.available_metrics)
       OR d.original_key IS NOT NULL AND d.original_key->>2 IS DISTINCT FROM d.campaign_id)) unverified_rows,
   EXISTS(SELECT 1 FROM public.meta_capture_reviews r WHERE r.account_id=i.accounts[1] AND r.level='campaign' AND r.status='pendente'
     AND r.window_start<=p_end AND r.window_end>=p_start)
   OR EXISTS(SELECT 1 FROM public.meta_sync_runs run WHERE run.account_id=i.accounts[1] AND run.level='campaign' AND run.coverage_state='partial'
     AND run.window_start<=p_end AND run.window_end>=p_start AND run.started_at>coalesce((SELECT max(r.reviewed_at) FROM public.meta_capture_reviews r
       WHERE r.account_id=i.accounts[1] AND r.level='campaign' AND r.status='aprovado'),'-infinity'::timestamptz)) unfinished
  FROM universe u JOIN identities i USING(campaign_id)
 ), campaigns AS (
  SELECT cv.campaign_id,coalesce(nullif(cv.campaign_name,''),c.campaign_name,cv.campaign_id) campaign_name,
   coalesce(c.received,0) received,coalesce(c.pending,0) pending,coalesce(c.approved,0) approved,coalesce(c.linked_crm,0) linked_crm,
   coalesce(c.confirmed_sales,0) confirmed_sales,coalesce(c.confirmed_revenue,0) confirmed_revenue,
   CASE WHEN cardinality(cv.accounts)<>1 OR NOT EXISTS(SELECT 1 FROM public.meta_ad_accounts a WHERE a.account_id=cv.accounts[1]
      AND a.currency='BRL' AND a.timezone='America/Sao_Paulo') OR cv.unverified_rows THEN 'unknown'
    WHEN cv.other_source OR cv.unfinished THEN 'partial' WHEN cv.full_api THEN 'complete' ELSE 'unknown' END coverage
  FROM coverage cv LEFT JOIN commercial c USING(campaign_id)
 ), unattributed AS (
  SELECT count(*) total FROM contacts c LEFT JOIN identities i USING(campaign_id)
  WHERE c.campaign_id='' OR i.campaign_id IS NULL OR cardinality(i.accounts)<>1
 ), reasons AS (
  SELECT 'Campanha '||campaign_id||': cobertura de gasto '||coverage||'; CPA e ROAS reais indisponíveis.' reason FROM campaigns WHERE coverage<>'complete'
  UNION SELECT 'Há contatos sem campanha/conta comprovada.' WHERE (SELECT total FROM unattributed)>0
  UNION SELECT 'Há contatos aprovados sem vínculo com o CRM.' WHERE EXISTS(SELECT 1 FROM campaigns WHERE approved>linked_crm)
  UNION SELECT 'Nenhuma campanha com identidade comprovada no período.' WHERE NOT EXISTS(SELECT 1 FROM campaigns)
 )
 SELECT jsonb_build_object('state',CASE WHEN EXISTS(SELECT 1 FROM campaigns) AND NOT EXISTS(SELECT 1 FROM campaigns WHERE coverage<>'complete')
     AND (SELECT total FROM unattributed)=0 THEN 'ready' ELSE 'insufficient' END,
  'reasons',coalesce((SELECT jsonb_agg(reason ORDER BY reason) FROM reasons),'[]'::jsonb),
  'campaigns',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.campaign_id) FROM campaigns c),'[]'::jsonb),
  'unattributed_contacts',(SELECT total FROM unattributed)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_traffic_cohort(date,date,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_traffic_cohort(date,date,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
