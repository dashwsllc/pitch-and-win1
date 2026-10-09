BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- The target project has no legacy filename/row identifiers. Stop on another
-- project if it needs a compatibility backfill before switching to content IDs.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.meta_form_leads
    WHERE meta_lead_id LIKE 'csv:%' AND meta_lead_id !~ '^csv:[a-f0-9]{64}$')
    OR EXISTS(SELECT 1 FROM public.meta_lead_import_batches b,
      LATERAL jsonb_array_elements(b.rows) r
      WHERE r->>'meta_lead_id' LIKE 'csv:%' AND r->>'meta_lead_id' !~ '^csv:[a-f0-9]{64}$')
  THEN RAISE EXCEPTION 'Legacy CSV identifiers require a compatibility backfill before this migration'; END IF;
END $$;

-- Additive only: existing batches have no invented processing totals.
ALTER TABLE public.meta_lead_import_batches ADD COLUMN result jsonb;
ALTER TABLE public.meta_form_leads
  ADD COLUMN import_contact jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(import_contact)='object' AND pg_column_size(import_contact)<=64000),
  ADD COLUMN import_warning text;

-- Automatic delivery must not replace the original answers from a manual batch.
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
 WHERE public.meta_form_leads.status='novo' AND public.meta_form_leads.lead_import_batch_id IS NULL
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id; END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_ingest_form_lead(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ingest_form_lead(jsonb) TO service_role;

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
    form_name,created_time,field_data,full_name,phone,email,lead_import_batch_id,import_contact,import_warning)
  VALUES(v_meta_id,'planilha',left(coalesce(nullif(item->>'form_id',''),'planilha'),100),
    left(coalesce(item->>'campaign_id',''),100),left(coalesce(item->>'campaign_name',''),160),
    left(coalesce(item->>'ad_id',''),100),left(coalesce(item->>'form_name',''),160),
    (item->>'created_time')::timestamptz,coalesce(item->'field_data','[]'::jsonb),
    left(btrim(coalesce(item->>'full_name','')),160),left(btrim(coalesce(item->>'phone','')),40),
    left(coalesce(item->>'email',''),254),p_batch_id,v_contact,
    CASE WHEN jsonb_typeof(item->'warnings')='array' THEN
      (SELECT string_agg(w, ' · ') FROM jsonb_array_elements_text(item->'warnings') w) END)
  ON CONFLICT(meta_lead_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Lead já recebido' USING ERRCODE='23505'; END IF;

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
REVOKE ALL ON FUNCTION public.meta_ingest_lead_import_row(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_review_lead_import(p_batch_id uuid,p_action text,
  p_expected_updated_at timestamptz,p_note text DEFAULT '')
RETURNS public.meta_lead_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_lead_import_batches; entry record; item jsonb; v_form public.meta_form_leads;
  v_meta_id text; v_row integer; v_crm integer:=0; v_queue integer:=0; v_duplicates integer:=0;
  v_failed integer:=0; v_issues jsonb:='[]'::jsonb; v_result jsonb;
BEGIN
  IF NOT public.is_executive(auth.uid()) OR NOT public.traffic_has_access()
    THEN RAISE EXCEPTION 'Acesso de Executive necessário' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION public.meta_review_lead_import(uuid,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_review_lead_import(uuid,text,timestamptz,text) TO authenticated;

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
  IF public.is_executive(auth.uid()) THEN
    b:=public.meta_review_lead_import(b.id,'aprovar',b.updated_at);
  END IF;
  RETURN jsonb_build_object('batch_id',b.id,'rows',b.row_count,'status',b.status,'result',b.result);
END $$;
REVOKE ALL ON FUNCTION public.meta_import_leads(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_import_leads(text,jsonb) TO authenticated;

-- The later SDR completion retains the original mapped data and notes.
CREATE OR REPLACE FUNCTION public.meta_promote_form_lead(p_id uuid,p_contact jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_form public.meta_form_leads; v_crm uuid;
BEGIN
  IF NOT public.meta_lead_inbox_access() OR NOT public.crm_user_can(auth.uid(),'leads')
    THEN RAISE EXCEPTION 'Acesso de SDR ao CRM necessário' USING ERRCODE='42501'; END IF;
  IF p_contact IS NULL OR jsonb_typeof(p_contact)<>'object' THEN RAISE EXCEPTION 'Cadastro inválido'; END IF;
  SELECT * INTO v_form FROM public.meta_form_leads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead de formulário não encontrado'; END IF;
  IF v_form.status='importado' AND v_form.crm_lead_id IS NOT NULL THEN RETURN v_form.crm_lead_id; END IF;
  IF v_form.status<>'novo' THEN RAISE EXCEPTION 'Lead já foi descartado'; END IF;
  v_crm:=public.meta_create_crm_lead_from_form(v_form,v_form.import_contact||p_contact,auth.uid());
  UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,imported_by=auth.uid(),
    imported_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;
  RETURN v_crm;
END $$;

CREATE TRIGGER meta_lead_import_batches_signal AFTER INSERT OR UPDATE ON public.meta_lead_import_batches
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
NOTIFY pgrst,'reload schema';
COMMIT;
