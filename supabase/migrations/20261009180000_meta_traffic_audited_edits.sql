-- Traffic edits retain decisions, source identifiers and SDR workflow. Audit is atomic.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
ALTER TABLE public.meta_form_leads ADD COLUMN traffic_edited_at timestamptz,
  ADD COLUMN source_snapshot jsonb;
ALTER TABLE public.meta_traffic_daily ADD COLUMN traffic_edited_at timestamptz,
  ADD COLUMN traffic_edit_reason text CHECK(traffic_edit_reason IS NULL OR length(traffic_edit_reason) BETWEEN 3 AND 500);
ALTER TABLE public.meta_audit_events DROP CONSTRAINT meta_audit_events_entity_type_check;
ALTER TABLE public.meta_audit_events ADD CONSTRAINT meta_audit_events_entity_type_check
  CHECK(entity_type IN ('lead','lead_batch','metrics_batch','metrics_row'));

CREATE FUNCTION public.meta_edit_diff(p_before jsonb,p_after jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',key,'before',p_before->key,'after',p_after->key) ORDER BY key),'[]')
  FROM jsonb_object_keys(p_after) k(key) WHERE p_before->key IS DISTINCT FROM p_after->key
$$;
CREATE FUNCTION public.meta_record_edit(p_type text,p_id uuid,p_action text,p_origin text,p_summary jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  INSERT INTO public.meta_audit_events(entity_type,entity_id,action,origin,actor_id,actor_name,actor_roles,summary)
  VALUES(p_type,p_id,p_action,p_origin,auth.uid(),
    (SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),
    coalesce((SELECT array_agg(role::text ORDER BY role::text) FROM public.user_roles WHERE user_id=auth.uid()),'{}'),p_summary)
$$;

-- Shared allowlist/validation prevents clients from editing decisions, assignments or provenance.
CREATE FUNCTION public.meta_validate_edit(p_kind text,p_patch jsonb,p_reason text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE key text; value jsonb; allowed text[];
BEGIN
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da alteração (3 a 500 caracteres)'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}' OR pg_column_size(p_patch)>45000 THEN RAISE EXCEPTION 'Alterações inválidas'; END IF;
  allowed:=CASE p_kind WHEN 'leads' THEN ARRAY['full_name','phone','email','athlete_name','athlete_birth_date','athlete_position',
    'athlete_age','athlete_height_cm','athlete_weight_kg','city_state','performance_report_url','raw_notes','created_time',
    'page_id','form_id','form_name','campaign_id','campaign_name','ad_id','field_data']
    WHEN 'metrics' THEN ARRAY['date','account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
      'level','currency','attribution_window','objective','spend','leads','purchases','purchase_value','impressions','reach','link_clicks','messaging_conversations_started'] END;
  IF allowed IS NULL THEN RAISE EXCEPTION 'Tipo de edição inválido'; END IF;
  FOR key,value IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF NOT key=ANY(allowed) THEN RAISE EXCEPTION 'Campo não editável: %',key; END IF;
    IF key='field_data' THEN
      IF jsonb_typeof(value)<>'array' OR pg_column_size(value)>30000 OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(value) a WHERE jsonb_typeof(a)<>'object'
          OR jsonb_typeof(a->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'values') IS DISTINCT FROM 'array'
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a->'values')='array' THEN a->'values' ELSE '[]' END) v WHERE jsonb_typeof(v)<>'string'))
      THEN RAISE EXCEPTION 'Respostas inválidas'; END IF;
    ELSIF p_kind='metrics' AND key IN ('spend','leads','purchases','purchase_value','impressions','reach','link_clicks','messaging_conversations_started') THEN
      IF jsonb_typeof(value)<>'number' OR (value::text)::numeric<0 OR (value::text)::numeric>100000000
        OR (key NOT IN ('spend','purchase_value') AND trunc((value::text)::numeric)<>(value::text)::numeric)
      THEN RAISE EXCEPTION 'Métrica inválida: %',key; END IF;
    ELSE
      IF jsonb_typeof(value)<>'string' OR length(value#>>'{}')>(CASE WHEN key='raw_notes' THEN 9500 WHEN key='email' THEN 254
        WHEN key='performance_report_url' THEN 2048 WHEN key IN ('phone','athlete_age','athlete_height_cm','athlete_weight_kg','athlete_birth_date') THEN 40
        WHEN key IN ('page_id','form_id','campaign_id','adset_id','ad_id','account_id') THEN CASE WHEN p_kind='leads' THEN 100 ELSE 80 END ELSE 160 END)
      THEN RAISE EXCEPTION 'Valor inválido: %',key; END IF;
      IF key='created_time' AND (nullif(value#>>'{}','')::timestamptz IS NULL OR (value#>>'{}')::timestamptz>clock_timestamp()) THEN RAISE EXCEPTION 'Data do lead inválida'; END IF;
      IF key='athlete_birth_date' AND value#>>'{}'<>'' AND ((value#>>'{}')::date<'1900-01-01' OR (value#>>'{}')::date>current_date) THEN RAISE EXCEPTION 'Nascimento inválido'; END IF;
      IF key IN ('athlete_age','athlete_height_cm','athlete_weight_kg') AND value#>>'{}'<>'' AND (
        (value#>>'{}')::numeric < CASE key WHEN 'athlete_height_cm' THEN 30 ELSE 1 END OR
        (value#>>'{}')::numeric > CASE key WHEN 'athlete_age' THEN 80 WHEN 'athlete_height_cm' THEN 250 ELSE 300 END OR
        (key='athlete_age' AND trunc((value#>>'{}')::numeric)<>(value#>>'{}')::numeric)) THEN RAISE EXCEPTION 'Valor do atleta inválido: %',key; END IF;
      IF key='performance_report_url' AND value#>>'{}'<>'' AND value#>>'{}' !~ '^https://' THEN RAISE EXCEPTION 'Use um link HTTPS'; END IF;
    END IF;
  END LOOP;
END $$;

-- Snapshot includes CURRENT CRM contact data, not an outdated import snapshot.
CREATE FUNCTION public.meta_get_traffic_lead(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f public.meta_form_leads; c public.crm_leads; contact jsonb; values_json jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  SELECT * INTO f FROM public.meta_form_leads WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado'; END IF;
  contact:=coalesce(public.meta_contact_from_form(f),'{}');
  IF f.crm_lead_id IS NOT NULL THEN
    SELECT * INTO STRICT c FROM public.crm_leads WHERE id=f.crm_lead_id AND meta_form_lead_id=f.id;
    contact:=contact||jsonb_build_object('name',c.name,'phone',coalesce(c.phone,''),'email',coalesce(c.email,''),
      'athlete_name',coalesce(c.athlete_name,''),'athlete_birth_date',coalesce(c.athlete_birth_date::text,''),
      'athlete_position',coalesce(c.athlete_position,''),'athlete_age',coalesce(c.athlete_age::text,''),
      'athlete_height_cm',coalesce(c.athlete_height_cm::text,''),'athlete_weight_kg',coalesce(c.athlete_weight_kg::text,''),
      'city_state',coalesce(c.city_state,''),'performance_report_url',coalesce(c.performance_report_url,''),'raw_notes',coalesce(c.observations,''));
  END IF;
  SELECT jsonb_object_agg(key,coalesce(value,'""')) INTO values_json FROM jsonb_each(contact) WHERE key IN
    ('phone','email','athlete_name','athlete_birth_date','athlete_position','athlete_age','athlete_height_cm','athlete_weight_kg','city_state','performance_report_url','raw_notes');
  values_json:=coalesce(values_json,'{}')||jsonb_build_object('full_name',contact->>'name','created_time',f.created_time,
    'page_id',f.page_id,'form_id',f.form_id,'form_name',f.form_name,'campaign_id',f.campaign_id,'campaign_name',f.campaign_name,'ad_id',f.ad_id,'field_data',f.field_data);
  RETURN jsonb_build_object('values',values_json,'updated_at',f.updated_at,'crm_version',c.version,'crm_id',f.crm_lead_id);
END $$;

CREATE FUNCTION public.meta_edit_form_lead(p_id uuid,p_expected_updated_at timestamptz,p_expected_crm_version bigint,p_patch jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f public.meta_form_leads; c public.crm_leads; data jsonb; snapshot jsonb; delta jsonb; contact_patch jsonb; key text; value jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  PERFORM public.meta_validate_edit('leads',p_patch,p_reason);
  SELECT * INTO f FROM public.meta_form_leads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado'; END IF;
  IF f.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Lead alterado, recarregue antes de editar' USING ERRCODE='40001'; END IF;
  IF f.crm_lead_id IS NOT NULL THEN
    SELECT * INTO STRICT c FROM public.crm_leads WHERE id=f.crm_lead_id AND meta_form_lead_id=f.id FOR UPDATE;
    IF c.version IS DISTINCT FROM p_expected_crm_version THEN RAISE EXCEPTION 'CRM alterado, recarregue antes de editar' USING ERRCODE='40001'; END IF;
  ELSIF p_expected_crm_version IS NOT NULL THEN RAISE EXCEPTION 'Vínculo CRM alterado, recarregue' USING ERRCODE='40001'; END IF;
  snapshot:=public.meta_get_traffic_lead(f.id); data:=(snapshot->'values')||p_patch;
  delta:=public.meta_edit_diff(snapshot->'values',data);
  IF delta='[]' THEN RETURN snapshot; END IF;
  contact_patch:='{}';
  FOR key,value IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF key=ANY(ARRAY['full_name','phone','email','athlete_name','athlete_birth_date','athlete_position','athlete_age','athlete_height_cm','athlete_weight_kg','city_state','performance_report_url','raw_notes']) THEN
      contact_patch:=contact_patch||jsonb_build_object(CASE key WHEN 'full_name' THEN 'name' ELSE key END,value);
    END IF;
  END LOOP;
  UPDATE public.meta_form_leads SET full_name=CASE WHEN p_patch ? 'full_name' THEN data->>'full_name' ELSE full_name END,
    phone=CASE WHEN p_patch ? 'phone' THEN data->>'phone' ELSE phone END,
    email=CASE WHEN p_patch ? 'email' THEN data->>'email' ELSE email END,
    page_id=data->>'page_id',form_id=data->>'form_id',form_name=data->>'form_name',campaign_id=data->>'campaign_id',campaign_name=data->>'campaign_name',
    ad_id=data->>'ad_id',created_time=(data->>'created_time')::timestamptz,field_data=data->'field_data',
    import_contact=coalesce(import_contact,'{}')||contact_patch,source_snapshot=coalesce(source_snapshot,to_jsonb(f)-'source_snapshot'),
    traffic_edited_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=f.id;
  IF c.id IS NOT NULL AND (contact_patch<>'{}' OR p_patch ? 'created_time') THEN
    -- Apply only requested fields: SDR notes, workflow and assignments are retained.
    UPDATE public.crm_leads SET
      name=CASE WHEN p_patch ? 'full_name' THEN data->>'full_name' ELSE name END,
      phone=CASE WHEN p_patch ? 'phone' THEN nullif(data->>'phone','') ELSE phone END,
      email=CASE WHEN p_patch ? 'email' THEN nullif(data->>'email','') ELSE email END,
      athlete_name=CASE WHEN p_patch ? 'athlete_name' THEN nullif(data->>'athlete_name','') ELSE athlete_name END,
      athlete_birth_date=CASE WHEN p_patch ? 'athlete_birth_date' THEN nullif(data->>'athlete_birth_date','')::date ELSE athlete_birth_date END,
      athlete_position=CASE WHEN p_patch ? 'athlete_position' THEN nullif(data->>'athlete_position','') ELSE athlete_position END,
      athlete_age=CASE WHEN p_patch ? 'athlete_age' THEN nullif(data->>'athlete_age','')::smallint ELSE athlete_age END,
      athlete_height_cm=CASE WHEN p_patch ? 'athlete_height_cm' THEN nullif(data->>'athlete_height_cm','')::numeric ELSE athlete_height_cm END,
      athlete_weight_kg=CASE WHEN p_patch ? 'athlete_weight_kg' THEN nullif(data->>'athlete_weight_kg','')::numeric ELSE athlete_weight_kg END,
      city_state=CASE WHEN p_patch ? 'city_state' THEN nullif(data->>'city_state','') ELSE city_state END,
      performance_report_url=CASE WHEN p_patch ? 'performance_report_url' THEN nullif(data->>'performance_report_url','') ELSE performance_report_url END,
      observations=CASE WHEN p_patch ? 'raw_notes' THEN data->>'raw_notes' ELSE observations END,
      lead_generated_at=CASE WHEN p_patch ? 'created_time' THEN (data->>'created_time')::timestamptz ELSE lead_generated_at END,
      updated_at=clock_timestamp() WHERE id=c.id;
  END IF;
  PERFORM public.meta_record_edit('lead',f.id,'lead.edited',CASE WHEN f.lead_import_batch_id IS NULL THEN 'api' ELSE 'csv' END,
    jsonb_build_object('reason',btrim(p_reason),'changes',delta,'crm_lead_id',c.id,'approval_status',f.approval_status));
  RETURN public.meta_get_traffic_lead(f.id);
END $$;

CREATE FUNCTION public.meta_edit_import_row(p_kind text,p_batch_id uuid,p_row_index integer,p_expected_updated_at timestamptz,p_patch jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
    PERFORM public.meta_validate_traffic_row(after_row);
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
END $$;

CREATE FUNCTION public.meta_edit_traffic_row(p_id uuid,p_expected_updated_at timestamptz,p_patch jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old public.meta_traffic_daily; edited public.meta_traffic_daily;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
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
END $$;

CREATE FUNCTION public.meta_audit_metric_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE delta jsonb; manually_edited boolean;
BEGIN
  delta:=public.meta_edit_diff(CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END,to_jsonb(NEW)-ARRAY['updated_at','traffic_edited_at','traffic_edit_reason']);
  IF delta<>'[]' THEN
    manually_edited:=TG_OP='UPDATE' AND NEW.traffic_edited_at IS DISTINCT FROM OLD.traffic_edited_at;
    PERFORM public.meta_record_edit('metrics_row',NEW.id,CASE WHEN TG_OP='INSERT' THEN 'metric.published' WHEN manually_edited THEN 'metric.edited' ELSE 'metric.updated' END,
      CASE WHEN NEW.source='api' THEN 'api' ELSE 'csv' END,jsonb_build_object('reason',CASE WHEN manually_edited THEN NEW.traffic_edit_reason ELSE 'Atualização por importação aprovada' END,
        'changes',delta,'import_batch_id',NEW.import_batch_id,'sync_run_id',NEW.sync_run_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meta_audit_metric_change AFTER INSERT OR UPDATE ON public.meta_traffic_daily FOR EACH ROW EXECUTE FUNCTION public.meta_audit_metric_change();

REVOKE ALL ON FUNCTION public.meta_edit_diff(jsonb,jsonb),public.meta_record_edit(text,uuid,text,text,jsonb),public.meta_validate_edit(text,jsonb,text),public.meta_audit_metric_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.meta_get_traffic_lead(uuid),public.meta_edit_form_lead(uuid,timestamptz,bigint,jsonb,text),
  public.meta_edit_import_row(text,uuid,integer,timestamptz,jsonb,text),public.meta_edit_traffic_row(uuid,timestamptz,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_get_traffic_lead(uuid),public.meta_edit_form_lead(uuid,timestamptz,bigint,jsonb,text),
  public.meta_edit_import_row(text,uuid,integer,timestamptz,jsonb,text),public.meta_edit_traffic_row(uuid,timestamptz,jsonb,text) TO authenticated;

-- Do not replace a manual correction with a repeated webhook or API capture.
-- These replacements keep the existing validation, grants and approval gates intact.

CREATE OR REPLACE FUNCTION public.meta_ingest_form_lead(p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_meta_id text; v_page text; v_form text; v_fields jsonb;
BEGIN
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Dados de lead inválidos'; END IF;
 v_meta_id:=btrim(coalesce(p_data->>'meta_lead_id',''));
 v_page:=btrim(coalesce(p_data->>'page_id',''));
 v_form:=btrim(coalesce(p_data->>'form_id',''));
 v_fields:=p_data->'field_data';
 IF length(v_meta_id) NOT BETWEEN 1 AND 100 OR length(v_page) NOT BETWEEN 1 AND 100
   OR length(v_form) NOT BETWEEN 1 AND 100 OR jsonb_typeof(v_fields)<>'array'
   OR pg_column_size(v_fields)>30000 OR nullif(p_data->>'created_time','') IS NULL
 THEN RAISE EXCEPTION 'Identificadores, data ou respostas inválidos'; END IF;
 INSERT INTO public.meta_form_leads(meta_lead_id,page_id,form_id,campaign_id,campaign_name,ad_id,
   form_name,created_time,field_data,custom_disclaimer_responses,full_name,phone,email)
 VALUES(v_meta_id,v_page,v_form,left(coalesce(p_data->>'campaign_id',''),100),
   left(coalesce(p_data->>'campaign_name',''),160),left(coalesce(p_data->>'ad_id',''),100),
   left(coalesce(p_data->>'form_name',''),160),(p_data->>'created_time')::timestamptz,
   v_fields,coalesce(p_data->'custom_disclaimer_responses','[]'::jsonb),
   left(coalesce(p_data->>'full_name',''),160),left(coalesce(p_data->>'phone',''),40),
   left(coalesce(p_data->>'email',''),254))
 ON CONFLICT(meta_lead_id) DO UPDATE SET
   campaign_id=excluded.campaign_id,campaign_name=excluded.campaign_name,ad_id=excluded.ad_id,
   form_name=excluded.form_name,field_data=excluded.field_data,
   custom_disclaimer_responses=excluded.custom_disclaimer_responses,full_name=excluded.full_name,
   phone=excluded.phone,email=excluded.email,updated_at=clock_timestamp()
 WHERE public.meta_form_leads.approval_status='pendente' AND public.meta_form_leads.status='novo' AND public.meta_form_leads.lead_import_batch_id IS NULL
   AND public.meta_form_leads.traffic_edited_at IS NULL
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id; END IF;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.meta_import_daily_system(p_rows jsonb,p_sync_run_id uuid,p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; batch public.meta_import_batches; account text; row_level text; merged jsonb; incoming jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Quantidade de linhas inválida'; END IF;
  SELECT account_id INTO account FROM public.meta_sync_runs WHERE id=p_sync_run_id AND status='running' AND kind='insights';
  IF NOT FOUND THEN RAISE EXCEPTION 'Captura inválida ou não está em execução'; END IF;
  row_level:=p_rows->0->>'level';
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_validate_traffic_row(item);
    IF btrim(item->>'account_id') IS DISTINCT FROM account OR item->>'level' IS DISTINCT FROM row_level THEN RAISE EXCEPTION 'Conta ou nível diferente da captura'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-pending:'||account||':'||row_level,0));
  SELECT * INTO batch FROM public.meta_import_batches WHERE source='api' AND account_id=account AND level=row_level AND status='pendente' FOR UPDATE;
  SELECT jsonb_agg(value||jsonb_build_object('sync_run_id',p_sync_run_id)) INTO incoming FROM jsonb_array_elements(p_rows) incoming_row(value)
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(batch.rows,'[]')) edited
      WHERE edited->>'traffic_edited'='true' AND
        ROW(incoming_row.value->>'date',incoming_row.value->>'account_id',incoming_row.value->>'campaign_id',coalesce(incoming_row.value->>'adset_id',''),coalesce(incoming_row.value->>'ad_id',''))=
        ROW(edited->'traffic_original'->>'date',edited->'traffic_original'->>'account_id',edited->'traffic_original'->>'campaign_id',
          coalesce(edited->'traffic_original'->>'adset_id',''),coalesce(edited->'traffic_original'->>'ad_id','')));
  -- Keep dates outside the latest capture window; replace matching rows with the newest capture.
  SELECT jsonb_agg(value ORDER BY value->>'date',value->>'campaign_id',value->>'adset_id',value->>'ad_id') INTO merged FROM (
    SELECT DISTINCT ON (value->>'date',value->>'account_id',value->>'campaign_id',coalesce(value->>'adset_id',''),coalesce(value->>'ad_id','')) value
    FROM (SELECT value,CASE WHEN value->>'traffic_edited'='true' THEN 2 ELSE 0 END AS priority,ordinality FROM jsonb_array_elements(coalesce(batch.rows,'[]')) WITH ORDINALITY
      UNION ALL SELECT value,1,ordinality FROM jsonb_array_elements(coalesce(incoming,'[]')) WITH ORDINALITY) captures
    ORDER BY value->>'date',value->>'account_id',value->>'campaign_id',coalesce(value->>'adset_id',''),coalesce(value->>'ad_id',''),priority DESC,ordinality DESC
  ) latest;
  IF jsonb_array_length(merged)>2000 THEN RAISE EXCEPTION 'Aprove a captura pendente antes de receber mais de 2.000 linhas'; END IF;
  IF batch.id IS NULL THEN
    INSERT INTO public.meta_import_batches(imported_by,filename,row_count,status,rows,source,sync_run_id,account_id,level)
      VALUES(p_actor,'Meta API · '||account||' · '||row_level,jsonb_array_length(merged),'pendente',merged,'api',p_sync_run_id,account,row_level) RETURNING * INTO batch;
  ELSE
    UPDATE public.meta_import_batches SET rows=merged,row_count=jsonb_array_length(merged),sync_run_id=p_sync_run_id,updated_at=clock_timestamp() WHERE id=batch.id RETURNING * INTO batch;
  END IF;
  RETURN jsonb_build_object('rows',jsonb_array_length(p_rows),'batch_id',batch.id,'status','pendente');
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
