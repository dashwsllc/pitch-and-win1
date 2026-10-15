-- Correcao da migration 20261015050000: meta_refresh_form_contexts() so reconhecia o texto antigo ("plain"). Como a definicao do
-- formulario chegou ANTES dos dados do anuncio, os contextos ficaram num estado intermediario que ela nao reconhecia e nunca
-- receberiam o resto. Agora ela reconhece o bloco de respostas do formulario em QUALQUER versao: o bloco e sempre o ultimo
-- trecho do contexto, comeca no cabecalho "Respostas do formulario Meta" e tem as mesmas tres primeiras linhas (titulo, campanha,
-- "Preenchido em") do texto que a funcao gera hoje para o mesmo formulario. O que vem antes do bloco (texto do site) nao e tocado.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF to_regprocedure('public.meta_refresh_form_contexts()') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015050000_meta_raw_capture_and_form_definitions' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public.meta_refresh_form_contexts()'::regprocedure))<>'4cac492e56b4fd4e6523b81fc499d896' THEN
  RAISE EXCEPTION 'meta_refresh_form_contexts mudou desde a auditoria; revise antes de aplicar' USING ERRCODE='55000'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.meta_refresh_form_contexts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; f public.meta_form_leads; s public.meta_form_leads; d public.crm_lead_contexts; new_body text; old_block text;
 mark constant text:=E'\nPreenchido em: '; title constant text:='Respostas do formulário Meta'; p_pre int; p_head int; new_content text; n int:=0;
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
  IF new_body IS NULL THEN CONTINUE; END IF;
  -- Ultima linha "Preenchido em:" do contexto e, antes dela, o ultimo cabecalho do bloco de respostas.
  IF position(reverse(mark) IN reverse(r.content))=0 THEN CONTINUE; END IF;
  p_pre:=length(r.content)-position(reverse(mark) IN reverse(r.content))-length(mark)+2;
  IF position(reverse(title) IN reverse(left(r.content,p_pre)))=0 THEN CONTINUE; END IF;
  p_head:=p_pre-position(reverse(title) IN reverse(left(r.content,p_pre)))-length(title)+2;
  old_block:=substr(r.content,p_head);
  -- Mesmo formulario (tres primeiras linhas iguais) e um unico bloco; senao nao toca.
  IF split_part(old_block,E'\n',1)<>split_part(new_body,E'\n',1) OR split_part(old_block,E'\n',2)<>split_part(new_body,E'\n',2)
   OR split_part(old_block,E'\n',3)<>split_part(new_body,E'\n',3) OR position(title IN substr(old_block,2))>0 THEN CONTINUE; END IF;
  IF old_block=new_body THEN CONTINUE; END IF;
  new_content:=left(r.content,p_head-1)||new_body;
  IF char_length(new_content)>50000 THEN CONTINUE; END IF;
  DELETE FROM public.crm_lead_contexts WHERE id=r.ctx_id RETURNING * INTO d;
  INSERT INTO public.crm_lead_contexts
   SELECT (jsonb_populate_record(NULL::public.crm_lead_contexts,to_jsonb(d)||jsonb_build_object('content',new_content))).*;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

CREATE TEMP TABLE _form_refresh2_report(atualizados integer) ON COMMIT DROP;
INSERT INTO _form_refresh2_report SELECT public.meta_refresh_form_contexts();

REVOKE ALL ON FUNCTION public.meta_refresh_form_contexts() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
