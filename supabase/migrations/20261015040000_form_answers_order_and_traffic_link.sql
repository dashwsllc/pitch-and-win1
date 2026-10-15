-- Acabamento das respostas do formulario Meta no CRM e em Trafego:
--  1) As perguntas passam a aparecer SEMPRE na ordem do formulario (as 11 perguntas, depois nome, telefone,
--     nascimento e estado). Os formularios chegam da Meta em 6 ordens diferentes; ate aqui o Contexto copiava a
--     ordem recebida. Os contextos ja gravados sao reescritos (mesmo texto, outra ordem; nada e perdido).
--  2) Em Trafego, a linha do registro do SITE passa a trazer as respostas do formulario ligado a ele
--     (meta_wave_leads devolve "linked_form"; so o front le).
--  3) Lead criado a mao duplicado (mesmo WhatsApp) deixa de ser "ambiguo": os dois recebem as respostas do
--     mesmo formulario. Continua ambiguo o lead com MAIS DE UM formulario.
--  4) Funcoes para o operador CONFIRMAR a mao um vinculo que as regras automaticas deixam em duvida
--     (com o motivo gravado no proprio vinculo).
-- Depende de 20261015032000_whatsapp_answer_links.sql.
BEGIN;
SET LOCAL lock_timeout='5s';

-- 0. So substitui as funcoes se forem exatamente as auditadas.
DO $guard$
BEGIN
 IF to_regclass('public.crm_form_answer_links') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015032000_whatsapp_answer_links' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads)'::regprocedure))<>'97a5df974c5f85d7a9de99d897595b37' THEN
  RAISE EXCEPTION 'meta_form_answers_text mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_wave_leads(uuid)'::regprocedure))<>'85e899b9ea495e80214333e25257352e' THEN
  RAISE EXCEPTION 'meta_wave_leads mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_link_manual_answers(boolean)'::regprocedure))<>'61616422495140f24959903b9215419c' THEN
  RAISE EXCEPTION 'meta_link_manual_answers mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
END $guard$;

-- 1. Posicao de cada campo na ordem do formulario (menor = antes). Campo desconhecido fica depois, na ordem recebida.
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
  WHEN t='full name' THEN 20
  WHEN t='phone number' THEN 21
  WHEN t='date of birth' THEN 22
  WHEN t='state' THEN 23
  WHEN t='city' THEN 24
  WHEN t='email' THEN 25
  ELSE 100 END
 FROM (SELECT public.meta_match_name(p_name) AS t) x
$$;

