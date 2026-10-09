BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.meta_form_leads
  ADD COLUMN approval_status text NOT NULL DEFAULT 'pendente' CHECK(approval_status IN ('pendente','aprovado','rejeitado')),
  ADD COLUMN reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text CHECK(review_note IS NULL OR length(review_note) BETWEEN 3 AND 500);
-- Preserve past decisions and existing CRM links; never fabricate a reviewer.
UPDATE public.meta_form_leads l SET approval_status='aprovado',reviewed_by=b.reviewed_by,reviewed_at=b.reviewed_at
  FROM public.meta_lead_import_batches b WHERE b.id=l.lead_import_batch_id AND b.status='aprovado';
UPDATE public.meta_form_leads SET approval_status='aprovado' WHERE status='importado' OR crm_lead_id IS NOT NULL;
UPDATE public.meta_form_leads SET approval_status='rejeitado' WHERE status='ignorado' AND approval_status='pendente';
CREATE INDEX meta_form_leads_approval_queue ON public.meta_form_leads(approval_status,received_at,id);
DROP POLICY meta_form_leads_read ON public.meta_form_leads;
CREATE POLICY meta_form_leads_read ON public.meta_form_leads FOR SELECT TO authenticated
  USING(public.traffic_has_access() OR (public.meta_lead_inbox_access() AND approval_status='aprovado'));

ALTER TABLE public.meta_import_batches
  ALTER COLUMN imported_by DROP NOT NULL,
  ADD COLUMN source text NOT NULL DEFAULT 'csv' CHECK(source IN ('csv','api')),
  ADD COLUMN sync_run_id uuid REFERENCES public.meta_sync_runs(id),
  ADD COLUMN account_id text,
  ADD COLUMN level text CHECK(level IN ('campaign','adset','ad')),
  ADD CONSTRAINT meta_import_batches_source_lineage CHECK(
    (source='csv' AND imported_by IS NOT NULL AND sync_run_id IS NULL) OR
    (source='api' AND sync_run_id IS NOT NULL AND account_id IS NOT NULL AND level IS NOT NULL));
CREATE UNIQUE INDEX meta_pending_api_batch ON public.meta_import_batches(account_id,level) WHERE source='api' AND status='pendente';
ALTER TABLE public.meta_traffic_daily DROP CONSTRAINT meta_traffic_daily_source_lineage;
ALTER TABLE public.meta_traffic_daily ADD CONSTRAINT meta_traffic_daily_source_lineage CHECK(
  (source='csv' AND import_batch_id IS NOT NULL AND imported_by IS NOT NULL AND sync_run_id IS NULL) OR
  (source='api' AND sync_run_id IS NOT NULL) OR source='manual_legacy');

CREATE TABLE public.meta_audit_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  entity_type text NOT NULL CHECK(entity_type IN ('lead','lead_batch','metrics_batch')),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  origin text NOT NULL CHECK(origin IN ('api','csv')),
  actor_id uuid REFERENCES auth.users(id),
  actor_name text,
  actor_roles text[] NOT NULL DEFAULT '{}',
  summary jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX meta_audit_events_timeline ON public.meta_audit_events(created_at DESC,id DESC);
ALTER TABLE public.meta_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_audit_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.meta_audit_events TO authenticated;
CREATE POLICY meta_audit_events_read ON public.meta_audit_events FOR SELECT TO authenticated USING(public.traffic_has_access());

