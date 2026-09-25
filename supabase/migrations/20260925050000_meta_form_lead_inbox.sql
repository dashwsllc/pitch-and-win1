BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.meta_lead_inbox_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT auth.uid() IS NOT NULL AND public.registration_has_access()
   AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND NOT p.suspended)
   AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid()
     AND r.role::text IN ('sdr','executive','super_admin'));
$$;
REVOKE ALL ON FUNCTION public.meta_lead_inbox_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_lead_inbox_access() TO authenticated;

CREATE TABLE public.meta_form_leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 meta_lead_id text NOT NULL UNIQUE CHECK(length(meta_lead_id) BETWEEN 1 AND 100),
 page_id text NOT NULL CHECK(length(page_id) BETWEEN 1 AND 100),
 form_id text NOT NULL CHECK(length(form_id) BETWEEN 1 AND 100),
 campaign_id text NOT NULL DEFAULT '',
 campaign_name text NOT NULL DEFAULT '',
 ad_id text NOT NULL DEFAULT '',
 form_name text NOT NULL DEFAULT '',
 created_time timestamptz NOT NULL,
 field_data jsonb NOT NULL CHECK(jsonb_typeof(field_data)='array' AND pg_column_size(field_data)<=30000),
 custom_disclaimer_responses jsonb NOT NULL DEFAULT '[]'::jsonb
   CHECK(jsonb_typeof(custom_disclaimer_responses)='array' AND pg_column_size(custom_disclaimer_responses)<=30000),
 full_name text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'novo' CHECK(status IN ('novo','importado','ignorado')),
 crm_lead_id uuid UNIQUE REFERENCES public.crm_leads(id),
 imported_by uuid REFERENCES auth.users(id),
 imported_at timestamptz,
 ignored_reason text,
 received_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meta_form_leads_queue ON public.meta_form_leads(status,created_time DESC);
CREATE INDEX meta_form_leads_campaign ON public.meta_form_leads(campaign_id,form_id);
ALTER TABLE public.crm_leads
 ADD COLUMN meta_form_lead_id uuid UNIQUE REFERENCES public.meta_form_leads(id);

ALTER TABLE public.meta_form_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_form_leads FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meta_form_leads TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.meta_form_leads TO service_role;
CREATE POLICY meta_form_leads_read ON public.meta_form_leads FOR SELECT TO authenticated
 USING(public.meta_lead_inbox_access());

-- Called by a server-side webhook/reconciliation job after Graph API retrieval.
-- Browser users never receive the service credential or direct write privileges.
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
 WHERE public.meta_form_leads.status='novo'
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id; END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_ingest_form_lead(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ingest_form_lead(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.meta_promote_form_lead(p_id uuid,p_contact jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_form public.meta_form_leads; v_crm uuid; v_name text; v_phone text; v_email text;
BEGIN
 IF NOT public.meta_lead_inbox_access() OR NOT public.crm_user_can(auth.uid(),'leads')
 THEN RAISE EXCEPTION 'Acesso de SDR ao CRM necessário' USING ERRCODE='42501'; END IF;
 IF p_contact IS NULL OR jsonb_typeof(p_contact)<>'object' THEN RAISE EXCEPTION 'Cadastro inválido'; END IF;
 SELECT * INTO v_form FROM public.meta_form_leads WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead de formulário não encontrado'; END IF;
 IF v_form.status='importado' AND v_form.crm_lead_id IS NOT NULL THEN RETURN v_form.crm_lead_id; END IF;
 IF v_form.status<>'novo' THEN RAISE EXCEPTION 'Lead já foi descartado'; END IF;
 v_name:=btrim(coalesce(p_contact->>'name',''));
 v_phone:=btrim(coalesce(p_contact->>'phone',''));
 v_email:=btrim(coalesce(p_contact->>'email',''));
 IF length(v_name) NOT BETWEEN 2 AND 160 OR length(v_phone) NOT BETWEEN 8 AND 32
   OR length(v_email) NOT BETWEEN 5 AND 254
   OR length(btrim(coalesce(p_contact->>'athlete_name','')))<2
   OR nullif(p_contact->>'athlete_birth_date','') IS NULL
   OR nullif(p_contact->>'athlete_position','') IS NULL
 THEN RAISE EXCEPTION 'Preencha responsável, WhatsApp, e-mail, atleta, nascimento e posição'; END IF;
 INSERT INTO public.crm_leads(name,phone,email,athlete_name,athlete_birth_date,athlete_position,
   athlete_age,athlete_height_cm,athlete_weight_kg,performance_report_url,
   city_state,lead_source,observations,sdr_id,meta_form_lead_id)
 VALUES(v_name,v_phone,v_email,btrim(p_contact->>'athlete_name'),
   (p_contact->>'athlete_birth_date')::date,p_contact->>'athlete_position',
   nullif(p_contact->>'athlete_age','')::smallint,
   nullif(p_contact->>'athlete_height_cm','')::numeric,
   nullif(p_contact->>'athlete_weight_kg','')::numeric,
   nullif(p_contact->>'performance_report_url',''),
   nullif(btrim(coalesce(p_contact->>'city_state','')),''),
   'meta_ads_form',
   left('Formulário Meta '||v_form.form_id||' · campanha '||coalesce(nullif(v_form.campaign_name,''),v_form.campaign_id)
     ||E'\nMeta lead ID: '||v_form.meta_lead_id
     ||E'\nRespostas originais e consentimentos preservados na aba Leads.',9500),auth.uid(),p_id)
 RETURNING id INTO v_crm;
 UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,
   imported_by=auth.uid(),imported_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=p_id;
 RETURN v_crm;
END $$;
CREATE OR REPLACE FUNCTION public.meta_ignore_form_lead(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.meta_lead_inbox_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500
 THEN RAISE EXCEPTION 'Informe o motivo (3 a 500 caracteres)'; END IF;
 UPDATE public.meta_form_leads SET status='ignorado',ignored_reason=btrim(p_reason),
   updated_at=clock_timestamp() WHERE id=p_id AND status='novo';
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado ou já tratado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_promote_form_lead(uuid,jsonb),public.meta_ignore_form_lead(uuid,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_promote_form_lead(uuid,jsonb),public.meta_ignore_form_lead(uuid,text)
 TO authenticated;

CREATE TRIGGER meta_form_leads_signal AFTER INSERT OR UPDATE ON public.meta_form_leads
 FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
NOTIFY pgrst, 'reload schema';
COMMIT;
