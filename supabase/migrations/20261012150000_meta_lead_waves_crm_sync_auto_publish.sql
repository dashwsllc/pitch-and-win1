-- Tráfego: levas de 20 leads, envio ao CRM com contexto, publicação automática das métricas
-- da API, métricas de campanhas de Vendas e chegada rápida de leads.
-- Atômica: qualquer falha desfaz tudo. Rodar no SQL Editor do Supabase (a trava de produção
-- do Claude Code não executa migrations).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ============================================================================
-- 1. Levas de leads (20 por leva), com status próprio e vínculo em cada lead.
-- ============================================================================
CREATE TABLE public.meta_lead_waves(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovada','rejeitada')),
  is_open boolean NOT NULL DEFAULT true,
  closed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text CHECK(review_note IS NULL OR length(review_note) BETWEEN 3 AND 500),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT meta_lead_waves_open_is_pending CHECK(NOT is_open OR status='pendente'),
  CONSTRAINT meta_lead_waves_decision_time CHECK((status='pendente') = (reviewed_at IS NULL))
);
-- Só pode existir uma leva aberta (recebendo leads novos).
CREATE UNIQUE INDEX meta_lead_waves_single_open ON public.meta_lead_waves((true)) WHERE is_open;
ALTER TABLE public.meta_lead_waves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_lead_waves FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.meta_lead_waves TO authenticated;
CREATE POLICY meta_lead_waves_read ON public.meta_lead_waves FOR SELECT TO authenticated USING(public.traffic_has_access());

ALTER TABLE public.meta_form_leads
  ADD COLUMN wave_id uuid REFERENCES public.meta_lead_waves(id),
  ADD COLUMN crm_sync_status text CHECK(crm_sync_status IN ('enviado','falhou')),
  ADD COLUMN crm_sync_error text CHECK(crm_sync_error IS NULL OR length(crm_sync_error)<=500),
  ADD COLUMN crm_sync_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN crm_sync_last_at timestamptz;
CREATE INDEX meta_form_leads_wave ON public.meta_form_leads(wave_id,created_time DESC,id) WHERE wave_id IS NOT NULL;
CREATE INDEX meta_form_leads_sync_failed ON public.meta_form_leads(wave_id) WHERE crm_sync_status='falhou';
-- Leads que já estavam no CRM antes das levas constam como enviados.
UPDATE public.meta_form_leads SET crm_sync_status='enviado',crm_sync_last_at=coalesce(imported_at,clock_timestamp()) WHERE crm_lead_id IS NOT NULL;

ALTER TABLE public.meta_audit_events DROP CONSTRAINT meta_audit_events_entity_type_check;
ALTER TABLE public.meta_audit_events ADD CONSTRAINT meta_audit_events_entity_type_check
  CHECK(entity_type = ANY (ARRAY['lead','lead_batch','metrics_batch','metrics_row','capture_review','lead_wave']));

-- Todo lead novo da Meta entra na leva aberta; ao chegar em 20 ela fecha e a próxima abre.
-- O gatilho BEFORE roda também no INSERT ... ON CONFLICT de um lead repetido, por isso
-- confere a duplicidade antes de contar vaga na leva.
CREATE OR REPLACE FUNCTION public.meta_wave_current() RETURNS public.meta_lead_waves
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves;
BEGIN
  SELECT * INTO w FROM public.meta_lead_waves WHERE is_open FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.meta_lead_waves(number) SELECT coalesce(max(number),0)+1 FROM public.meta_lead_waves RETURNING * INTO w;
  END IF;
  RETURN w;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_current() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_assign_lead_wave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; members integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  IF EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id=NEW.meta_lead_id) THEN RETURN NEW; END IF;
  w:=public.meta_wave_current();
  NEW.wave_id:=w.id;
  SELECT count(*) INTO members FROM public.meta_form_leads WHERE wave_id=w.id;
  IF members+1>=20 THEN
    UPDATE public.meta_lead_waves SET is_open=false,closed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=w.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meta_assign_lead_wave() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER meta_form_leads_assign_wave BEFORE INSERT ON public.meta_form_leads FOR EACH ROW
  WHEN (NEW.approval_status='pendente')
  EXECUTE FUNCTION public.meta_assign_lead_wave();