CREATE OR REPLACE FUNCTION public.meta_audit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entity text; origin text; actions text[]:='{}'; event text; detail jsonb; actor uuid:=auth.uid();
BEGIN
  IF TG_TABLE_NAME='meta_form_leads' THEN
    entity:='lead'; origin:=CASE WHEN NEW.lead_import_batch_id IS NULL THEN 'api' ELSE 'csv' END;
    detail:=jsonb_build_object('approval_status',NEW.approval_status,'status',NEW.status,
      'crm_lead_id',NEW.crm_lead_id,'batch_id',NEW.lead_import_batch_id,'note',NEW.review_note,
      'warning',NEW.import_warning,'reason',NEW.ignored_reason);
    IF TG_OP='INSERT' THEN actions:=array_append(actions,'lead.received');
    ELSE
      IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
        actions:=array_append(actions,CASE NEW.approval_status WHEN 'aprovado' THEN 'lead.approved' ELSE 'lead.rejected' END);
      END IF;
      IF NEW.crm_lead_id IS DISTINCT FROM OLD.crm_lead_id AND NEW.crm_lead_id IS NOT NULL THEN actions:=array_append(actions,'lead.synced'); END IF;
      IF NEW.status='ignorado' AND OLD.status<>'ignorado' AND NEW.approval_status='aprovado' THEN actions:=array_append(actions,'lead.discarded'); END IF;
      IF NEW.import_warning IS DISTINCT FROM OLD.import_warning AND NEW.import_warning IS NOT NULL THEN actions:=array_append(actions,'lead.completion_required'); END IF;
      IF NEW.field_data IS DISTINCT FROM OLD.field_data THEN actions:=array_append(actions,'lead.updated'); END IF;
    END IF;
    IF TG_OP='INSERT' AND NEW.approval_status='aprovado' THEN actions:=array_append(actions,'lead.approved'); END IF;
  ELSE
    entity:=CASE TG_TABLE_NAME WHEN 'meta_lead_import_batches' THEN 'lead_batch' ELSE 'metrics_batch' END;
    origin:=coalesce(to_jsonb(NEW)->>'source','csv');
    detail:=jsonb_build_object('filename',NEW.filename,'rows',NEW.row_count,'status',NEW.status,'note',NEW.review_note);
    IF entity='lead_batch' THEN detail:=detail||jsonb_build_object('result',to_jsonb(NEW)->'result');
    ELSE detail:=detail||jsonb_build_object('sync_run_id',to_jsonb(NEW)->'sync_run_id'); END IF;
    IF TG_OP='INSERT' THEN actions:=array_append(actions,'batch.received');
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN actions:=array_append(actions,CASE NEW.status WHEN 'aprovado' THEN 'batch.approved' ELSE 'batch.rejected' END);
    ELSIF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN actions:=array_append(actions,'batch.updated'); END IF;
  END IF;
  FOREACH event IN ARRAY actions LOOP
    INSERT INTO public.meta_audit_events(entity_type,entity_id,action,origin,actor_id,actor_name,actor_roles,summary)
    VALUES(entity,NEW.id,event,origin,actor,
      (SELECT p.display_name FROM public.profiles p WHERE p.user_id=actor),
      coalesce((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id=actor),'{}'),detail);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meta_audit_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER meta_form_leads_audit AFTER INSERT OR UPDATE ON public.meta_form_leads FOR EACH ROW EXECUTE FUNCTION public.meta_audit_change();
CREATE TRIGGER meta_lead_batches_audit AFTER INSERT OR UPDATE ON public.meta_lead_import_batches FOR EACH ROW EXECUTE FUNCTION public.meta_audit_change();
CREATE TRIGGER meta_metrics_batches_audit AFTER INSERT OR UPDATE ON public.meta_import_batches FOR EACH ROW EXECUTE FUNCTION public.meta_audit_change();

