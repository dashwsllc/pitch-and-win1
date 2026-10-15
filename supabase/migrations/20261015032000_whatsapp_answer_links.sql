-- O nome que a pessoa tem no Facebook/Instagram quase nunca e o nome que ela digita no site ("Silvazs",
-- "jonaslevyr_", "P10", nome de um parente...). Quando o WhatsApp e IDENTICO (8 ultimos digitos), o anuncio e o mesmo
-- e o site chega minutos depois do formulario, e a mesma pessoa: nao ha o que adivinhar pelo nome.
-- Regra 4: mesmo WhatsApp + mesmo anuncio (ou site sem anuncio identificado), site de 2 min antes a 15 min depois do
-- formulario, qualquer nome. Tem a mesma forca da regra 1: se houver mais de um candidato para o mesmo registro,
-- vai para "revisar (ambiguo)". Anuncios diferentes nos dois lados NAO sao ligados por esta regra.
--
-- Leads criados A MAO no CRM (o SDR digitou o contato) tambem tem formulario: o WhatsApp e o mesmo. Quando ha UM unico
-- lead manual e UM unico formulario com o mesmo WhatsApp (8 ultimos digitos), as respostas entram no Contexto desse lead
-- e o vinculo fica guardado em crm_form_answer_links. Na aprovacao o formulario REAPROVEITA esse lead (nao cria outro).
-- Casos com mais de um candidato ficam para revisao. Nada e apagado nem alterado alem de anexar o Contexto
-- (e o aquecimento sugerido, so em lead que ninguem abordou).
-- Depende de 20261015031000_site_form_pairs_name_compat.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF to_regprocedure('public.meta_names_compatible(text,text)') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015031000_site_form_pairs_name_compat' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_sync_form_lead_to_crm(uuid,uuid)'::regprocedure))<>'859776b0667bb818db018d026e04475c' THEN
  RAISE EXCEPTION 'meta_sync_form_lead_to_crm mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
END $guard$;

