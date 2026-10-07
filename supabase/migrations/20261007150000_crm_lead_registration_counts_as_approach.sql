-- Cada lead cadastrado no CRM conta como uma abordagem de quem o cadastrou (a partir do cadastro: sem mexer no histórico).
--
-- Hoje a abordagem do time só entra nos números pelo formulário "Nova abordagem" (tabela abordagens) e por ações de
-- abordagem sobre um lead já cadastrado. Os SDRs de hoje (Pedro Iago, Ismael...) nunca usaram o formulário: o trabalho deles
-- é cadastrar lead, e isso não aparecia em "Abordagens" (Visão geral, Executive, Arena, ranking, metas por turno).
--
-- Regra: cadastrar um lead (Novo Lead) = 1 abordagem para quem cadastrou (o SDR do lead, ou quem o criou). Fora da regra:
-- lead que chega pela integração do Meta (lead_source = 'meta_ads_form') ou sem autor, porque ninguém o abordou.
--
-- Como entra em cada contador, sem tocar nas funções deles:
--   * Tabela abordagens (Visão geral, Executive, Arena: métricas do período e ranking de Closers, metas por turno "manual"):
--     uma linha por lead, ligada por abordagens.crm_lead_id (único). Os campos obrigatórios do formulário recebem o que o
--     cadastro já sabe (nome, WhatsApp) e tempo médio 1 min; "mostrou a IA" fica falso. Excluir o lead remove a linha.
--   * Eventos da Arena (ranking de SDRs e metas por turno "CRM"): um evento lead.approached por lead, peso 0.
-- Os leads que JÁ existem não são alterados por esta migração (o preenchimento do histórico é uma decisão à parte).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.abordagens
  ADD COLUMN IF NOT EXISTS crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS abordagens_crm_lead_id_key
  ON public.abordagens (crm_lead_id) WHERE crm_lead_id IS NOT NULL;
COMMENT ON COLUMN public.abordagens.crm_lead_id IS
  'Preenchido quando a abordagem vem do cadastro de um lead no CRM (um lead = uma abordagem); nulo no formulário Nova abordagem.';

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.crm_lead_registered_as_approach()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.created_by IS NULL OR COALESCE(NEW.lead_source, '') = 'meta_ads_form' THEN RETURN NULL; END IF;
  INSERT INTO public.abordagens (user_id, nomes_abordados, dados_abordados, tempo_medio_abordagem, mostrou_ia, visao_geral, created_at, crm_lead_id)
  VALUES (
    COALESCE(NEW.sdr_id, NEW.created_by),
    left(COALESCE(NULLIF(btrim(NEW.name), ''), 'Lead'), 2000),
    left(COALESCE(NULLIF(concat_ws(' · ', 'Atleta ' || NULLIF(btrim(NEW.athlete_name), ''), NULLIF(btrim(NEW.phone), ''), NULLIF(btrim(NEW.email), '')), ''), 'Sem contato'), 5000),
    1, false, 'Lead cadastrado no CRM', NEW.created_at, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION private.crm_lead_registered_as_approach() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_lead_registered_as_approach ON public.crm_leads;
CREATE TRIGGER crm_lead_registered_as_approach
  AFTER INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION private.crm_lead_registered_as_approach();

-- O evento da Arena do cadastro (peso 0: conta como abordagem, não dá pontos). O resto da função é o de sempre: uma
-- abordagem a mais para cada aumento de approach_count.
CREATE OR REPLACE FUNCTION public.arena_approach_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_previous integer; v_step integer;
BEGIN
 IF TG_OP='INSERT' AND NEW.created_by IS NOT NULL AND COALESCE(NEW.lead_source,'')<>'meta_ads_form' THEN
   PERFORM public.arena_emit('lead.approached:'||NEW.id||':registered','lead.approached',COALESCE(NEW.sdr_id,NEW.created_by),'sdr',
     'crm_leads',NEW.id,NEW.created_at,0,0,NEW.id);
 END IF;
 v_previous:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.approach_count END;
 IF NEW.sdr_id IS NULL OR NEW.approach_count<=v_previous THEN RETURN NULL; END IF;
 FOR v_step IN 1..NEW.approach_count-v_previous LOOP
   PERFORM public.arena_emit('lead.approached:'||NEW.id||':'||NEW.version||':'||v_step,
     'lead.approached',NEW.sdr_id,'sdr','crm_leads',NEW.id,clock_timestamp(),0,0,NEW.id);
 END LOOP;
 RETURN NULL;
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
