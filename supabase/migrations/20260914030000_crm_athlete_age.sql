-- Idade do atleta no CRM.
--
-- Nem todo lead entra pelo fluxo de IA, entao nem sempre existe data de
-- nascimento. Este campo permite registrar a idade diretamente, sem inventar
-- uma data de nascimento a partir dela.
--
-- Regra de prioridade aplicada no frontend (src/lib/crm-age.ts): quando existe
-- data de nascimento valida, a idade e calculada a partir dela e vence a idade
-- manual. Os dois campos coexistem sem se sobrescrever.
--
-- Nada se torna obrigatorio: leads antigos, sem idade e sem nascimento,
-- continuam validos. Nenhuma data de nascimento existente e alterada.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS athlete_age smallint;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_athlete_age_range'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_athlete_age_range
      CHECK (athlete_age IS NULL OR athlete_age BETWEEN 1 AND 80);
  END IF;
END; $guard$;

-- crm_transition e recriada a partir da versao em producao, com duas mudancas
-- pontuais: 'athlete_age' entra na lista de campos aceitos pela acao 'edit' e
-- a coluna passa a ser gravada no UPDATE. Nenhuma outra regra foi tocada.
CREATE OR REPLACE FUNCTION public.crm_transition(p_lead_id uuid, p_action text, p_expected_version bigint, p_data jsonb DEFAULT '{}')
RETURNS public.crm_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $crm_transition$
DECLARE l public.crm_leads; c public.crm_activities; d public.crm_leads; v_when timestamptz; v_assignee uuid; v_outcome text; v_note text;
BEGIN
  PERFORM public.crm_require_role('leads');
  IF p_action IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN RAISE EXCEPTION 'Lead alterado por outra ação. A lista foi atualizada; confira e tente novamente.' USING ERRCODE='PT409'; END IF;
  v_note:=NULLIF(btrim(p_data->>'note'),'');
  IF char_length(v_note)>10000 THEN RAISE EXCEPTION 'Anotação excede 10000 caracteres' USING ERRCODE='22023'; END IF;
  IF p_action='edit' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('name','athlete_name','phone','email','city_state','athlete_birth_date','athlete_position','athlete_height_cm','athlete_weight_kg','athlete_age','performance_report_url','lead_source','estimated_deal_value','observations','priority')) THEN
      RAISE EXCEPTION 'Campo não permitido no cadastro' USING ERRCODE='22023'; END IF;
    d:=jsonb_populate_record(l,p_data);
    UPDATE public.crm_leads SET name=btrim(d.name),athlete_name=btrim(d.athlete_name),phone=btrim(d.phone),email=d.email,
      city_state=d.city_state,athlete_birth_date=d.athlete_birth_date,athlete_position=d.athlete_position,
      athlete_height_cm=d.athlete_height_cm,athlete_weight_kg=d.athlete_weight_kg,athlete_age=d.athlete_age,performance_report_url=d.performance_report_url,
      lead_source=d.lead_source,estimated_deal_value=d.estimated_deal_value,observations=d.observations,priority=d.priority WHERE id=l.id;
  ELSIF p_action IN ('classify','approach','qualify','lose') THEN
    PERFORM public.crm_require_role('sdr');
    IF p_action='classify' THEN
      IF p_data->>'temperature' IS NULL OR p_data->>'temperature' NOT IN ('frio','morno','quente') THEN RAISE EXCEPTION 'Aquecimento inválido' USING ERRCODE='22023'; END IF;
      l.temperature:=p_data->>'temperature';
    ELSIF p_action='approach' THEN
      IF p_data->>'stage' IS NULL OR p_data->>'stage' NOT IN ('nao_abordado','em_abordagem','abordado','reabordado') THEN RAISE EXCEPTION 'Abordagem inválida' USING ERRCODE='22023'; END IF;
      l.approach_stage:=p_data->>'stage';
    ELSIF p_action='lose' THEN
      IF l.pipeline_stage IN ('repassado_closer','fechado_ganho','fechado_perdido','lead_perdido') THEN RAISE EXCEPTION 'Transição indisponível para esta etapa' USING ERRCODE='PT409'; END IF;
      l.pipeline_stage:='lead_perdido'; l.closed_at:=clock_timestamp(); l.closed_by:=auth.uid();
    ELSE
      IF l.pipeline_stage NOT IN ('novo','em_qualificacao','pronto_closer','contato_feito','proposta_enviada','negociacao','reativacao') THEN RAISE EXCEPTION 'Transição indisponível para esta etapa' USING ERRCODE='PT409'; END IF;
      l.pipeline_stage:='em_qualificacao';
    END IF;
    IF l.pipeline_stage NOT IN ('repassado_closer','fechado_ganho','fechado_perdido','lead_perdido') THEN
      IF l.temperature='quente' AND l.approach_stage IN ('abordado','reabordado') THEN l.pipeline_stage:='pronto_closer';
      ELSIF l.approach_stage<>'nao_abordado' OR l.pipeline_stage='pronto_closer' THEN l.pipeline_stage:='em_qualificacao'; END IF;
    END IF;
    UPDATE public.crm_leads SET temperature=l.temperature,approach_stage=l.approach_stage,pipeline_stage=l.pipeline_stage,
      approached=l.approach_stage IN ('abordado','reabordado'),
      approach_count=approach_count+CASE WHEN p_action='approach' AND l.approach_stage<>'nao_abordado' THEN 1 ELSE 0 END,
      approached_at=CASE WHEN p_action='approach' THEN clock_timestamp() ELSE approached_at END,
      first_contact_at=CASE WHEN p_action='approach' AND l.approach_stage<>'nao_abordado' THEN COALESCE(first_contact_at,clock_timestamp()) ELSE first_contact_at END,
      last_contact_at=CASE WHEN p_action='approach' THEN clock_timestamp() ELSE last_contact_at END,
      closed_at=l.closed_at,closed_by=l.closed_by WHERE id=l.id;
    IF p_action='lose' THEN UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome='lead_perdido' WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed; END IF;
  ELSIF p_action='handoff' THEN
    PERFORM public.crm_require_role('sdr');
    IF l.pipeline_stage NOT IN ('novo','em_qualificacao','pronto_closer','contato_feito','proposta_enviada','negociacao','reativacao') THEN RAISE EXCEPTION 'Lead já repassado ou encerrado' USING ERRCODE='PT409'; END IF;
    v_assignee:=NULLIF(p_data->>'closer_id','')::uuid;
    IF v_assignee IS NOT NULL AND NOT public.crm_user_can(v_assignee,'closer') THEN RAISE EXCEPTION 'Responsável sem capacidade Closer' USING ERRCODE='22023'; END IF;
    UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome='repassado_closer' WHERE lead_id=l.id AND call_type='qualificacao' AND NOT is_completed;
    UPDATE public.crm_leads SET pipeline_stage='repassado_closer',closer_id=v_assignee,sdr_id=COALESCE(sdr_id,auth.uid()),handed_off_at=clock_timestamp(),next_followup_at=NULL WHERE id=l.id;
  ELSIF p_action IN ('claim','assign') THEN
    PERFORM public.crm_require_role('closer');
    IF l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'Lead fora da fila Closer' USING ERRCODE='PT409'; END IF;
    IF p_action='claim' THEN
      IF l.closer_id IS NOT NULL THEN RAISE EXCEPTION 'Lead já assumido. Atualize a fila.' USING ERRCODE='PT409'; END IF;
      v_assignee:=auth.uid();
    ELSE
      IF NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente responsável ou executive pode atribuir' USING ERRCODE='42501'; END IF;
      v_assignee:=NULLIF(p_data->>'closer_id','')::uuid;
    END IF;
    IF v_assignee IS NOT NULL AND NOT public.crm_user_can(v_assignee,'closer') THEN RAISE EXCEPTION 'Responsável sem capacidade Closer' USING ERRCODE='22023'; END IF;
    IF v_assignee IS NULL AND EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed) THEN RAISE EXCEPTION 'Atribua a call pendente a um responsável' USING ERRCODE='PT409'; END IF;
    UPDATE public.crm_activities SET assigned_to=v_assignee WHERE lead_id=l.id AND call_type='fechamento_closer' AND NOT is_completed;
    UPDATE public.crm_leads SET closer_id=v_assignee WHERE id=l.id;
  ELSIF p_action IN ('close','return') THEN
    PERFORM public.crm_require_role('closer');
    IF l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'Lead já encerrado ou fora da fila Closer' USING ERRCODE='PT409'; END IF;
    IF NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Assuma o lead antes de registrar o resultado' USING ERRCODE='42501'; END IF;
    v_outcome:=CASE WHEN p_action='return' THEN 'devolvido_sdr' ELSE p_data->>'outcome' END;
    IF v_outcome IS NULL OR v_outcome NOT IN ('venda_concluida','venda_perdida','followup','devolvido_sdr') THEN RAISE EXCEPTION 'Selecione o resultado do fechamento' USING ERRCODE='22023'; END IF;
    IF v_outcome='followup' THEN
      v_when:=(p_data->>'next_at')::timestamptz;
      IF v_when IS NULL OR NOT isfinite(v_when) OR v_when<=now() THEN RAISE EXCEPTION 'Follow-up exige uma próxima data futura' USING ERRCODE='22023'; END IF;
    END IF;
    UPDATE public.crm_activities SET is_completed=true,completed_at=clock_timestamp(),outcome=v_outcome WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed;
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,outcome,is_completed,completed_at)
      VALUES(l.id,auth.uid(),'fechamento','Resultado do fechamento',v_note,v_outcome,true,clock_timestamp());
    v_note:=NULL;
    UPDATE public.crm_leads SET pipeline_stage=CASE v_outcome WHEN 'venda_concluida' THEN 'fechado_ganho' WHEN 'venda_perdida' THEN 'fechado_perdido' WHEN 'devolvido_sdr' THEN 'em_qualificacao' ELSE 'repassado_closer' END,
      closer_id=CASE WHEN v_outcome='devolvido_sdr' THEN NULL ELSE COALESCE(closer_id,auth.uid()) END,
      closed_at=CASE WHEN v_outcome IN ('venda_concluida','venda_perdida') THEN clock_timestamp() ELSE NULL END,
      closed_by=CASE WHEN v_outcome IN ('venda_concluida','venda_perdida') THEN auth.uid() ELSE NULL END,
      next_followup_at=v_when,last_contact_at=clock_timestamp() WHERE id=l.id;
  ELSIF p_action IN ('note','contact','followup') THEN
    IF p_action IN ('note','contact') AND v_note IS NULL THEN RAISE EXCEPTION 'Escreva uma anotação' USING ERRCODE='22023'; END IF;
    IF p_action='followup' THEN
      IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE='PT409'; END IF;
      PERFORM public.crm_require_role(CASE WHEN l.pipeline_stage='repassado_closer' THEN 'closer' ELSE 'sdr' END);
      IF l.pipeline_stage='repassado_closer' AND NOT public.crm_user_can(auth.uid(),'admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o responsável pode agendar retorno' USING ERRCODE='42501'; END IF;
      v_when:=(p_data->>'next_at')::timestamptz;
      IF v_when IS NULL OR NOT isfinite(v_when) OR v_when<=now() THEN RAISE EXCEPTION 'Escolha uma data futura' USING ERRCODE='22023'; END IF;
    END IF;
    UPDATE public.crm_leads SET next_followup_at=CASE WHEN p_action='followup' THEN v_when ELSE next_followup_at END,
      last_contact_at=CASE WHEN p_action='contact' THEN clock_timestamp() ELSE last_contact_at END,
      approach_count=approach_count+CASE WHEN p_action='contact' THEN 1 ELSE 0 END WHERE id=l.id;
  ELSE RAISE EXCEPTION 'Ação não reconhecida' USING ERRCODE='22023'; END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,is_completed,completed_at)
      VALUES(l.id,auth.uid(),'contexto_vida',CASE WHEN p_action='contact' THEN 'Tentativa de contato' ELSE 'Anotação' END,v_note,true,clock_timestamp());
  END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id;
  RETURN l;
END; $crm_transition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
