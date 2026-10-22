-- Leads do CRM que ainda nao se cadastraram na VOXEN: envio por ESCOLHA do time (decisao do dono em 22/10/2026).
-- Botao "Enviar para a VOXEN" no lead e secao "VOXEN" no CRM (selecionar varios e enviar), sem janela de confirmacao. Quem foi enviado fica em sincronia:
-- cada mudanca no lead (dados do atleta, observacoes, qualificacao, notas, respostas do formulario) vira uma versao nova na fila, em ~1 a 2 minutos.
-- Quem nao foi escolhido nao sai. Quando o lead se cadastra na VOXEN, o fluxo normal (athlete_context, pelo ID da VOXEN) assume sozinho.
-- ADITIVA. Eventos novos usam kind='prospect_context'. source_lead_id = ID do lead no CRM (nao e ID da VOXEN); link.crm_lead_id leva o mesmo valor, que e a chave
-- para a VOXEN juntar este registro ao evento normal do mesmo atleta quando ele se cadastrar. O envio so e liberado depois de UM evento de ensaio do mesmo tipo
-- receber recibo applied ou waiting_member: a entrega nao confere o tipo e a fila aceita quarantined como entregue, entao um receptor que ignorasse o tipo
-- engoliria os leads em silencio.
-- Tambem nesta migration (decisoes do dono em 22/10): (1) campanha e IDs da Meta nunca saem, nem dentro da observacao gerada pelo CRM, nos DOIS fluxos;
-- (2) pergunta nova de formulario vai sozinha, como resposta, sem filtro de assunto (contato continua fora e o texto continua passando pela limpeza de contato).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

DO $guard$
BEGIN
 IF to_regclass('public.crm_context_outbox') IS NULL OR to_regprocedure('public.crm_context_payload(uuid)') IS NULL OR to_regprocedure('public.crm_context_sites_of_lead(uuid)') IS NULL
  OR to_regprocedure('public.crm_context_summary(integer,integer)') IS NULL OR to_regprocedure('public.crm_has_access()') IS NULL OR to_regclass('public.crm_leads') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261020120000 (ponte de contexto) e as do CRM' USING ERRCODE='55000'; END IF;
END $guard$;

-- Leads sem cadastro na VOXEN que alguem do time escolheu enviar. So funcoes SECURITY DEFINER tocam nesta tabela.
ALTER TABLE public.crm_context_delivery_control ADD COLUMN IF NOT EXISTS prospects_cursor uuid;
CREATE TABLE IF NOT EXISTS public.crm_voxen_prospects(
 lead_id uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(),enabled_by uuid,
 stopped_at timestamptz,stopped_by uuid);
ALTER TABLE public.crm_voxen_prospects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_voxen_prospects FROM PUBLIC,anon,authenticated,service_role;

