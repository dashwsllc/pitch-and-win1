-- O atleta preenche o formulario da Meta e, ~1-9 min depois, cai no site, que cria um segundo
-- registro so com contato. O CRM era criado a partir do registro do site, sem as respostas.
-- Esta migration liga os dois registros (anuncio + horario + nome, ou telefone + nome), copia as
-- respostas do formulario para o Contexto do lead e impede lead duplicado na aprovacao.
-- Nada e apagado: respostas, snapshots e registros originais permanecem como estao.
BEGIN;
SET LOCAL lock_timeout='5s';

-- 0. So substitui as funcoes se elas ainda forem exatamente as que foram auditadas.
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.meta_sync_form_lead_to_crm(uuid,uuid)'::regprocedure))<>'802879125215ace732d8240913d3f531' THEN
  RAISE EXCEPTION 'meta_sync_form_lead_to_crm mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.crm_context_summary(integer,integer)'::regprocedure))<>'d796186737091641ece778e250786b95' THEN
  RAISE EXCEPTION 'crm_context_summary mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
END $guard$;

-- 1. Vinculo: o registro do SITE aponta para o registro do FORMULARIO que guarda as respostas.
ALTER TABLE public.meta_form_leads
 ADD COLUMN IF NOT EXISTS answers_form_lead_id uuid REFERENCES public.meta_form_leads(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS answers_link_basis text,
 ADD COLUMN IF NOT EXISTS answers_linked_at timestamptz;
DO $constraint$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='meta_form_leads_answers_link_chk') THEN
  ALTER TABLE public.meta_form_leads ADD CONSTRAINT meta_form_leads_answers_link_chk
   CHECK(answers_form_lead_id IS NULL OR (entry_channel='website' AND answers_form_lead_id<>id AND answers_linked_at IS NOT NULL));
 END IF;
END $constraint$;
CREATE UNIQUE INDEX IF NOT EXISTS meta_form_leads_answers_form_key ON public.meta_form_leads(answers_form_lead_id) WHERE answers_form_lead_id IS NOT NULL;