-- 2. Texto das respostas, agora na ordem do formulario. A versao anterior fica com outro nome so durante esta migration,
-- para reescrever os contextos ja gravados.
ALTER FUNCTION public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads) RENAME TO meta_form_answers_text_v1;
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
   '',answers.body),50000) END
 FROM (
  SELECT string_agg(x.label||E'\n→ '||x.value,E'\n\n' ORDER BY x.rk,x.n) AS body
  FROM (
   SELECT a.n,public.meta_form_field_rank(a.answer->>'name') AS rk,
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

-- 3. Reescreve os contextos ja gravados: o bloco de respostas muda de ordem e o resto do texto fica como esta.
-- So mexe no que a versao anterior da funcao teria gerado EXATAMENTE (senao conta como "ignorado").
CREATE TEMP TABLE _form_answers_reorder_report(reescritos integer,ja_na_ordem integer,ignorados integer) ON COMMIT DROP;
DO $reorder$
DECLARE r record; f public.meta_form_leads; s public.meta_form_leads; d public.crm_lead_contexts; old_body text; new_body text; n_new int:=0; n_same int:=0; n_skip int:=0;
BEGIN
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
   IF s.entry_channel='website' AND s.answers_form_lead_id IS NOT NULL THEN
    SELECT * INTO f FROM public.meta_form_leads WHERE id=s.answers_form_lead_id;
   ELSE
    f:=NULL; s:=NULL;
   END IF;
  END IF;
  IF f.id IS NULL THEN n_skip:=n_skip+1; CONTINUE; END IF;
  old_body:=public.meta_form_answers_text_v1(f,s);
  new_body:=public.meta_form_answers_text(f,s);
  IF old_body IS NULL OR position(old_body IN r.content)=0 THEN n_skip:=n_skip+1; CONTINUE; END IF;
  IF old_body=new_body THEN n_same:=n_same+1; CONTINUE; END IF;
  IF length(old_body)<>length(new_body) THEN
   RAISE EXCEPTION 'A reordenacao mudaria o tamanho do texto (contexto %); nada foi alterado',r.ctx_id USING ERRCODE='55000'; END IF;
  -- O gatilho de protecao bloqueia UPDATE de respostas do formulario; DELETE + INSERT preserva id, autor, datas e versao.
  DELETE FROM public.crm_lead_contexts WHERE id=r.ctx_id RETURNING * INTO d;
  INSERT INTO public.crm_lead_contexts
   SELECT (jsonb_populate_record(NULL::public.crm_lead_contexts,to_jsonb(d)||jsonb_build_object('content',replace(r.content,old_body,new_body)))).*;
  n_new:=n_new+1;
 END LOOP;
 INSERT INTO _form_answers_reorder_report VALUES(n_new,n_same,n_skip);
END $reorder$;
DROP FUNCTION public.meta_form_answers_text_v1(public.meta_form_leads,public.meta_form_leads);

-- 4. Lead criado a mao duplicado: mais de um LEAD para o mesmo formulario nao e duvida (e o mesmo WhatsApp);
-- o que continua em duvida e um lead com mais de um formulario.
ALTER TABLE public.crm_form_answer_links DROP CONSTRAINT IF EXISTS crm_form_answer_links_form_lead_id_key;
CREATE INDEX IF NOT EXISTS crm_form_answer_links_form_idx ON public.crm_form_answer_links(form_lead_id);

CREATE OR REPLACE FUNCTION public.meta_manual_twin_pairs() RETURNS TABLE(crm_lead_id uuid,form_id uuid,ambiguous boolean,nome_crm text,nome_formulario text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH c AS (
  SELECT l.id,l.name,public.meta_phone_tail(l.phone) k FROM public.crm_leads l
  WHERE l.meta_form_lead_id IS NULL AND coalesce(l.import_channel,'')<>'form' AND public.meta_phone_tail(l.phone)<>''
   AND NOT EXISTS(SELECT 1 FROM public.crm_form_answer_links x WHERE x.crm_lead_id=l.id)
 ), f AS (
  SELECT m.id,m.full_name,public.meta_phone_tail(m.phone) k FROM public.meta_form_leads m
  WHERE m.entry_channel='form' AND m.crm_lead_id IS NULL AND public.crm_form_answers_present(to_jsonb(m)) AND public.meta_phone_tail(m.phone)<>''
 ), p AS (
  SELECT c.id cid,f.id fid,c.name,f.full_name FROM c JOIN f ON c.k=f.k
 )
 SELECT cid,fid,count(*) OVER (PARTITION BY cid)>1,name,full_name FROM p
$$;

-- Mesma funcao de antes; so a ordem do laco muda: o lead mais antigo e ligado primeiro. E o primeiro vinculo gravado de um formulario
-- que a aprovacao reaproveita (assim a aprovacao sempre escolhe o lead mais antigo).
CREATE OR REPLACE FUNCTION public.meta_link_manual_answers(p_apply boolean DEFAULT false)
RETURNS TABLE(crm_lead_id uuid,form_id uuid,ambiguous boolean,situacao text,nome_crm text,nome_formulario text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_author uuid; v_res text; v_status text;
BEGIN
 IF p_apply IS NULL THEN RAISE EXCEPTION 'Informe true ou false' USING ERRCODE='22023'; END IF;
 IF p_apply THEN PERFORM pg_advisory_xact_lock(hashtextextended('meta-site-form-link',0)); END IF;
 FOR r IN SELECT * FROM public.meta_manual_twin_pairs() t
  ORDER BY t.ambiguous DESC,(SELECT l.created_at FROM public.crm_leads l WHERE l.id=t.crm_lead_id),t.crm_lead_id LOOP
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

-- 5. Respostas do formulario ligado, na linha do registro do SITE em Trafego (so leitura; o front ignora o que nao conhece).
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
          'field_data',f.field_data,'basis',l.answers_link_basis) FROM public.meta_form_leads f WHERE f.id=l.answers_form_lead_id)) ORDER BY l.first_received_at DESC,l.created_time DESC,l.id)
      FROM public.meta_form_leads l WHERE l.wave_id=p_wave),'[]'))
  INTO result;
  RETURN result;
END $$;

