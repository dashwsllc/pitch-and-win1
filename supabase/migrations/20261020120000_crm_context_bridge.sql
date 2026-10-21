-- Ponte de saida dash -> VOXEN: envia o contexto do atleta (formulario Meta ligado ao registro do site) ao painel da Zyron.
-- ADITIVA. Nasce DESLIGADA: crm_context_delivery_control.enabled=false e os dois jobs do pg_cron (entrega e varredura) pausados. Nenhum dado, tela ou
-- permissao existente muda; a ponte VOXEN -> dash continua igual. Falha desta ponte nunca derruba quem salvou o lead.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

DO $guard$
BEGIN
 IF to_regprocedure('public.meta_match_name(text)') IS NULL OR to_regprocedure('public.meta_form_field_rank(text)') IS NULL
  OR to_regclass('public.meta_form_definitions') IS NULL OR to_regprocedure('public.is_executive(uuid)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_form_leads' AND column_name='answers_link_basis')
  OR to_regclass('public.crm_form_answer_links') IS NULL OR to_regclass('public.crm_lead_contexts') IS NULL OR to_regprocedure('public.crm_context_summary(integer,integer)') IS NULL
  OR to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes as migrations de vinculo site x formulario (ate 20261015051000) e habilite pg_cron, pg_net e Vault' USING ERRCODE='55000'; END IF;
END $guard$;

-- 1. Fila, controle e registro de tentativas. So funcoes SECURITY DEFINER tocam nestas tabelas.
CREATE TABLE public.crm_context_delivery_control(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 trigger_error_count bigint NOT NULL DEFAULT 0,last_trigger_error_at timestamptz,last_trigger_error text,
 reconcile_cursor uuid,last_reconcile_at timestamptz,last_reconcile_summary jsonb);
INSERT INTO public.crm_context_delivery_control(singleton) VALUES(true);

-- payload guarda o evento completo, exatamente como sera enviado (event_id, revisao e corpo).
CREATE TABLE public.crm_context_outbox(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_lead_id uuid NOT NULL,source_revision bigint NOT NULL CHECK(source_revision>0),
 payload jsonb NOT NULL,content_hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','delivered','blocked')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_token uuid,lease_until timestamptz,receipt jsonb,delivered_at timestamptz,last_error_code text,
 UNIQUE(source_lead_id,source_revision),
 CHECK((state='processing')=(claim_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state<>'delivered' OR receipt IS NOT NULL));
CREATE INDEX crm_context_outbox_due ON public.crm_context_outbox(next_attempt_at,created_at) WHERE state IN('pending','processing');
CREATE INDEX crm_context_outbox_lead ON public.crm_context_outbox(source_lead_id,source_revision DESC);

CREATE TABLE public.crm_context_delivery_attempts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,event_id uuid NOT NULL REFERENCES public.crm_context_outbox(event_id) ON DELETE CASCADE,
 attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(),outcome text NOT NULL CHECK(outcome IN('delivered','retry','blocked')),code text,receipt jsonb);
CREATE INDEX crm_context_attempts_event ON public.crm_context_delivery_attempts(event_id,id);

ALTER TABLE public.crm_context_delivery_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_context_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_context_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_context_delivery_control,public.crm_context_outbox,public.crm_context_delivery_attempts FROM PUBLIC,anon,authenticated,service_role;

-- 2. Montagem do payload. UNICO lugar que conhece as chaves permitidas (lista fechada).
--    Sai: respostas do formulario, dados do atleta (nome, nascimento, posicao, altura, peso, idade, cidade/estado), nome do responsavel,
--    observacoes e qualificacao qualitativa do lead, notas de atendimento (WhatsApp, manual, transcricao de call). Informacao incompleta
--    vai mesmo assim, so com as chaves que tem valor. Nunca sai: telefone, e-mail, UTM/anuncio/campanha, consentimentos, temperatura e
--    etapas do funil, faixa de renda, valores, pagamentos, vendas, usuarios da equipe, anexos de notas. E-mail e telefone digitados dentro
--    de texto livre viram [contato removido]. Valores vao como o sistema recebeu (opcao de multipla escolha pelo texto da definicao do formulario).
CREATE FUNCTION public.crm_context_scrub(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT btrim(regexp_replace(regexp_replace(p_text,'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[contato removido]','g'),
  '(?<![0-9])(\+?55[ .-]?)?\(?[0-9]{2}\)?[ .-]?9?[ .-]?[0-9]{4}[ .-]?[0-9]{4}(?![0-9])','[contato removido]','g'))
$$;

-- Atletas que a ponte acompanha: todo registro do site (tem o ID da VOXEN) que ja tem formulario ligado ou lead no CRM.
CREATE FUNCTION public.crm_context_candidate_sites() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT w.id FROM public.meta_form_leads w WHERE w.entry_channel='website'
  AND (w.answers_form_lead_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.crm_leads c WHERE c.meta_form_lead_id=w.id))
$$;