-- 0. Observacoes geradas pelo sistema (nao digitadas por pessoa). Ao criar o lead a partir do formulario da Meta, o CRM grava 3 linhas:
--    "Formulário Meta <id do formulario> · campanha <NOME DA CAMPANHA>", "Meta lead ID: <id>" e "Respostas do formulário no painel Contexto deste lead.".
--    Campanha e identificadores da Meta nunca saem (contrato A.4): para o preenchimento so segue o texto que uma pessoa escreveu. Nulo se nao sobrar nada.
CREATE OR REPLACE FUNCTION public.crm_context_strip_auto_observations(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT nullif(btrim(regexp_replace(regexp_replace(p_text,
   '^[ \t]*(Formul.rio Meta .*|Meta lead ID:.*|Respostas do formul.rio no painel Contexto deste lead\.?)[ \t\r]*$','','gn'),
   '(\r?\n){3,}',E'\n\n','g'),E' \t\r\n'),'')
$$;

-- 0b. Campo de contato do formulario (nome, e-mail, telefone/WhatsApp): nunca sai como "pergunta nova" (contrato A.4). Nome vem so da regra do responsavel/atleta.
--     Qualquer outro assunto de pergunta nova vai (decisao do dono em 22/10: sem filtro de assunto).
CREATE OR REPLACE FUNCTION public.crm_context_is_contact_field(p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(public.meta_match_name(p_name) ~ '^(first name|last name|full name|name|nome|nome completo|sobrenome)$'
  OR public.meta_match_name(p_name) ~ '(^| )(email|e mail|phone|telefone|celular|whatsapp|zap|fone)( |$)',false)
$$;

-- 1. Montador do corpo do evento, agora recebendo os IDs (site pode ser nulo). Diferencas para o texto de antes: (a) pergunta que o sistema nao conhece (rank 30)
--    vai em "answers" como as demais, sem filtro de assunto (so contato fica fora); (b) p_strip_auto=true tira a observacao gerada pelo sistema (campanha e IDs da Meta).
CREATE OR REPLACE FUNCTION public.crm_context_build(p_site uuid,p_form uuid,p_crm uuid,p_basis text DEFAULT NULL,p_strip_auto boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_site public.meta_form_leads; v_form public.meta_form_leads; v_crm public.crm_leads;
 v_profile jsonb:='{}'::jsonb; v_context jsonb:='{}'::jsonb; v_answers jsonb:='[]'::jsonb; v_structured jsonb; v_guardian jsonb; v_crmblock jsonb; v_notes jsonb:='[]'::jsonb;
 v_body jsonb; v_basis text; v_names text[]; v_filled text; v_norm text; v_is_guardian boolean; v_is_athlete boolean; v_guardian_name text; v_athlete_name text;
BEGIN
 IF p_site IS NOT NULL THEN SELECT * INTO v_site FROM public.meta_form_leads WHERE id=p_site; END IF;
 IF p_form IS NOT NULL THEN SELECT * INTO v_form FROM public.meta_form_leads WHERE id=p_form; END IF;
 IF p_crm IS NOT NULL THEN SELECT * INTO v_crm FROM public.crm_leads WHERE id=p_crm; END IF;
 SELECT coalesce(array_agg(DISTINCT lower(btrim(nm))),'{}'::text[]) INTO v_names
 FROM unnest(ARRAY[v_site.full_name,v_form.full_name,v_crm.name]) nm WHERE char_length(btrim(coalesce(nm,'')))>=4;
 IF v_form.id IS NOT NULL THEN
  -- "state" e nascimento sao campos curtos: so saem no formato esperado (no dado real, "state" chegou com telefone, e-mail e nome).
  WITH fields AS (
   SELECT x.rk,x.n,x.label,x.value AS raw_value,CASE WHEN x.rk=30 THEN left(public.crm_context_scrub(x.value),4000) ELSE public.crm_context_scrub(x.value) END AS value
   FROM (
    SELECT a.n,a.answer->>'name' AS qkey,public.meta_form_field_rank(a.answer->>'name') AS rk,
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
   WHERE x.value IS NOT NULL AND (x.rk BETWEEN 1 AND 11 OR x.rk IN(92,93) OR (x.rk=30 AND NOT public.crm_context_is_contact_field(x.qkey)))),
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
   coalesce(jsonb_agg(jsonb_build_object('question',CASE WHEN rk=30 THEN left(label,500) ELSE label END,'answer',value) ORDER BY rk,n) FILTER(WHERE rk BETWEEN 1 AND 11 OR rk=30),'[]'::jsonb)
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
  v_crmblock:=jsonb_strip_nulls(jsonb_build_object('observations',nullif(public.crm_context_scrub(left(
     CASE WHEN p_strip_auto THEN public.crm_context_strip_auto_observations(v_crm.observations) ELSE v_crm.observations END,6000)),''),
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
 v_basis:=coalesce(p_basis,CASE WHEN v_form.id IS NULL THEN 'registro do site, sem formulário ligado'
               WHEN v_site.answers_link_basis ~ '^mesmo (anúncio|WhatsApp)' THEN left(v_site.answers_link_basis,200)
               WHEN v_site.answers_link_basis ~ '^confirmado manualmente' THEN 'confirmado manualmente' ELSE 'vínculo registrado' END);
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

-- 2. Fluxo normal (atleta com cadastro na VOXEN): mesma resolucao de antes, agora delegando ao montador. Limpa a observacao gerada pelo sistema (campanha e IDs da Meta).
CREATE OR REPLACE FUNCTION public.crm_context_payload(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_site public.meta_form_leads; v_form public.meta_form_leads; v_crm_id uuid;
BEGIN
 SELECT * INTO v_site FROM public.meta_form_leads WHERE id=p_site;
 IF NOT FOUND OR v_site.entry_channel IS DISTINCT FROM 'website' THEN RETURN NULL; END IF;
 IF v_site.answers_form_lead_id IS NOT NULL THEN SELECT * INTO v_form FROM public.meta_form_leads WHERE id=v_site.answers_form_lead_id; END IF;
 -- O lead do CRM pode estar ligado pelo site, pelo formulario ou (lead criado a mao) por crm_form_answer_links.
 SELECT c.id INTO v_crm_id FROM public.crm_leads c
 WHERE c.meta_form_lead_id=v_site.id OR (v_form.id IS NOT NULL AND (c.meta_form_lead_id=v_form.id
   OR c.id IN(SELECT k.crm_lead_id FROM public.crm_form_answer_links k WHERE k.form_lead_id=v_form.id)))
 ORDER BY (c.meta_form_lead_id=v_site.id) DESC NULLS LAST,(c.meta_form_lead_id=v_form.id) DESC NULLS LAST,c.created_at,c.id LIMIT 1;
 RETURN public.crm_context_build(v_site.id,v_form.id,v_crm_id,NULL,true);
END $$;

-- 3. O lead do CRM ja tem cadastro na VOXEN (registro do site com ID valido da VOXEN, por qualquer caminho de vinculo)?
CREATE OR REPLACE FUNCTION public.crm_context_lead_has_voxen(p_lead uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.crm_context_sites_of_lead(p_lead) s JOIN public.meta_form_leads w ON w.id=s
  WHERE w.entry_channel='website' AND w.meta_lead_id ~ '^site:zyron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
$$;

-- 4. Corpo do evento de um lead SEM cadastro na VOXEN. Nulo se ja tem cadastro (segue o fluxo normal) ou se nao ha nada a enviar.
CREATE OR REPLACE FUNCTION public.crm_context_payload_prospect(p_crm uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_crm public.crm_leads; v_form uuid;
BEGIN
 SELECT * INTO v_crm FROM public.crm_leads WHERE id=p_crm;
 IF NOT FOUND OR public.crm_context_lead_has_voxen(p_crm) THEN RETURN NULL; END IF;
 v_form:=coalesce(
  (SELECT m.id FROM public.meta_form_leads m WHERE m.id=v_crm.meta_form_lead_id AND m.entry_channel='form'),
  (SELECT m.answers_form_lead_id FROM public.meta_form_leads m WHERE m.id=v_crm.meta_form_lead_id AND m.entry_channel='website'),
  (SELECT k.form_lead_id FROM public.crm_form_answer_links k WHERE k.crm_lead_id=p_crm ORDER BY k.form_lead_id LIMIT 1));
 RETURN public.crm_context_build(NULL,v_form,p_crm,'lead do CRM sem cadastro na VOXEN',true);
END $$;

-- 5. Leads do CRM com contexto (icone aceso) e sem cadastro na VOXEN.
CREATE OR REPLACE FUNCTION public.crm_context_prospect_candidates() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_off integer:=0; v_page uuid[];
BEGIN
 LOOP
  SELECT array_agg(s.lead_id ORDER BY s.lead_id) INTO v_page FROM public.crm_context_summary(v_off,500) s;
  EXIT WHEN v_page IS NULL;
  RETURN QUERY SELECT x FROM unnest(v_page) x WHERE NOT public.crm_context_lead_has_voxen(x);
  EXIT WHEN array_length(v_page,1)<500;
  v_off:=v_off+500;
 END LOOP;
END $$;

-- 6. Enfileira uma versao do lead escolhido. Mesmas regras do fluxo normal: conteudo igual nao gera nada; mudancas na janela de 45 s (teto de 5 min) reescrevem a versao
--    ainda nao reservada para envio; depois de reservada, qualquer mudanca real vira a versao seguinte. A PRIMEIRA versao (o clique em "Enviar para a VOXEN") sai na hora.
--    Retorna: skipped | unchanged | coalesced | enqueued | enqueue (so contagem). "skipped": lead nao escolhido, ja cadastrado na VOXEN ou sem nada a enviar.
CREATE OR REPLACE FUNCTION public.crm_context_enqueue_prospect(p_crm uuid,p_dry boolean DEFAULT false,p_immediate boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_body jsonb; v_hash text; v_latest public.crm_context_outbox; v_had boolean; v_event uuid:=gen_random_uuid(); v_rev bigint; v_stamp text;
BEGIN
 IF p_crm IS NULL THEN RETURN 'skipped'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_voxen_prospects WHERE lead_id=p_crm AND enabled) THEN RETURN 'skipped'; END IF;
 IF NOT p_dry THEN PERFORM pg_advisory_xact_lock(hashtextextended('crm-context:'||p_crm::text,0)); END IF;
 v_body:=public.crm_context_payload_prospect(p_crm);
 IF v_body IS NULL THEN RETURN 'skipped'; END IF;
 v_hash:=md5(v_body::text);
 IF p_dry THEN SELECT * INTO v_latest FROM public.crm_context_outbox WHERE source_lead_id=p_crm ORDER BY source_revision DESC LIMIT 1;
 ELSE SELECT * INTO v_latest FROM public.crm_context_outbox WHERE source_lead_id=p_crm ORDER BY source_revision DESC LIMIT 1 FOR UPDATE; END IF;
 v_had:=FOUND;
 IF v_had AND v_latest.content_hash=v_hash THEN RETURN 'unchanged'; END IF;
 IF p_dry THEN RETURN 'enqueue'; END IF;
 v_stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF v_had AND v_latest.state='pending' AND v_latest.attempts=0 THEN
  UPDATE public.crm_context_outbox SET content_hash=v_hash,updated_at=clock_timestamp(),
   next_attempt_at=CASE WHEN p_immediate THEN clock_timestamp() ELSE least(clock_timestamp()+interval '45 seconds',v_latest.created_at+interval '5 minutes') END,
   payload=jsonb_build_object('schema_version',1,'kind','prospect_context','event_id',v_latest.event_id,'source_project','mbzwchnxtskysqplqiyy',
    'source_lead_id',p_crm,'source_revision',v_latest.source_revision,'generated_at',v_stamp)||v_body
  WHERE event_id=v_latest.event_id;
  RETURN 'coalesced';
 END IF;
 v_rev:=coalesce(v_latest.source_revision,0)+1;
 INSERT INTO public.crm_context_outbox(event_id,source_lead_id,source_revision,payload,content_hash,next_attempt_at)
 VALUES(v_event,p_crm,v_rev,jsonb_build_object('schema_version',1,'kind','prospect_context','event_id',v_event,'source_project','mbzwchnxtskysqplqiyy',
   'source_lead_id',p_crm,'source_revision',v_rev,'generated_at',v_stamp)||v_body,v_hash,
   CASE WHEN p_immediate OR NOT v_had THEN clock_timestamp() ELSE clock_timestamp()+interval '45 seconds' END);
 RETURN 'enqueued';
END $$;

-- 6b. Gatilhos: mudou algo que entra no corpo do lead escolhido -> nova versao na fila. So quem foi escolhido entra. Toda falha vira registro em
--     crm_context_delivery_control; quem salvou o lead nunca recebe erro daqui.
CREATE OR REPLACE FUNCTION public.crm_context_touch_prospect(p_crm uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_crm IS NOT NULL AND EXISTS(SELECT 1 FROM public.crm_voxen_prospects WHERE lead_id=p_crm AND enabled) THEN
  PERFORM public.crm_context_enqueue_prospect(p_crm,false,false);
 END IF;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('touch_prospect',SQLSTATE);
END $$;

CREATE OR REPLACE FUNCTION public.crm_context_on_prospect_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.crm_context_touch_prospect(NEW.id);
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('prospect_lead_trigger',SQLSTATE); RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.crm_context_on_prospect_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP IN('INSERT','UPDATE') THEN PERFORM public.crm_context_touch_prospect(NEW.lead_id); END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.lead_id IS DISTINCT FROM NEW.lead_id) THEN PERFORM public.crm_context_touch_prospect(OLD.lead_id); END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('prospect_note_trigger',SQLSTATE); RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.crm_context_on_prospect_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP IN('INSERT','UPDATE') THEN PERFORM public.crm_context_touch_prospect(NEW.crm_lead_id); END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.crm_lead_id IS DISTINCT FROM NEW.crm_lead_id) THEN PERFORM public.crm_context_touch_prospect(OLD.crm_lead_id); END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('prospect_link_trigger',SQLSTATE); RETURN NULL;
END $$;

-- Respostas do formulario editadas: todo lead escolhido que usa este formulario (pelo lead, pelo registro do site ou pelo vinculo manual) recebe versao nova.
CREATE OR REPLACE FUNCTION public.crm_context_on_prospect_form() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 IF NEW.field_data IS DISTINCT FROM OLD.field_data THEN
  FOR r IN SELECT p.lead_id FROM public.crm_voxen_prospects p JOIN public.crm_leads c ON c.id=p.lead_id
   WHERE p.enabled AND (c.meta_form_lead_id=NEW.id
    OR c.meta_form_lead_id IN(SELECT w.id FROM public.meta_form_leads w WHERE w.entry_channel='website' AND w.answers_form_lead_id=NEW.id)
    OR EXISTS(SELECT 1 FROM public.crm_form_answer_links k WHERE k.crm_lead_id=c.id AND k.form_lead_id=NEW.id))
  LOOP PERFORM public.crm_context_touch_prospect(r.lead_id); END LOOP;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.crm_context_log_error('prospect_form_trigger',SQLSTATE); RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER zz_crm_context_prospect_lead AFTER UPDATE OF athlete_name,athlete_birth_date,athlete_position,athlete_age,athlete_height_cm,athlete_weight_kg,city_state,meta_form_lead_id,
 name,observations,qualification_goal,qualification_decision_maker,qualification_timeline,qualification_summary
 ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_prospect_lead();
CREATE OR REPLACE TRIGGER zz_crm_context_prospect_note AFTER INSERT OR UPDATE OF content,context_type,lead_id OR DELETE ON public.crm_lead_contexts
 FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_prospect_note();
CREATE OR REPLACE TRIGGER zz_crm_context_prospect_link AFTER INSERT OR UPDATE OR DELETE ON public.crm_form_answer_links
 FOR EACH ROW EXECUTE FUNCTION public.crm_context_on_prospect_link();
CREATE OR REPLACE TRIGGER zz_crm_context_prospect_form AFTER UPDATE OF field_data ON public.meta_form_leads
 FOR EACH ROW WHEN (NEW.entry_channel='form') EXECUTE FUNCTION public.crm_context_on_prospect_form();

-- 6c. Varredura de seguranca (a mesma do fluxo normal, a cada 15 min): recalcula os leads escolhidos e enfileira so o que mudou. Pega o que nenhum gatilho ve
--     (definicao do formulario chegando depois, gatilho que falhou). O trecho dos registros do site e identico ao anterior; o dos leads escolhidos tem cursor proprio.
CREATE OR REPLACE FUNCTION public.crm_context_reconcile(p_limit integer DEFAULT 150) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_cursor uuid; v_last uuid; v_state text; v_examined integer:=0; v_changed integer:=0; v_errors integer:=0; v_done boolean; v_summary jsonb;
 v_pcursor uuid; v_plast uuid; v_pexamined integer:=0; v_pchanged integer:=0; v_pdone boolean;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid reconcile bounds' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('crm-context-reconcile',0)) THEN RETURN jsonb_build_object('skipped','running'); END IF;
 SELECT reconcile_cursor,prospects_cursor INTO v_cursor,v_pcursor FROM public.crm_context_delivery_control WHERE singleton;
 v_last:=v_cursor; v_plast:=v_pcursor;
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
 FOR r IN SELECT lead_id AS id FROM public.crm_voxen_prospects WHERE enabled AND (v_pcursor IS NULL OR lead_id>v_pcursor) ORDER BY lead_id LIMIT p_limit LOOP
  BEGIN
   v_state:=public.crm_context_enqueue_prospect(r.id,false,false);
   IF v_state IN('enqueued','coalesced') THEN v_pchanged:=v_pchanged+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   v_errors:=v_errors+1; PERFORM public.crm_context_log_error('reconcile_prospect',SQLSTATE);
  END;
  v_pexamined:=v_pexamined+1; v_plast:=r.id;
 END LOOP;
 v_pdone:=NOT EXISTS(SELECT 1 FROM public.crm_voxen_prospects WHERE enabled AND lead_id>v_plast);
 v_summary:=jsonb_build_object('examined',v_examined,'changed',v_changed,'errors',v_errors,'cycle_complete',v_done AND v_pdone,
  'prospects_examined',v_pexamined,'prospects_changed',v_pchanged);
 UPDATE public.crm_context_delivery_control SET reconcile_cursor=CASE WHEN v_done THEN NULL ELSE v_last END,prospects_cursor=CASE WHEN v_pdone THEN NULL ELSE v_plast END,
  last_reconcile_at=clock_timestamp(),last_reconcile_summary=v_summary WHERE singleton;
 RETURN v_summary;
END $$;

-- 7. Ensaio: UM evento do mesmo tipo (prospect_context), corpo fixo e identificado, de um lead que nao existe no CRM. O envio dos leads so e liberado
--    depois que a VOXEN devolver recibo applied ou waiting_member para ele (quarantined nao vale: significaria que ela nao guardou o que recebeu).
CREATE OR REPLACE FUNCTION public.crm_context_rehearsal_accepted() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.crm_context_outbox o WHERE o.payload->>'kind'='prospect_context' AND o.payload->'link'->>'basis'='teste de integração'
  AND o.state='delivered' AND o.receipt->>'status' IN('applied','waiting_member'))
$$;

CREATE OR REPLACE FUNCTION public.crm_context_enqueue_synthetic_prospect() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_event uuid:=gen_random_uuid(); v_lead uuid:=gen_random_uuid(); v_body jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-context-prospect-rehearsal',0));
 -- Um de cada vez: se o anterior ainda espera entrega (ou ficou bloqueado), reenfileire aquele em vez de criar outro.
 IF EXISTS(SELECT 1 FROM public.crm_context_outbox WHERE payload->>'kind'='prospect_context' AND payload->'link'->>'basis'='teste de integração' AND state<>'delivered') THEN
  RAISE EXCEPTION 'Ja ha um evento de ensaio aguardando entrega' USING ERRCODE='55000'; END IF;
 v_body:=jsonb_build_object('link',jsonb_build_object('basis','teste de integração','form_lead_id',NULL,'crm_lead_id',v_lead),
  'profile',jsonb_build_object('filled_by_raw','Teste de integração — não abordar'),'context',jsonb_build_object('goal','Teste de integração — não abordar'),
  'answers',jsonb_build_array(jsonb_build_object('question','Identificação do evento','answer','Teste de integração — não abordar')));
 INSERT INTO public.crm_context_outbox(event_id,source_lead_id,source_revision,payload,content_hash)
 VALUES(v_event,v_lead,1,jsonb_build_object('schema_version',1,'kind','prospect_context','event_id',v_event,'source_project','mbzwchnxtskysqplqiyy',
   'source_lead_id',v_lead,'source_revision',1,'generated_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))||v_body,md5(v_body::text));
 RETURN v_event;
END $$;

-- 8. Acoes do time, chamadas pelo app com a sessao de quem esta logado (mesma regra de acesso do CRM). Sem confirmacao: o clique envia.
--    Ate 25 leads por chamada (o app envia em blocos), para a chamada caber no limite de tempo da sessao.
--    Resultado por lead: sent | nothing_to_send (escolhido, mas ainda sem nada a enviar: segue sozinho quando houver) | registered (ja cadastrado na VOXEN) | not_found.
CREATE OR REPLACE FUNCTION public.crm_voxen_send(p_leads uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_res text; v_out jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso ao CRM necessário' USING ERRCODE='42501'; END IF;
 IF p_leads IS NULL OR coalesce(array_length(p_leads,1),0) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Envie de 1 a 25 leads por vez' USING ERRCODE='22023'; END IF;
 IF NOT public.crm_context_rehearsal_accepted() THEN RAISE EXCEPTION 'A VOXEN ainda não confirmou o recebimento de leads sem cadastro' USING ERRCODE='55000'; END IF;
 FOR v_id IN SELECT DISTINCT x FROM unnest(p_leads) x WHERE x IS NOT NULL ORDER BY 1 LOOP
  IF NOT EXISTS(SELECT 1 FROM public.crm_leads WHERE id=v_id) THEN v_res:='not_found';
  ELSIF public.crm_context_lead_has_voxen(v_id) THEN v_res:='registered';
  ELSE
   INSERT INTO public.crm_voxen_prospects(lead_id,enabled,enabled_at,enabled_by) VALUES(v_id,true,clock_timestamp(),auth.uid())
   ON CONFLICT(lead_id) DO UPDATE SET enabled=true,
    enabled_at=CASE WHEN public.crm_voxen_prospects.enabled THEN public.crm_voxen_prospects.enabled_at ELSE clock_timestamp() END,
    enabled_by=CASE WHEN public.crm_voxen_prospects.enabled THEN public.crm_voxen_prospects.enabled_by ELSE auth.uid() END,stopped_at=NULL,stopped_by=NULL;
   v_res:=CASE public.crm_context_enqueue_prospect(v_id,false,true) WHEN 'enqueued' THEN 'sent' WHEN 'coalesced' THEN 'sent' WHEN 'unchanged' THEN 'sent' ELSE 'nothing_to_send' END;
  END IF;
  v_out:=v_out||jsonb_build_object('lead_id',v_id,'result',v_res);
 END LOOP;
 RETURN v_out;
END $$;

-- Parar de sincronizar: nada novo sai. O que ja foi enviado continua na VOXEN (quem decide o descarte la e a VOXEN).
CREATE OR REPLACE FUNCTION public.crm_voxen_stop(p_leads uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_res text; v_out jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso ao CRM necessário' USING ERRCODE='42501'; END IF;
 IF p_leads IS NULL OR coalesce(array_length(p_leads,1),0) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Envie de 1 a 25 leads por vez' USING ERRCODE='22023'; END IF;
 FOR v_id IN SELECT DISTINCT x FROM unnest(p_leads) x WHERE x IS NOT NULL ORDER BY 1 LOOP
  UPDATE public.crm_voxen_prospects SET enabled=false,stopped_at=clock_timestamp(),stopped_by=auth.uid() WHERE lead_id=v_id AND enabled;
  v_res:=CASE WHEN FOUND THEN 'stopped' ELSE 'not_enabled' END;
  v_out:=v_out||jsonb_build_object('lead_id',v_id,'result',v_res);
 END LOOP;
 RETURN v_out;
END $$;

-- Estado de cada lead para o app: so ids e estados (nenhum dado pessoal). Lead que nao aparece aqui esta "disponivel" (ainda nao escolhido).
--  registered: ja cadastrado na VOXEN (sincroniza sozinho pelo ID da VOXEN) | waiting: escolhido, sem nada a enviar ainda | pending: na fila | sent: entregue
--  blocked / quarantined: a VOXEN recusou ou nao guardou (avisar a Zyron) | stopped: sincronizacao parada.
CREATE OR REPLACE FUNCTION public.crm_voxen_sync_states() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.crm_has_access() THEN RAISE EXCEPTION 'Acesso ao CRM necessário' USING ERRCODE='42501'; END IF;
 RETURN (
  WITH reg AS (SELECT c.id AS lead_id FROM public.crm_leads c WHERE public.crm_context_lead_has_voxen(c.id)),
  latest AS (SELECT DISTINCT ON (o.source_lead_id) o.source_lead_id,o.state,o.receipt->>'status' AS receipt_status,coalesce(o.delivered_at,o.updated_at) AS at
    FROM public.crm_context_outbox o
    WHERE o.payload->>'kind'='prospect_context' AND coalesce(o.payload->'link'->>'basis','')<>'teste de integração'
    ORDER BY o.source_lead_id,o.source_revision DESC),
  items AS (
   SELECT r.lead_id,'registered'::text AS state,NULL::timestamptz AS at FROM reg r
   UNION ALL
   SELECT p.lead_id,
    CASE WHEN NOT p.enabled THEN 'stopped' WHEN l.state IS NULL THEN 'waiting' WHEN l.state IN('pending','processing') THEN 'pending'
     WHEN l.state='blocked' THEN 'blocked' WHEN l.receipt_status='quarantined' THEN 'quarantined' ELSE 'sent' END,
    coalesce(l.at,p.enabled_at)
   FROM public.crm_voxen_prospects p LEFT JOIN latest l ON l.source_lead_id=p.lead_id
   WHERE NOT EXISTS(SELECT 1 FROM reg r WHERE r.lead_id=p.lead_id))
  SELECT jsonb_build_object('ready',public.crm_context_rehearsal_accepted(),
   'rows',coalesce(jsonb_agg(jsonb_build_object('lead_id',i.lead_id,'state',i.state,'at',i.at) ORDER BY i.lead_id),'[]'::jsonb))
  FROM items i);
END $$;

-- 9. Situacao para o Executivo e para o sistema: so contagens (o evento de ensaio fica de fora e aparece em "rehearsal").
CREATE OR REPLACE FUNCTION public.crm_context_prospects_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' AND NOT coalesce(public.is_executive(auth.uid()),false) THEN
  RAISE EXCEPTION 'Acesso do Executive necessário' USING ERRCODE='42501'; END IF;
 RETURN (
  WITH latest AS (SELECT DISTINCT ON (o.source_lead_id) o.source_lead_id,o.state,o.receipt->>'status' AS receipt_status
    FROM public.crm_context_outbox o
    WHERE o.payload->>'kind'='prospect_context' AND coalesce(o.payload->'link'->>'basis','')<>'teste de integração'
    ORDER BY o.source_lead_id,o.source_revision DESC),
  p AS (SELECT s.lead_id,s.enabled,l.state,l.receipt_status FROM public.crm_voxen_prospects s LEFT JOIN latest l ON l.source_lead_id=s.lead_id),
  t AS (SELECT state,receipt->>'status' AS receipt_status FROM public.crm_context_outbox
    WHERE payload->>'kind'='prospect_context' AND payload->'link'->>'basis'='teste de integração' ORDER BY created_at DESC LIMIT 1)
  SELECT jsonb_build_object(
   'ready',public.crm_context_rehearsal_accepted(),
   'enabled',(SELECT count(*) FROM p WHERE enabled),
   'stopped',(SELECT count(*) FROM p WHERE NOT enabled),
   'waiting',(SELECT count(*) FROM p WHERE enabled AND state IS NULL),
   'pending',(SELECT count(*) FROM p WHERE enabled AND state IN('pending','processing')),
   'delivered',(SELECT count(*) FROM p WHERE enabled AND state='delivered' AND receipt_status IS DISTINCT FROM 'quarantined'),
   'blocked',(SELECT count(*) FROM p WHERE enabled AND state='blocked'),
   'quarantined',(SELECT count(*) FROM p WHERE enabled AND state='delivered' AND receipt_status='quarantined'),
   'available',(SELECT count(*) FROM public.crm_context_prospect_candidates() c WHERE NOT EXISTS(SELECT 1 FROM public.crm_voxen_prospects s WHERE s.lead_id=c)),
   'rehearsal',jsonb_build_object('accepted',public.crm_context_rehearsal_accepted(),'state',(SELECT state FROM t),'receipt_status',(SELECT receipt_status FROM t))));
END $$;

REVOKE ALL ON FUNCTION public.crm_context_strip_auto_observations(text),public.crm_context_is_contact_field(text),public.crm_context_build(uuid,uuid,uuid,text,boolean),
 public.crm_context_lead_has_voxen(uuid),public.crm_context_payload_prospect(uuid),public.crm_context_prospect_candidates(),
 public.crm_context_enqueue_prospect(uuid,boolean,boolean),public.crm_context_touch_prospect(uuid),public.crm_context_on_prospect_lead(),public.crm_context_on_prospect_note(),
 public.crm_context_on_prospect_link(),public.crm_context_on_prospect_form(),public.crm_context_rehearsal_accepted(),public.crm_context_enqueue_synthetic_prospect(),
 public.crm_voxen_send(uuid[]),public.crm_voxen_stop(uuid[]),public.crm_voxen_sync_states(),public.crm_context_prospects_status()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_voxen_send(uuid[]),public.crm_voxen_stop(uuid[]),public.crm_voxen_sync_states() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_context_enqueue_synthetic_prospect() TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_context_prospects_status() TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
