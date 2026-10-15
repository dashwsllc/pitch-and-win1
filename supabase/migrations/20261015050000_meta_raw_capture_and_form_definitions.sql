-- Nada que a Meta envia pode se perder, nem de um formulario novo, de outra campanha, com outras perguntas.
--  1) meta_lead_raw guarda o retorno COMPLETO da Meta para cada lead (todos os campos que a API devolver, inclusive os que ainda
--     nao tem lugar na tela) e meta_form_definitions guarda a definicao de cada formulario (texto exato das perguntas e das opcoes).
--  2) O Contexto passa a usar o texto exato da pergunta/opcao quando a definicao existe, e SEMPRE mostra: as respostas, os
--     consentimentos (custom_disclaimer_responses) e todos os demais dados da Meta (anuncio, conjunto, plataforma, organico...).
--     Pergunta que o sistema nao conhece aparece apos as conhecidas e antes do contato, na ordem da definicao do formulario.
--  3) meta_refresh_form_contexts() atualiza os contextos ja gravados quando chegam esses dados (agendado a cada 10 min).
--  4) meta_wave_leads devolve "meta_extra" (dados da Meta alem das respostas) para a linha em Trafego.
-- Depende de 20261015040000_form_answers_order_and_traffic_link.sql.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $guard$
BEGIN
 IF to_regprocedure('public.meta_form_field_rank(text)') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015040000_form_answers_order_and_traffic_link' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads)'::regprocedure))<>'ba074624074c20a17c9eb0db431ebd2a' THEN
  RAISE EXCEPTION 'meta_form_answers_text mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_wave_leads(uuid)'::regprocedure))<>'b2a65c25c50a80891903c4c2468826d9' THEN
  RAISE EXCEPTION 'meta_wave_leads mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_form_field_rank(text)'::regprocedure))<>'2a06572c5a8b7c5c92cf84f14f95ea0b' THEN
  RAISE EXCEPTION 'meta_form_field_rank mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
END $guard$;

