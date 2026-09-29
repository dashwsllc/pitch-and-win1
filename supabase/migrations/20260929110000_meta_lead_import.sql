-- Import de leads/formulários por planilha (complemento ao webhook individual), com o
-- mesmo desenho de pendência + aprovação por Executive da migration anterior. Linha completa
-- (nome, telefone, e-mail, atleta, nascimento, posição) vira crm_leads automaticamente na
-- aprovação; linha incompleta cai em meta_form_leads 'novo', pro SDR completar em /leads
-- exatamente como já funciona hoje para leads do webhook.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE public.meta_lead_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by uuid NOT NULL REFERENCES auth.users(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 180),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovado','rejeitado')),
  rows jsonb NOT NULL,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text CHECK(review_note IS NULL OR char_length(review_note) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.meta_lead_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_lead_import_batches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meta_lead_import_batches TO authenticated;
CREATE POLICY meta_lead_import_read ON public.meta_lead_import_batches FOR SELECT TO authenticated
  USING(public.traffic_has_access());

-- Rastreabilidade: de qual planilha um lead da fila veio (NULL para leads do webhook Meta).
ALTER TABLE public.meta_form_leads
  ADD COLUMN lead_import_batch_id uuid REFERENCES public.meta_lead_import_batches(id);

CREATE OR REPLACE FUNCTION public.meta_import_leads(p_filename text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b uuid; item jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
  -- Só exige o mínimo estrutural (identificador e data — o cliente sempre preenche os dois,
  -- inclusive com fallback quando a planilha não traz). Nome/telefone/e-mail/atleta podem vir
  -- vazios: a linha entra do mesmo jeito e completa na fila /leads, sem travar o arquivo inteiro
  -- por causa de uma coluna que a exportação real não tem.
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF length(btrim(coalesce(item->>'meta_lead_id',''))) NOT BETWEEN 1 AND 100
      OR nullif(item->>'created_time','') IS NULL
    THEN RAISE EXCEPTION 'Cada linha precisa de identificador e data válidos'; END IF;
  END LOOP;
  INSERT INTO public.meta_lead_import_batches(imported_by,filename,row_count,status,rows)
  VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows),'pendente',p_rows) RETURNING id INTO b;
  RETURN jsonb_build_object('batch_id',b,'rows',jsonb_array_length(p_rows));
