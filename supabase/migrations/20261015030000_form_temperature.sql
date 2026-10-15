-- Pre-classifica o aquecimento (frio / morno / quente) pelas respostas do formulario Meta, para o SDR saber
-- quem abordar primeiro. E um PONTO DE PARTIDA: o SDR continua dono do campo e pode mudar a qualquer momento.
--   quente  compromisso >= 9, objetivo ligado a clube/carreira, impedimento que a oferta resolve e
--           pelo menos 2 sinais de movimento (fez avaliacoes, recebeu proposta/contrato, respostas detalhadas)
--   morno   compromisso >= 7 e objetivo OU impedimento alinhado
--   frio    o resto (compromisso baixo ou objetivo/impedimento sem ligacao com entrar em clube)
-- Compromisso ilegivel conta como 7 (nunca chega a quente sozinho). Formularios que nao tem as perguntas
-- conhecidas (menos de 4 reconhecidas) nao sao classificados. Nada aqui aprova, repassa ou abre lead.
-- Depende de 20261015021500_site_form_answers_link.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF to_regprocedure('public.meta_attach_form_answers(uuid,uuid,uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015021500_site_form_answers_link' USING ERRCODE='55000'; END IF;
END $guard$;

-- 1. Sugestao e motivos (somente leitura para o app; gravada so pelas funcoes abaixo).
CREATE TABLE IF NOT EXISTS public.crm_lead_temperature_hints(
 lead_id uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
 temperature text NOT NULL CHECK(temperature IN('frio','morno','quente')),
 reasons text NOT NULL CHECK(char_length(reasons) BETWEEN 1 AND 1000),
 rule_version smallint NOT NULL,
 applied boolean NOT NULL DEFAULT false,
 computed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.crm_lead_temperature_hints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_lead_temperature_hints_select ON public.crm_lead_temperature_hints;
CREATE POLICY crm_lead_temperature_hints_select ON public.crm_lead_temperature_hints FOR SELECT TO authenticated
 USING(auth.uid() IS NOT NULL AND public.crm_can('leads'));
REVOKE ALL ON public.crm_lead_temperature_hints FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.crm_lead_temperature_hints TO authenticated;

-- 2. Texto normalizado (minusculas, sem acento, so letras/numeros) para comparar perguntas e opcoes.
CREATE OR REPLACE FUNCTION public.meta_match_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT btrim(regexp_replace(regexp_replace(lower(translate(coalesce(p,''),
  'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),'[^a-z0-9 ]',' ','g'),'\s+',' ','g'))
$$;

-- 3. A classificacao. Pura: so le as respostas (field_data) e explica o motivo com as palavras do proprio atleta.
CREATE OR REPLACE FUNCTION public.meta_form_temperature(p_fields jsonb) RETURNS TABLE(temperature text,reasons text)
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; k text; v text; n text;
 linked text; evals text; opp text; goal text; block text; clubs text; judged text; traits text; raw text;
 recognized int:=0; score_c int; score_text text; goal_ok boolean; block_ok boolean; detail int:=0; signals text[]:='{}'; tier text; parts text[];
 empty_re constant text:='^(nenhum|nenhuma|nao|nunca|0|n a|ninguem|nada)$';
BEGIN
 IF jsonb_typeof(p_fields)<>'array' THEN RETURN; END IF;
 FOR a IN SELECT x FROM jsonb_array_elements(p_fields) x LOOP
  k:=public.meta_match_text(a->>'name'); v:=btrim(coalesce(a->'values'->>0,''));
  IF v LIKE '<test lead%' THEN RETURN; END IF;
  IF k LIKE '%vinculado a algum clube%' THEN linked:=v;
  ELSIF k LIKE '%participou de avaliacoes%' THEN evals:=v;
  ELSIF k LIKE '%recebeu alguma oportunidade%' THEN opp:=v;
  ELSIF k LIKE '%principal objetivo%' THEN goal:=v;
  ELSIF k LIKE '%impedindo%' THEN block:=v;
  ELSIF k LIKE '%principais clubes%' THEN clubs:=v;
  ELSIF k LIKE '%quais clubes avaliou%' THEN judged:=v;
  ELSIF k LIKE '%3 principais caracteristicas%' THEN traits:=v;
  ELSIF k LIKE 'de 0 a 10%' THEN raw:=v;
  END IF;
 END LOOP;
 recognized:=(linked IS NOT NULL)::int+(evals IS NOT NULL)::int+(opp IS NOT NULL)::int+(goal IS NOT NULL)::int+(block IS NOT NULL)::int+(raw IS NOT NULL)::int;
 IF recognized<4 THEN RETURN; END IF;
 -- Compromisso: primeira nota 0-10 do texto ("8/10", "Sim 8", "9. estou focado"); sem nota, le o sentido.
 score_c:=substring(coalesce(raw,'') from '(?:^|[^0-9.,])(10|[0-9])(?:[.,][0-9]+)?(?:[^0-9]|$)')::int;
 IF score_c IS NOT NULL THEN score_text:='compromisso '||score_c||'/10';
 ELSIF raw ~* '(muit|total|m[aá]xim|sempre|100 ?%|dedicad|focad|determinad)' THEN score_c:=8; score_text:='descreve compromisso alto, sem dar nota';
 ELSIF raw ~* '(pouco|nada|n[aã]o|nenhum)' THEN score_c:=4; score_text:='descreve compromisso baixo';
 ELSE score_c:=7; score_text:='nota de compromisso não informada de forma legível'; END IF;
 n:=public.meta_match_text(goal);
 goal_ok:=coalesce(n ~ '(jogador profissional|oportunidade em um clube|clube de maior nivel|visibilidade|direcionamento para a carreira)',false);
 n:=public.meta_match_text(block);
 block_ok:=coalesce(n ~ '(falta de oportunidades|falta de visibilidade|dificuldade para chegar|ja tentei oportunidades|falta de direcionamento|falta de acompanhamento|nao sei qual caminho)',false);
 IF public.meta_match_text(evals)='sim' THEN signals:=array_append(signals,'já participou de avaliações ou peneiras'::text); END IF;
 IF public.meta_match_text(opp) LIKE 'sim%' THEN
  signals:=array_append(signals,('já recebeu '||lower(regexp_replace(replace(btrim(opp),'_',' '),'^[Ss]im,? *','')))::text);
 END IF;
 IF length(coalesce(traits,''))>=40 THEN detail:=detail+1; END IF;
 IF length(coalesce(clubs,''))>2 AND public.meta_match_text(clubs)!~empty_re THEN detail:=detail+1; END IF;
 IF length(coalesce(judged,''))>2 AND public.meta_match_text(judged)!~empty_re THEN detail:=detail+1; END IF;
 IF detail>=2 THEN signals:=array_append(signals,'respostas detalhadas sobre clubes e características'::text); END IF;
 tier:=CASE WHEN score_c>=9 AND goal_ok AND block_ok AND cardinality(signals)>=2 THEN 'quente'
            WHEN score_c>=7 AND (goal_ok OR block_ok) THEN 'morno' ELSE 'frio' END;
 parts:=ARRAY[score_text,
  'objetivo: “'||upper(left(replace(goal,'_',' '),1))||substr(replace(goal,'_',' '),2)||'”'||CASE WHEN goal_ok THEN '' ELSE ' (pouco ligado a entrar em clube)' END,
  'impedimento: “'||upper(left(replace(block,'_',' '),1))||substr(replace(block,'_',' '),2)||'”'||CASE WHEN block_ok THEN '' ELSE ' (menos ligado à entrada em clubes)' END,
  CASE WHEN cardinality(signals)>0 THEN 'sinais de movimento: '||array_to_string(signals,', ') ELSE 'sem avaliações, propostas nem respostas detalhadas' END];
 temperature:=tier; reasons:=upper(left(tier,1))||substr(tier,2)||': '||array_to_string(parts,'; ')||'.';
 RETURN NEXT;
END $$;

-- 4. Quais respostas valem para um registro: as do proprio formulario, ou as do formulario ligado ao registro do site.
CREATE OR REPLACE FUNCTION public.crm_form_temperature_fields(p_form_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN f.entry_channel='form' THEN f.field_data
  ELSE (SELECT p.field_data FROM public.meta_form_leads p WHERE p.id=f.answers_form_lead_id) END
 FROM public.meta_form_leads f WHERE f.id=p_form_id
$$;

-- 5. Lead novo (aprovacao): nasce ja com o aquecimento sugerido. Nunca bloqueia a criacao do lead.
CREATE OR REPLACE FUNCTION public.crm_form_temperature_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t text;
BEGIN
 IF NEW.meta_form_lead_id IS NOT NULL AND NEW.temperature='frio' THEN
  SELECT x.temperature INTO t FROM public.meta_form_temperature(public.crm_form_temperature_fields(NEW.meta_form_lead_id)) x;
  IF t IS NOT NULL THEN NEW.temperature:=t; END IF;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.crm_form_temperature_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t text; r text;
BEGIN
 IF NEW.meta_form_lead_id IS NOT NULL THEN
  SELECT x.temperature,x.reasons INTO t,r FROM public.meta_form_temperature(public.crm_form_temperature_fields(NEW.meta_form_lead_id)) x;
  IF t IS NOT NULL THEN
   INSERT INTO public.crm_lead_temperature_hints(lead_id,temperature,reasons,rule_version,applied)
   VALUES(NEW.id,t,r,1,NEW.temperature=t) ON CONFLICT(lead_id) DO NOTHING;
  END IF;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_crm_form_temperature_before ON public.crm_leads;
CREATE TRIGGER zz_crm_form_temperature_before BEFORE INSERT ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_form_temperature_before();
DROP TRIGGER IF EXISTS zz_crm_form_temperature_after ON public.crm_leads;
CREATE TRIGGER zz_crm_form_temperature_after AFTER INSERT ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_form_temperature_after();

-- 6. Lead que JA esta no CRM e ganhou as respostas depois: marca so se ninguem mexeu nele ainda
-- (aquecimento padrao, nao abordado, sem Closer). Caso contrario fica so a sugestao, sem alterar o lead.
-- Os gatilhos do CRM exigem um usuario autenticado: a alteracao e atribuida a quem aprovou o lead.
CREATE OR REPLACE FUNCTION public.meta_apply_form_temperature(p_crm uuid,p_form uuid,p_author uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t text; r text; l public.crm_leads; done boolean:=false; prev text;
BEGIN
 SELECT x.temperature,x.reasons INTO t,r FROM public.meta_form_temperature((SELECT field_data FROM public.meta_form_leads WHERE id=p_form)) x;
 IF t IS NULL THEN RETURN 'sem_classificacao'; END IF;
 -- Uma unica vez por lead: depois disso o aquecimento e do SDR e nunca e refeito por aqui.
 IF EXISTS(SELECT 1 FROM public.crm_lead_temperature_hints WHERE lead_id=p_crm) THEN RETURN 'ja_sugerida'; END IF;
 SELECT * INTO l FROM public.crm_leads WHERE id=p_crm FOR UPDATE;
 IF NOT FOUND THEN RETURN 'lead_inexistente'; END IF;
 IF l.temperature=t THEN done:=true;
 ELSIF l.temperature='frio' AND l.approach_stage='nao_abordado' AND l.pipeline_stage='novo' AND coalesce(l.approach_count,0)=0
   AND l.closer_id IS NULL AND p_author IS NOT NULL THEN
  prev:=coalesce(current_setting('request.jwt.claim.sub',true),'');
  BEGIN
   PERFORM set_config('request.jwt.claim.sub',p_author::text,true);
   UPDATE public.crm_leads SET temperature=t WHERE id=p_crm;
   done:=true;
  EXCEPTION WHEN OTHERS THEN done:=false;
  END;
  PERFORM set_config('request.jwt.claim.sub',prev,true);
 END IF;
 INSERT INTO public.crm_lead_temperature_hints(lead_id,temperature,reasons,rule_version,applied)
 VALUES(p_crm,t,r,1,done)
 ON CONFLICT(lead_id) DO UPDATE SET temperature=EXCLUDED.temperature,reasons=EXCLUDED.reasons,rule_version=EXCLUDED.rule_version,
  applied=EXCLUDED.applied,computed_at=clock_timestamp();
 RETURN CASE WHEN done THEN 'aplicada' ELSE 'sugestao' END;
END $$;

-- 7. Anexar respostas agora tambem sugere/marca o aquecimento (a anexacao em si nao depende disso).
ALTER FUNCTION public.meta_attach_form_answers(uuid,uuid,uuid,uuid) RENAME TO meta_attach_form_answers_core;
CREATE OR REPLACE FUNCTION public.meta_attach_form_answers(p_crm uuid,p_form uuid,p_author uuid,p_site uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r text;
BEGIN
 r:=public.meta_attach_form_answers_core(p_crm,p_form,p_author,p_site);
 IF r IN('inserido','mesclado','igual') THEN
  BEGIN PERFORM public.meta_apply_form_temperature(p_crm,p_form,p_author);
  EXCEPTION WHEN OTHERS THEN NULL; END;
 END IF;
 RETURN r;
END $$;

-- 8. Leitura para a tela do SDR (respeita a regra de acesso da tabela) e conferencia para a gestao.
CREATE OR REPLACE FUNCTION public.crm_lead_temperature_hint(p_lead uuid) RETURNS TABLE(temperature text,reasons text,applied boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT h.temperature,h.reasons,h.applied FROM public.crm_lead_temperature_hints h WHERE h.lead_id=p_lead
$$;
CREATE OR REPLACE FUNCTION public.meta_temperature_preview() RETURNS TABLE(form_id uuid,temperature text,reasons text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.id,x.temperature,x.reasons FROM public.meta_form_leads f
 CROSS JOIN LATERAL public.meta_form_temperature(public.crm_form_temperature_fields(f.id)) x WHERE f.entry_channel='form'
$$;

REVOKE ALL ON FUNCTION public.meta_match_text(text),public.meta_form_temperature(jsonb),public.crm_form_temperature_fields(uuid),
 public.crm_form_temperature_before(),public.crm_form_temperature_after(),public.meta_apply_form_temperature(uuid,uuid,uuid),
 public.meta_attach_form_answers_core(uuid,uuid,uuid,uuid),public.meta_attach_form_answers(uuid,uuid,uuid,uuid),
 public.meta_temperature_preview() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_lead_temperature_hint(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_lead_temperature_hint(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
