BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
   city_state,lead_source,observations,sdr_id,meta_form_lead_id,lead_generated_at)
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
     ||E'\nRespostas originais e consentimentos preservados na aba Leads.',9500),auth.uid(),p_id,
   v_form.created_time)
 RETURNING id INTO v_crm;
 UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,
   imported_by=auth.uid(),imported_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=p_id;
 RETURN v_crm;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