-- Fecha a leva cujos leads já foram todos decididos (por exemplo, pelo caminho individual antigo).
CREATE OR REPLACE FUNCTION public.meta_wave_settle(p_wave uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; pending integer; approved integer; rejected integer;
BEGIN
  IF p_wave IS NULL THEN RETURN; END IF;
  SELECT * INTO w FROM public.meta_lead_waves WHERE id=p_wave FOR UPDATE;
  IF NOT FOUND OR w.status<>'pendente' THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE approval_status='pendente'),count(*) FILTER(WHERE approval_status='aprovado'),count(*) FILTER(WHERE approval_status='rejeitado')
    INTO pending,approved,rejected FROM public.meta_form_leads WHERE wave_id=p_wave;
  IF pending>0 OR approved+rejected=0 THEN RETURN; END IF;
  UPDATE public.meta_lead_waves SET status=CASE WHEN approved>0 THEN 'aprovada' ELSE 'rejeitada' END,is_open=false,
    closed_at=coalesce(closed_at,clock_timestamp()),reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),
    version=version+1,updated_at=clock_timestamp() WHERE id=p_wave;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_settle(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Reorganiza só os leads ainda pendentes, em ordem cronológica, em levas de 20.
-- Levas já aprovadas ou rejeitadas nunca são tocadas.
CREATE OR REPLACE FUNCTION public.meta_wave_rebuild_core() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  UPDATE public.meta_form_leads SET wave_id=NULL
   WHERE approval_status='pendente' AND wave_id IN (SELECT id FROM public.meta_lead_waves WHERE status='pendente');
  PERFORM public.meta_wave_settle(w.id) FROM public.meta_lead_waves w
   WHERE w.status='pendente' AND EXISTS(SELECT 1 FROM public.meta_form_leads l WHERE l.wave_id=w.id);
  DELETE FROM public.meta_lead_waves w WHERE w.status='pendente' AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads l WHERE l.wave_id=w.id);
  base:=coalesce((SELECT max(number) FROM public.meta_lead_waves),0);
  WITH ordered AS (
    SELECT id,(row_number() OVER (ORDER BY created_time,id)-1)/20 AS chunk FROM public.meta_form_leads
     WHERE approval_status='pendente' AND wave_id IS NULL),
  sized AS (SELECT chunk,count(*) AS n FROM ordered GROUP BY chunk),
  made AS (
    INSERT INTO public.meta_lead_waves(number,is_open,closed_at)
    SELECT base+chunk+1,n<20,CASE WHEN n>=20 THEN clock_timestamp() END FROM sized ORDER BY chunk
    RETURNING id,number)
  UPDATE public.meta_form_leads l SET wave_id=made.id FROM ordered JOIN made ON made.number=base+ordered.chunk+1 WHERE l.id=ordered.id;
  -- Rede de segurança: reorganizar nunca pode deixar um lead pendente sem leva (a transação inteira é desfeita).
  IF EXISTS(SELECT 1 FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL) THEN
    RAISE EXCEPTION 'A reorganização das levas deixaria leads sem leva' USING ERRCODE='XX001';
  END IF;
  RETURN (SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente')::integer;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_rebuild_core() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_wave_needs_rebuild() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL)
  OR EXISTS(
    WITH s AS (SELECT w.number,min(l.created_time) AS mn,max(l.created_time) AS mx
      FROM public.meta_lead_waves w JOIN public.meta_form_leads l ON l.wave_id=w.id AND l.approval_status='pendente'
      WHERE w.status='pendente' GROUP BY w.number)
    SELECT 1 FROM s a JOIN s b ON b.number>a.number AND b.mn<a.mx)
$$;
REVOKE ALL ON FUNCTION public.meta_wave_needs_rebuild() FROM PUBLIC,anon,authenticated,service_role;

-- Ao concluir uma descoberta (por exemplo, a busca dos leads antigos), recoloca em ordem
-- as levas pendentes, mas só se houver lead fora de ordem.
CREATE OR REPLACE FUNCTION public.meta_wave_after_discovery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.last_completed_until IS DISTINCT FROM OLD.last_completed_until AND public.meta_wave_needs_rebuild() THEN
    PERFORM public.meta_wave_rebuild_core();
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_after_discovery() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER meta_lead_discovery_rebuild_waves AFTER UPDATE OF last_completed_until ON public.meta_lead_discovery_state
  FOR EACH ROW EXECUTE FUNCTION public.meta_wave_after_discovery();

-- ============================================================================
-- 2. Lead da Meta entra no CRM só com nome, WhatsApp e contexto.
--    O SDR completa e-mail, atleta, nascimento e posição.
-- ============================================================================
-- Contexto "Respostas do formulário": criado pelo sistema, somente leitura, um por lead.
ALTER TABLE public.crm_lead_contexts DROP CONSTRAINT crm_lead_contexts_author_role_check;
ALTER TABLE public.crm_lead_contexts ADD CONSTRAINT crm_lead_contexts_author_role_check
  CHECK(author_role = ANY (ARRAY['sdr','closer','trafego']));
ALTER TABLE public.crm_lead_contexts DROP CONSTRAINT crm_lead_contexts_context_type_check;
ALTER TABLE public.crm_lead_contexts ADD CONSTRAINT crm_lead_contexts_context_type_check
  CHECK(context_type = ANY (ARRAY['whatsapp_summary','call_transcript','manual_note','meta_form']));
CREATE UNIQUE INDEX crm_lead_contexts_meta_form_once ON public.crm_lead_contexts(lead_id) WHERE context_type='meta_form';

CREATE OR REPLACE FUNCTION public.crm_protect_meta_form_context() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.context_type='meta_form' THEN
    RAISE EXCEPTION 'As respostas do formulário são somente leitura' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_protect_meta_form_context() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER crm_lead_contexts_protect_meta_form BEFORE UPDATE ON public.crm_lead_contexts
  FOR EACH ROW EXECUTE FUNCTION public.crm_protect_meta_form_context();

-- Lead vindo da Meta não precisa do nome do atleta para ser criado; edições posteriores
-- dos dados pessoais continuam exigindo os campos de sempre.
CREATE OR REPLACE FUNCTION public.crm_guard_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_owner name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid=TG_RELID;
  IF TG_TABLE_NAME='crm_leads' THEN
    NEW.email:=NULLIF(btrim(NEW.email),''); NEW.athlete_position:=NULLIF(btrim(NEW.athlete_position),'');
    NEW.city_state:=NULLIF(btrim(NEW.city_state),''); NEW.performance_report_url:=NULLIF(btrim(NEW.performance_report_url),'');
    NEW.priority:=NULLIF(btrim(NEW.priority),''); NEW.lead_source:=NULLIF(btrim(NEW.lead_source),'');
    -- Old incomplete records remain usable; edits to personal data must complete only these three fields.
    IF TG_OP='INSERT' OR ROW(NEW.name,NEW.athlete_name,NEW.phone) IS DISTINCT FROM ROW(OLD.name,OLD.athlete_name,OLD.phone) THEN
      IF NULLIF(btrim(NEW.name),'') IS NULL OR NULLIF(btrim(NEW.phone),'') IS NULL
        OR (NULLIF(btrim(NEW.athlete_name),'') IS NULL AND NOT (TG_OP='INSERT' AND NEW.meta_form_lead_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Preencha nome do responsável, nome do atleta e WhatsApp' USING ERRCODE='23514'; END IF;
    END IF;
    IF current_user<>v_owner THEN
      IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Atualize o lead pelas ações do CRM' USING ERRCODE='42501'; END IF;
      IF NEW.pipeline_stage<>'novo' OR NEW.approach_stage<>'nao_abordado' OR NEW.closer_id IS NOT NULL OR NEW.handed_off_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL THEN
        RAISE EXCEPTION 'Novo lead deve iniciar na esteira SDR' USING ERRCODE='42501'; END IF;
    END IF;
    IF TG_OP='INSERT' THEN
      NEW.version:=1; NEW.sdr_id:=CASE WHEN public.crm_can('sdr') THEN auth.uid() ELSE NULL END;
      NEW.approached:=false; NEW.approach_count:=0; NEW.approached_at:=NULL;
    ELSE NEW.version:=OLD.version+1; END IF;
  ELSE
    IF current_user<>v_owner AND (TG_OP<>'INSERT' OR NEW.call_type IS NOT NULL OR NEW.previous_state IS NOT NULL OR NEW.new_state IS NOT NULL) THEN
      RAISE EXCEPTION 'Histórico é imutável; altere calls pelas ações do CRM' USING ERRCODE='42501'; END IF;
    IF TG_OP='INSERT' THEN SELECT COALESCE(display_name,auth.uid()::text) INTO NEW.author_name FROM public.profiles WHERE user_id=auth.uid();
    ELSIF TG_OP='UPDATE' THEN NEW.author_name:=OLD.author_name; END IF;
    IF TG_OP<>'DELETE' THEN NEW.updated_at:=clock_timestamp(); END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.meta_crm_approval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND OLD.meta_form_lead_id IS NOT NULL AND NEW.meta_form_lead_id IS DISTINCT FROM OLD.meta_form_lead_id THEN
    RAISE EXCEPTION 'O vínculo original do lead Meta não pode ser removido ou alterado' USING ERRCODE='42501';
  END IF;
  IF NEW.meta_form_lead_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.meta_form_lead_id IS DISTINCT FROM OLD.meta_form_lead_id) THEN
    PERFORM 1 FROM public.meta_form_leads WHERE id=NEW.meta_form_lead_id AND approval_status='aprovado' AND status='novo' FOR UPDATE;
    IF NOT FOUND
      THEN RAISE EXCEPTION 'Lead aguardando aprovação em Tráfego' USING ERRCODE='42501'; END IF;
    -- Mínimo para o SDR abordar: responsável e WhatsApp. O restante é completado no CRM.
    IF length(btrim(NEW.name))<2 OR length(btrim(coalesce(NEW.phone,'')))<8
    THEN RAISE EXCEPTION 'Informe o nome do responsável e um WhatsApp válido antes de enviar ao CRM' USING ERRCODE='22023'; END IF;
    IF TG_OP='INSERT' THEN NEW.sdr_id:=NULL; END IF;
  END IF;
  IF NEW.meta_form_lead_id IS NOT NULL THEN NEW.lead_source:='meta_ads_form'; END IF;
  RETURN NEW;
END $function$;

-- Texto do contexto: todas as respostas escritas do formulário, com rótulos legíveis.
CREATE OR REPLACE FUNCTION public.meta_form_context_text(p_form public.meta_form_leads) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN answers.body IS NULL THEN NULL ELSE left(concat_ws(E'\n',
    'Respostas do formulário Meta'||CASE WHEN nullif(btrim(p_form.form_name),'') IS NOT NULL THEN ' · '||btrim(p_form.form_name) ELSE '' END,
    'Campanha: '||coalesce(nullif(btrim(p_form.campaign_name),''),nullif(btrim(p_form.campaign_id),''),'não informada'),
    CASE WHEN p_form.import_contact->>'time_known'='false'
      THEN 'Caiu em: '||to_char(p_form.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||' (horário não informado na planilha)'
      ELSE 'Caiu em: '||to_char(p_form.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (Brasília)' END,
    '',answers.body),49000) END
  FROM (
    SELECT string_agg('- '||x.label||': '||x.value,E'\n' ORDER BY x.n) AS body
    FROM (
      SELECT a.n,
        CASE a.answer->>'name' WHEN 'full_name' THEN 'Nome completo' WHEN 'phone_number' THEN 'Telefone' WHEN 'email' THEN 'E-mail'
          WHEN 'date_of_birth' THEN 'Data de nascimento' WHEN 'state' THEN 'Estado' WHEN 'city' THEN 'Cidade'
          ELSE upper(left(s.name_text,1))||substr(s.name_text,2) END AS label,
        left(v.value,1500) AS value
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_form.field_data)='array' THEN p_form.field_data ELSE '[]'::jsonb END) WITH ORDINALITY a(answer,n)
      CROSS JOIN LATERAL (SELECT btrim(regexp_replace(replace(coalesce(a.answer->>'name',''),'_',' '),'\s+',' ','g')) AS name_text) s
      CROSS JOIN LATERAL (
        SELECT string_agg(CASE WHEN t ~ '^[^[:space:]]+$' AND t=lower(t) AND t LIKE '%\_%' THEN replace(t,'_',' ') ELSE t END,', ') AS value
        FROM (SELECT btrim(item) AS t FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.answer->'values')='array' THEN a.answer->'values' ELSE '[]'::jsonb END) item) parts
        WHERE t<>'') v
      WHERE s.name_text<>'' AND v.value IS NOT NULL
    ) x
  ) answers
$$;
REVOKE ALL ON FUNCTION public.meta_form_context_text(public.meta_form_leads) FROM PUBLIC,anon,authenticated,service_role;