-- 2. Normalizacoes (sem acento, minusculas) usadas so para comparar.
CREATE OR REPLACE FUNCTION public.meta_match_name(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT btrim(regexp_replace(regexp_replace(lower(translate(coalesce(p,''),
  'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),'[^a-z ]',' ','g'),'\s+',' ','g'))
$$;
CREATE OR REPLACE FUNCTION public.meta_phone_tail(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT right(regexp_replace(coalesce(p,''),'\D','','g'),8) $$;
CREATE OR REPLACE FUNCTION public.meta_site_ad_id(p_utm_content text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT nullif(btrim(split_part(coalesce(p_utm_content,''),'|',2)),'') $$;

-- 3. Texto das respostas: TODAS as perguntas, na ordem do formulario, com a resposta exata.
-- Sem corte por tamanho (o limite do campo e maior que o do formulario).
CREATE OR REPLACE FUNCTION public.meta_form_answers_text(p_form public.meta_form_leads,p_site public.meta_form_leads DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN answers.body IS NULL THEN NULL ELSE left(concat_ws(E'\n',
   'Respostas do formulário Meta'||CASE WHEN nullif(btrim(p_form.form_name),'') IS NOT NULL THEN ' · '||btrim(p_form.form_name) ELSE '' END,
   'Campanha: '||coalesce(nullif(btrim(p_form.campaign_name),''),nullif(btrim(p_form.campaign_id),''),'não informada'),
   'Preenchido em: '||CASE WHEN p_form.import_contact->>'time_known'='false'
     THEN to_char(p_form.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||' (horário não informado)'
     ELSE to_char(p_form.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS')||' (Brasília)' END,
   CASE WHEN p_site.id IS NOT NULL THEN 'Ligado ao envio do site de '||to_char(p_site.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS')
     ||' (Brasília) — '||coalesce(p_site.answers_link_basis,'vínculo registrado') END,
   '',answers.body),50000) END
 FROM (
  SELECT string_agg(x.label||E'\n→ '||x.value,E'\n\n' ORDER BY x.n) AS body
  FROM (
   SELECT a.n,
    CASE a.answer->>'name' WHEN 'full_name' THEN 'Nome completo' WHEN 'phone_number' THEN 'Telefone' WHEN 'email' THEN 'E-mail'
     WHEN 'date_of_birth' THEN 'Data de nascimento' WHEN 'state' THEN 'Estado' WHEN 'city' THEN 'Cidade'
     ELSE upper(left(s.name_text,1))||substr(s.name_text,2) END AS label,
    coalesce(nullif(v.value,''),'Não informado na origem') AS value
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_form.field_data)='array' THEN p_form.field_data ELSE '[]'::jsonb END) WITH ORDINALITY a(answer,n)
   CROSS JOIN LATERAL (SELECT btrim(regexp_replace(replace(coalesce(a.answer->>'name',''),'_',' '),'\s+',' ','g')) AS name_text) s
   CROSS JOIN LATERAL (
    SELECT string_agg(CASE WHEN t ~ '^[^[:space:]]+$' AND t=lower(t) AND t LIKE '%\_%'
      THEN upper(left(replace(t,'_',' '),1))||substr(replace(t,'_',' '),2) ELSE t END,', ') AS value
    FROM (SELECT btrim(item) AS t FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.answer->'values')='array' THEN a.answer->'values' ELSE '[]'::jsonb END) item) parts
    WHERE t<>'') v
   WHERE s.name_text<>''
  ) x
 ) answers
$$;

-- 4. Anexa as respostas ao Contexto de um lead que ja esta no CRM (idempotente).
CREATE OR REPLACE FUNCTION public.meta_attach_form_answers(p_crm uuid,p_form uuid,p_author uuid,p_site uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f public.meta_form_leads; s public.meta_form_leads; body text; prev public.crm_lead_contexts; v_name text;
BEGIN
 SELECT * INTO f FROM public.meta_form_leads WHERE id=p_form;
 IF NOT FOUND THEN RETURN 'formulario_inexistente'; END IF;
 IF p_site IS NOT NULL THEN SELECT * INTO s FROM public.meta_form_leads WHERE id=p_site; END IF;
 body:=public.meta_form_answers_text(f,s);
 IF body IS NULL THEN RETURN 'sem_respostas'; END IF;
 SELECT * INTO prev FROM public.crm_lead_contexts WHERE lead_id=p_crm AND context_type='meta_form';
 IF FOUND THEN
  IF position(body IN prev.content)>0 THEN RETURN 'igual'; END IF;
  IF char_length(prev.content)+char_length(body)+2>50000 THEN RETURN 'muito_grande'; END IF;
  -- Mescla sem perder o texto que ja existia (o gatilho de protecao bloqueia UPDATE, nao DELETE).
  DELETE FROM public.crm_lead_contexts WHERE id=prev.id;
  INSERT INTO public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content,created_at)
  VALUES(p_crm,prev.author_id,prev.author_name,prev.author_role,'meta_form',prev.content||E'\n\n'||body,prev.created_at);
  RETURN 'mesclado';
 END IF;
 IF p_author IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_author) THEN RETURN 'sem_autor'; END IF;
 SELECT nullif(btrim(p.display_name),'') INTO v_name FROM public.profiles p WHERE p.user_id=p_author;
 INSERT INTO public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content)
 VALUES(p_crm,p_author,coalesce(v_name,'Tráfego'),'trafego','meta_form',body)
 ON CONFLICT(lead_id) WHERE context_type='meta_form' DO NOTHING;
 RETURN 'inserido';
END $$;

-- 5. Pares site <-> formulario. Regras (a mais forte de cada par vence; empate = ambiguo, vai para revisao):
--   1  mesmo anuncio, site ate 10 min depois do formulario, nome completo igual
--   2  mesmo anuncio, site ate 15 min depois, primeiro nome igual
--   3  mesmo telefone (8 ultimos digitos), ate 72 h depois, primeiro nome igual
CREATE OR REPLACE FUNCTION public.meta_site_form_pairs() RETURNS TABLE(site_id uuid,form_id uuid,rule smallint,delta_seconds numeric,ambiguous boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH s AS (
  SELECT m.id,m.created_time t,public.meta_site_ad_id(m.source_snapshot#>>'{site_event,payload,attribution,utm_content}') ad,
   public.meta_match_name(m.full_name) nome,public.meta_phone_tail(m.phone) k8
  FROM public.meta_form_leads m WHERE m.entry_channel='website' AND m.answers_form_lead_id IS NULL
 ), f AS (
  SELECT m.id,m.created_time t,m.ad_id ad,public.meta_match_name(m.full_name) nome,public.meta_phone_tail(m.phone) k8
  FROM public.meta_form_leads m WHERE m.entry_channel='form' AND public.crm_form_answers_present(to_jsonb(m))
   AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads x WHERE x.answers_form_lead_id=m.id)
 ), p AS (
  SELECT s.id sid,f.id fid,extract(epoch FROM s.t-f.t) d,
   (CASE
    WHEN s.ad IS NOT NULL AND s.ad=f.ad AND s.nome<>'' AND s.nome=f.nome AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '10 minutes' THEN 1
    WHEN s.ad IS NOT NULL AND s.ad=f.ad AND split_part(s.nome,' ',1)<>'' AND split_part(s.nome,' ',1)=split_part(f.nome,' ',1)
     AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '15 minutes' THEN 2
    WHEN s.k8<>'' AND s.k8=f.k8 AND split_part(s.nome,' ',1)<>'' AND split_part(s.nome,' ',1)=split_part(f.nome,' ',1)
     AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '72 hours' THEN 3 END)::smallint rule
  FROM s JOIN f ON s.t-f.t BETWEEN interval '-2 minutes' AND interval '72 hours'
 ), q AS (
  SELECT *,min(rule) OVER (PARTITION BY fid) best_f,min(rule) OVER (PARTITION BY sid) best_s FROM p WHERE rule IS NOT NULL
 ), k AS (
  SELECT *,count(*) OVER (PARTITION BY fid) n_f,count(*) OVER (PARTITION BY sid) n_s FROM q WHERE rule=best_f AND rule=best_s
 )
 SELECT sid,fid,rule,d,(n_f>1 OR n_s>1) FROM k
$$;

-- 6. Aplica os vinculos. p_apply=false so mostra o que faria. Reexecutar e seguro.
CREATE OR REPLACE FUNCTION public.meta_link_site_answers(p_apply boolean DEFAULT false)
RETURNS TABLE(site_id uuid,form_id uuid,rule smallint,delta_seconds numeric,ambiguous boolean,situacao text,crm_lead_id uuid,nome_site text,nome_formulario text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_site public.meta_form_leads; v_form public.meta_form_leads; v_status text; v_basis text;
BEGIN
 IF p_apply IS NULL THEN RAISE EXCEPTION 'Informe true ou false' USING ERRCODE='22023'; END IF;
 IF p_apply THEN PERFORM pg_advisory_xact_lock(hashtextextended('meta-site-form-link',0)); END IF;
 FOR r IN SELECT * FROM public.meta_site_form_pairs() ORDER BY 5 DESC,3,4 LOOP
  SELECT * INTO v_site FROM public.meta_form_leads WHERE id=r.site_id;
  SELECT * INTO v_form FROM public.meta_form_leads WHERE id=r.form_id;
  v_status:=CASE WHEN r.ambiguous THEN 'revisar (ambíguo)' WHEN p_apply THEN 'vinculado' ELSE 'previsto' END;
  IF p_apply AND NOT r.ambiguous THEN
   v_basis:=CASE r.rule WHEN 1 THEN 'mesmo anúncio, nome completo igual' WHEN 2 THEN 'mesmo anúncio, primeiro nome igual' ELSE 'mesmo WhatsApp, primeiro nome igual' END
    ||', '||round(r.delta_seconds)||' s depois do formulário';
   UPDATE public.meta_form_leads SET answers_form_lead_id=r.form_id,answers_link_basis=v_basis,answers_linked_at=clock_timestamp()
    WHERE id=r.site_id AND answers_form_lead_id IS NULL;
   IF v_site.crm_lead_id IS NOT NULL THEN
    v_status:='vinculado; contexto '||public.meta_attach_form_answers(v_site.crm_lead_id,r.form_id,coalesce(v_site.reviewed_by,v_site.imported_by),r.site_id);
   END IF;
  END IF;
  site_id:=r.site_id;form_id:=r.form_id;rule:=r.rule;delta_seconds:=round(r.delta_seconds);ambiguous:=r.ambiguous;
  situacao:=v_status;crm_lead_id:=v_site.crm_lead_id;nome_site:=v_site.full_name;nome_formulario:=v_form.full_name;
  RETURN NEXT;
 END LOOP;
END $$;

-- 7. Leads criados A MAO no CRM que tem formulario com o mesmo WhatsApp e primeiro nome (so aviso: nada e alterado).
CREATE OR REPLACE FUNCTION public.meta_manual_crm_twins()
RETURNS TABLE(crm_lead_id uuid,form_id uuid,nome_crm text,nome_formulario text,form_approval text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT c.id,f.id,c.name,f.full_name,f.approval_status
 FROM public.crm_leads c JOIN public.meta_form_leads f ON f.entry_channel='form' AND public.crm_form_answers_present(to_jsonb(f))
  AND public.meta_phone_tail(c.phone)<>'' AND public.meta_phone_tail(c.phone)=public.meta_phone_tail(f.phone)
  AND split_part(public.meta_match_name(c.name),' ',1)<>'' AND split_part(public.meta_match_name(c.name),' ',1)=split_part(public.meta_match_name(f.full_name),' ',1)
 WHERE c.meta_form_lead_id IS NULL AND f.crm_lead_id IS NULL
$$;

-- 8. Aprovacao: se o par do mesmo atleta ja tem lead no CRM, reaproveita-o (sem duplicar); se vai
-- criar o lead a partir do site e ha formulario ligado, o Contexto ja nasce com as respostas.
-- Corpo identico ao auditado em producao, exceto os trechos marcados como NOVO.
CREATE OR REPLACE FUNCTION public.meta_sync_form_lead_to_crm(p_lead uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE f public.meta_form_leads; contact jsonb; crm uuid; stamp timestamptz:=clock_timestamp();
  v_name text; v_phone text; v_email text; v_athlete text; v_birth date; v_position text; v_context text; v_author text; v_error text;
  v_age smallint; v_height numeric; v_weight numeric; v_report text; v_city text; v_observations text;
  v_peer public.meta_form_leads; v_blocked boolean:=false; v_linked text; -- NOVO
BEGIN
  SELECT * INTO f FROM public.meta_form_leads WHERE id=p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF f.approval_status<>'aprovado' THEN RAISE EXCEPTION 'Lead aguardando aprovação em Tráfego' USING ERRCODE='42501'; END IF;
  IF f.crm_lead_id IS NOT NULL THEN
    UPDATE public.meta_form_leads SET crm_sync_status='enviado',crm_sync_error=NULL,crm_sync_last_at=coalesce(crm_sync_last_at,stamp) WHERE id=f.id AND crm_sync_status IS DISTINCT FROM 'enviado';
    RETURN jsonb_build_object('ok',true,'crm_lead_id',f.crm_lead_id,'already',true);
  END IF;
  SELECT id INTO crm FROM public.crm_leads WHERE meta_form_lead_id=f.id;
  -- NOVO: o par (site <-> formulário) do mesmo atleta já virou lead? Então reaproveita, sem duplicar.
  IF crm IS NULL THEN
    IF f.entry_channel='website' THEN
      SELECT p.* INTO v_peer FROM public.meta_form_leads p WHERE p.id=f.answers_form_lead_id;
    ELSE
      SELECT p.* INTO v_peer FROM public.meta_form_leads p WHERE p.answers_form_lead_id=f.id;
    END IF;
    IF v_peer.id IS NOT NULL AND v_peer.crm_lead_id IS NOT NULL THEN
      BEGIN
        crm:=v_peer.crm_lead_id;
        IF f.entry_channel='form' THEN
          v_linked:=public.meta_attach_form_answers(crm,f.id,coalesce(v_peer.reviewed_by,p_actor),v_peer.id);
          IF v_linked NOT IN('inserido','igual','mesclado') THEN
            RAISE EXCEPTION 'Não foi possível anexar as respostas do formulário ao lead que já existe no CRM (%)',v_linked USING ERRCODE='22023';
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_error:=left(SQLERRM,500); crm:=NULL; v_blocked:=true;
      END;
    END IF;
  END IF;
  IF crm IS NULL AND NOT v_blocked THEN
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
      -- NOVO: registro do site com formulário ligado: o Contexto já nasce com as respostas do formulário.
      IF f.entry_channel='website' AND f.answers_form_lead_id IS NOT NULL THEN
        SELECT p.* INTO v_peer FROM public.meta_form_leads p WHERE p.id=f.answers_form_lead_id;
        v_context:=left(concat_ws(E'\n\n',v_context,public.meta_form_answers_text(v_peer,f)),50000);
      END IF;
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
END $function$;

-- 9. Indicador de contexto: respostas do formulario ligadas a um lead do site (ou manual) tambem contam.
CREATE OR REPLACE FUNCTION public.crm_context_summary(p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(lead_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT c.id FROM public.crm_leads c WHERE CASE WHEN c.import_channel='form' THEN
  public.crm_form_answers_present(c.import_snapshot)
 ELSE
  EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND x.context_type<>'meta_form' AND nullif(btrim(x.content),'') IS NOT NULL)
  OR EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND x.context_type='meta_form' AND nullif(btrim(x.content),'') IS NOT NULL)
  OR public.crm_source_context_present(c.import_snapshot)
  OR EXISTS(SELECT FROM public.site_import_events e WHERE e.meta_form_lead_id=c.meta_form_lead_id
    AND e.status IN('pending_review','context_only','superseded')
    AND public.crm_source_context_present(jsonb_build_object('source_snapshot',jsonb_build_object('site_event',e.event))))
  OR (c.meta_form_lead_id IS NULL AND EXISTS(SELECT FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND nullif(btrim(x.content),'') IS NOT NULL))
 END
 ORDER BY c.id LIMIT least(greatest(coalesce(p_limit,500),1),500) OFFSET greatest(coalesce(p_offset,0),0)
$function$;

-- 10. Permissoes: as funcoes de vinculo nao sao chamaveis por usuarios do app.
REVOKE ALL ON FUNCTION public.meta_match_name(text),public.meta_phone_tail(text),public.meta_site_ad_id(text),
 public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads),
 public.meta_attach_form_answers(uuid,uuid,uuid,uuid),public.meta_site_form_pairs(),
 public.meta_link_site_answers(boolean),public.meta_manual_crm_twins() FROM PUBLIC,anon,authenticated,service_role;
-- meta_sync_form_lead_to_crm e crm_context_summary mantem as permissoes que ja tem (CREATE OR REPLACE as preserva).
NOTIFY pgrst,'reload schema';
COMMIT;