-- Registros do site afetados por um lead do CRM (ligado pelo site, pelo formulario ou, se criado a mao, por crm_form_answer_links).
CREATE FUNCTION public.crm_context_sites_of_lead(p_lead uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT w.id FROM public.crm_leads c JOIN public.meta_form_leads w ON w.entry_channel='website' AND (
   w.id=c.meta_form_lead_id OR w.answers_form_lead_id=c.meta_form_lead_id
   OR w.answers_form_lead_id IN(SELECT k.form_lead_id FROM public.crm_form_answer_links k WHERE k.crm_lead_id=c.id))
 WHERE c.id=p_lead
$$;

CREATE FUNCTION public.crm_context_payload(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_site public.meta_form_leads; v_form public.meta_form_leads; v_crm public.crm_leads;
 v_profile jsonb:='{}'::jsonb; v_context jsonb:='{}'::jsonb; v_answers jsonb:='[]'::jsonb; v_structured jsonb; v_guardian jsonb; v_crmblock jsonb; v_notes jsonb:='[]'::jsonb;
 v_body jsonb; v_basis text; v_names text[]; v_filled text; v_norm text; v_is_guardian boolean; v_is_athlete boolean; v_guardian_name text; v_athlete_name text;
BEGIN
 SELECT * INTO v_site FROM public.meta_form_leads WHERE id=p_site;
 IF NOT FOUND OR v_site.entry_channel IS DISTINCT FROM 'website' THEN RETURN NULL; END IF;
 IF v_site.answers_form_lead_id IS NOT NULL THEN SELECT * INTO v_form FROM public.meta_form_leads WHERE id=v_site.answers_form_lead_id; END IF;
 -- O lead do CRM pode estar ligado pelo site, pelo formulario ou (lead criado a mao) por crm_form_answer_links.
 SELECT c.* INTO v_crm FROM public.crm_leads c
 WHERE c.meta_form_lead_id=v_site.id OR (v_form.id IS NOT NULL AND (c.meta_form_lead_id=v_form.id
   OR c.id IN(SELECT k.crm_lead_id FROM public.crm_form_answer_links k WHERE k.form_lead_id=v_form.id)))
 ORDER BY (c.meta_form_lead_id=v_site.id) DESC NULLS LAST,(c.meta_form_lead_id=v_form.id) DESC NULLS LAST,c.created_at,c.id LIMIT 1;
 SELECT coalesce(array_agg(DISTINCT lower(btrim(nm))),'{}'::text[]) INTO v_names
 FROM unnest(ARRAY[v_site.full_name,v_form.full_name,v_crm.name]) nm WHERE char_length(btrim(coalesce(nm,'')))>=4;
 IF v_form.id IS NOT NULL THEN
  -- "state" e nascimento sao campos curtos: so saem no formato esperado (no dado real, "state" chegou com telefone, e-mail e nome).
  WITH fields AS (
   SELECT x.rk,x.n,x.label,x.value AS raw_value,public.crm_context_scrub(x.value) AS value
   FROM (
    SELECT a.n,public.meta_form_field_rank(a.answer->>'name') AS rk,
     coalesce(nullif(btrim(q.q->>'label'),''),upper(left(s.name_text,1))||substr(s.name_text,2)) AS label,v.value
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_form.field_data)='array' THEN v_form.field_data ELSE '[]'::jsonb END) WITH ORDINALITY a(answer,n)
    CROSS JOIN LATERAL (SELECT btrim(regexp_replace(replace(coalesce(a.answer->>'name',''),'_',' '),'\s+',' ','g')) AS name_text) s
    LEFT JOIN LATERAL (
     SELECT z.q FROM public.meta_form_definitions d
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.questions)='array' THEN d.questions ELSE '[]'::jsonb END) z(q)
     WHERE d.form_id=v_form.form_id AND z.q->>'key'=a.answer->>'name' LIMIT 1) q ON true
    CROSS JOIN LATERAL (
     SELECT string_agg(coalesce(
       (SELECT nullif(btrim(o->>'value'),'') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.q->'options')='array' THEN q.q->'options' ELSE '[]'::jsonb END) o WHERE o->>'key'=parts.t LIMIT 1),
       parts.t),', ' ORDER BY parts.ord) AS value
     FROM (SELECT btrim(i.item) AS t,i.ord FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.answer->'values')='array' THEN a.answer->'values' ELSE '[]'::jsonb END) WITH ORDINALITY i(item,ord)) parts
     WHERE parts.t<>'') v
    WHERE s.name_text<>'') x
   WHERE x.value IS NOT NULL AND (x.rk BETWEEN 1 AND 11 OR x.rk IN(92,93))),
  kept AS (
   SELECT rk,n,label,value FROM fields
   WHERE value<>'' AND CASE rk
    WHEN 92 THEN raw_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR raw_value ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
    WHEN 93 THEN raw_value !~ '[0-9@]' AND char_length(raw_value)<=60
     AND NOT EXISTS(SELECT 1 FROM unnest(v_names) nm WHERE position(nm in lower(raw_value))>0)
    ELSE true END)
  SELECT coalesce(jsonb_object_agg(CASE rk WHEN 1 THEN 'filled_by_raw' WHEN 2 THEN 'current_club_raw' WHEN 7 THEN 'position_category_raw'
     WHEN 92 THEN 'birth_date_raw' WHEN 93 THEN 'state_raw' END,value ORDER BY n DESC) FILTER(WHERE rk IN(1,2,7,92,93)),'{}'::jsonb),
   coalesce(jsonb_object_agg(CASE rk WHEN 3 THEN 'trials' WHEN 4 THEN 'opportunities_received' WHEN 5 THEN 'goal' WHEN 6 THEN 'blocker'
     WHEN 8 THEN 'past_clubs' WHEN 9 THEN 'evaluated_clubs' WHEN 10 THEN 'strengths_and_improvements' WHEN 11 THEN 'commitment_score_raw' END,value ORDER BY n DESC) FILTER(WHERE rk IN(3,4,5,6,8,9,10,11)),'{}'::jsonb),
   coalesce(jsonb_agg(jsonb_build_object('question',label,'answer',value) ORDER BY rk,n) FILTER(WHERE rk BETWEEN 1 AND 11),'[]'::jsonb)
  INTO v_profile,v_context,v_answers FROM kept;
 END IF;
 -- Quem preencheu: so as duas opcoes reais definem papel (atleta, ou pai/mae/responsavel); lead de teste e resposta desconhecida nao sao classificados.
 v_filled:=v_profile->>'filled_by_raw';
 v_norm:=public.meta_match_name(v_filled);
 v_is_guardian:=coalesce(v_norm ~ 'respons|(^| )(pai|mae)( |$)',false);
 v_is_athlete:=NOT v_is_guardian AND coalesce(v_norm ~ '(^| )atleta( |$)',false);
 v_athlete_name:=coalesce(nullif(btrim(v_crm.athlete_name),''),CASE WHEN v_is_athlete THEN nullif(btrim(v_form.full_name),'') END);
 v_structured:=jsonb_strip_nulls(jsonb_build_object('athlete_name',left(v_athlete_name,160),'athlete_birth_date',to_char(v_crm.athlete_birth_date,'YYYY-MM-DD'),
   'athlete_position',nullif(btrim(v_crm.athlete_position),''),'athlete_height_cm',v_crm.athlete_height_cm,'athlete_weight_kg',v_crm.athlete_weight_kg,
   'athlete_age',v_crm.athlete_age,'city_state',nullif(btrim(v_crm.city_state),'')));
 -- Responsavel: quem preencheu como pai/mae/responsavel; sem formulario, o contato do lead quando e outra pessoa que o atleta.
 v_guardian_name:=CASE
  WHEN v_is_guardian AND nullif(btrim(v_form.full_name),'') IS NOT NULL THEN left(btrim(v_form.full_name),160)
  WHEN v_form.id IS NULL AND nullif(btrim(v_crm.name),'') IS NOT NULL AND nullif(btrim(v_crm.athlete_name),'') IS NOT NULL
   AND public.meta_match_name(v_crm.name)<>public.meta_match_name(v_crm.athlete_name) THEN left(btrim(v_crm.name),160) END;
 v_guardian:=jsonb_strip_nulls(jsonb_build_object('name',v_guardian_name,'filled_by_raw',CASE WHEN v_guardian_name IS NOT NULL THEN v_filled END));
 IF v_crm.id IS NOT NULL THEN
  v_crmblock:=jsonb_strip_nulls(jsonb_build_object('observations',nullif(public.crm_context_scrub(left(v_crm.observations,6000)),''),
   'qualification',nullif(jsonb_strip_nulls(jsonb_build_object('goal',nullif(public.crm_context_scrub(left(v_crm.qualification_goal,2000)),''),
     'decision_maker',nullif(public.crm_context_scrub(left(v_crm.qualification_decision_maker,2000)),''),'timeline',nullif(public.crm_context_scrub(left(v_crm.qualification_timeline,2000)),''),
     'summary',nullif(public.crm_context_scrub(left(v_crm.qualification_summary,6000)),''))),'{}'::jsonb)));
  -- Notas de atendimento (so o texto; anexos e autores da equipe nao saem). Teto: as 25 notas MAIS RECENTES (enviadas em ordem cronologica)
  -- e 6000 caracteres cada, para caber no limite de 1 MiB e para a nota nova nunca ficar de fora de um lead com muito historico.
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('type',n.context_type,'content',n.content,'created_at',n.at,
    'truncated',CASE WHEN n.truncated THEN true END)) ORDER BY n.created_at,n.id),'[]'::jsonb) INTO v_notes
  FROM (SELECT x.id,x.context_type,x.created_at,to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
    public.crm_context_scrub(left(x.content,6000)) AS content,char_length(x.content)>6000 AS truncated
   FROM public.crm_lead_contexts x
   WHERE x.lead_id=v_crm.id AND x.context_type IN('whatsapp_summary','manual_note','call_transcript') AND nullif(btrim(x.content),'') IS NOT NULL
   ORDER BY x.created_at DESC,x.id DESC LIMIT 25) n;
 END IF;
 -- A regra automatica vai como esta; texto digitado por pessoa (motivo da confirmacao) nunca sai.
 v_basis:=CASE WHEN v_form.id IS NULL THEN 'registro do site, sem formulário ligado'
               WHEN v_site.answers_link_basis ~ '^mesmo (anúncio|WhatsApp)' THEN left(v_site.answers_link_basis,200)
               WHEN v_site.answers_link_basis ~ '^confirmado manualmente' THEN 'confirmado manualmente' ELSE 'vínculo registrado' END;
 v_body:=jsonb_build_object('link',jsonb_build_object('basis',v_basis,'form_lead_id',v_form.id,'crm_lead_id',v_crm.id));
 IF v_profile<>'{}'::jsonb THEN v_body:=v_body||jsonb_build_object('profile',v_profile); END IF;
 IF v_context<>'{}'::jsonb THEN v_body:=v_body||jsonb_build_object('context',v_context); END IF;
 IF v_structured<>'{}'::jsonb THEN v_body:=v_body||jsonb_build_object('structured',v_structured); END IF;
 IF v_guardian<>'{}'::jsonb THEN v_body:=v_body||jsonb_build_object('guardian',v_guardian); END IF;
 IF v_crmblock IS NOT NULL AND v_crmblock<>'{}'::jsonb THEN v_body:=v_body||jsonb_build_object('crm',v_crmblock); END IF;
 IF jsonb_array_length(v_notes)>0 THEN v_body:=v_body||jsonb_build_object('notes',v_notes); END IF;
 IF jsonb_array_length(v_answers)>0 THEN v_body:=v_body||jsonb_build_object('answers',v_answers); END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v_body))<=1 THEN RETURN NULL; END IF;
 RETURN v_body;