-- 1. Armazenamento sem perda (so o sistema le e grava).
CREATE TABLE IF NOT EXISTS public.meta_lead_raw(
 meta_lead_id text PRIMARY KEY, page_id text NOT NULL, form_id text NOT NULL, raw jsonb NOT NULL, fields_requested text NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS public.meta_form_definitions(
 form_id text PRIMARY KEY, page_id text NOT NULL, name text, questions jsonb NOT NULL DEFAULT '[]'::jsonb, raw jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.meta_lead_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_form_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_lead_raw,public.meta_form_definitions FROM PUBLIC,anon,authenticated,service_role;

-- Grava o retorno bruto de um lead que ja foi recebido. Uma nova busca nunca apaga o que uma anterior trouxe (jsonb || mescla as chaves).
CREATE OR REPLACE FUNCTION public.meta_lead_raw_store(p_meta_lead_id text,p_page_id text,p_form_id text,p_raw jsonb,p_fields text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF jsonb_typeof(p_raw) IS DISTINCT FROM 'object' OR nullif(btrim(coalesce(p_fields,'')),'') IS NULL THEN
  RAISE EXCEPTION 'Retorno da Meta inválido' USING ERRCODE='22023'; END IF;
 IF p_fields<>'unavailable' AND p_raw->>'id' IS DISTINCT FROM p_meta_lead_id THEN RAISE EXCEPTION 'Retorno de outro lead' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.meta_form_leads m WHERE m.meta_lead_id=p_meta_lead_id AND m.page_id=p_page_id AND m.form_id=p_form_id) THEN
  RAISE EXCEPTION 'Lead não recebido' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.meta_lead_raw(meta_lead_id,page_id,form_id,raw,fields_requested)
 VALUES(p_meta_lead_id,p_page_id,p_form_id,p_raw,left(p_fields,1000))
 ON CONFLICT(meta_lead_id) DO UPDATE SET
  raw=CASE WHEN public.meta_lead_raw.fields_requested='unavailable' THEN EXCLUDED.raw ELSE public.meta_lead_raw.raw||EXCLUDED.raw END,
  fields_requested=EXCLUDED.fields_requested,fetched_at=clock_timestamp();
END $$;

-- Leads recebidos da API ainda sem retorno bruto (os mais novos primeiro). "unavailable" (lead que a Meta nao devolveu) e tentado de novo apos 7 dias.
CREATE OR REPLACE FUNCTION public.meta_lead_raw_missing(p_limit integer DEFAULT 20) RETURNS TABLE(meta_lead_id text,page_id text,form_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT m.meta_lead_id,m.page_id,m.form_id FROM public.meta_form_leads m
 WHERE m.entry_channel='form' AND m.lead_import_batch_id IS NULL AND m.meta_lead_id ~ '^[0-9]+$'
  AND NOT EXISTS(SELECT 1 FROM public.meta_lead_raw r WHERE r.meta_lead_id=m.meta_lead_id
   AND (r.fields_requested<>'unavailable' OR r.fetched_at>clock_timestamp()-interval '7 days'))
 ORDER BY m.created_time DESC LIMIT least(greatest(coalesce(p_limit,20),1),100)
$$;

CREATE OR REPLACE FUNCTION public.meta_form_definition_store(p_form_id text,p_page_id text,p_name text,p_raw jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q jsonb;
BEGIN
 IF jsonb_typeof(p_raw) IS DISTINCT FROM 'object' OR p_raw->>'id' IS DISTINCT FROM p_form_id THEN RAISE EXCEPTION 'Definição de outro formulário' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.meta_form_leads m WHERE m.form_id=p_form_id AND m.page_id=p_page_id) THEN RAISE EXCEPTION 'Formulário sem leads recebidos' USING ERRCODE='P0002'; END IF;
 q:=CASE WHEN jsonb_typeof(p_raw->'questions')='array' THEN p_raw->'questions'
         WHEN jsonb_typeof(p_raw#>'{questions,data}')='array' THEN p_raw#>'{questions,data}' ELSE '[]'::jsonb END;
 INSERT INTO public.meta_form_definitions(form_id,page_id,name,questions,raw) VALUES(p_form_id,p_page_id,left(coalesce(p_name,p_raw->>'name'),160),q,p_raw)
 ON CONFLICT(form_id) DO UPDATE SET name=EXCLUDED.name,
  questions=CASE WHEN jsonb_array_length(EXCLUDED.questions)>0 THEN EXCLUDED.questions ELSE public.meta_form_definitions.questions END,
  raw=public.meta_form_definitions.raw||EXCLUDED.raw,fetched_at=clock_timestamp();
END $$;

CREATE OR REPLACE FUNCTION public.meta_form_definition_missing(p_limit integer DEFAULT 5) RETURNS TABLE(form_id text,page_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT x.form_id,x.page_id FROM (SELECT DISTINCT m.form_id,m.page_id FROM public.meta_form_leads m
  WHERE m.entry_channel='form' AND m.lead_import_batch_id IS NULL AND m.meta_lead_id ~ '^[0-9]+$') x
 WHERE NOT EXISTS(SELECT 1 FROM public.meta_form_definitions d WHERE d.form_id=x.form_id AND d.fetched_at>clock_timestamp()-interval '7 days')
 ORDER BY x.form_id LIMIT least(greatest(coalesce(p_limit,5),1),20)
$$;

REVOKE ALL ON FUNCTION public.meta_lead_raw_store(text,text,text,jsonb,text),public.meta_lead_raw_missing(integer),
 public.meta_form_definition_store(text,text,text,jsonb),public.meta_form_definition_missing(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_lead_raw_store(text,text,text,jsonb,text),public.meta_lead_raw_missing(integer),
 public.meta_form_definition_store(text,text,text,jsonb),public.meta_form_definition_missing(integer) TO service_role;

-- 2. Posicao dos campos: as 11 perguntas conhecidas (1-11), as perguntas que o sistema nao conhece (30, na ordem da definicao do formulario) e o contato (90+).
CREATE OR REPLACE FUNCTION public.meta_form_field_rank(p_name text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE
  WHEN t ~ 'preenchendo' THEN 1
  WHEN t ~ 'vinculado' THEN 2
  WHEN t ~ 'avaliacoes|peneiras' THEN 3
  WHEN t ~ 'oportunidade' THEN 4
  WHEN t ~ 'principal objetivo' THEN 5
  WHEN t ~ 'impedindo' THEN 6
  WHEN t ~ 'posicao' THEN 7
  WHEN t ~ 'representou' THEN 8
  WHEN t ~ 'clubes avaliou' THEN 9
  WHEN t ~ 'caracteristicas' THEN 10
  WHEN t ~ 'comprometido' THEN 11
  WHEN t='full name' THEN 90
  WHEN t='phone number' THEN 91
  WHEN t='date of birth' THEN 92
  WHEN t='state' THEN 93
  WHEN t='city' THEN 94
  WHEN t='email' THEN 95
  ELSE 30 END
 FROM (SELECT public.meta_match_name(p_name) AS t) x
$$;

-- 3. A versao atual do texto fica como "plain": serve para reconhecer os contextos ja gravados e atualiza-los.
ALTER FUNCTION public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads) RENAME TO meta_form_answers_text_plain;
CREATE FUNCTION public.meta_form_answers_text(p_form public.meta_form_leads,p_site public.meta_form_leads DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN answers.body IS NULL THEN NULL ELSE left(concat_ws(E'\n',
   'Respostas do formulário Meta'||CASE WHEN nullif(btrim(p_form.form_name),'') IS NOT NULL THEN ' · '||btrim(p_form.form_name) ELSE '' END,
   'Campanha: '||coalesce(nullif(btrim(p_form.campaign_name),''),nullif(btrim(p_form.campaign_id),''),'não informada'),
   'Preenchido em: '||CASE WHEN p_form.import_contact->>'time_known'='false'
     THEN to_char(p_form.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||' (horário não informado)'
     ELSE to_char(p_form.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS')||' (Brasília)' END,
   CASE WHEN p_site.id IS NOT NULL THEN 'Ligado ao envio do site de '||to_char(p_site.created_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS')
     ||' (Brasília) — '||coalesce(p_site.answers_link_basis,'vínculo registrado') END,
   '',answers.body||coalesce(E'\n\n'||extras.body,'')),50000) END
 FROM (
  SELECT string_agg(x.label||E'\n→ '||x.value,E'\n\n' ORDER BY x.rk,x.dx,x.n) AS body
  FROM (
   SELECT a.n,public.meta_form_field_rank(a.answer->>'name') AS rk,coalesce(q.i,100000) AS dx,
    CASE a.answer->>'name' WHEN 'full_name' THEN 'Nome completo' WHEN 'phone_number' THEN 'Telefone' WHEN 'email' THEN 'E-mail'
     WHEN 'date_of_birth' THEN 'Data de nascimento' WHEN 'state' THEN 'Estado' WHEN 'city' THEN 'Cidade'
     ELSE coalesce(nullif(btrim(q.q->>'label'),''),upper(left(s.name_text,1))||substr(s.name_text,2)) END AS label,
    coalesce(nullif(v.value,''),'Não informado na origem') AS value
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_form.field_data)='array' THEN p_form.field_data ELSE '[]'::jsonb END) WITH ORDINALITY a(answer,n)
   CROSS JOIN LATERAL (SELECT btrim(regexp_replace(replace(coalesce(a.answer->>'name',''),'_',' '),'\s+',' ','g')) AS name_text) s
   LEFT JOIN LATERAL (
    SELECT z.q,z.i FROM public.meta_form_definitions d
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.questions)='array' THEN d.questions ELSE '[]'::jsonb END) WITH ORDINALITY z(q,i)
    WHERE d.form_id=p_form.form_id AND z.q->>'key'=a.answer->>'name' LIMIT 1) q ON true
   CROSS JOIN LATERAL (
    SELECT string_agg(coalesce(
      (SELECT nullif(btrim(o->>'value'),'') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.q->'options')='array' THEN q.q->'options' ELSE '[]'::jsonb END) o WHERE o->>'key'=t LIMIT 1),
      CASE WHEN t ~ '^[^[:space:]]+$' AND t=lower(t) AND t LIKE '%\_%' THEN upper(left(replace(t,'_',' '),1))||substr(replace(t,'_',' '),2) ELSE t END),', ') AS value
    FROM (SELECT btrim(item) AS t FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.answer->'values')='array' THEN a.answer->'values' ELSE '[]'::jsonb END) item) parts
    WHERE t<>'') v
   WHERE s.name_text<>''
  ) x
 ) answers
 LEFT JOIN LATERAL (
  SELECT string_agg(e.label||E'\n→ '||e.value,E'\n\n' ORDER BY e.o,e.label) AS body FROM (
   SELECT 1 AS o,'Consentimento: '||coalesce(nullif(btrim(c->>'checkbox_key'),''),'sem identificação') AS label,
    CASE WHEN c->'is_checked' IS NOT NULL THEN CASE WHEN lower(c->>'is_checked') IN ('true','1','t','yes') THEN 'marcado' ELSE 'não marcado' END ELSE left(c::text,500) END AS value
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_form.custom_disclaimer_responses)='array' THEN p_form.custom_disclaimer_responses ELSE '[]'::jsonb END) c
   WHERE jsonb_typeof(c)='object'
   UNION ALL
   SELECT 2,CASE kv.key WHEN 'ad_name' THEN 'Anúncio' WHEN 'adset_name' THEN 'Conjunto de anúncios' WHEN 'ad_id' THEN 'ID do anúncio' WHEN 'adset_id' THEN 'ID do conjunto de anúncios'
     WHEN 'platform' THEN 'Plataforma' WHEN 'is_organic' THEN 'Lead orgânico' WHEN 'partner_name' THEN 'Parceiro'
     ELSE upper(left(replace(kv.key,'_',' '),1))||substr(replace(kv.key,'_',' '),2) END,
    CASE WHEN kv.key='platform' AND lower(kv.value#>>'{}') IN ('fb','facebook') THEN 'Facebook'
     WHEN kv.key='platform' AND lower(kv.value#>>'{}') IN ('ig','instagram') THEN 'Instagram'
     WHEN jsonb_typeof(kv.value)='boolean' THEN CASE WHEN kv.value::text='true' THEN 'sim' ELSE 'não' END
     WHEN jsonb_typeof(kv.value)='string' THEN kv.value#>>'{}' ELSE left(kv.value::text,1000) END
   FROM public.meta_lead_raw r CROSS JOIN LATERAL jsonb_each(r.raw) kv
   WHERE r.meta_lead_id=p_form.meta_lead_id AND r.fields_requested<>'unavailable'
    AND kv.key NOT IN('id','created_time','form_id','field_data','custom_disclaimer_responses','campaign_id','campaign_name','_unavailable')
    AND jsonb_typeof(kv.value)<>'null' AND nullif(btrim(kv.value#>>'{}'),'') IS NOT NULL
  ) e) extras ON true
$$;

-- 4. Atualiza os contextos ja gravados (mesma regra da migration anterior: so mexe no que a versao "plain" teria gerado exatamente).
CREATE OR REPLACE FUNCTION public.meta_refresh_form_contexts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; f public.meta_form_leads; s public.meta_form_leads; d public.crm_lead_contexts; prev_body text; new_body text; n int:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-site-form-link',0));
 FOR r IN
  SELECT x.id AS ctx_id,x.content,l.meta_form_lead_id,k.form_lead_id AS link_form
  FROM public.crm_lead_contexts x JOIN public.crm_leads l ON l.id=x.lead_id
  LEFT JOIN public.crm_form_answer_links k ON k.crm_lead_id=l.id
  WHERE x.context_type='meta_form' ORDER BY x.id
 LOOP
  f:=NULL; s:=NULL;
  IF r.link_form IS NOT NULL THEN
   SELECT * INTO f FROM public.meta_form_leads WHERE id=r.link_form;
  ELSIF r.meta_form_lead_id IS NOT NULL THEN
   SELECT * INTO s FROM public.meta_form_leads WHERE id=r.meta_form_lead_id;
   IF s.entry_channel='website' AND s.answers_form_lead_id IS NOT NULL THEN SELECT * INTO f FROM public.meta_form_leads WHERE id=s.answers_form_lead_id;
   ELSE f:=NULL; s:=NULL; END IF;
  END IF;
  IF f.id IS NULL THEN CONTINUE; END IF;
  new_body:=public.meta_form_answers_text(f,s);
  prev_body:=public.meta_form_answers_text_plain(f,s);
  IF new_body IS NULL OR prev_body IS NULL OR new_body=prev_body OR position(new_body IN r.content)>0 OR position(prev_body IN r.content)=0 THEN CONTINUE; END IF;
  IF char_length(replace(r.content,prev_body,new_body))>50000 THEN CONTINUE; END IF;
  DELETE FROM public.crm_lead_contexts WHERE id=r.ctx_id RETURNING * INTO d;
  INSERT INTO public.crm_lead_contexts
   SELECT (jsonb_populate_record(NULL::public.crm_lead_contexts,to_jsonb(d)||jsonb_build_object('content',replace(r.content,prev_body,new_body)))).*;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

-- 5. Dados da Meta alem das respostas, na linha de Trafego ("meta_extra"). O resto da funcao e identico.
CREATE OR REPLACE FUNCTION public.meta_wave_leads(p_wave uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meta_lead_waves WHERE id=p_wave) THEN RAISE EXCEPTION 'Leva não encontrada' USING ERRCODE='P0002'; END IF;
  SELECT jsonb_build_object('wave',public.meta_wave_summary(p_wave),
    'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'meta_lead_id',l.meta_lead_id,'page_id',l.page_id,'form_id',l.form_id,'form_name',l.form_name,
      'campaign_id',l.campaign_id,'campaign_name',l.campaign_name,'ad_id',l.ad_id,'created_time',l.created_time,'received_at',l.received_at,'first_received_at',l.first_received_at,'entry_channel',l.entry_channel,'updated_at',l.updated_at,
      'full_name',l.full_name,'phone',l.phone,'email',l.email,'field_data',l.field_data,'custom_disclaimer_responses',l.custom_disclaimer_responses,
      'approval_status',l.approval_status,'status',l.status,'review_note',l.review_note,'reviewed_at',l.reviewed_at,'import_warning',l.import_warning,
      'crm_lead_id',l.crm_lead_id,'crm_sync_status',l.crm_sync_status,'crm_sync_error',l.crm_sync_error,'crm_sync_attempts',l.crm_sync_attempts,
      'crm_sync_last_at',l.crm_sync_last_at,'traffic_edited_at',l.traffic_edited_at,
      'source',CASE WHEN l.lead_import_batch_id IS NULL THEN 'api' ELSE 'planilha' END,
      'batch_filename',(SELECT b.filename FROM public.meta_lead_import_batches b WHERE b.id=l.lead_import_batch_id),
      'time_known',CASE WHEN l.import_contact->>'time_known' IN ('true','false') THEN (l.import_contact->>'time_known')::boolean ELSE true END,
      'date_known',CASE WHEN l.import_contact->>'source_has_date' IN ('true','false') THEN (l.import_contact->>'source_has_date')::boolean
        WHEN l.import_contact->>'time_known'='false' THEN false ELSE true END,
      'linked_form',(SELECT jsonb_build_object('id',f.id,'created_time',f.created_time,'form_name',f.form_name,'campaign_name',f.campaign_name,
          'field_data',f.field_data,'basis',l.answers_link_basis) FROM public.meta_form_leads f WHERE f.id=l.answers_form_lead_id),
      'meta_extra',(SELECT r.raw-'id'-'created_time'-'form_id'-'field_data'-'custom_disclaimer_responses'-'campaign_id'-'campaign_name'-'_unavailable'
          FROM public.meta_lead_raw r WHERE r.meta_lead_id=l.meta_lead_id AND r.fields_requested<>'unavailable')) ORDER BY l.first_received_at DESC,l.created_time DESC,l.id)
      FROM public.meta_form_leads l WHERE l.wave_id=p_wave),'[]'))
  INTO result;
  RETURN result;