END $$;
REVOKE ALL ON FUNCTION public.meta_import_leads(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_import_leads(text,jsonb) TO authenticated;

-- Extraído de meta_promote_form_lead original: só o INSERT em crm_leads a partir de um
-- meta_form_leads já existente. Reusado pela promoção manual (SDR) e pela aprovação em massa.
CREATE OR REPLACE FUNCTION public.meta_create_crm_lead_from_form(v_form public.meta_form_leads,
  p_contact jsonb, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_crm uuid; v_name text; v_phone text; v_email text; v_observations text;
BEGIN
  v_name:=btrim(coalesce(p_contact->>'name',''));
  v_phone:=btrim(coalesce(p_contact->>'phone',''));
  v_email:=btrim(coalesce(p_contact->>'email',''));
  IF length(v_name) NOT BETWEEN 2 AND 160 OR length(v_phone) NOT BETWEEN 8 AND 32
    OR length(v_email) NOT BETWEEN 5 AND 254
    OR length(btrim(coalesce(p_contact->>'athlete_name','')))<2
    OR nullif(p_contact->>'athlete_birth_date','') IS NULL
    OR nullif(p_contact->>'athlete_position','') IS NULL
  THEN RAISE EXCEPTION 'Preencha responsável, WhatsApp, e-mail, atleta, nascimento e posição'; END IF;
  -- raw_notes só existe no payload da importação em planilha (meta_ingest_lead_import_row):
  -- respostas do formulário sem coluna dedicada no CRM. Ausente na promoção manual do SDR
  -- (Leads.tsx nunca envia essa chave), então o texto abaixo não muda pra esse caminho.
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
REVOKE ALL ON FUNCTION public.meta_create_crm_lead_from_form(public.meta_form_leads,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

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
 v_crm := public.meta_create_crm_lead_from_form(v_form, p_contact, auth.uid());
 UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,
   imported_by=auth.uid(),imported_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=p_id;
 RETURN v_crm;
END $$;

-- Ingestão em massa de uma linha da planilha aprovada: nunca deixa uma linha malformada ou
-- incompleta derrubar o lote inteiro (cada etapa roda numa subtransação própria). Completa se
-- der (mesma regra de meta_create_crm_lead_from_form); senão fica 'novo' na fila /leads.
CREATE OR REPLACE FUNCTION public.meta_ingest_lead_import_row(item jsonb, p_batch_id uuid, p_reviewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_form public.meta_form_leads; v_crm uuid; v_contact jsonb;
BEGIN
  BEGIN
    INSERT INTO public.meta_form_leads(meta_lead_id,page_id,form_id,campaign_id,campaign_name,ad_id,
      form_name,created_time,field_data,full_name,phone,email,lead_import_batch_id)
    VALUES(left(btrim(coalesce(item->>'meta_lead_id','')),100),'planilha',
      left(coalesce(nullif(item->>'form_id',''),'planilha'),100),
      left(coalesce(item->>'campaign_id',''),100),left(coalesce(item->>'campaign_name',''),160),
      left(coalesce(item->>'ad_id',''),100),left(coalesce(item->>'form_name',''),160),
      (item->>'created_time')::timestamptz,coalesce(item->'field_data','[]'::jsonb),
      left(btrim(coalesce(item->>'full_name','')),160),left(btrim(coalesce(item->>'phone','')),40),
      left(coalesce(item->>'email',''),254),p_batch_id)
    ON CONFLICT(meta_lead_id) DO NOTHING
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN RETURN; END;
  IF v_id IS NULL THEN RETURN; END IF;

  v_contact := jsonb_build_object('name',item->>'full_name','phone',item->>'phone','email',item->>'email',
    'athlete_name',item->>'athlete_name','athlete_birth_date',item->>'athlete_birth_date',
    'athlete_position',item->>'athlete_position','athlete_age',item->>'athlete_age',
    'athlete_height_cm',item->>'athlete_height_cm','athlete_weight_kg',item->>'athlete_weight_kg',
    'performance_report_url',item->>'performance_report_url','city_state',item->>'city_state',
    'raw_notes',item->>'raw_notes');
  BEGIN
    SELECT * INTO v_form FROM public.meta_form_leads WHERE id=v_id;
    v_crm := public.meta_create_crm_lead_from_form(v_form, v_contact, p_reviewer);
    UPDATE public.meta_form_leads SET status='importado',crm_lead_id=v_crm,
      imported_by=p_reviewer,imported_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=v_id;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- sem atleta/nascimento/posição válidos: fica 'novo' em /leads pro SDR completar
  END;
END $$;
REVOKE ALL ON FUNCTION public.meta_ingest_lead_import_row(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_review_lead_import(p_batch_id uuid, p_action text,
  p_expected_updated_at timestamptz, p_note text DEFAULT '')
RETURNS public.meta_lead_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_lead_import_batches; item jsonb;
BEGIN
  IF NOT public.is_executive(auth.uid()) THEN RAISE EXCEPTION 'Acesso de Executive necessário' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO b FROM public.meta_lead_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF b.status <> 'pendente' THEN RAISE EXCEPTION 'Esta importação já foi revisada'; END IF;
  IF b.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'Importação foi alterada por outra pessoa, recarregue' USING ERRCODE='40001'; END IF;
  IF p_action = 'rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)';
  END IF;
  IF p_action = 'aprovar' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(b.rows) LOOP
      PERFORM public.meta_ingest_lead_import_row(item, b.id, auth.uid());
    END LOOP;
  END IF;
  UPDATE public.meta_lead_import_batches SET
    status = CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
    review_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = clock_timestamp()
  WHERE id = p_batch_id
  RETURNING * INTO b;
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.meta_review_lead_import(uuid,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_review_lead_import(uuid,text,timestamptz,text) TO authenticated;

-- Sem trigger de sinal aqui: aprovação escreve em meta_form_leads, que já dispara
-- meta_form_leads_signal('crm') sozinho. meta_import_batches (métricas) também não tem sinal próprio.
NOTIFY pgrst,'reload schema';
COMMIT;