-- 6. Confirmacao humana de um vinculo em duvida. O motivo fica gravado no proprio vinculo.
CREATE OR REPLACE FUNCTION public.meta_confirm_site_form_link(p_site uuid,p_form uuid,p_note text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.meta_form_leads; f public.meta_form_leads; v_res text;
BEGIN
 IF nullif(btrim(coalesce(p_note,'')),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da confirmação' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-site-form-link',0));
 SELECT * INTO s FROM public.meta_form_leads WHERE id=p_site FOR UPDATE;
 SELECT * INTO f FROM public.meta_form_leads WHERE id=p_form;
 IF s.id IS NULL OR s.entry_channel<>'website' THEN RAISE EXCEPTION 'O primeiro identificador precisa ser de um registro do site' USING ERRCODE='22023'; END IF;
 IF f.id IS NULL OR f.entry_channel<>'form' OR NOT public.crm_form_answers_present(to_jsonb(f)) THEN
  RAISE EXCEPTION 'O segundo identificador precisa ser de um formulário com respostas' USING ERRCODE='22023'; END IF;
 IF s.answers_form_lead_id IS NOT NULL THEN RAISE EXCEPTION 'Este registro do site já está ligado a um formulário' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.meta_form_leads x WHERE x.answers_form_lead_id=p_form) THEN
  RAISE EXCEPTION 'Este formulário já está ligado a outro registro do site' USING ERRCODE='23505'; END IF;
 UPDATE public.meta_form_leads SET answers_form_lead_id=p_form,
  answers_link_basis='confirmado manualmente ('||left(btrim(p_note),200)||'), '||round(extract(epoch FROM s.created_time-f.created_time))||' s depois do formulário',
  answers_linked_at=clock_timestamp() WHERE id=p_site;
 IF s.crm_lead_id IS NOT NULL THEN
  v_res:=public.meta_attach_form_answers(s.crm_lead_id,p_form,coalesce(s.reviewed_by,s.imported_by),p_site);
  RETURN 'vinculado; contexto '||v_res;
 END IF;
 RETURN 'vinculado';
END $$;

CREATE OR REPLACE FUNCTION public.meta_confirm_manual_form_link(p_crm uuid,p_form uuid,p_note text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.crm_leads; f public.meta_form_leads; v_res text;
BEGIN
 IF nullif(btrim(coalesce(p_note,'')),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da confirmação' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-site-form-link',0));
 SELECT * INTO l FROM public.crm_leads WHERE id=p_crm FOR UPDATE;
 SELECT * INTO f FROM public.meta_form_leads WHERE id=p_form;
 IF l.id IS NULL OR l.meta_form_lead_id IS NOT NULL THEN RAISE EXCEPTION 'O primeiro identificador precisa ser de um lead criado à mão' USING ERRCODE='22023'; END IF;
 IF f.id IS NULL OR f.entry_channel<>'form' OR NOT public.crm_form_answers_present(to_jsonb(f)) THEN
  RAISE EXCEPTION 'O segundo identificador precisa ser de um formulário com respostas' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_form_answer_links x WHERE x.crm_lead_id=p_crm) THEN
  RAISE EXCEPTION 'Este lead já está ligado a um formulário' USING ERRCODE='23505'; END IF;
 v_res:=public.meta_attach_form_answers(p_crm,p_form,coalesce(l.sdr_id,l.created_by));
 IF v_res NOT IN('inserido','igual','mesclado') THEN RAISE EXCEPTION 'Não foi possível anexar as respostas (%)',v_res USING ERRCODE='22023'; END IF;
 INSERT INTO public.crm_form_answer_links(crm_lead_id,form_lead_id,basis) VALUES(p_crm,p_form,'confirmado manualmente ('||left(btrim(p_note),200)||')');
 RETURN 'vinculado; contexto '||v_res;
END $$;

REVOKE ALL ON FUNCTION public.meta_form_field_rank(text),public.meta_form_answers_text(public.meta_form_leads,public.meta_form_leads),
 public.meta_manual_twin_pairs(),public.meta_link_manual_answers(boolean),public.meta_confirm_site_form_link(uuid,uuid,text),public.meta_confirm_manual_form_link(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
-- meta_wave_leads mantem as permissoes que ja tem (CREATE OR REPLACE as preserva).
NOTIFY pgrst,'reload schema';
COMMIT;
