BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.meta_traffic_daily ALTER COLUMN imported_by DROP NOT NULL;
ALTER TABLE public.meta_traffic_daily ALTER COLUMN import_batch_id DROP NOT NULL;
ALTER TABLE public.meta_traffic_daily ADD COLUMN source text NOT NULL DEFAULT 'csv';
ALTER TABLE public.meta_traffic_daily ADD COLUMN sync_run_id uuid REFERENCES public.meta_sync_runs(id);
ALTER TABLE public.meta_traffic_daily ADD CONSTRAINT meta_traffic_daily_source_check
  CHECK (source IN ('csv','api','manual_legacy')) NOT VALID;
ALTER TABLE public.meta_traffic_daily ADD CONSTRAINT meta_traffic_daily_source_lineage CHECK (
  (source='csv' AND import_batch_id IS NOT NULL AND imported_by IS NOT NULL AND sync_run_id IS NULL) OR
  (source='api' AND sync_run_id IS NOT NULL AND import_batch_id IS NULL) OR
  (source='manual_legacy')
) NOT VALID;
ALTER TABLE public.meta_traffic_daily VALIDATE CONSTRAINT meta_traffic_daily_source_check;
ALTER TABLE public.meta_traffic_daily VALIDATE CONSTRAINT meta_traffic_daily_source_lineage;
-- Linhas de CSV ja existentes ja satisfazem a linhagem 'csv' (tem import_batch_id/imported_by desde sempre) - sem backfill.

-- Helper interno unico: SEM grant a ninguem. So e alcancavel de dentro de outra
-- SECURITY DEFINER function do mesmo dono (checagem de privilegio usa o definer).
CREATE OR REPLACE FUNCTION public.meta_upsert_traffic_row(item jsonb, p_source text,
  p_imported_by uuid, p_import_batch_id uuid, p_sync_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
  v_date:=(item->>'date')::date;
  v_level:=item->>'level'; v_account:=btrim(coalesce(item->>'account_id',''));
  v_campaign:=btrim(coalesce(item->>'campaign_id','')); v_adset:=btrim(coalesce(item->>'adset_id',''));
  v_ad:=btrim(coalesce(item->>'ad_id',''));
  IF v_date IS NULL OR v_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date
    OR v_level NOT IN ('campaign','adset','ad') OR v_account='' OR v_campaign=''
    OR (v_level IN ('adset','ad') AND v_adset='') OR (v_level='ad' AND v_ad='')
    OR coalesce(item->>'currency','BRL')<>'BRL'
  THEN RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores ou moeda'; END IF;
  INSERT INTO public.meta_traffic_daily(date,account_id,account_name,campaign_id,campaign_name,
    adset_id,adset_name,ad_id,ad_name,level,currency,attribution_window,objective,spend,leads,purchases,
    purchase_value,impressions,reach,link_clicks,messaging_conversations_started,
    source,imported_by,import_batch_id,sync_run_id)
  VALUES(v_date,v_account,left(coalesce(item->>'account_name',''),160),v_campaign,
    left(coalesce(item->>'campaign_name',''),160),v_adset,left(coalesce(item->>'adset_name',''),160),
    v_ad,left(coalesce(item->>'ad_name',''),160),v_level,'BRL',
    left(coalesce(nullif(item->>'attribution_window',''),'Conforme exportação Meta'),120),
    left(coalesce(nullif(item->>'objective',''),'nao_informado'),160),
    (item->>'spend')::numeric,(item->>'leads')::integer,(item->>'purchases')::integer,
    coalesce((item->>'purchase_value')::numeric,0),coalesce((item->>'impressions')::bigint,0),
    coalesce((item->>'reach')::bigint,0),coalesce((item->>'link_clicks')::bigint,0),
    coalesce((item->>'messaging_conversations_started')::bigint,0),
    p_source,p_imported_by,p_import_batch_id,p_sync_run_id)
  ON CONFLICT(date,account_id,campaign_id,adset_id,ad_id) DO UPDATE SET
    account_name=excluded.account_name,campaign_name=excluded.campaign_name,
    adset_name=excluded.adset_name,ad_name=excluded.ad_name,level=excluded.level,
    attribution_window=excluded.attribution_window,spend=excluded.spend,
    objective=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'objective' THEN excluded.objective ELSE meta_traffic_daily.objective END,
    leads=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'leads' THEN excluded.leads ELSE meta_traffic_daily.leads END,
    purchases=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'purchases' THEN excluded.purchases ELSE meta_traffic_daily.purchases END,
    purchase_value=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'purchase_value' THEN excluded.purchase_value ELSE meta_traffic_daily.purchase_value END,
    impressions=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'impressions' THEN excluded.impressions ELSE meta_traffic_daily.impressions END,
    reach=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'reach' THEN excluded.reach ELSE meta_traffic_daily.reach END,
    link_clicks=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'link_clicks' THEN excluded.link_clicks ELSE meta_traffic_daily.link_clicks END,
    messaging_conversations_started=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'messaging_conversations_started' THEN excluded.messaging_conversations_started ELSE meta_traffic_daily.messaging_conversations_started END,
    source=excluded.source,imported_by=excluded.imported_by,import_batch_id=excluded.import_batch_id,
    sync_run_id=excluded.sync_run_id,updated_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.meta_upsert_traffic_row(jsonb,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Wrapper CSV: mesmo contrato/retorno de hoje, so troca o corpo do loop pela chamada ao helper.
CREATE OR REPLACE FUNCTION public.meta_import_daily(p_filename text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b uuid; item jsonb; v_count integer:=0;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
  INSERT INTO public.meta_import_batches(imported_by,filename,row_count)
  VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows)) RETURNING id INTO b;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_upsert_traffic_row(item,'csv',auth.uid(),b,NULL);
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('batch_id',b,'rows',v_count);
END $$;

-- Wrapper API: so service_role. Exige um sync_run_id ja 'running' (criado por meta_sync_run_start),
-- entao nao da pra chamar isso avulso mesmo tendo a service key - precisa do ciclo start->import->finish.
CREATE OR REPLACE FUNCTION public.meta_import_daily_system(p_rows jsonb, p_sync_run_id uuid, p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; v_count integer:=0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'Quantidade de linhas inválida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meta_sync_runs WHERE id=p_sync_run_id AND status='running')
  THEN RAISE EXCEPTION 'sync_run_id inválido ou não está em execução'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_upsert_traffic_row(item,'api',p_actor,NULL,p_sync_run_id);
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('rows',v_count);
END $$;
REVOKE ALL ON FUNCTION public.meta_import_daily_system(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_import_daily_system(jsonb,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
