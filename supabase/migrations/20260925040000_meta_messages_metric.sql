BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.meta_traffic_daily
  ADD COLUMN messaging_conversations_started bigint NOT NULL DEFAULT 0
  CHECK(messaging_conversations_started>=0);

CREATE OR REPLACE FUNCTION public.meta_import_daily(p_filename text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b uuid; item jsonb; v_count integer:=0; v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
   OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
 INSERT INTO public.meta_import_batches(imported_by,filename,row_count)
 VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows)) RETURNING id INTO b;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   v_date:=(item->>'date')::date;
   v_level:=item->>'level'; v_account:=btrim(coalesce(item->>'account_id',''));
   v_campaign:=btrim(coalesce(item->>'campaign_id',''));
   v_adset:=btrim(coalesce(item->>'adset_id','')); v_ad:=btrim(coalesce(item->>'ad_id',''));
   IF v_date IS NULL OR v_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date
     OR v_level NOT IN ('campaign','adset','ad') OR v_account='' OR v_campaign=''
     OR (v_level IN ('adset','ad') AND v_adset='') OR (v_level='ad' AND v_ad='')
     OR coalesce(item->>'currency','BRL')<>'BRL'
   THEN RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores ou moeda'; END IF;
   INSERT INTO public.meta_traffic_daily(date,account_id,account_name,campaign_id,campaign_name,
     adset_id,adset_name,ad_id,ad_name,level,currency,attribution_window,spend,leads,purchases,
     purchase_value,impressions,reach,link_clicks,messaging_conversations_started,imported_by,import_batch_id)
   VALUES(v_date,v_account,left(coalesce(item->>'account_name',''),160),v_campaign,
     left(coalesce(item->>'campaign_name',''),160),v_adset,left(coalesce(item->>'adset_name',''),160),
     v_ad,left(coalesce(item->>'ad_name',''),160),v_level,'BRL',
     left(coalesce(nullif(item->>'attribution_window',''),'Conforme exportação Meta'),120),
     (item->>'spend')::numeric,(item->>'leads')::integer,(item->>'purchases')::integer,
     coalesce((item->>'purchase_value')::numeric,0),coalesce((item->>'impressions')::bigint,0),
     coalesce((item->>'reach')::bigint,0),coalesce((item->>'link_clicks')::bigint,0),
     coalesce((item->>'messaging_conversations_started')::bigint,0),auth.uid(),b)
   ON CONFLICT(date,account_id,campaign_id,adset_id,ad_id) DO UPDATE SET
     account_name=excluded.account_name,campaign_name=excluded.campaign_name,
     adset_name=excluded.adset_name,ad_name=excluded.ad_name,level=excluded.level,
     attribution_window=excluded.attribution_window,spend=excluded.spend,
     leads=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'leads'
       THEN excluded.leads ELSE meta_traffic_daily.leads END,
     purchases=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'purchases'
       THEN excluded.purchases ELSE meta_traffic_daily.purchases END,
     purchase_value=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'purchase_value'
       THEN excluded.purchase_value ELSE meta_traffic_daily.purchase_value END,
     impressions=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'impressions'
       THEN excluded.impressions ELSE meta_traffic_daily.impressions END,
     reach=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'reach'
       THEN excluded.reach ELSE meta_traffic_daily.reach END,
     link_clicks=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'link_clicks'
       THEN excluded.link_clicks ELSE meta_traffic_daily.link_clicks END,
     messaging_conversations_started=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'messaging_conversations_started'
       THEN excluded.messaging_conversations_started ELSE meta_traffic_daily.messaging_conversations_started END,
     imported_by=excluded.imported_by,import_batch_id=excluded.import_batch_id,updated_at=clock_timestamp();
   v_count:=v_count+1;
 END LOOP;
 RETURN jsonb_build_object('batch_id',b,'rows',v_count);
END $$;
COMMIT;