-- Runs after crm_guard_workflow, including generic CRM inserts. Approved Meta
-- leads enter the shared queue; the SDR claims them through the normal workflow.
CREATE OR REPLACE FUNCTION public.meta_crm_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.meta_form_lead_id IS NOT NULL AND NEW.meta_form_lead_id IS DISTINCT FROM OLD.meta_form_lead_id THEN
    RAISE EXCEPTION 'O vínculo original do lead Meta não pode ser removido ou alterado' USING ERRCODE='42501';
  END IF;
  IF NEW.meta_form_lead_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.meta_form_lead_id IS DISTINCT FROM OLD.meta_form_lead_id) THEN
    PERFORM 1 FROM public.meta_form_leads WHERE id=NEW.meta_form_lead_id AND approval_status='aprovado' AND status='novo' FOR UPDATE;
    IF NOT FOUND
      THEN RAISE EXCEPTION 'Lead aguardando aprovação em Tráfego' USING ERRCODE='42501'; END IF;
    IF length(btrim(NEW.name))<2 OR length(btrim(NEW.phone))<8
      OR coalesce(NEW.email,'') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
      OR length(btrim(coalesce(NEW.athlete_name,'')))<2 OR NEW.athlete_birth_date IS NULL OR NEW.athlete_position IS NULL
    THEN RAISE EXCEPTION 'Complete o cadastro aprovado antes de enviar ao CRM' USING ERRCODE='22023'; END IF;
    IF TG_OP='INSERT' THEN NEW.sdr_id:=NULL; END IF;
  END IF;
  IF NEW.meta_form_lead_id IS NOT NULL THEN NEW.lead_source:='meta_ads_form'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meta_crm_approval_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_meta_crm_approval_guard BEFORE INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.meta_crm_approval_guard();

-- Keep both sides consistent even when an approved form enters through a CRM RPC.
CREATE OR REPLACE FUNCTION public.meta_crm_link_form()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.meta_form_lead_id IS NOT NULL THEN
    UPDATE public.meta_form_leads SET status='importado',crm_lead_id=NEW.id,
      imported_by=auth.uid(),imported_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=NEW.meta_form_lead_id AND crm_lead_id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meta_crm_link_form() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER meta_crm_link_form AFTER INSERT OR UPDATE OF meta_form_lead_id ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.meta_crm_link_form();