-- Envia UM lead aprovado ao CRM. Idempotente: se já existe vínculo, só confirma.
-- A falha de um lead não derruba os outros: o erro fica gravado no lead, que pode ser
-- corrigido (edição de Tráfego) e reenviado.
CREATE OR REPLACE FUNCTION public.meta_sync_form_lead_to_crm(p_lead uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f public.meta_form_leads; contact jsonb; crm uuid; stamp timestamptz:=clock_timestamp();
  v_name text; v_phone text; v_email text; v_athlete text; v_birth date; v_position text; v_context text; v_author text; v_error text;
  v_age smallint; v_height numeric; v_weight numeric; v_report text; v_city text; v_observations text;
BEGIN
  SELECT * INTO f FROM public.meta_form_leads WHERE id=p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF f.approval_status<>'aprovado' THEN RAISE EXCEPTION 'Lead aguardando aprovação em Tráfego' USING ERRCODE='42501'; END IF;
  IF f.crm_lead_id IS NOT NULL THEN
    UPDATE public.meta_form_leads SET crm_sync_status='enviado',crm_sync_error=NULL,crm_sync_last_at=coalesce(crm_sync_last_at,stamp) WHERE id=f.id AND crm_sync_status IS DISTINCT FROM 'enviado';
    RETURN jsonb_build_object('ok',true,'crm_lead_id',f.crm_lead_id,'already',true);
  END IF;
  SELECT id INTO crm FROM public.crm_leads WHERE meta_form_lead_id=f.id;
  IF crm IS NULL THEN
    BEGIN
      contact:=public.meta_contact_from_form(f);
      v_name:=left(btrim(coalesce(contact->>'name','')),160);
      v_phone:=btrim(coalesce(contact->>'phone',''));
      IF length(v_name)<2 THEN RAISE EXCEPTION 'Informe o nome do responsável (mínimo de 2 caracteres)' USING ERRCODE='22023'; END IF;
      IF length(v_phone) NOT BETWEEN 8 AND 32 THEN RAISE EXCEPTION 'Corrija o WhatsApp: ele precisa ter de 8 a 32 caracteres' USING ERRCODE='22023'; END IF;
      v_email:=nullif(btrim(coalesce(contact->>'email','')),'');
      IF v_email IS NOT NULL AND (length(v_email)>254 OR v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') THEN v_email:=NULL; END IF;
      v_athlete:=nullif(left(btrim(coalesce(contact->>'athlete_name','')),160),'');
      IF length(coalesce(v_athlete,''))<2 THEN v_athlete:=NULL; END IF;
      BEGIN v_birth:=nullif(contact->>'athlete_birth_date','')::date; EXCEPTION WHEN OTHERS THEN v_birth:=NULL; END;
      IF v_birth IS NOT NULL AND (v_birth<DATE '1900-01-01' OR v_birth>(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date) THEN v_birth:=NULL; END IF;
      v_position:=CASE WHEN contact->>'athlete_position' IN ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante') THEN contact->>'athlete_position' END;
      BEGIN v_age:=nullif(contact->>'athlete_age','')::smallint; EXCEPTION WHEN OTHERS THEN v_age:=NULL; END;
      IF v_age IS NOT NULL AND v_age NOT BETWEEN 1 AND 80 THEN v_age:=NULL; END IF;
      BEGIN v_height:=nullif(contact->>'athlete_height_cm','')::numeric; EXCEPTION WHEN OTHERS THEN v_height:=NULL; END;
      IF v_height IS NOT NULL AND v_height NOT BETWEEN 30 AND 250 THEN v_height:=NULL; END IF;
      BEGIN v_weight:=nullif(contact->>'athlete_weight_kg','')::numeric; EXCEPTION WHEN OTHERS THEN v_weight:=NULL; END;
      IF v_weight IS NOT NULL AND v_weight NOT BETWEEN 1 AND 300 THEN v_weight:=NULL; END IF;
      v_report:=nullif(contact->>'performance_report_url','');
      IF v_report IS NOT NULL AND (length(v_report)>2048 OR v_report !~ '^https://[^/[:space:]]+') THEN v_report:=NULL; END IF;
      v_city:=nullif(left(btrim(coalesce(contact->>'city_state','')),160),'');
      v_observations:='Formulário Meta '||f.form_id||' · campanha '||coalesce(nullif(f.campaign_name,''),f.campaign_id)
        ||E'\nMeta lead ID: '||f.meta_lead_id||E'\nRespostas do formulário no painel Contexto deste lead.';
      INSERT INTO public.crm_leads(name,phone,email,athlete_name,athlete_birth_date,athlete_position,athlete_age,athlete_height_cm,athlete_weight_kg,
        performance_report_url,city_state,lead_source,observations,sdr_id,meta_form_lead_id,lead_generated_at)
      VALUES(v_name,v_phone,v_email,v_athlete,v_birth,v_position,v_age,v_height,v_weight,v_report,v_city,'meta_ads_form',left(v_observations,9500),NULL,f.id,f.created_time)
      RETURNING id INTO crm;
      v_context:=public.meta_form_context_text(f);
      IF v_context IS NOT NULL THEN
        SELECT p.display_name INTO v_author FROM public.profiles p WHERE p.user_id=p_actor;
        INSERT INTO public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content)
        VALUES(crm,p_actor,coalesce(nullif(btrim(v_author),''),'Tráfego'),'trafego','meta_form',v_context)
        ON CONFLICT(lead_id) WHERE context_type='meta_form' DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_error:=left(SQLERRM,500); crm:=NULL;
    END;
  END IF;
  IF crm IS NULL THEN
    UPDATE public.meta_form_leads SET crm_sync_status='falhou',crm_sync_error=v_error,crm_sync_attempts=crm_sync_attempts+1,crm_sync_last_at=stamp,
      import_warning=left('Falha no envio ao CRM: '||v_error,500),updated_at=stamp WHERE id=f.id;
    RETURN jsonb_build_object('ok',false,'error',v_error);
  END IF;
  UPDATE public.meta_form_leads SET crm_sync_status='enviado',crm_sync_error=NULL,crm_sync_attempts=crm_sync_attempts+1,crm_sync_last_at=stamp,
    import_warning=CASE WHEN import_warning LIKE 'Falha no envio ao CRM:%' THEN NULL ELSE import_warning END,updated_at=stamp WHERE id=f.id;
  RETURN jsonb_build_object('ok',true,'crm_lead_id',crm,'already',false);
END $$;
REVOKE ALL ON FUNCTION public.meta_sync_form_lead_to_crm(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- ============================================================================
-- 3. Telas e ações das levas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.meta_wave_summary(p_wave uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('id',w.id,'number',w.number,'status',w.status,'is_open',w.is_open,'version',w.version,
    'created_at',w.created_at,'closed_at',w.closed_at,'reviewed_at',w.reviewed_at,'review_note',w.review_note,
    'reviewed_by_name',(SELECT p.display_name FROM public.profiles p WHERE p.user_id=w.reviewed_by),
    'lead_count',count(l.id),
    'pending',count(l.id) FILTER(WHERE l.approval_status='pendente'),
    'approved',count(l.id) FILTER(WHERE l.approval_status='aprovado'),
    'rejected',count(l.id) FILTER(WHERE l.approval_status='rejeitado'),
    'sent',count(l.id) FILTER(WHERE l.crm_sync_status='enviado'),
    'failed',count(l.id) FILTER(WHERE l.crm_sync_status='falhou'),
    'first_lead_at',min(l.created_time),'last_lead_at',max(l.created_time))
  FROM public.meta_lead_waves w LEFT JOIN public.meta_form_leads l ON l.wave_id=w.id
  WHERE w.id=p_wave GROUP BY w.id
$$;
REVOKE ALL ON FUNCTION public.meta_wave_summary(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Lista as levas, da mais recente para a mais antiga.
CREATE OR REPLACE FUNCTION public.meta_wave_list(p_status text DEFAULT NULL,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pendente','aprovada','rejeitada') THEN RAISE EXCEPTION 'Status de leva inválido' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Paginação inválida' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'count',(SELECT count(*) FROM public.meta_lead_waves WHERE p_status IS NULL OR status=p_status),
    'pending_waves',(SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente'),
    'pending_leads',(SELECT count(*) FROM public.meta_form_leads WHERE approval_status='pendente'),
    'failed_leads',(SELECT count(*) FROM public.meta_form_leads WHERE approval_status='aprovado' AND crm_lead_id IS NULL AND crm_sync_status='falhou'),
    'newest_pending_lead_at',(SELECT max(created_time) FROM public.meta_form_leads WHERE approval_status='pendente'),
    'needs_rebuild',public.meta_wave_needs_rebuild(),
    'waves',coalesce((SELECT jsonb_agg(public.meta_wave_summary(page.id) ORDER BY page.number DESC)
      FROM (SELECT id,number FROM public.meta_lead_waves WHERE p_status IS NULL OR status=p_status ORDER BY number DESC LIMIT p_limit OFFSET p_offset) page),'[]'))
  INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_list(text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_list(text,integer,integer) TO authenticated;

-- Abre uma leva: os leads, do mais recente para o mais antigo, com data e hora de cada um.
CREATE OR REPLACE FUNCTION public.meta_wave_leads(p_wave uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_lead_waves WHERE id=p_wave) THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
  SELECT jsonb_build_object('wave',public.meta_wave_summary(p_wave),
    'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'meta_lead_id',l.meta_lead_id,'page_id',l.page_id,'form_id',l.form_id,'form_name',l.form_name,
      'campaign_id',l.campaign_id,'campaign_name',l.campaign_name,'ad_id',l.ad_id,'created_time',l.created_time,'received_at',l.received_at,'updated_at',l.updated_at,
      'full_name',l.full_name,'phone',l.phone,'email',l.email,'field_data',l.field_data,'custom_disclaimer_responses',l.custom_disclaimer_responses,
      'approval_status',l.approval_status,'status',l.status,'review_note',l.review_note,'reviewed_at',l.reviewed_at,'import_warning',l.import_warning,
      'crm_lead_id',l.crm_lead_id,'crm_sync_status',l.crm_sync_status,'crm_sync_error',l.crm_sync_error,'crm_sync_attempts',l.crm_sync_attempts,
      'crm_sync_last_at',l.crm_sync_last_at,'traffic_edited_at',l.traffic_edited_at,
      'source',CASE WHEN l.lead_import_batch_id IS NULL THEN 'api' ELSE 'planilha' END,
      'batch_filename',(SELECT b.filename FROM public.meta_lead_import_batches b WHERE b.id=l.lead_import_batch_id),
      'time_known',CASE WHEN l.import_contact->>'time_known' IN ('true','false') THEN (l.import_contact->>'time_known')::boolean ELSE true END) ORDER BY l.created_time DESC,l.id)
      FROM public.meta_form_leads l WHERE l.wave_id=p_wave),'[]'))
  INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_leads(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_leads(uuid) TO authenticated;

-- Aprova ou rejeita uma leva. p_lead_ids são os leads que estavam na tela; p_excluded
-- tira leads da leva (com motivo) e aprova os demais. Repetir a mesma decisão devolve o
-- mesmo resultado sem criar nada novo.
CREATE OR REPLACE FUNCTION public.meta_wave_decide(p_wave uuid,p_action text,p_lead_ids uuid[],p_excluded jsonb DEFAULT '[]'::jsonb,p_note text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; actor uuid:=auth.uid(); stamp timestamptz:=clock_timestamp(); ids uuid[]; excluded_ids uuid[]:='{}'; extra uuid[];
  item jsonb; reason text; lead_id uuid; approve_ids uuid[]; nw public.meta_lead_waves; excluded_n integer:=0; decided_n integer:=0; summary jsonb; note text;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  SELECT * INTO w FROM public.meta_lead_waves WHERE id=p_wave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
  IF w.status<>'pendente' THEN
    IF (w.status='aprovada' AND p_action='aprovar') OR (w.status='rejeitada' AND p_action='rejeitar') THEN
      RETURN public.meta_wave_summary(w.id)||jsonb_build_object('already',true);
    END IF;
    RAISE EXCEPTION 'Esta leva já foi %',w.status USING ERRCODE='22023';
  END IF;
  note:=nullif(btrim(coalesce(p_note,'')),'');
  IF p_action='rejeitar' AND (note IS NULL OR length(note) NOT BETWEEN 3 AND 500) THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)' USING ERRCODE='22023'; END IF;
  IF note IS NOT NULL AND length(note)>500 THEN RAISE EXCEPTION 'Observação acima de 500 caracteres' USING ERRCODE='22023'; END IF;
  ids:=ARRAY(SELECT DISTINCT i FROM unnest(coalesce(p_lead_ids,'{}'::uuid[])) i);
  IF cardinality(ids)=0 THEN RAISE EXCEPTION 'Selecione ao menos um lead da leva' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ids) i WHERE NOT EXISTS(SELECT 1 FROM public.meta_form_leads l WHERE l.id=i AND l.wave_id=p_wave)) THEN
    RAISE EXCEPTION 'A leva mudou; recarregue antes de decidir' USING ERRCODE='40001'; END IF;
  IF p_excluded IS NULL OR jsonb_typeof(p_excluded)<>'array' THEN RAISE EXCEPTION 'Lista de exclusões inválida' USING ERRCODE='22023'; END IF;
  IF p_action='rejeitar' AND jsonb_array_length(p_excluded)>0 THEN RAISE EXCEPTION 'Ao rejeitar a leva não há exclusões individuais' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_excluded) LOOP
    IF jsonb_typeof(item)<>'object' OR coalesce(item->>'id','') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Exclusão inválida' USING ERRCODE='22023'; END IF;
    lead_id:=(item->>'id')::uuid; reason:=btrim(coalesce(item->>'reason',''));
    IF NOT lead_id=ANY(ids) THEN RAISE EXCEPTION 'Exclusão de lead que não está na leva' USING ERRCODE='22023'; END IF;
    IF length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo para tirar o lead da leva (3 a 500 caracteres)' USING ERRCODE='22023'; END IF;
    IF lead_id=ANY(excluded_ids) THEN RAISE EXCEPTION 'Lead repetido nas exclusões' USING ERRCODE='22023'; END IF;
    excluded_ids:=excluded_ids||lead_id;
  END LOOP;
  PERFORM 1 FROM public.meta_form_leads WHERE wave_id=p_wave ORDER BY id FOR UPDATE;
  approve_ids:=ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.wave_id=p_wave AND l.id=ANY(ids) AND NOT l.id=ANY(excluded_ids)
    AND l.approval_status='pendente' AND l.status='novo' ORDER BY l.created_time,l.id);
  IF p_action='aprovar' AND cardinality(approve_ids)=0 THEN
    RAISE EXCEPTION 'Nenhum lead restou para aprovar; rejeite a leva' USING ERRCODE='22023'; END IF;
  -- Leads que chegaram depois da tela carregada vão para a próxima leva, intactos.
  extra:=ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.wave_id=p_wave AND l.approval_status='pendente' AND NOT l.id=ANY(ids));
  UPDATE public.meta_lead_waves SET is_open=false,closed_at=coalesce(closed_at,stamp) WHERE id=p_wave;
  IF cardinality(extra)>0 THEN
    nw:=public.meta_wave_current();
    UPDATE public.meta_form_leads SET wave_id=nw.id WHERE id=ANY(extra);
  END IF;
  IF p_action='aprovar' THEN
    UPDATE public.meta_form_leads SET approval_status='aprovado',reviewed_by=actor,reviewed_at=stamp,updated_at=stamp
      WHERE id=ANY(approve_ids);
    FOREACH lead_id IN ARRAY approve_ids LOOP PERFORM public.meta_sync_form_lead_to_crm(lead_id,actor); END LOOP;
    decided_n:=cardinality(approve_ids);
  ELSE
    UPDATE public.meta_form_leads SET approval_status='rejeitado',status='ignorado',reviewed_by=actor,reviewed_at=stamp,review_note=note,
      ignored_reason=note,updated_at=stamp WHERE id=ANY(approve_ids);
    decided_n:=cardinality(approve_ids);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_excluded) LOOP
    lead_id:=(item->>'id')::uuid; reason:=btrim(item->>'reason');
    UPDATE public.meta_form_leads SET approval_status='rejeitado',status='ignorado',reviewed_by=actor,reviewed_at=stamp,review_note=reason,
      ignored_reason=reason,updated_at=stamp WHERE id=lead_id AND approval_status='pendente' AND status='novo';
    excluded_n:=excluded_n+1;
  END LOOP;
  UPDATE public.meta_lead_waves SET status=CASE p_action WHEN 'aprovar' THEN 'aprovada' ELSE 'rejeitada' END,is_open=false,
    reviewed_by=actor,reviewed_at=stamp,review_note=note,version=version+1,updated_at=stamp WHERE id=p_wave;
  summary:=public.meta_wave_summary(p_wave);
  PERFORM public.meta_record_edit('lead_wave',p_wave,CASE p_action WHEN 'aprovar' THEN 'wave.approved' ELSE 'wave.rejected' END,'api',
    jsonb_build_object('number',w.number,'decided',decided_n,'excluded',excluded_n,'sent',summary->'sent','failed',summary->'failed','note',note,'moved_to_next',cardinality(extra)));
  RETURN summary||jsonb_build_object('already',false);
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_decide(uuid,text,uuid[],jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_decide(uuid,text,uuid[],jsonb,text) TO authenticated;

-- Reenvia ao CRM os leads aprovados que falharam (todos da leva ou só um).
CREATE OR REPLACE FUNCTION public.meta_wave_retry(p_wave uuid,p_lead uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; actor uuid:=auth.uid(); lead_id uuid; retried integer:=0; recovered integer:=0; outcome jsonb; summary jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  SELECT * INTO w FROM public.meta_lead_waves WHERE id=p_wave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
  IF w.status<>'aprovada' THEN RAISE EXCEPTION 'Só é possível reenviar leads de uma leva aprovada' USING ERRCODE='22023'; END IF;
  FOR lead_id IN SELECT l.id FROM public.meta_form_leads l WHERE l.wave_id=p_wave AND l.approval_status='aprovado' AND l.crm_lead_id IS NULL
    AND l.crm_sync_status='falhou' AND (p_lead IS NULL OR l.id=p_lead) ORDER BY l.created_time,l.id LOOP
    outcome:=public.meta_sync_form_lead_to_crm(lead_id,actor);
    retried:=retried+1;
    IF (outcome->>'ok')::boolean THEN recovered:=recovered+1; END IF;
  END LOOP;
  summary:=public.meta_wave_summary(p_wave);
  IF retried>0 THEN
    PERFORM public.meta_record_edit('lead_wave',p_wave,'wave.retried','api',jsonb_build_object('number',w.number,'retried',retried,'recovered',recovered,'failed',summary->'failed'));
  END IF;
  RETURN summary||jsonb_build_object('retried',retried,'recovered',recovered);
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_retry(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_retry(uuid,uuid) TO authenticated;

-- Botão de reserva: reorganiza as levas pendentes quando há lead fora de ordem.
CREATE OR REPLACE FUNCTION public.meta_wave_rebuild() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE waves integer:=0;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  IF public.meta_wave_needs_rebuild() THEN waves:=public.meta_wave_rebuild_core(); END IF;
  RETURN jsonb_build_object('pending_waves',(SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente'),'rebuilt',waves>0);
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_rebuild() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_rebuild() TO authenticated;

-- Caminho individual antigo: usa o mesmo envio (nome, WhatsApp e contexto) e fecha a leva se for o caso.
CREATE OR REPLACE FUNCTION public.meta_review_form_lead(p_id uuid,p_action text,p_expected_updated_at timestamptz,p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lead public.meta_form_leads; outcome jsonb;
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
    ignored_reason=CASE WHEN p_action='rejeitar' THEN nullif(btrim(coalesce(p_note,'')),'') ELSE ignored_reason END,
    updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO lead;
  IF p_action='rejeitar' THEN
    PERFORM public.meta_wave_settle(lead.wave_id);
    RETURN jsonb_build_object('crm',0,'queued',0,'duplicates',0,'failed',0,'issues','[]'::jsonb);
  END IF;
  outcome:=public.meta_sync_form_lead_to_crm(lead.id,auth.uid());
  PERFORM public.meta_wave_settle(lead.wave_id);
  RETURN jsonb_build_object('crm',CASE WHEN (outcome->>'ok')::boolean THEN 1 ELSE 0 END,'queued',CASE WHEN (outcome->>'ok')::boolean THEN 0 ELSE 1 END,
    'duplicates',0,'failed',0,'issues','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.meta_review_form_lead(uuid,text,timestamptz,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_review_form_lead(uuid,text,timestamptz,text) TO authenticated;


-- ============================================================================
-- Importação manual: a planilha entra nas MESMAS levas dos leads automáticos
-- ============================================================================
-- Cada linha vira um lead pendente (com a data e a hora do próprio lead), ordenado junto com os
-- demais. A aprovação, o envio ao CRM (nome, WhatsApp, contexto e "caiu em"), a falha visível e o
-- reenvio são os da leva. O arquivo inteiro fica guardado no lote, mesmo que uma linha seja recusada.
ALTER TABLE public.meta_lead_import_batches DROP CONSTRAINT meta_lead_import_batches_status_check;
ALTER TABLE public.meta_lead_import_batches ADD CONSTRAINT meta_lead_import_batches_status_check
  CHECK(status = ANY (ARRAY['pendente','aprovado','rejeitado','recebido']));

CREATE OR REPLACE FUNCTION public.meta_ingest_lead_import_row(item jsonb, p_batch_id uuid, p_reviewer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_id uuid; v_form public.meta_form_leads; v_contact jsonb; v_meta_id text; v_created timestamptz; v_wave bigint; v_time_known boolean; v_note text;
BEGIN
  -- Um lead não se perde por causa da data: sem data válida ele entra com o horário do recebimento (e o aviso).
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(coalesce(item->'field_data','[]'::jsonb)) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Linha ou respostas inválidas' USING ERRCODE='22023'; END IF;
  v_meta_id := regexp_replace(btrim(coalesce(item->>'meta_lead_id','')), '^l:([0-9]+)$', '\1');
  IF v_meta_id='' THEN
    v_meta_id := 'csv:'||md5(coalesce(item->'field_data','[]'::jsonb)::text||'|'||coalesce(item->>'full_name','')||'|'||coalesce(item->>'phone','')||'|'||coalesce(item->>'created_time',''));
  END IF;
  IF length(v_meta_id) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Identificador do lead inválido (máximo de 100 caracteres)' USING ERRCODE='22023'; END IF;
  v_time_known := CASE WHEN item->>'time_known' IN ('true','false') THEN (item->>'time_known')::boolean ELSE true END;
  BEGIN v_created := nullif(btrim(coalesce(item->>'created_time','')),'')::timestamptz; EXCEPTION WHEN OTHERS THEN v_created := NULL; END;
  IF v_created IS NULL OR NOT isfinite(v_created) OR v_created > clock_timestamp() + interval '1 day' THEN
    v_created := clock_timestamp(); v_time_known := false;
    v_note := 'Data do lead ausente, inválida ou futura; usamos o horário do recebimento da planilha.';
  END IF;
  v_contact := jsonb_build_object('name',item->>'full_name','phone',item->>'phone','email',item->>'email',
    'athlete_name',item->>'athlete_name','athlete_birth_date',item->>'athlete_birth_date',
    'athlete_position',item->>'athlete_position','athlete_age',item->>'athlete_age',
    'athlete_height_cm',item->>'athlete_height_cm','athlete_weight_kg',item->>'athlete_weight_kg',
    'performance_report_url',item->>'performance_report_url','city_state',item->>'city_state',
    'raw_notes',item->>'raw_notes','time_known',v_time_known);
  INSERT INTO public.meta_form_leads(meta_lead_id,page_id,form_id,campaign_id,campaign_name,ad_id,
    form_name,created_time,field_data,full_name,phone,email,lead_import_batch_id,import_contact,import_warning)
  VALUES(v_meta_id,'planilha',left(coalesce(nullif(item->>'form_id',''),'planilha'),100),
    left(coalesce(item->>'campaign_id',''),100),left(coalesce(item->>'campaign_name',''),160),
    left(coalesce(item->>'ad_id',''),100),left(coalesce(item->>'form_name',''),160),
    v_created,coalesce(item->'field_data','[]'::jsonb),
    left(btrim(coalesce(item->>'full_name','')),160),left(btrim(coalesce(item->>'phone','')),40),
    left(coalesce(item->>'email',''),254),p_batch_id,v_contact,
    nullif(left(concat_ws(' · ',
      CASE WHEN jsonb_typeof(item->'warnings')='array' THEN (SELECT string_agg(w, ' · ') FROM jsonb_array_elements_text(item->'warnings') w) END,
      v_note),500),''))
  ON CONFLICT(meta_lead_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_form FROM public.meta_form_leads WHERE meta_lead_id=v_meta_id;
    IF v_form.approval_status='pendente' THEN
      SELECT number INTO v_wave FROM public.meta_lead_waves WHERE id=v_form.wave_id;
      RAISE EXCEPTION 'Lead já recebido e aguardando aprovação na leva #%',coalesce(v_wave::text,'?') USING ERRCODE='23505';
    END IF;
    RAISE EXCEPTION 'Lead já recebido e %',CASE v_form.approval_status WHEN 'aprovado' THEN 'aprovado' ELSE 'rejeitado' END USING ERRCODE='23505';
  END IF;
END $function$;

-- Percorre as linhas de um lote. Erro de uma linha (dado inválido ou lead repetido) não derruba as demais;
-- qualquer outro erro desfaz o lote inteiro, então nada fica pela metade e o arquivo pode ser reenviado.
CREATE OR REPLACE FUNCTION public.meta_lead_import_ingest(p_batch_id uuid,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entry record; item jsonb; v_row integer; received integer:=0; duplicates integer:=0; failed integer:=0; issues jsonb:='[]'::jsonb;
BEGIN
  FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(p_rows) WITH ORDINALITY LOOP
    item:=entry.value;
    v_row:=CASE WHEN item->>'source_row' ~ '^[0-9]{1,6}$' THEN greatest(2,(item->>'source_row')::integer) ELSE entry.ordinality+1 END;
    BEGIN
      PERFORM public.meta_ingest_lead_import_row(item,p_batch_id,auth.uid());
      received:=received+1;
    EXCEPTION
      WHEN unique_violation THEN
        duplicates:=duplicates+1;
        IF jsonb_array_length(issues)<200 THEN
          issues:=issues||jsonb_build_array(jsonb_build_object('row',v_row,'kind','duplicate','reason',left(SQLERRM,300))); END IF;
      WHEN data_exception OR check_violation OR not_null_violation THEN
        failed:=failed+1;
        issues:=issues||jsonb_build_array(jsonb_build_object('row',v_row,'kind','failed','reason',left(SQLERRM,300)));
    END;
  END LOOP;
  RETURN jsonb_build_object('received',received,'duplicates',duplicates,'failed',failed,'issues',issues);
END $$;
REVOKE ALL ON FUNCTION public.meta_lead_import_ingest(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.meta_ingest_lead_import_row(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_import_leads(p_filename text,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_lead_import_batches; outcome jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    THEN RAISE EXCEPTION 'Envie de 1 a 2.000 linhas'; END IF;
  IF length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Nome de arquivo inválido'; END IF;
  INSERT INTO public.meta_lead_import_batches(imported_by,filename,row_count,status,rows)
    VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows),'recebido',p_rows) RETURNING * INTO b;
  outcome:=public.meta_lead_import_ingest(b.id,p_rows);
  UPDATE public.meta_lead_import_batches SET result=outcome,updated_at=clock_timestamp() WHERE id=b.id RETURNING * INTO b;
  -- Leads de datas antigas ou misturadas são colocados em ordem cronológica nas levas pendentes.
  IF public.meta_wave_needs_rebuild() THEN PERFORM public.meta_wave_rebuild_core(); END IF;
  RETURN jsonb_build_object('batch_id',b.id,'rows',b.row_count,'status',b.status,'result',outcome);
END $$;
REVOKE ALL ON FUNCTION public.meta_import_leads(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_import_leads(text,jsonb) TO authenticated;

-- Lotes que ficaram pendentes antes desta mudança: aprovar manda as linhas para as levas (nunca direto ao CRM).
CREATE OR REPLACE FUNCTION public.meta_review_lead_import(p_batch_id uuid,p_action text,p_expected_updated_at timestamptz,p_note text DEFAULT '')
RETURNS public.meta_lead_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_lead_import_batches; outcome jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO b FROM public.meta_lead_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF b.status<>'pendente' THEN RAISE EXCEPTION 'Esta importação já foi revisada'; END IF;
  IF b.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN RAISE EXCEPTION 'Importação foi alterada por outra pessoa, recarregue' USING ERRCODE='40001'; END IF;
  IF p_action='rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500
    THEN RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)'; END IF;
  IF p_action='aprovar' THEN outcome:=public.meta_lead_import_ingest(b.id,b.rows); END IF;
  UPDATE public.meta_lead_import_batches SET status=CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    result=outcome,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),
    review_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=clock_timestamp()
    WHERE id=p_batch_id RETURNING * INTO b;
  IF p_action='aprovar' AND public.meta_wave_needs_rebuild() THEN PERFORM public.meta_wave_rebuild_core(); END IF;
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.meta_review_lead_import(uuid,text,timestamptz,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_review_lead_import(uuid,text,timestamptz,text) TO authenticated;

-- Nenhum lead se perde: um lead rejeitado (por engano ou por mudança de ideia) volta como pendente,
-- na posição cronológica correta. Vale para um lead ou para uma leva rejeitada inteira.
CREATE OR REPLACE FUNCTION public.meta_wave_reopen(p_wave uuid DEFAULT NULL,p_lead uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.meta_lead_waves; ids uuid[]; origin_number bigint;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF (p_wave IS NULL) = (p_lead IS NULL) THEN RAISE EXCEPTION 'Informe a leva ou o lead a reabrir' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-lead-wave',0));
  IF p_lead IS NOT NULL THEN
    PERFORM 1 FROM public.meta_form_leads l WHERE l.id=p_lead FOR UPDATE;
    ids:=ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.id=p_lead AND l.approval_status='rejeitado' AND l.crm_lead_id IS NULL);
  ELSE
    SELECT * INTO w FROM public.meta_lead_waves WHERE id=p_wave FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
    IF w.status<>'rejeitada' THEN RAISE EXCEPTION 'Só uma leva rejeitada pode ser reaberta' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.meta_form_leads l WHERE l.wave_id=p_wave ORDER BY l.id FOR UPDATE;
    ids:=ARRAY(SELECT l.id FROM public.meta_form_leads l WHERE l.wave_id=p_wave AND l.approval_status='rejeitado' AND l.crm_lead_id IS NULL);
  END IF;
  IF cardinality(ids)=0 THEN RAISE EXCEPTION 'Não há lead rejeitado para reabrir' USING ERRCODE='22023'; END IF;
  UPDATE public.meta_form_leads SET approval_status='pendente',status='novo',reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,
    ignored_reason=NULL,wave_id=NULL,updated_at=clock_timestamp() WHERE id=ANY(ids);
  PERFORM public.meta_wave_rebuild_core();
  -- Leva rejeitada que ficou sem nenhum lead deixa de existir; o registro da decisão permanece na auditoria.
  DELETE FROM public.meta_lead_waves x WHERE x.status<>'pendente' AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads l WHERE l.wave_id=x.id);
  IF p_wave IS NOT NULL THEN
    PERFORM public.meta_record_edit('lead_wave',p_wave,'wave.reopened','api',jsonb_build_object('number',w.number,'reopened',cardinality(ids)));
  END IF;
  RETURN jsonb_build_object('reopened',cardinality(ids),'pending_waves',(SELECT count(*) FROM public.meta_lead_waves WHERE status='pendente'));
END $$;
REVOKE ALL ON FUNCTION public.meta_wave_reopen(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_wave_reopen(uuid,uuid) TO authenticated;

-- Reabrir um lead rejeitado fica registrado como reabertura, não como nova rejeição.
CREATE OR REPLACE FUNCTION public.meta_audit_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
        actions:=array_append(actions,CASE NEW.approval_status WHEN 'aprovado' THEN 'lead.approved' WHEN 'rejeitado' THEN 'lead.rejected' ELSE 'lead.reopened' END);
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
END $function$;

-- ============================================================================
-- 4. Métricas: campanhas de Vendas (página de destino, carrinho, finalização) e operação
-- ============================================================================
ALTER TABLE public.meta_traffic_daily
  ADD COLUMN landing_page_views bigint NOT NULL DEFAULT 0 CHECK(landing_page_views>=0),
  ADD COLUMN adds_to_cart bigint NOT NULL DEFAULT 0 CHECK(adds_to_cart>=0),
  ADD COLUMN checkouts_initiated bigint NOT NULL DEFAULT 0 CHECK(checkouts_initiated>=0);

ALTER TABLE public.meta_lead_discovery_state
  ADD COLUMN webhook_leadgen_subscribed boolean,
  ADD COLUMN webhook_checked_at timestamptz;

CREATE OR REPLACE FUNCTION public.meta_validate_traffic_row(item jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
 ELSIF nullif(current_setting('meta.capture_review',true),'') IS NOT NULL THEN
   SELECT (now() AT TIME ZONE (r.manifest->'account'->>'timezone'))::date INTO today FROM public.meta_capture_reviews r
     WHERE r.id=nullif(current_setting('meta.capture_review',true),'')::uuid AND r.account_id=acct AND r.status IN ('pendente','aprovado');
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
 FOREACH key IN ARRAY ARRAY['spend','purchase_value','leads','purchases','impressions','reach','link_clicks','messaging_conversations_started','landing_page_views','adds_to_cart','checkouts_initiated'] LOOP
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
     OR v#>>'{}' NOT IN ('objective','leads','purchases','purchase_value','impressions','reach','link_clicks','messaging_conversations_started','landing_page_views','adds_to_cart','checkouts_initiated'))) THEN
   RAISE EXCEPTION 'Disponibilidade de métricas inválida' USING ERRCODE='22023'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.meta_upsert_traffic_row(item jsonb, p_source text, p_imported_by uuid, p_import_batch_id uuid, p_sync_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-fact:'||public.meta_traffic_identity(item),0));
  item:=item||jsonb_build_object('account_id',public.meta_normalize_account_id(item->>'account_id'));
  PERFORM public.meta_validate_traffic_row(item);
  v_date:=(item->>'date')::date;
  v_level:=item->>'level'; v_account:=btrim(coalesce(item->>'account_id',''));
  v_campaign:=btrim(coalesce(item->>'campaign_id','')); v_adset:=btrim(coalesce(item->>'adset_id',''));
  v_ad:=btrim(coalesce(item->>'ad_id',''));
  IF v_date IS NULL
    OR v_level NOT IN ('campaign','adset','ad') OR v_account='' OR v_campaign=''
    OR (v_level IN ('adset','ad') AND v_adset='') OR (v_level='ad' AND v_ad='')
    OR coalesce(item->>'currency','BRL')<>'BRL'
  THEN RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores ou moeda'; END IF;
  INSERT INTO public.meta_traffic_daily(date,account_id,account_name,campaign_id,campaign_name,
    adset_id,adset_name,ad_id,ad_name,level,currency,attribution_window,objective,spend,leads,purchases,
    purchase_value,impressions,reach,link_clicks,messaging_conversations_started,
    landing_page_views,adds_to_cart,checkouts_initiated,
    source,imported_by,import_batch_id,sync_run_id,available_metrics,metric_metadata,original_key,capture_review_id,first_origin)
  VALUES(v_date,v_account,left(coalesce(item->>'account_name',''),160),v_campaign,
    left(coalesce(item->>'campaign_name',''),160),v_adset,left(coalesce(item->>'adset_name',''),160),
    v_ad,left(coalesce(item->>'ad_name',''),160),v_level,'BRL',
    left(coalesce(nullif(item->>'attribution_window',''),'Conforme exportação Meta'),120),
    left(coalesce(nullif(item->>'objective',''),'nao_informado'),160),
    (item->>'spend')::numeric,(item->>'leads')::integer,(item->>'purchases')::integer,
    coalesce((item->>'purchase_value')::numeric,0),coalesce((item->>'impressions')::bigint,0),
    coalesce((item->>'reach')::bigint,0),coalesce((item->>'link_clicks')::bigint,0),
    coalesce((item->>'messaging_conversations_started')::bigint,0),
    coalesce((item->>'landing_page_views')::bigint,0),coalesce((item->>'adds_to_cart')::bigint,0),coalesce((item->>'checkouts_initiated')::bigint,0),
    p_source,p_imported_by,p_import_batch_id,p_sync_run_id,
    CASE WHEN item ? 'available_metrics' THEN ARRAY(SELECT jsonb_array_elements_text(item->'available_metrics'))
      WHEN item ? 'present_metrics' THEN ARRAY['spend']||ARRAY(SELECT jsonb_array_elements_text(item->'present_metrics')) END,
    item->'metric_metadata',coalesce(item->'original_key',public.meta_traffic_identity(item)::jsonb),(item->>'capture_review_id')::uuid,
    jsonb_build_object('source',p_source,'imported_by',p_imported_by,'import_batch_id',p_import_batch_id,'sync_run_id',p_sync_run_id))
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
    landing_page_views=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'landing_page_views' THEN excluded.landing_page_views ELSE meta_traffic_daily.landing_page_views END,
    adds_to_cart=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'adds_to_cart' THEN excluded.adds_to_cart ELSE meta_traffic_daily.adds_to_cart END,
    checkouts_initiated=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'checkouts_initiated' THEN excluded.checkouts_initiated ELSE meta_traffic_daily.checkouts_initiated END,
    source=excluded.source,imported_by=excluded.imported_by,import_batch_id=excluded.import_batch_id,
    sync_run_id=excluded.sync_run_id,
    available_metrics=CASE WHEN item ? 'available_metrics' THEN excluded.available_metrics
      WHEN item ? 'present_metrics' AND meta_traffic_daily.available_metrics IS NOT NULL THEN ARRAY(SELECT DISTINCT m FROM unnest(meta_traffic_daily.available_metrics||excluded.available_metrics) m)
      ELSE meta_traffic_daily.available_metrics END,
    metric_metadata=CASE WHEN item ? 'metric_metadata' THEN excluded.metric_metadata ELSE meta_traffic_daily.metric_metadata END,
    original_key=coalesce(meta_traffic_daily.original_key,public.meta_traffic_identity(to_jsonb(meta_traffic_daily))::jsonb),
    capture_review_id=excluded.capture_review_id,
    first_origin=coalesce(meta_traffic_daily.first_origin,jsonb_build_object('source',meta_traffic_daily.source,'imported_by',meta_traffic_daily.imported_by,'import_batch_id',meta_traffic_daily.import_batch_id,'sync_run_id',meta_traffic_daily.sync_run_id)),
    updated_at=clock_timestamp();
END $function$;

CREATE OR REPLACE FUNCTION public.meta_traffic_operation()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 WITH latest AS (SELECT DISTINCT ON(account_id,level,kind,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs ORDER BY account_id,level,kind,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC),
 complete AS (SELECT DISTINCT ON(account_id,level,kind,coalesce(request_params->>'discover','legacy')) id FROM public.meta_sync_runs WHERE status='success' AND coverage_state='complete' ORDER BY account_id,level,kind,coalesce(request_params->>'discover','legacy'),started_at DESC,id DESC),
 runs AS (SELECT r.id,r.kind,r.account_id,r.level,r.status,r.coverage_state,r.started_at,r.finished_at,r.window_start,r.window_end,r.rows_synced,r.page_count,CASE WHEN jsonb_typeof(r.request_params->'discover')='boolean' THEN (r.request_params->>'discover')::boolean END AS discover,
   CASE WHEN r.error_message IS NULL THEN NULL WHEN r.error_message ~* 'pages_manage_ads|permission|permiss|oauth|authoriz|autoriz|token' THEN 'Regularize a autorização da Meta e o acesso aos leads da página. A importação manual continua disponível.'
     ELSE 'A sincronização não concluiu. Confira a configuração e tente novamente; a importação manual continua disponível.' END AS error_message
   FROM public.meta_sync_runs r WHERE r.id IN (SELECT id FROM latest UNION SELECT id FROM complete)),
 published AS (SELECT DISTINCT ON(account_id,level) account_id,level,window_start,window_end,reviewed_at FROM public.meta_capture_reviews WHERE status='aprovado' ORDER BY account_id,level,reviewed_at DESC,id DESC)
 SELECT jsonb_build_object('runs',coalesce((SELECT jsonb_agg(to_jsonb(runs)) FROM runs),'[]'),
   'published',coalesce((SELECT jsonb_agg(to_jsonb(published)) FROM published),'[]'),
   'pending',coalesce((SELECT jsonb_object_agg(account_id,levels) FROM (SELECT account_id,jsonb_object_agg(level,n) levels FROM (SELECT account_id,level,count(*) n FROM public.meta_capture_reviews WHERE status='pendente' GROUP BY account_id,level) counts GROUP BY account_id) p),'{}'),
   'webhook',coalesce((SELECT jsonb_agg(jsonb_build_object('page_id',s.page_id,'leadgen_subscribed',s.webhook_leadgen_subscribed,'checked_at',s.webhook_checked_at)) FROM public.meta_lead_discovery_state s),'[]'),
   'alerts',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',k.kind,'last_success_at',k.last_success_at,'last_error_at',k.last_error_at))
     FROM (SELECT r.kind,max(r.finished_at) FILTER(WHERE r.status='success') AS last_success_at,max(r.started_at) FILTER(WHERE r.status='error') AS last_error_at
       FROM public.meta_sync_runs r WHERE r.started_at>clock_timestamp()-interval '14 days'
         AND ((r.kind='insights') OR (r.kind='leads_reconciliation' AND r.request_params->>'discover'='true'))
       GROUP BY r.kind) k
     WHERE k.last_error_at IS NOT NULL AND (k.last_success_at IS NULL OR (k.last_error_at>k.last_success_at AND clock_timestamp()-k.last_success_at>interval '60 minutes'))),'[]')) INTO result;
 RETURN result;
END $function$;

-- Publicação automática de uma captura COMPLETA da API. Só publica quando a revisão não tem
-- conflito, edição manual ou remoção em excesso; do contrário continua pendente para um humano.
CREATE OR REPLACE FUNCTION public.meta_capture_publish_system(p_review uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews; row public.meta_capture_review_rows; fact public.meta_traffic_daily; item jsonb;
  inserted integer:=0; updated integer:=0; removed integer:=0; total integer; removals integer;
BEGIN
  PERFORM public.meta_capture_require_service();
  SELECT * INTO r FROM public.meta_capture_reviews WHERE id=p_review FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revisão não encontrada' USING ERRCODE='P0002'; END IF;
  IF r.status<>'pendente' THEN RETURN jsonb_build_object('published',false,'reason','not_pending','status',r.status); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-capture:'||r.account_id||':'||r.level,0));
  SELECT count(*),count(*) FILTER(WHERE operation='remove') INTO total,removals FROM public.meta_capture_review_rows WHERE review_id=p_review;
  IF EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=p_review AND (conflict_details IS NOT NULL OR edited OR operation NOT IN ('upsert','remove'))) THEN
    RETURN jsonb_build_object('published',false,'reason','requires_review'); END IF;
  IF removals>greatest(5,total/5) THEN RETURN jsonb_build_object('published',false,'reason','many_removals','removals',removals); END IF;
  FOR row IN SELECT * FROM public.meta_capture_review_rows WHERE review_id=p_review ORDER BY effective_key::text LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('meta-fact:'||row.effective_key::text,0));
    SELECT * INTO fact FROM public.meta_traffic_daily WHERE date=(row.effective_key->>0)::date AND account_id=row.effective_key->>1 AND campaign_id=row.effective_key->>2 AND adset_id=row.effective_key->>3 AND ad_id=row.effective_key->>4 FOR UPDATE;
    IF row.before_snapshot IS NOT NULL AND fact.id IS NULL THEN
      SELECT * INTO fact FROM public.meta_traffic_daily WHERE id=(row.before_snapshot->>'id')::uuid FOR UPDATE;
    END IF;
    IF fact.updated_at IS DISTINCT FROM row.before_version OR (fact.id IS NOT NULL AND fact.id IS DISTINCT FROM (row.before_snapshot->>'id')::uuid) THEN
      RETURN jsonb_build_object('published',false,'reason','stale');
    END IF;
  END LOOP;
  FOR row IN SELECT * FROM public.meta_capture_review_rows WHERE review_id=p_review ORDER BY effective_key::text LOOP
    IF row.operation='remove' THEN
      DELETE FROM public.meta_traffic_daily WHERE id=(row.before_snapshot->>'id')::uuid;
      removed:=removed+1;
      PERFORM public.meta_record_edit('metrics_row',(row.before_snapshot->>'id')::uuid,'metric.removed',row.before_snapshot->>'source',
        jsonb_build_object('review_id',p_review,'reason','Ausente na captura completa publicada automaticamente','before',row.before_snapshot));
    ELSE
      item:=row.payload||jsonb_build_object('capture_review_id',p_review,'original_key',row.original_key);
      PERFORM public.meta_upsert_traffic_row(item,'api',NULL,NULL,coalesce((item->>'sync_run_id')::uuid,r.sync_run_id));
      IF row.before_snapshot IS NULL THEN inserted:=inserted+1; ELSE updated:=updated+1; END IF;
    END IF;
  END LOOP;
  UPDATE public.meta_capture_reviews SET status='aprovado',version=version+1,reviewed_by=NULL,reviewed_at=clock_timestamp(),
    review_note='Publicação automática: captura completa da API, sem conflitos',updated_at=clock_timestamp() WHERE id=p_review RETURNING * INTO r;
  PERFORM public.meta_record_edit('capture_review',p_review,'capture.auto_approved','api',
    jsonb_build_object('version',r.version-1,'inserted',inserted,'updated',updated,'removed',removed,'automatic',true,'manifest',r.manifest));
  RETURN jsonb_build_object('published',true,'inserted',inserted,'updated',updated,'removed',removed);
END $$;
REVOKE ALL ON FUNCTION public.meta_capture_publish_system(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capture_publish_system(uuid) TO service_role;

-- Conferência por dia e campanha: o que a Meta informa × o que chegou × o que foi ao CRM.
CREATE OR REPLACE FUNCTION public.meta_traffic_conference(p_start date,p_end date)
RETURNS TABLE(stat_day date,campaign_id text,campaign_name text,meta_leads bigint,received bigint,pending bigint,approved bigint,rejected bigint,in_crm bigint,failed bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_start>p_end OR p_end-p_start>366 THEN RAISE EXCEPTION 'Período inválido' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH metrics AS (
    SELECT d.date AS day,d.campaign_id,max(d.campaign_name) AS campaign_name,sum(d.leads)::bigint AS meta_leads
    FROM public.meta_traffic_daily d WHERE d.level='campaign' AND d.date BETWEEN p_start AND p_end GROUP BY d.date,d.campaign_id),
  leads AS (
    SELECT (l.created_time AT TIME ZONE 'America/Sao_Paulo')::date AS day,l.campaign_id,max(nullif(l.campaign_name,'')) AS campaign_name,
      count(*)::bigint AS received,
      count(*) FILTER(WHERE l.approval_status='pendente')::bigint AS pending,
      count(*) FILTER(WHERE l.approval_status='aprovado')::bigint AS approved,
      count(*) FILTER(WHERE l.approval_status='rejeitado')::bigint AS rejected,
      count(*) FILTER(WHERE l.crm_lead_id IS NOT NULL)::bigint AS in_crm,
      count(*) FILTER(WHERE l.crm_sync_status='falhou')::bigint AS failed
    FROM public.meta_form_leads l WHERE (l.created_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end GROUP BY 1,2)
  SELECT coalesce(m.day,l.day),coalesce(m.campaign_id,l.campaign_id),coalesce(m.campaign_name,l.campaign_name,''),
    coalesce(m.meta_leads,0),coalesce(l.received,0),coalesce(l.pending,0),coalesce(l.approved,0),coalesce(l.rejected,0),coalesce(l.in_crm,0),coalesce(l.failed,0)
  FROM metrics m FULL OUTER JOIN leads l ON l.day=m.day AND l.campaign_id=m.campaign_id
  WHERE coalesce(m.meta_leads,0)>0 OR coalesce(l.received,0)>0
  ORDER BY 1 DESC,2;
END $$;
REVOKE ALL ON FUNCTION public.meta_traffic_conference(date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_traffic_conference(date,date) TO authenticated;

-- A busca de leads registra se a Página está assinada para receber leads em tempo real.
CREATE OR REPLACE FUNCTION public.meta_lead_discovery_note_webhook(p_page_id text,p_subscribed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.meta_capture_require_service();
  IF p_page_id IS NULL OR p_page_id !~ '^[A-Za-z0-9_-]{1,100}$' OR p_subscribed IS NULL THEN RAISE EXCEPTION 'Página ou estado inválido' USING ERRCODE='22023'; END IF;
  UPDATE public.meta_lead_discovery_state SET webhook_leadgen_subscribed=p_subscribed,webhook_checked_at=clock_timestamp() WHERE page_id=p_page_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_lead_discovery_note_webhook(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_lead_discovery_note_webhook(text,boolean) TO service_role;

-- ============================================================================
-- 5. Chegada rápida e dados
-- ============================================================================
-- Busca de reserva a cada 5 minutos; métricas recapturam 8 dias a cada 30 minutos.
-- Os jobs mantêm nome e estado (ativo/pausado); só mudam agenda e corpo da chamada.
DO $cron$
DECLARE job record; existing bigint; command text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  FOR job IN SELECT * FROM (VALUES
    ('meta-insights-sync-frequent','*/30 * * * *','meta-insights-sync','{"days":8}'::jsonb),
    ('meta-leads-reconciliation-hourly','*/5 * * * *','meta-leads-reconciliation','{"discover":true}'::jsonb)) desired(name,schedule,endpoint,body) LOOP
    SELECT jobid INTO existing FROM cron.job WHERE jobname=job.name;
    IF existing IS NULL THEN CONTINUE; END IF;
    command:=format($command$
     SELECT net.http_post(url:=%L,
       headers:=jsonb_build_object('Content-Type','application/json',
         'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_cron_anon_key' LIMIT 1),
         'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_sync_cron_secret' LIMIT 1)),
       body:=%L::jsonb,timeout_milliseconds:=60000)
     WHERE (SELECT count(DISTINCT name)=2 FROM vault.decrypted_secrets WHERE name IN ('meta_cron_anon_key','meta_sync_cron_secret') AND length(decrypted_secret)>0);
   $command$,'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/'||job.endpoint,job.body::text);
    PERFORM cron.alter_job(existing,schedule:=job.schedule,command:=command);
  END LOOP;
END $cron$;

-- Busca dos leads de 07/10 em diante (a primeira janela cobriu só as 48 horas anteriores a 09/10).
-- Os 148 já recebidos são deduplicados pelo recibo; só os faltantes entram, e as levas pendentes
-- são reorganizadas em ordem cronológica quando a busca terminar.
UPDATE public.meta_lead_discovery_state SET last_completed_until=TIMESTAMPTZ '2026-10-07 00:05:00-03'
 WHERE last_completed_until IS NOT NULL AND last_completed_until>TIMESTAMPTZ '2026-10-07 00:05:00-03';

-- Distribui nas levas os leads que já estavam pendentes.
SELECT public.meta_wave_rebuild_core();

-- Conferência final: a migration só conclui se as levas estiverem consistentes.
DO $check$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL;
  IF bad>0 THEN RAISE EXCEPTION 'Verificação das levas: % leads pendentes sem leva',bad; END IF;
  SELECT count(*) INTO bad FROM (SELECT wave_id FROM public.meta_form_leads WHERE wave_id IS NOT NULL GROUP BY wave_id HAVING count(*)>20) s;
  IF bad>0 THEN RAISE EXCEPTION 'Verificação das levas: % levas com mais de 20 leads',bad; END IF;
  SELECT count(*) INTO bad FROM public.meta_lead_waves WHERE is_open;
  IF bad>1 THEN RAISE EXCEPTION 'Verificação das levas: % levas abertas',bad; END IF;
  IF public.meta_wave_needs_rebuild() THEN RAISE EXCEPTION 'Verificação das levas: ordem cronológica inconsistente'; END IF;
END $check$;

NOTIFY pgrst,'reload schema';

COMMIT;
