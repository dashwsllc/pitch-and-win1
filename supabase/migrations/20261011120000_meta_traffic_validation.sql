-- Validate at the database boundary, including direct RPC callers.
BEGIN;
CREATE OR REPLACE FUNCTION public.meta_normalize_account_id(p_id text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE v text:=regexp_replace(btrim(coalesce(p_id,'')),'^act_','');
BEGIN
 IF v !~ '^[0-9]{1,80}$' THEN RAISE EXCEPTION 'ID de conta Meta inválido' USING ERRCODE='22023'; END IF;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.meta_traffic_identity(item jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_array(item->>'date',public.meta_normalize_account_id(item->>'account_id'),btrim(item->>'campaign_id'),
   btrim(coalesce(item->>'adset_id','')),btrim(coalesce(item->>'ad_id','')))::text;
$$;
CREATE OR REPLACE FUNCTION public.meta_assert_account_identity(p_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.meta_ad_accounts WHERE account_id<>p_id AND regexp_replace(btrim(account_id),'^act_','')=p_id)
   OR EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id<>p_id AND regexp_replace(btrim(account_id),'^act_','')=p_id) THEN
   RAISE EXCEPTION 'Conta legada requer revisão de identidade antes de importar ou conectar' USING ERRCODE='23505'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.meta_validate_traffic_row(item jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE day date; lvl text; acct text; campaign text; adset text; ad text; key text; amount numeric; max_value numeric; today date;
BEGIN
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'Data ou linha inválida' USING ERRCODE='22023'; END IF;
 BEGIN day:=(item->>'date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Data inválida' USING ERRCODE='22023'; END;
 acct:=public.meta_normalize_account_id(item->>'account_id');
 PERFORM public.meta_assert_account_identity(acct);
 today:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
 -- Only a service capture may use the registered account timezone.
 IF auth.role()='service_role' THEN
   SELECT (now() AT TIME ZONE a.timezone)::date INTO today FROM public.meta_ad_accounts a WHERE a.account_id=acct;
   today:=coalesce(today,(now() AT TIME ZONE 'America/Sao_Paulo')::date);
 END IF;
 lvl:=item->>'level'; campaign:=btrim(coalesce(item->>'campaign_id',''));
 adset:=btrim(coalesce(item->>'adset_id','')); ad:=btrim(coalesce(item->>'ad_id',''));
 IF day>today OR lvl IS NULL OR lvl NOT IN ('campaign','adset','ad')
   OR length(campaign) NOT BETWEEN 1 AND 80 OR length(adset)>80 OR length(ad)>80
   OR (lvl IN ('adset','ad') AND adset='') OR (lvl='ad' AND ad='')
   OR (lvl='campaign' AND (adset<>'' OR ad<>'')) OR (lvl='adset' AND ad<>'')
   OR coalesce(item->>'currency','BRL')<>'BRL'
   OR length(btrim(coalesce(item->>'campaign_name',''))) NOT BETWEEN 1 AND 160
   OR length(coalesce(item->>'adset_name',''))>160 OR length(coalesce(item->>'ad_name',''))>160
   OR length(coalesce(item->>'objective',''))>80 THEN
   RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores, texto ou moeda' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY ARRAY['spend','purchase_value','leads','purchases','impressions','reach','link_clicks','messaging_conversations_started'] LOOP
   IF NOT item ? key THEN CONTINUE; END IF;
   IF jsonb_typeof(item->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Métrica % deve ser numérica',key USING ERRCODE='22023'; END IF;
   amount:=(item->>key)::numeric;
   max_value:=CASE WHEN key='spend' THEN 100000000 WHEN key='purchase_value' THEN 99999999999999.99
     WHEN key IN ('leads','purchases') THEN 2147483647 ELSE 9007199254740991 END;
   IF amount<0 OR amount>max_value OR (key NOT IN ('spend','purchase_value') AND amount<>trunc(amount)) THEN
     RAISE EXCEPTION 'Métrica % fora dos limites',key USING ERRCODE='22023'; END IF;
 END LOOP;
 IF item ? 'present_metrics' AND (jsonb_typeof(item->'present_metrics') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'present_metrics') v WHERE jsonb_typeof(v)<>'string'
     OR v#>>'{}' NOT IN ('objective','leads','purchases','purchase_value','impressions','reach','link_clicks','messaging_conversations_started'))) THEN
   RAISE EXCEPTION 'Disponibilidade de métricas inválida' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_normalize_account_id(text),public.meta_traffic_identity(jsonb),public.meta_assert_account_identity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_normalize_account_id(text),public.meta_traffic_identity(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.meta_import_daily(p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE b uuid; item jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
  -- Valida cada linha antes de existir um lote pendente, para não aceitar lixo agora e falhar só na aprovação.
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_validate_traffic_row(item);
  END LOOP;
  SELECT jsonb_agg(value||jsonb_build_object('account_id',public.meta_normalize_account_id(value->>'account_id'))) INTO p_rows FROM jsonb_array_elements(p_rows);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY public.meta_traffic_identity(r) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Identidade repetida no arquivo' USING ERRCODE='22023'; END IF;
  INSERT INTO public.meta_import_batches(imported_by,filename,row_count,status,rows)
  VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows),'pendente',p_rows) RETURNING id INTO b;
  RETURN jsonb_build_object('batch_id',b,'rows',jsonb_array_length(p_rows));
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_edit_import_row(p_kind text, p_batch_id uuid, p_row_index integer, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE rows_json jsonb; before_row jsonb; after_row jsonb; version timestamptz; decision text; origin text; filename text; delta jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  PERFORM public.meta_validate_edit(p_kind,p_patch,p_reason);
  IF p_kind='leads' THEN
    SELECT rows,updated_at,status,'csv',b.filename INTO rows_json,version,decision,origin,filename FROM public.meta_lead_import_batches b WHERE id=p_batch_id FOR UPDATE;
  ELSE
    SELECT rows,updated_at,status,source,b.filename INTO rows_json,version,decision,origin,filename FROM public.meta_import_batches b WHERE id=p_batch_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF version IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Importação alterada, recarregue antes de editar' USING ERRCODE='40001'; END IF;
  IF p_row_index IS NULL OR p_row_index<0 OR p_row_index>=jsonb_array_length(rows_json) THEN RAISE EXCEPTION 'Linha inválida'; END IF;
  before_row:=rows_json->p_row_index; after_row:=before_row||p_patch;
  delta:=public.meta_edit_diff(before_row,after_row);
  IF delta='[]' THEN RETURN jsonb_build_object('updated_at',version); END IF;
  IF p_kind='metrics' THEN
    after_row:=after_row||jsonb_build_object('account_id',public.meta_normalize_account_id(after_row->>'account_id'));
    PERFORM public.meta_validate_traffic_row(after_row);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows_json) WITH ORDINALITY r(value,n)
      WHERE n<>p_row_index+1 AND public.meta_traffic_identity(value)=public.meta_traffic_identity(after_row)) THEN
      RAISE EXCEPTION 'A edição ocupa a identidade de outra linha do lote' USING ERRCODE='23505'; END IF;
    IF public.meta_traffic_identity(before_row) IS DISTINCT FROM public.meta_traffic_identity(after_row)
      AND EXISTS(SELECT 1 FROM public.meta_traffic_daily d WHERE public.meta_traffic_identity(to_jsonb(d))=public.meta_traffic_identity(after_row)) THEN
      RAISE EXCEPTION 'A edição ocupa a identidade de uma linha publicada' USING ERRCODE='23505'; END IF;
    IF origin='api' AND (after_row->>'account_id' IS DISTINCT FROM public.meta_normalize_account_id(before_row->>'account_id')
      OR after_row->>'level' IS DISTINCT FROM before_row->>'level') THEN
      RAISE EXCEPTION 'Conta e nível pertencem à captura' USING ERRCODE='22023'; END IF;
    -- Preserve numeric/default and identity constraints already used by published rows.
    PERFORM public.meta_validate_edit('metrics',jsonb_build_object('spend',coalesce(after_row->'spend','0'),
      'leads',coalesce(after_row->'leads','0'),'purchases',coalesce(after_row->'purchases','0')),p_reason);
    IF (after_row->>'level'='campaign' AND (coalesce(after_row->>'adset_id','')<>'' OR coalesce(after_row->>'ad_id','')<>''))
      OR (after_row->>'level'='adset' AND coalesce(after_row->>'ad_id','')<>'')
      OR length(btrim(coalesce(after_row->>'campaign_name',''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Identificadores ou campanha inválidos'; END IF;
    after_row:=after_row||jsonb_build_object('traffic_edited',true,'traffic_original',coalesce(before_row->'traffic_original',before_row));
    IF after_row ? 'present_metrics' THEN
      after_row:=after_row||jsonb_build_object('present_metrics',(SELECT jsonb_agg(DISTINCT key) FROM
        (SELECT jsonb_array_elements_text(after_row->'present_metrics') key UNION ALL SELECT jsonb_object_keys(p_patch)) k));
    END IF;
  ELSE
    after_row:=after_row||jsonb_build_object('complete',length(btrim(coalesce(after_row->>'full_name','')))>=2
      AND length(btrim(coalesce(after_row->>'phone',''))) BETWEEN 8 AND 32
      AND coalesce(after_row->>'email','') ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
      AND length(btrim(coalesce(after_row->>'athlete_name','')))>=2 AND nullif(after_row->>'athlete_birth_date','') IS NOT NULL
      AND coalesce(after_row->>'athlete_position','') IN ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante'),
      'traffic_original',coalesce(before_row->'traffic_original',before_row));
  END IF;
  rows_json:=jsonb_set(rows_json,ARRAY[p_row_index::text],after_row);
  IF p_kind='leads' THEN UPDATE public.meta_lead_import_batches SET rows=rows_json,updated_at=clock_timestamp() WHERE id=p_batch_id RETURNING updated_at INTO version;
  ELSE UPDATE public.meta_import_batches SET rows=rows_json,updated_at=clock_timestamp() WHERE id=p_batch_id RETURNING updated_at INTO version; END IF;
  PERFORM public.meta_record_edit(CASE p_kind WHEN 'leads' THEN 'lead_batch' ELSE 'metrics_batch' END,p_batch_id,'batch.row_edited',origin,
    jsonb_build_object('reason',btrim(p_reason),'filename',filename,'row',p_row_index+1,'changes',delta));
  RETURN jsonb_build_object('updated_at',version);
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_upsert_traffic_row(item jsonb, p_source text, p_imported_by uuid, p_import_batch_id uuid, p_sync_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
  item:=item||jsonb_build_object('account_id',public.meta_normalize_account_id(item->>'account_id'));
  PERFORM public.meta_validate_traffic_row(item);
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
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_edit_traffic_row(p_id uuid, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old public.meta_traffic_daily; edited public.meta_traffic_daily;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_patch ? 'account_id' THEN p_patch:=p_patch||jsonb_build_object('account_id',public.meta_normalize_account_id(p_patch->>'account_id')); END IF;
  PERFORM public.meta_validate_edit('metrics',p_patch,p_reason);
  SELECT * INTO old FROM public.meta_traffic_daily WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Métrica não encontrada'; END IF;
  IF old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Métrica alterada, recarregue antes de editar' USING ERRCODE='40001'; END IF;
  IF public.meta_edit_diff(to_jsonb(old),to_jsonb(old)||p_patch)='[]' THEN RETURN to_jsonb(old); END IF;
  edited:=jsonb_populate_record(old,p_patch);
  PERFORM public.meta_validate_traffic_row(to_jsonb(edited));
  UPDATE public.meta_traffic_daily SET date=edited.date,account_id=edited.account_id,account_name=edited.account_name,
    campaign_id=edited.campaign_id,campaign_name=edited.campaign_name,adset_id=edited.adset_id,adset_name=edited.adset_name,
    ad_id=edited.ad_id,ad_name=edited.ad_name,level=edited.level,currency=edited.currency,attribution_window=edited.attribution_window,
    objective=edited.objective,spend=edited.spend,leads=edited.leads,purchases=edited.purchases,purchase_value=edited.purchase_value,
    impressions=edited.impressions,reach=edited.reach,link_clicks=edited.link_clicks,messaging_conversations_started=edited.messaging_conversations_started,
    traffic_edited_at=clock_timestamp(),traffic_edit_reason=btrim(p_reason),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO edited;
  RETURN to_jsonb(edited);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe uma métrica para esta data e identificação. Edite a linha existente.';
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_connect_ad_account(p_account_id text, p_account_name text, p_currency text DEFAULT 'BRL'::text, p_timezone text DEFAULT 'America/Sao_Paulo'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_id uuid; v_account text;
BEGIN
  IF NOT public.is_executive(auth.uid()) OR NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso Executive necessário' USING ERRCODE='42501'; END IF;
  v_account:=public.meta_normalize_account_id(p_account_id);
  PERFORM public.meta_assert_account_identity(v_account);
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) OR p_currency IS DISTINCT FROM 'BRL' THEN
    RAISE EXCEPTION 'Fuso ou moeda inválidos' USING ERRCODE='22023'; END IF;
  IF length(v_account) NOT BETWEEN 1 AND 80 OR p_currency<>'BRL' THEN RAISE EXCEPTION 'ID da conta ou moeda inválidos'; END IF;
  INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by,connected_at)
  VALUES(v_account,left(coalesce(p_account_name,''),160),p_currency,left(coalesce(p_timezone,'America/Sao_Paulo'),80),'active',auth.uid(),clock_timestamp())
  ON CONFLICT(account_id) DO UPDATE SET account_name=excluded.account_name,currency=excluded.currency,
    timezone=excluded.timezone,status='active',connected_by=excluded.connected_by,connected_at=clock_timestamp(),
    paused_by=NULL,paused_at=NULL,paused_reason=NULL,updated_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_disconnect_ad_account(p_account_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_executive(auth.uid()) OR NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso Executive necessário' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo (3 a 500 caracteres)'; END IF;
  UPDATE public.meta_ad_accounts SET status='paused',paused_by=auth.uid(),paused_at=clock_timestamp(),
    paused_reason=btrim(p_reason),updated_at=clock_timestamp() WHERE account_id=public.meta_normalize_account_id(p_account_id) AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada ou já pausada'; END IF;
END $function$
;
COMMIT;