CREATE OR REPLACE FUNCTION public.meta_answer_text(p_fields jsonb,p_names text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT nullif(btrim(answer->'values'->>0),'') FROM jsonb_array_elements(p_fields) WITH ORDINALITY a(answer,n)
  WHERE regexp_replace(translate(lower(answer->>'name'),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+','_','g')=ANY(p_names)
    AND nullif(btrim(answer->'values'->>0),'') IS NOT NULL ORDER BY n LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.meta_answer_text(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_contact_from_form(p_form public.meta_form_leads)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE birth text; position text; contact jsonb;
BEGIN
  birth:=public.meta_answer_text(p_form.field_data,ARRAY['athlete_birth_date','nascimento','data_de_nascimento','data_de_nascimento_do_atleta','nascimento_do_atleta']);
  IF birth ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN birth:=split_part(birth,'/',3)||'-'||split_part(birth,'/',2)||'-'||split_part(birth,'/',1); END IF;
  position:=public.meta_answer_text(p_form.field_data,ARRAY['athlete_position','posicao','posicao_do_atleta','qual_a_posicao_do_atleta']);
  position:=CASE lower(position) WHEN 'goleiro' THEN 'Goleiro' WHEN 'zagueiro' THEN 'Zagueiro' WHEN 'lateral' THEN 'Lateral' WHEN 'volante' THEN 'Volante' WHEN 'meia' THEN 'Meia' WHEN 'atacante' THEN 'Atacante' ELSE position END;
  contact:=jsonb_build_object('name',p_form.full_name,'phone',p_form.phone,'email',p_form.email,
    'athlete_name',public.meta_answer_text(p_form.field_data,ARRAY['athlete_name','nome_do_atleta','nome_atleta']),
    'athlete_birth_date',birth,'athlete_position',position,
    'city_state',public.meta_answer_text(p_form.field_data,ARRAY['city_state','city','cidade','cidade_estado']),
    'raw_notes',(SELECT string_agg((answer->>'name')||': '||(SELECT string_agg(value,', ') FROM jsonb_array_elements_text(answer->'values') v(value)),E'\n' ORDER BY n)
      FROM jsonb_array_elements(p_form.field_data) WITH ORDINALITY a(answer,n)));
  RETURN contact||p_form.import_contact;
END $$;
REVOKE ALL ON FUNCTION public.meta_contact_from_form(public.meta_form_leads) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_review_form_lead(p_id uuid,p_action text,p_expected_updated_at timestamptz,p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lead public.meta_form_leads; crm_id uuid; contact jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO lead FROM public.meta_form_leads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado'; END IF;
  IF lead.approval_status<>'pendente' OR lead.status<>'novo' THEN RAISE EXCEPTION 'Lead já revisado'; END IF;
  IF lead.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Lead alterado, recarregue a prévia' USING ERRCODE='40001'; END IF;
  IF p_action='rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)'; END IF;
  UPDATE public.meta_form_leads SET approval_status=CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    status=CASE p_action WHEN 'rejeitar' THEN 'ignorado' ELSE 'novo' END,
    reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=nullif(btrim(coalesce(p_note,'')),''),
    updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO lead;
  IF p_action='rejeitar' THEN RETURN jsonb_build_object('crm',0,'queued',0,'duplicates',0,'failed',0,'issues','[]'::jsonb); END IF;
  BEGIN
    contact:=public.meta_contact_from_form(lead);
    crm_id:=public.meta_create_crm_lead_from_form(lead,contact,auth.uid());
    UPDATE public.meta_form_leads SET status='importado',crm_lead_id=crm_id,imported_by=auth.uid(),imported_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;
  EXCEPTION WHEN data_exception OR check_violation OR raise_exception THEN
    UPDATE public.meta_form_leads SET import_warning=left(SQLERRM,500),updated_at=clock_timestamp() WHERE id=p_id;
  END;
  RETURN jsonb_build_object('crm',CASE WHEN crm_id IS NULL THEN 0 ELSE 1 END,'queued',CASE WHEN crm_id IS NULL THEN 1 ELSE 0 END,'duplicates',0,'failed',0,'issues','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.meta_review_form_lead(uuid,text,timestamptz,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_review_form_lead(uuid,text,timestamptz,text) TO authenticated;

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
  SELECT jsonb_agg(value||jsonb_build_object('sync_run_id',p_sync_run_id)) INTO incoming FROM jsonb_array_elements(p_rows);
  -- Keep dates outside the latest capture window; replace matching rows with the newest capture.
  SELECT jsonb_agg(value ORDER BY value->>'date',value->>'campaign_id',value->>'adset_id',value->>'ad_id') INTO merged FROM (
    SELECT DISTINCT ON (value->>'date',value->>'account_id',value->>'campaign_id',coalesce(value->>'adset_id',''),coalesce(value->>'ad_id','')) value
    FROM (SELECT value,0 AS priority,ordinality FROM jsonb_array_elements(coalesce(batch.rows,'[]')) WITH ORDINALITY
      UNION ALL SELECT value,1,ordinality FROM jsonb_array_elements(incoming) WITH ORDINALITY) captures
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
REVOKE ALL ON FUNCTION public.meta_import_daily_system(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_import_daily_system(jsonb,uuid,uuid) TO service_role;

-- Existing function contracts are retained below with explicit review gates.


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
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id; END IF;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.meta_ingest_lead_import_row(item jsonb, p_batch_id uuid, p_reviewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_form public.meta_form_leads; v_crm uuid; v_contact jsonb; v_meta_id text;
BEGIN
  v_meta_id := regexp_replace(btrim(coalesce(item->>'meta_lead_id','')), '^l:([0-9]+)$', '\1');
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR length(v_meta_id) NOT BETWEEN 1 AND 100
    OR nullif(item->>'created_time','') IS NULL OR NOT isfinite((item->>'created_time')::timestamptz)
    OR jsonb_typeof(coalesce(item->'field_data','[]'::jsonb)) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Identificador, data ou respostas inválidos' USING ERRCODE='22023'; END IF;

  v_contact := jsonb_build_object('name',item->>'full_name','phone',item->>'phone','email',item->>'email',
    'athlete_name',item->>'athlete_name','athlete_birth_date',item->>'athlete_birth_date',
    'athlete_position',item->>'athlete_position','athlete_age',item->>'athlete_age',
    'athlete_height_cm',item->>'athlete_height_cm','athlete_weight_kg',item->>'athlete_weight_kg',
    'performance_report_url',item->>'performance_report_url','city_state',item->>'city_state',
    'raw_notes',item->>'raw_notes');
  INSERT INTO public.meta_form_leads(meta_lead_id,page_id,form_id,campaign_id,campaign_name,ad_id,
    form_name,created_time,field_data,full_name,phone,email,lead_import_batch_id,import_contact,import_warning,approval_status,reviewed_by,reviewed_at)
  VALUES(v_meta_id,'planilha',left(coalesce(nullif(item->>'form_id',''),'planilha'),100),
    left(coalesce(item->>'campaign_id',''),100),left(coalesce(item->>'campaign_name',''),160),
    left(coalesce(item->>'ad_id',''),100),left(coalesce(item->>'form_name',''),160),
    (item->>'created_time')::timestamptz,coalesce(item->'field_data','[]'::jsonb),
    left(btrim(coalesce(item->>'full_name','')),160),left(btrim(coalesce(item->>'phone','')),40),
    left(coalesce(item->>'email',''),254),p_batch_id,v_contact,
    CASE WHEN jsonb_typeof(item->'warnings')='array' THEN
      (SELECT string_agg(w, ' · ') FROM jsonb_array_elements_text(item->'warnings') w) END,'aprovado',p_reviewer,clock_timestamp())
  ON CONFLICT(meta_lead_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_form FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id FOR UPDATE;
    IF v_form.approval_status='pendente' THEN
      RAISE EXCEPTION 'Lead já recebido pela Meta e ainda pendente. Revise-o em Tráfego > Aprovações > Leads automáticos' USING ERRCODE='22023';
    END IF;
    RAISE EXCEPTION 'Lead já recebido' USING ERRCODE='23505';
  END IF;

  -- Expected contact problems leave the original record in the completion queue.
  -- Infrastructure/permission errors propagate and roll back the batch.
  BEGIN
    IF coalesce(v_contact->>'email','') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
      THEN RAISE EXCEPTION 'Complete ou corrija o e-mail para enviar ao CRM'; END IF;
    SELECT * INTO v_form FROM public.meta_form_leads WHERE id=v_id;
    v_crm := public.meta_create_crm_lead_from_form(v_form,v_contact,p_reviewer);
    UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,
      imported_by=p_reviewer,imported_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_id;
  EXCEPTION WHEN data_exception OR check_violation OR raise_exception THEN
    UPDATE public.meta_form_leads SET import_warning=concat_ws(' · ',import_warning,left(SQLERRM,500)) WHERE id=v_id;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.meta_review_lead_import(p_batch_id uuid,p_action text,
  p_expected_updated_at timestamptz,p_note text DEFAULT '')
RETURNS public.meta_lead_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_lead_import_batches; entry record; item jsonb; v_form public.meta_form_leads;
  v_meta_id text; v_row integer; v_crm integer:=0; v_queue integer:=0; v_duplicates integer:=0;
  v_failed integer:=0; v_issues jsonb:='[]'::jsonb; v_result jsonb;
BEGIN
  IF NOT public.traffic_has_access()
    THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('aprovar','rejeitar') OR p_action IS NULL THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO b FROM public.meta_lead_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF b.status<>'pendente' THEN RAISE EXCEPTION 'Esta importação já foi revisada'; END IF;
  IF b.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN RAISE EXCEPTION 'Importação foi alterada por outra pessoa, recarregue' USING ERRCODE='40001'; END IF;
  IF p_action='rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500
    THEN RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)'; END IF;
  IF p_action='aprovar' THEN
    FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(b.rows) WITH ORDINALITY LOOP
      item:=entry.value;
      v_row:=CASE WHEN item->>'source_row' ~ '^[0-9]{1,6}$' THEN greatest(2,(item->>'source_row')::integer) ELSE entry.ordinality+1 END;
      BEGIN
        PERFORM public.meta_ingest_lead_import_row(item,b.id,auth.uid());
        v_meta_id:=regexp_replace(btrim(item->>'meta_lead_id'),'^l:([0-9]+)$','\1');
        SELECT * INTO STRICT v_form FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id;
        IF v_form.status='importado' THEN v_crm:=v_crm+1;
        ELSE
          v_queue:=v_queue+1;
          v_issues:=v_issues||jsonb_build_array(jsonb_build_object('row',v_row,'kind','queued',
            'reason',coalesce(v_form.import_warning,'Complete os campos exigidos pelo CRM')));
        END IF;
      EXCEPTION WHEN unique_violation THEN v_duplicates:=v_duplicates+1;
        WHEN data_exception OR check_violation OR not_null_violation THEN
          v_failed:=v_failed+1;
          v_issues:=v_issues||jsonb_build_array(jsonb_build_object('row',v_row,'kind','failed','reason',left(SQLERRM,500)));
      END;
    END LOOP;
    v_result:=jsonb_build_object('crm',v_crm,'queued',v_queue,'duplicates',v_duplicates,'failed',v_failed,'issues',v_issues);
  END IF;
  UPDATE public.meta_lead_import_batches SET status=CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    result=v_result,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),
    review_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=clock_timestamp()
    WHERE id=p_batch_id RETURNING * INTO b;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION public.meta_import_leads(p_filename text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_lead_import_batches;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    THEN RAISE EXCEPTION 'Envie de 1 a 2.000 linhas'; END IF;
  IF length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Nome de arquivo inválido'; END IF;
  INSERT INTO public.meta_lead_import_batches(imported_by,filename,row_count,status,rows)
    VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows),'pendente',p_rows) RETURNING * INTO b;
  RETURN jsonb_build_object('batch_id',b.id,'rows',b.row_count,'status',b.status,'result',b.result);
END $$;

CREATE OR REPLACE FUNCTION public.meta_promote_form_lead(p_id uuid,p_contact jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_form public.meta_form_leads; v_crm uuid;
BEGIN
  IF NOT public.meta_lead_inbox_access() OR NOT public.crm_user_can(auth.uid(),'leads')
    THEN RAISE EXCEPTION 'Acesso de SDR ao CRM necessário' USING ERRCODE='42501'; END IF;
  IF p_contact IS NULL OR jsonb_typeof(p_contact)<>'object' THEN RAISE EXCEPTION 'Cadastro inválido'; END IF;
  SELECT * INTO v_form FROM public.meta_form_leads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead de formulário não encontrado'; END IF;
  IF v_form.approval_status<>'aprovado' THEN RAISE EXCEPTION 'Lead aguardando aprovação em Tráfego' USING ERRCODE='42501'; END IF;
  IF v_form.status='importado' AND v_form.crm_lead_id IS NOT NULL THEN RETURN v_form.crm_lead_id; END IF;
  IF v_form.status<>'novo' THEN RAISE EXCEPTION 'Lead já foi descartado'; END IF;
  v_crm:=public.meta_create_crm_lead_from_form(v_form,v_form.import_contact||p_contact,auth.uid());
  UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,imported_by=auth.uid(),
    imported_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;
  RETURN v_crm;
END $$;

CREATE OR REPLACE FUNCTION public.meta_ignore_form_lead(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.meta_lead_inbox_access() OR NOT public.crm_user_can(auth.uid(),'leads') THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'Informe o motivo (3 a 500 caracteres)'; END IF;
 UPDATE public.meta_form_leads SET status='ignorado',ignored_reason=btrim(p_reason),
   updated_at=clock_timestamp() WHERE id=p_id AND status='novo' AND approval_status='aprovado';
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado ou já tratado'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.meta_create_crm_lead_from_form(v_form public.meta_form_leads,
  p_contact jsonb, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_crm uuid; v_name text; v_phone text; v_email text; v_observations text;
BEGIN
  v_name:=btrim(coalesce(p_contact->>'name',''));
  v_phone:=btrim(coalesce(p_contact->>'phone',''));
  v_email:=btrim(coalesce(p_contact->>'email',''));
  IF length(v_name) NOT BETWEEN 2 AND 160 OR length(v_phone) NOT BETWEEN 8 AND 32
    OR length(v_email) NOT BETWEEN 5 AND 254 OR v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    OR length(btrim(coalesce(p_contact->>'athlete_name','')))<2
    OR nullif(p_contact->>'athlete_birth_date','') IS NULL
    OR nullif(p_contact->>'athlete_position','') IS NULL
  THEN RAISE EXCEPTION 'Preencha responsável, WhatsApp, e-mail, atleta, nascimento e posição'; END IF;
  -- Preserve original answers supplied by the approved spreadsheet or form.
  v_observations := 'Formulário Meta '||v_form.form_id||' · campanha '||coalesce(nullif(v_form.campaign_name,''),v_form.campaign_id)
    ||E'\nMeta lead ID: '||v_form.meta_lead_id
    ||E'\nRespostas originais e consentimentos preservados na aba Leads.';
  IF nullif(btrim(coalesce(p_contact->>'raw_notes','')),'') IS NOT NULL THEN
    v_observations := v_observations||E'\n\nRespostas do formulário sem campo próprio no CRM:\n'||btrim(p_contact->>'raw_notes');
  END IF;
  INSERT INTO public.crm_leads(name,phone,email,athlete_name,athlete_birth_date,athlete_position,
    athlete_age,athlete_height_cm,athlete_weight_kg,performance_report_url,
    city_state,lead_source,observations,sdr_id,meta_form_lead_id,lead_generated_at)
  VALUES(v_name,v_phone,v_email,btrim(p_contact->>'athlete_name'),
    (p_contact->>'athlete_birth_date')::date,p_contact->>'athlete_position',
    nullif(p_contact->>'athlete_age','')::smallint,
    nullif(p_contact->>'athlete_height_cm','')::numeric,
    nullif(p_contact->>'athlete_weight_kg','')::numeric,
    nullif(p_contact->>'performance_report_url',''),
    nullif(btrim(coalesce(p_contact->>'city_state','')),''),
    'meta_ads_form',left(v_observations,9500),p_actor,v_form.id,
    v_form.created_time)
  RETURNING id INTO v_crm;
  RETURN v_crm;
END $$;

CREATE OR REPLACE FUNCTION public.meta_review_traffic_import(p_batch_id uuid, p_action text,
  p_expected_updated_at timestamptz, p_note text DEFAULT '')
RETURNS public.meta_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_import_batches; item jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO b FROM public.meta_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF b.status <> 'pendente' THEN RAISE EXCEPTION 'Esta importação já foi revisada'; END IF;
  IF b.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Importação foi alterada por outra pessoa, recarregue' USING ERRCODE='40001'; END IF;
  IF p_action = 'rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)';
  END IF;
  IF p_action = 'aprovar' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(b.rows) LOOP
      PERFORM public.meta_upsert_traffic_row(item,b.source,b.imported_by,b.id,
        CASE WHEN b.source='api' THEN coalesce((item->>'sync_run_id')::uuid,b.sync_run_id) END);
    END LOOP;
  END IF;
  UPDATE public.meta_import_batches SET
    status = CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
    review_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = clock_timestamp()
  WHERE id = p_batch_id
  RETURNING * INTO b;
  RETURN b;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