END $$;

-- 6. Atualizacao automatica dos contextos quando chegam o retorno bruto e as definicoes.
DO $job$
DECLARE existing bigint;
BEGIN
 IF to_regnamespace('cron') IS NULL THEN RAISE EXCEPTION 'pg_cron nao esta instalado' USING ERRCODE='55000'; END IF;
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname='meta-form-context-refresh' LOOP PERFORM cron.unschedule(existing); END LOOP;
 PERFORM cron.schedule('meta-form-context-refresh','*/10 * * * *','SELECT public.meta_refresh_form_contexts()');
END $job$;

-- Estado inicial: aplica ja o que existe (consentimentos gravados, por exemplo).
CREATE TEMP TABLE _form_refresh_report(atualizados integer) ON COMMIT DROP;
INSERT INTO _form_refresh_report SELECT public.meta_refresh_form_contexts();

REVOKE ALL ON FUNCTION public.meta_form_field_rank(text),public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads),
 public.meta_form_answers_text_plain(public.meta_form_leads,public.meta_form_leads),public.meta_refresh_form_contexts() FROM PUBLIC,anon,authenticated,service_role;
-- meta_wave_leads mantem as permissoes que ja tem (CREATE OR REPLACE as preserva).
NOTIFY pgrst,'reload schema';
COMMIT;