-- Vinculo persistente lead manual <-> formulario (so o sistema le e grava).
CREATE TABLE IF NOT EXISTS public.crm_form_answer_links(
 crm_lead_id uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
 form_lead_id uuid NOT NULL UNIQUE REFERENCES public.meta_form_leads(id) ON DELETE CASCADE,
 basis text NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.crm_form_answer_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_form_answer_links FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.meta_site_form_pairs() RETURNS TABLE(site_id uuid,form_id uuid,rule smallint,delta_seconds numeric,ambiguous boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH s AS (
  SELECT m.id,m.created_time t,public.meta_site_ad_id(m.source_snapshot#>>'{site_event,payload,attribution,utm_content}') ad,
   public.meta_match_name(m.full_name) nome,m.full_name raw,public.meta_phone_tail(m.phone) k8
  FROM public.meta_form_leads m WHERE m.entry_channel='website' AND m.answers_form_lead_id IS NULL
 ), f AS (
  SELECT m.id,m.created_time t,m.ad_id ad,public.meta_match_name(m.full_name) nome,m.full_name raw,public.meta_phone_tail(m.phone) k8
  FROM public.meta_form_leads m WHERE m.entry_channel='form' AND public.crm_form_answers_present(to_jsonb(m))
   AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads x WHERE x.answers_form_lead_id=m.id)
 ), p0 AS (
  SELECT s.id sid,f.id fid,extract(epoch FROM s.t-f.t) d,
   (CASE
    WHEN s.ad IS NOT NULL AND s.ad=f.ad AND s.nome<>'' AND s.nome=f.nome AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '10 minutes' THEN 1
    WHEN s.ad IS NOT NULL AND s.ad=f.ad AND split_part(s.nome,' ',1)<>'' AND split_part(s.nome,' ',1)=split_part(f.nome,' ',1)
     AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '15 minutes' THEN 2
    WHEN s.k8<>'' AND s.k8=f.k8 AND split_part(s.nome,' ',1)<>'' AND split_part(s.nome,' ',1)=split_part(f.nome,' ',1)
     AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '72 hours' THEN 3 END)::smallint name_rule,
   (s.k8<>'' AND s.k8=f.k8 AND (s.ad IS NULL OR s.ad=f.ad) AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '15 minutes') whatsapp,
   (s.nome=f.nome OR f.raw ~ '[._@~0-9]' OR public.meta_names_compatible(s.raw,f.raw)) compat_name
  FROM s JOIN f ON s.t-f.t BETWEEN interval '-2 minutes' AND interval '72 hours'
 ), p AS (
  SELECT sid,fid,d,coalesce(name_rule,CASE WHEN whatsapp THEN 4 END)::smallint rule,
   CASE WHEN whatsapp THEN 1 ELSE name_rule END prio,(whatsapp OR compat_name) compat
  FROM p0
 ), q AS (
  SELECT *,min(prio) FILTER (WHERE compat) OVER (PARTITION BY fid) best_f,min(prio) FILTER (WHERE compat) OVER (PARTITION BY sid) best_s
  FROM p WHERE rule IS NOT NULL
 ), k AS (
  SELECT *,count(*) FILTER (WHERE compat) OVER (PARTITION BY fid) n_f,count(*) FILTER (WHERE compat) OVER (PARTITION BY sid) n_s
  FROM q WHERE NOT compat OR (prio=best_f AND prio=best_s)
 )
 SELECT sid,fid,rule,d,(NOT compat OR n_f>1 OR n_s>1) FROM k
$$;

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
   v_basis:=CASE r.rule WHEN 1 THEN 'mesmo anúncio, nome completo igual' WHEN 2 THEN 'mesmo anúncio, primeiro nome igual'
     WHEN 4 THEN CASE WHEN public.meta_site_ad_id(v_site.source_snapshot#>>'{site_event,payload,attribution,utm_content}') IS NULL
      THEN 'mesmo WhatsApp (site sem anúncio identificado), nome diferente' ELSE 'mesmo WhatsApp e mesmo anúncio, nome diferente' END
     ELSE 'mesmo WhatsApp, primeiro nome igual' END
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
 IF p_apply THEN PERFORM public.meta_link_manual_answers(true); END IF; -- leads criados a mao (mesmo agendamento)
END $$;

-- Leads criados a mao x formularios com o mesmo WhatsApp. ambiguous = mais de um candidato dos dois lados.
CREATE OR REPLACE FUNCTION public.meta_manual_twin_pairs() RETURNS TABLE(crm_lead_id uuid,form_id uuid,ambiguous boolean,nome_crm text,nome_formulario text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH c AS (
  SELECT l.id,l.name,public.meta_phone_tail(l.phone) k FROM public.crm_leads l
  WHERE l.meta_form_lead_id IS NULL AND coalesce(l.import_channel,'')<>'form' AND public.meta_phone_tail(l.phone)<>''
   AND NOT EXISTS(SELECT 1 FROM public.crm_form_answer_links x WHERE x.crm_lead_id=l.id)
 ), f AS (
  SELECT m.id,m.full_name,public.meta_phone_tail(m.phone) k FROM public.meta_form_leads m
  WHERE m.entry_channel='form' AND m.crm_lead_id IS NULL AND public.crm_form_answers_present(to_jsonb(m)) AND public.meta_phone_tail(m.phone)<>''
   AND NOT EXISTS(SELECT 1 FROM public.crm_form_answer_links x WHERE x.form_lead_id=m.id)
 ), p AS (
  SELECT c.id cid,f.id fid,c.name,f.full_name FROM c JOIN f ON c.k=f.k
 )
 SELECT cid,fid,(count(*) OVER (PARTITION BY cid)>1 OR count(*) OVER (PARTITION BY fid)>1),name,full_name FROM p
$$;

-- Aplica. p_apply=false so mostra. Reexecutar e seguro (o que ja foi vinculado sai da lista).
CREATE OR REPLACE FUNCTION public.meta_link_manual_answers(p_apply boolean DEFAULT false)
RETURNS TABLE(crm_lead_id uuid,form_id uuid,ambiguous boolean,situacao text,nome_crm text,nome_formulario text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_author uuid; v_res text; v_status text;
BEGIN
 IF p_apply IS NULL THEN RAISE EXCEPTION 'Informe true ou false' USING ERRCODE='22023'; END IF;
 IF p_apply THEN PERFORM pg_advisory_xact_lock(hashtextextended('meta-site-form-link',0)); END IF;
 FOR r IN SELECT * FROM public.meta_manual_twin_pairs() t ORDER BY t.ambiguous DESC,t.nome_crm LOOP
  v_status:=CASE WHEN r.ambiguous THEN 'revisar (ambíguo)' WHEN p_apply THEN 'vinculado' ELSE 'previsto' END;
  IF p_apply AND NOT r.ambiguous THEN
   BEGIN
    SELECT coalesce(l.sdr_id,l.created_by) INTO v_author FROM public.crm_leads l WHERE l.id=r.crm_lead_id;
    v_res:=public.meta_attach_form_answers(r.crm_lead_id,r.form_id,v_author);
    IF v_res IN('inserido','igual','mesclado') THEN
     INSERT INTO public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) VALUES(r.crm_lead_id,r.form_id,'mesmo WhatsApp (lead criado manualmente)') ON CONFLICT DO NOTHING;
     v_status:='vinculado; contexto '||v_res;
    ELSE
     v_status:='não vinculado; contexto '||v_res;
    END IF;
   EXCEPTION WHEN OTHERS THEN
    v_status:='falhou: '||left(SQLERRM,200);
   END;
  END IF;
  crm_lead_id:=r.crm_lead_id;form_id:=r.form_id;ambiguous:=r.ambiguous;situacao:=v_status;nome_crm:=r.nome_crm;nome_formulario:=r.nome_formulario;
  RETURN NEXT;
 END LOOP;
END $$;

-- Aprovacao: corpo identico ao auditado, exceto os trechos marcados NOVO.
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
  v_twin uuid; -- NOVO (lead criado a mao)
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
  -- NOVO: o atleta ja e um lead criado a mao no CRM (mesmo WhatsApp do formulario, vinculo em crm_form_answer_links)? Reaproveita, sem duplicar.
  IF crm IS NULL AND NOT v_blocked THEN
    SELECT l.crm_lead_id INTO v_twin FROM public.crm_form_answer_links l
      WHERE l.form_lead_id=CASE WHEN f.entry_channel='form' THEN f.id ELSE f.answers_form_lead_id END;
    crm:=v_twin;
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

REVOKE ALL ON FUNCTION public.meta_site_form_pairs(),public.meta_link_site_answers(boolean),public.meta_manual_twin_pairs(),
 public.meta_link_manual_answers(boolean) FROM PUBLIC,anon,authenticated,service_role;
-- meta_sync_form_lead_to_crm mantem as permissoes que ja tem (CREATE OR REPLACE as preserva).
NOTIFY pgrst,'reload schema';
COMMIT;