END $$;

-- 3. Enfileira uma revisao. Mudancas na janela de 45 s (teto de 5 min) reescrevem a revisao ainda nunca enviada;
--    depois de reservada para envio, qualquer mudanca real vira a revisao seguinte. Conteudo igual nao gera nada.
--    Retorna: skipped | unchanged | coalesced | enqueued | enqueue (so contagem).
CREATE FUNCTION public.crm_context_enqueue(p_site uuid,p_dry boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_site public.meta_form_leads; v_lead uuid; v_body jsonb; v_hash text; v_latest public.crm_context_outbox; v_had boolean;
 v_event uuid:=gen_random_uuid(); v_rev bigint; v_stamp text;
BEGIN
 SELECT * INTO v_site FROM public.meta_form_leads WHERE id=p_site;
 IF NOT FOUND OR v_site.entry_channel IS DISTINCT FROM 'website'
  OR v_site.meta_lead_id !~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN 'skipped'; END IF;
 v_lead:=substr(v_site.meta_lead_id,12)::uuid;
 IF NOT p_dry THEN PERFORM pg_advisory_xact_lock(hashtextextended('crm-context:'||v_lead::text,0)); END IF;
 v_body:=public.crm_context_payload(p_site);
 IF v_body IS NULL THEN RETURN 'skipped'; END IF;
 v_hash:=md5(v_body::text);
 IF p_dry THEN SELECT * INTO v_latest FROM public.crm_context_outbox WHERE source_lead_id=v_lead ORDER BY source_revision DESC LIMIT 1;
 ELSE SELECT * INTO v_latest FROM public.crm_context_outbox WHERE source_lead_id=v_lead ORDER BY source_revision DESC LIMIT 1 FOR UPDATE; END IF;
 v_had:=FOUND;
 IF v_had AND v_latest.content_hash=v_hash THEN RETURN 'unchanged'; END IF;
 IF p_dry THEN RETURN 'enqueue'; END IF;
 v_stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF v_had AND v_latest.state='pending' AND v_latest.attempts=0 THEN
  UPDATE public.crm_context_outbox SET content_hash=v_hash,updated_at=clock_timestamp(),
   next_attempt_at=least(clock_timestamp()+interval '45 seconds',v_latest.created_at+interval '5 minutes'),
   payload=jsonb_build_object('schema_version',1,'kind','athlete_context','event_id',v_latest.event_id,'source_project','mbzwchnxtskysqplqiyy',
    'source_lead_id',v_lead,'source_revision',v_latest.source_revision,'generated_at',v_stamp)||v_body
  WHERE event_id=v_latest.event_id;
  RETURN 'coalesced';
 END IF;
 v_rev:=coalesce(v_latest.source_revision,0)+1;
 INSERT INTO public.crm_context_outbox(event_id,source_lead_id,source_revision,payload,content_hash,next_attempt_at)
 VALUES(v_event,v_lead,v_rev,jsonb_build_object('schema_version',1,'kind','athlete_context','event_id',v_event,'source_project','mbzwchnxtskysqplqiyy',
   'source_lead_id',v_lead,'source_revision',v_rev,'generated_at',v_stamp)||v_body,v_hash,clock_timestamp()+interval '45 seconds');
 RETURN 'enqueued';
END $$;

CREATE FUNCTION public.crm_context_log_error(p_where text,p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.crm_context_delivery_control SET trigger_error_count=trigger_error_count+1,last_trigger_error_at=clock_timestamp(),
  last_trigger_error=left(coalesce(p_where,'')||' '||coalesce(p_state,''),200) WHERE singleton;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE FUNCTION public.crm_context_touch(p_site uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.crm_context_enqueue(p_site,false);
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('touch',SQLSTATE);
END $$;

-- 4. Gatilhos: toda falha vira registro em crm_context_delivery_control; quem salvou o lead nunca recebe erro daqui.
CREATE FUNCTION public.crm_context_on_form_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 IF NEW.entry_channel='website' THEN
  IF NEW.answers_form_lead_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.answers_form_lead_id IS DISTINCT FROM OLD.answers_form_lead_id) THEN
   PERFORM public.crm_context_touch(NEW.id); END IF;
 ELSIF NEW.entry_channel='form' AND (TG_OP='INSERT' OR NEW.field_data IS DISTINCT FROM OLD.field_data) THEN
  FOR r IN SELECT id FROM public.meta_form_leads WHERE answers_form_lead_id=NEW.id LOOP PERFORM public.crm_context_touch(r.id); END LOOP;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('form_lead_trigger',SQLSTATE); RETURN NULL;
END $$;

CREATE FUNCTION public.crm_context_on_crm_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_old uuid;
BEGIN
 IF TG_OP='INSERT' OR
  (NEW.athlete_name,NEW.athlete_birth_date,NEW.athlete_position,NEW.athlete_age,NEW.athlete_height_cm,NEW.athlete_weight_kg,NEW.city_state,NEW.meta_form_lead_id,
   NEW.name,NEW.observations,NEW.qualification_goal,NEW.qualification_decision_maker,NEW.qualification_timeline,NEW.qualification_summary)
  IS DISTINCT FROM (OLD.athlete_name,OLD.athlete_birth_date,OLD.athlete_position,OLD.athlete_age,OLD.athlete_height_cm,OLD.athlete_weight_kg,OLD.city_state,OLD.meta_form_lead_id,
   OLD.name,OLD.observations,OLD.qualification_goal,OLD.qualification_decision_maker,OLD.qualification_timeline,OLD.qualification_summary) THEN
  IF TG_OP='UPDATE' THEN v_old:=OLD.meta_form_lead_id; END IF;
  -- Sites ligados ao lead pelo site, pelo formulario ou (lead criado a mao) por crm_form_answer_links; inclui o vinculo anterior.
  FOR r IN SELECT w.id FROM public.meta_form_leads w WHERE w.entry_channel='website' AND (
    w.id IN(NEW.meta_form_lead_id,v_old) OR w.answers_form_lead_id IN(NEW.meta_form_lead_id,v_old)
    OR w.answers_form_lead_id IN(SELECT k.form_lead_id FROM public.crm_form_answer_links k WHERE k.crm_lead_id=NEW.id))
  LOOP PERFORM public.crm_context_touch(r.id); END LOOP;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('crm_lead_trigger',SQLSTATE); RETURN NULL;
END $$;

-- Lead criado a mao ligado a um formulario (crm_form_answer_links): entra ou sai do contexto do atleta no mesmo instante.
CREATE FUNCTION public.crm_context_on_answer_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_new uuid; v_old uuid;
BEGIN
 IF TG_OP IN('INSERT','UPDATE') THEN v_new:=NEW.form_lead_id; END IF;
 IF TG_OP IN('UPDATE','DELETE') THEN v_old:=OLD.form_lead_id; END IF;
 FOR r IN SELECT id FROM public.meta_form_leads WHERE entry_channel='website' AND answers_form_lead_id IN(v_new,v_old)
 LOOP PERFORM public.crm_context_touch(r.id); END LOOP;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('answer_link_trigger',SQLSTATE); RETURN NULL;
END $$;

CREATE TRIGGER zz_crm_context_form_lead AFTER INSERT OR UPDATE OF answers_form_lead_id,field_data ON public.meta_form_leads
 FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_form_lead();
CREATE TRIGGER zz_crm_context_crm_lead AFTER INSERT OR UPDATE OF athlete_name,athlete_birth_date,athlete_position,athlete_age,athlete_height_cm,athlete_weight_kg,city_state,meta_form_lead_id,
 name,observations,qualification_goal,qualification_decision_maker,qualification_timeline,qualification_summary
 ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_crm_lead();

-- Lead apagado: observacoes, qualificacao e notas saem do contexto do atleta no mesmo instante (a varredura de 5 min e so a rede de seguranca).
CREATE FUNCTION public.crm_context_on_crm_lead_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT w.id FROM public.meta_form_leads w WHERE w.entry_channel='website' AND OLD.meta_form_lead_id IS NOT NULL
   AND (w.id=OLD.meta_form_lead_id OR w.answers_form_lead_id=OLD.meta_form_lead_id)
 LOOP PERFORM public.crm_context_touch(r.id); END LOOP;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('crm_lead_delete_trigger',SQLSTATE); RETURN NULL;
END $$;
CREATE TRIGGER zz_crm_context_crm_lead_delete AFTER DELETE ON public.crm_leads
 FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_crm_lead_delete();

-- Notas de atendimento (WhatsApp, manual, transcricao) entram, mudam ou saem do contexto do atleta no mesmo instante.
CREATE FUNCTION public.crm_context_on_lead_context() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_new uuid; v_old uuid;
BEGIN
 IF TG_OP IN('INSERT','UPDATE') THEN v_new:=NEW.lead_id; END IF;
 IF TG_OP IN('UPDATE','DELETE') THEN v_old:=OLD.lead_id; END IF;
 FOR r IN SELECT DISTINCT s AS id FROM (SELECT public.crm_context_sites_of_lead(v_new) AS s UNION ALL SELECT public.crm_context_sites_of_lead(v_old)) q WHERE s IS NOT NULL
 LOOP PERFORM public.crm_context_touch(r.id); END LOOP;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('lead_context_trigger',SQLSTATE); RETURN NULL;
END $$;
CREATE TRIGGER zz_crm_context_lead_context AFTER INSERT OR UPDATE OF content,context_type,lead_id OR DELETE ON public.crm_lead_contexts
 FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_lead_context();
CREATE TRIGGER zz_crm_context_answer_link AFTER INSERT OR UPDATE OR DELETE ON public.crm_form_answer_links
 FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_answer_link();

-- 5. Fila de entrega (modelo de funnel_outbox_* da VOXEN). p_event_id isola um evento (ensaio).
CREATE FUNCTION public.crm_context_claim(p_limit integer DEFAULT 20,p_lease_seconds integer DEFAULT 60,p_event_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE events jsonb;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 20 OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'Invalid claim bounds' USING ERRCODE='22023'; END IF;
 WITH due AS (SELECT event_id FROM public.crm_context_outbox
  WHERE ((state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp()))
   AND (p_event_id IS NULL OR event_id=p_event_id)
  ORDER BY created_at,event_id LIMIT p_limit FOR UPDATE SKIP LOCKED),
 claimed AS (UPDATE public.crm_context_outbox o SET state='processing',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   attempts=attempts+1,updated_at=clock_timestamp() FROM due WHERE o.event_id=due.event_id RETURNING o.*)
 SELECT coalesce(jsonb_agg(to_jsonb(claimed) ORDER BY created_at,event_id),'[]'::jsonb) INTO events FROM claimed;
 RETURN events;
END $$;

CREATE FUNCTION public.crm_context_ack(p_event uuid,p_claim uuid,p_receipt jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_row public.crm_context_outbox;
BEGIN
 SELECT * INTO v_row FROM public.crm_context_outbox WHERE event_id=p_event FOR UPDATE;
 IF v_row.state IS DISTINCT FROM 'processing' OR v_row.claim_token IS DISTINCT FROM p_claim OR v_row.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'Stale claim' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR p_receipt->>'ok' IS DISTINCT FROM 'true' OR p_receipt->>'event_id' IS DISTINCT FROM v_row.event_id::text
  OR coalesce(p_receipt->>'receipt_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(p_receipt->>'status','') NOT IN('applied','waiting_member','superseded','duplicate','quarantined') THEN
  RAISE EXCEPTION 'Invalid receipt identity' USING ERRCODE='22023'; END IF;
 UPDATE public.crm_context_outbox SET state='delivered',receipt=p_receipt,delivered_at=clock_timestamp(),last_error_code=NULL,claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE event_id=p_event;
 INSERT INTO public.crm_context_delivery_attempts(event_id,outcome,receipt) VALUES(p_event,'delivered',p_receipt);
END $$;

-- p_permanent: erro que repetir nao resolve (400, 403, 409, 413, recibo invalido): bloqueia ate alguem reenfileirar.
CREATE FUNCTION public.crm_context_fail(p_event uuid,p_claim uuid,p_code text,p_retry_at timestamptz,p_permanent boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_code text:=CASE WHEN p_code ~ '^[a-z0-9_]{1,60}$' THEN p_code ELSE 'delivery_failed' END; v_block boolean:=coalesce(p_permanent,false);
BEGIN
 UPDATE public.crm_context_outbox SET state=CASE WHEN v_block THEN 'blocked' ELSE 'pending' END,claim_token=NULL,lease_until=NULL,last_error_code=v_code,
  next_attempt_at=CASE WHEN v_block THEN next_attempt_at
   ELSE greatest(clock_timestamp(),least(coalesce(p_retry_at,clock_timestamp()+interval '1 minute'),clock_timestamp()+interval '6 hours')) END,
  updated_at=clock_timestamp()
 WHERE event_id=p_event AND state='processing' AND claim_token=p_claim AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Stale claim' USING ERRCODE='40001'; END IF;
 INSERT INTO public.crm_context_delivery_attempts(event_id,outcome,code) VALUES(p_event,CASE WHEN v_block THEN 'blocked' ELSE 'retry' END,v_code);
END $$;

CREATE FUNCTION public.crm_context_requeue_blocked(p_event uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 UPDATE public.crm_context_outbox SET state='pending',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE state='blocked' AND (p_event IS NULL OR event_id=p_event);
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;

-- Evento de ensaio (Fase 5): corpo fixo e identificado; so entra na fila para um lead de teste combinado com a VOXEN.
CREATE FUNCTION public.crm_context_enqueue_synthetic(p_source_lead_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_event uuid:=gen_random_uuid(); v_rev bigint; v_body jsonb;
BEGIN
 IF p_source_lead_id IS NULL THEN RAISE EXCEPTION 'Lead de teste necessario' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-context:'||p_source_lead_id::text,0));
 SELECT coalesce(max(source_revision),0)+1 INTO v_rev FROM public.crm_context_outbox WHERE source_lead_id=p_source_lead_id;
 v_body:=jsonb_build_object('link',jsonb_build_object('basis','teste de integração','form_lead_id','00000000-0000-0000-0000-000000000000','crm_lead_id',NULL),
  'profile',jsonb_build_object('filled_by_raw','Teste de integração — não abordar'),'context',jsonb_build_object('goal','Teste de integração — não abordar'),
  'answers',jsonb_build_array(jsonb_build_object('question','Identificação do evento','answer','Teste de integração — não abordar')));
 INSERT INTO public.crm_context_outbox(event_id,source_lead_id,source_revision,payload,content_hash)
 VALUES(v_event,p_source_lead_id,v_rev,jsonb_build_object('schema_version',1,'kind','athlete_context','event_id',v_event,'source_project','mbzwchnxtskysqplqiyy',
  'source_lead_id',p_source_lead_id,'source_revision',v_rev,'generated_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))||v_body,md5(v_body::text));
 RETURN v_event;
END $$;

-- 6. Backfill retomavel (cursor por id). Padrao: so contar, nada entra na fila.
CREATE FUNCTION public.crm_context_backfill(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_dry_run boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_last uuid:=p_after; v_state text; v_dry boolean:=coalesce(p_dry_run,true);
 v_examined integer:=0; v_enqueued integer:=0; v_would integer:=0; v_unchanged integer:=0; v_skipped integer:=0;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid backfill bounds' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT s AS id FROM public.crm_context_candidate_sites() s WHERE (p_after IS NULL OR s>p_after) ORDER BY s LIMIT p_limit LOOP
  v_state:=public.crm_context_enqueue(r.id,v_dry);
  v_examined:=v_examined+1; v_last:=r.id;
  IF v_state='enqueue' THEN v_would:=v_would+1;
  ELSIF v_state IN('enqueued','coalesced') THEN v_enqueued:=v_enqueued+1;
  ELSIF v_state='unchanged' THEN v_unchanged:=v_unchanged+1;
  ELSE v_skipped:=v_skipped+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('dry_run',v_dry,'last_id',v_last,'examined',v_examined,'enqueued',v_enqueued,'would_enqueue',v_would,'unchanged',v_unchanged,'skipped',v_skipped,
  'done',NOT EXISTS(SELECT 1 FROM public.crm_context_candidate_sites() s WHERE v_last IS NULL OR s>v_last));
END $$;

-- 7. Saude da fila para o Executive (e para o sistema). Nunca devolve payload nem dado pessoal.
CREATE FUNCTION public.crm_context_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' AND NOT coalesce(public.is_executive(auth.uid()),false) THEN
  RAISE EXCEPTION 'Acesso do Executive necessário' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('enabled',(SELECT enabled FROM public.crm_context_delivery_control WHERE singleton),
  'pending_count',count(*) FILTER(WHERE state='pending'),'processing_count',count(*) FILTER(WHERE state='processing'),
  'blocked_count',count(*) FILTER(WHERE state='blocked'),'delivered_count',count(*) FILTER(WHERE state='delivered'),
  'oldest_pending_at',min(created_at) FILTER(WHERE state IN('pending','processing','blocked')),'last_delivered_at',max(delivered_at),
  'error_codes',coalesce((SELECT jsonb_object_agg(e.code,e.n) FROM (SELECT last_error_code AS code,count(*) AS n FROM public.crm_context_outbox
    WHERE state<>'delivered' AND last_error_code IS NOT NULL GROUP BY last_error_code) e),'{}'::jsonb),
  'quarantined_receipts',count(*) FILTER(WHERE state='delivered' AND receipt->>'status'='quarantined'),
  'trigger_error_count',(SELECT trigger_error_count FROM public.crm_context_delivery_control WHERE singleton),
  'last_trigger_error_at',(SELECT last_trigger_error_at FROM public.crm_context_delivery_control WHERE singleton),
  'last_trigger_error',(SELECT last_trigger_error FROM public.crm_context_delivery_control WHERE singleton),
  'last_reconcile_at',(SELECT last_reconcile_at FROM public.crm_context_delivery_control WHERE singleton),
  'last_reconcile_summary',(SELECT last_reconcile_summary FROM public.crm_context_delivery_control WHERE singleton),
  'recent_attempts',coalesce((SELECT jsonb_agg(jsonb_build_object('event_id',a.event_id,'at',a.attempted_at,'outcome',a.outcome,'code',a.code) ORDER BY a.id DESC)
    FROM (SELECT * FROM public.crm_context_delivery_attempts ORDER BY id DESC LIMIT 20) a),'[]'::jsonb))
  FROM public.crm_context_outbox);
END $$;

-- 7b. Varredura de alinhamento: rede de seguranca dos gatilhos. Recalcula o payload de cada atleta ligado e enfileira so o que
--     mudou (conteudo igual nao gera nada). Pega o que nenhum gatilho ve (definicao do formulario chegando depois, lead apagado,
--     gatilho que falhou). Cursor por id, lote limitado, sem sobreposicao entre execucoes, erro de um atleta nao para o resto.
CREATE FUNCTION public.crm_context_reconcile(p_limit integer DEFAULT 150) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_cursor uuid; v_last uuid; v_state text; v_examined integer:=0; v_changed integer:=0; v_errors integer:=0; v_done boolean; v_summary jsonb;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid reconcile bounds' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('crm-context-reconcile',0)) THEN RETURN jsonb_build_object('skipped','running'); END IF;
 SELECT reconcile_cursor INTO v_cursor FROM public.crm_context_delivery_control WHERE singleton;
 v_last:=v_cursor;
 FOR r IN SELECT s AS id FROM public.crm_context_candidate_sites() s WHERE (v_cursor IS NULL OR s>v_cursor) ORDER BY s LIMIT p_limit LOOP
  BEGIN
   v_state:=public.crm_context_enqueue(r.id,false);
   IF v_state IN('enqueued','coalesced') THEN v_changed:=v_changed+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   v_errors:=v_errors+1; PERFORM public.crm_context_log_error('reconcile',SQLSTATE);
  END;
  v_examined:=v_examined+1; v_last:=r.id;
 END LOOP;
 v_done:=NOT EXISTS(SELECT 1 FROM public.crm_context_candidate_sites() s WHERE s>v_last);
 v_summary:=jsonb_build_object('examined',v_examined,'changed',v_changed,'errors',v_errors,'cycle_complete',v_done);
 UPDATE public.crm_context_delivery_control SET reconcile_cursor=CASE WHEN v_done THEN NULL ELSE v_last END,last_reconcile_at=clock_timestamp(),last_reconcile_summary=v_summary WHERE singleton;
 RETURN v_summary;
END $$;

-- 7c. Alinhamento: o que o CRM tem de contexto x o que a ponte consegue entregar. So contagens e nomes de pergunta, nunca dado pessoal.
--     "without_voxen_id": lead do CRM com respostas do formulario mas sem registro do site (sem o ID da VOXEN o contrato v1 nao
--     consegue enderecar o atleta). "unmapped_questions": perguntas novas do formulario que a ponte ainda nao conhece e por isso nao envia.
CREATE FUNCTION public.crm_context_alignment() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_state text; v_linked integer:=0; v_in_sync integer:=0; v_to_enqueue integer:=0; v_skipped integer:=0;
 v_marked uuid[]:='{}'::uuid[]; v_page uuid[]; v_off integer:=0; v_scope record; v_unmapped jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' AND NOT coalesce(public.is_executive(auth.uid()),false) THEN
  RAISE EXCEPTION 'Acesso do Executive necessário' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT s AS id FROM public.crm_context_candidate_sites() s LOOP
  v_linked:=v_linked+1; v_state:=public.crm_context_enqueue(r.id,true);
  IF v_state='unchanged' THEN v_in_sync:=v_in_sync+1; ELSIF v_state='enqueue' THEN v_to_enqueue:=v_to_enqueue+1; ELSE v_skipped:=v_skipped+1; END IF;
 END LOOP;
 LOOP
  SELECT array_agg(s.lead_id) INTO v_page FROM public.crm_context_summary(v_off,500) s;
  EXIT WHEN v_page IS NULL;
  v_marked:=v_marked||v_page; v_off:=v_off+500;
  EXIT WHEN array_length(v_page,1)<500;
 END LOOP;
 SELECT count(*) AS total,count(*) FILTER(WHERE has_answers) AS with_answers,
   count(*) FILTER(WHERE has_answers AND voxen_site IS NOT NULL) AS addressable,count(*) FILTER(WHERE has_answers AND voxen_site IS NULL) AS without_voxen_id,
   count(*) FILTER(WHERE NOT has_answers) AS no_answers
 INTO v_scope FROM (
  SELECT x.id,(f.id IS NOT NULL) AS has_answers,
   coalesce(x.site_direct,(SELECT s.id FROM public.meta_form_leads s WHERE s.entry_channel='website' AND s.answers_form_lead_id=x.ans_form LIMIT 1)) AS voxen_site
  FROM (SELECT c.id,CASE WHEN m.entry_channel='website' THEN m.id END AS site_direct,
    coalesce(CASE WHEN m.entry_channel='form' THEN m.id WHEN m.entry_channel='website' THEN m.answers_form_lead_id END,
     (SELECT k.form_lead_id FROM public.crm_form_answer_links k WHERE k.crm_lead_id=c.id ORDER BY k.form_lead_id LIMIT 1)) AS ans_form
   FROM public.crm_leads c LEFT JOIN public.meta_form_leads m ON m.id=c.meta_form_lead_id WHERE c.id=ANY(v_marked)) x
  LEFT JOIN public.meta_form_leads f ON f.id=x.ans_form AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.field_data)='array' THEN f.field_data ELSE '[]'::jsonb END) e
    WHERE public.meta_form_field_rank(e->>'name') BETWEEN 1 AND 11)) y;
 SELECT coalesce(jsonb_agg(u.n ORDER BY u.n),'[]'::jsonb) INTO v_unmapped FROM (
  SELECT DISTINCT left(btrim(e->>'name'),120) AS n FROM public.meta_form_leads f
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.field_data)='array' THEN f.field_data ELSE '[]'::jsonb END) e
  WHERE f.id IN(SELECT w.answers_form_lead_id FROM public.meta_form_leads w WHERE w.entry_channel='website' AND w.answers_form_lead_id IS NOT NULL)
   AND public.meta_form_field_rank(e->>'name')=30 AND coalesce(btrim(e->>'name'),'')<>'' LIMIT 20) u;
 RETURN jsonb_build_object('linked_sites',v_linked,'in_sync',v_in_sync,'to_enqueue',v_to_enqueue,'skipped',v_skipped,
  'crm_leads_with_context',v_scope.total,'with_answers',v_scope.with_answers,'with_answers_addressable',v_scope.addressable,
  'with_answers_without_voxen_id',v_scope.without_voxen_id,'context_without_answers',v_scope.no_answers,'unmapped_questions',v_unmapped);
END $$;

-- 8. Agendamento: pausado. Ativar e um passo manual (set_enabled(true)) depois do ensaio e do segredo no Vault.
CREATE FUNCTION public.crm_context_delivery_invoke() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_secret text; v_request bigint;
BEGIN
 IF NOT EXISTS(SELECT FROM public.crm_context_delivery_control WHERE singleton AND enabled) THEN RETURN NULL; END IF;
 -- Fila vazia ou sem nada vencido: nao chama a Edge Function (poupa a chamada HTTP, o registro do pg_net e IO a cada minuto).
 IF NOT EXISTS(SELECT FROM public.crm_context_outbox WHERE (state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp())) THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='crm_context_delivery_cron_secret' LIMIT 1;
 IF nullif(v_secret,'') IS NULL THEN RETURN NULL; END IF;
 SELECT net.http_post(url:='https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/voxen-context-delivery',
  headers:=jsonb_build_object('content-type','application/json','x-crm-cron-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=50000) INTO v_request;
 RETURN v_request;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION public.crm_context_delivery_set_enabled(p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Activation state required' USING ERRCODE='22023'; END IF;
 UPDATE public.crm_context_delivery_control SET enabled=p_enabled WHERE singleton;
 PERFORM cron.alter_job(jobid,active:=p_enabled) FROM cron.job WHERE jobname='crm-context-delivery';
 -- Desligar e desligar tudo. Ligar a entrega NAO liga a varredura: ela enfileiraria todos os atletas de uma vez e atropelaria o backfill em lotes.
 IF NOT p_enabled THEN PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='crm-context-reconcile'; END IF;
END $$;

-- A varredura e o ultimo passo da ativacao: so depois da entrega ligada e do backfill em lotes conferido.
CREATE FUNCTION public.crm_context_reconcile_set_enabled(p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Activation state required' USING ERRCODE='22023'; END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.crm_context_delivery_control WHERE singleton AND enabled) THEN
  RAISE EXCEPTION 'Ative a entrega antes da varredura' USING ERRCODE='55000'; END IF;
 PERFORM cron.alter_job(jobid,active:=p_enabled) FROM cron.job WHERE jobname='crm-context-reconcile';
END $$;

DO $job$
DECLARE existing bigint;
BEGIN
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname IN('crm-context-delivery','crm-context-reconcile') LOOP PERFORM cron.unschedule(existing); END LOOP;
 PERFORM cron.schedule('crm-context-delivery','* * * * *','SELECT public.crm_context_delivery_invoke()');
 PERFORM cron.schedule('crm-context-reconcile','*/5 * * * *','SELECT public.crm_context_reconcile(150)');
 PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname IN('crm-context-delivery','crm-context-reconcile');
END $job$;

-- 9. Permissoes: funcoes internas sem acesso; entrega so pelo service_role; saude tambem pelo Executive autenticado.
REVOKE ALL ON FUNCTION public.crm_context_scrub(text),public.crm_context_candidate_sites(),public.crm_context_sites_of_lead(uuid),
 public.crm_context_payload(uuid),public.crm_context_enqueue(uuid,boolean),public.crm_context_log_error(text,text),public.crm_context_touch(uuid),
 public.crm_context_on_form_lead(),public.crm_context_on_crm_lead(),public.crm_context_on_crm_lead_delete(),public.crm_context_on_answer_link(),public.crm_context_on_lead_context(),
 public.crm_context_claim(integer,integer,uuid),public.crm_context_ack(uuid,uuid,jsonb),
 public.crm_context_fail(uuid,uuid,text,timestamptz,boolean),public.crm_context_requeue_blocked(uuid),public.crm_context_enqueue_synthetic(uuid),
 public.crm_context_backfill(uuid,integer,boolean),public.crm_context_reconcile(integer),public.crm_context_health(),public.crm_context_alignment(),
 public.crm_context_delivery_invoke(),public.crm_context_delivery_set_enabled(boolean),public.crm_context_reconcile_set_enabled(boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_context_claim(integer,integer,uuid),public.crm_context_ack(uuid,uuid,jsonb),public.crm_context_fail(uuid,uuid,text,timestamptz,boolean),
 public.crm_context_requeue_blocked(uuid),public.crm_context_enqueue_synthetic(uuid),public.crm_context_backfill(uuid,integer,boolean),public.crm_context_reconcile(integer),
 public.crm_context_delivery_invoke(),public.crm_context_delivery_set_enabled(boolean),public.crm_context_reconcile_set_enabled(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_context_health(),public.crm_context_alignment() TO authenticated,service_role;
COMMIT;
