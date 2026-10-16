-- Agenda dos Closers, botão do Meet no CRM e venda livre com sinal (pedido do dono em 2026-10-16).
--
-- 1) Link da reunião por call. O "Entrar no Google Meet" vinha do sincronismo com o Google Agenda e ficava na tela o tempo
--    todo. Agora o Closer cola o link de cada call na /agenda (crm_activities.meeting_link, gravado por
--    crm_set_call_meeting_link); o CRM só mostra o botão no horário da call e ele some quando a call é encerrada.
--
-- 2) Resultado da call na /agenda: Vendeu, Não vendeu, Pendente ou Sinal. Os três primeiros já existiam no fechamento do
--    Closer (crm_transition 'close': venda_concluida, venda_perdida, followup com data de retorno). O novo é 'sinal': o
--    lead pagou um valor para segurar a vaga. A call termina com o resultado 'sinal', o valor fica no lead
--    (crm_leads.deposit_amount/deposit_at) e na linha do tempo, e o lead SEGUE com o Closer (repassado_closer) até a venda
--    ser registrada. Para a Arena, 'sinal' não é "venda não concluída": conta só como call realizada.
--
-- 3) Venda livre em /vendas. Produto e ticket do catálogo passam a ser opcionais e o valor é o que a pessoa digitar (a
--    venda continua nascendo pendente e passando pela aprovação do executive); nome, WhatsApp e e-mail do comprador
--    podem ficar em branco. Nova forma de pagamento: 'integral' ou 'sinal' com o valor do sinal. Decisão do dono: no
--    faturamento (e, como sempre, na comissão e na Arena) a venda conta pelo VALOR TOTAL; o sinal é informação de
--    pagamento ("já pago" / "falta receber").
--
-- Os corpos de crm_transition e enforce_catalog_sale partem do que está em produção em 2026-10-16; só mudam as linhas
-- marcadas com "-- NOVO".
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Link da reunião
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.crm_activities ADD COLUMN IF NOT EXISTS meeting_link text;
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_activities_meeting_link CHECK (
  meeting_link IS NULL OR (char_length(meeting_link) <= 2048 AND meeting_link ~ '^https://[^/[:space:]]+[^[:space:]]*$')
);
COMMENT ON COLUMN public.crm_activities.meeting_link IS
  'Link da reunião (Google Meet) colado pelo Closer na /agenda. O CRM mostra "Entrar na call" só entre o início e o fim da call, e nunca depois de encerrada.';

CREATE OR REPLACE FUNCTION public.crm_set_call_meeting_link(p_activity_id uuid, p_link text, p_expected_revision timestamptz)
 RETURNS public.crm_activities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.crm_activities; l public.crm_leads; v_lead uuid; v_link text;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT lead_id INTO v_lead FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  -- Mesma ordem de travas de crm_transition e update_crm_call: o lead primeiro, depois a call.
  SELECT * INTO l FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO c FROM public.crm_activities WHERE id=p_activity_id AND call_type IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call não encontrada' USING ERRCODE='P0002'; END IF;
  IF c.is_completed OR c.cancelled_at IS NOT NULL OR c.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'Call encerrada: o link não é mais usado' USING ERRCODE='PT409';
  END IF;
  IF p_expected_revision IS DISTINCT FROM c.updated_at THEN
    RAISE EXCEPTION 'Call alterada. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF NOT (public.crm_user_can(auth.uid(),'executive') OR c.assigned_to=auth.uid() OR c.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Somente o Closer da call, quem a agendou ou a gestão coloca o link' USING ERRCODE='42501';
  END IF;
  v_link:=NULLIF(btrim(p_link),'');
  -- "meet.google.com/abc-defg-hij" colado sem o https:// também vale.
  IF v_link IS NOT NULL AND v_link !~* '^[a-z][a-z0-9+.-]*://' THEN v_link:='https://'||v_link; END IF;
  IF v_link IS NOT NULL AND (char_length(v_link)>2048 OR v_link !~ '^https://[^/[:space:]]+[^[:space:]]*$') THEN
    RAISE EXCEPTION 'Link inválido: cole o endereço https da reunião' USING ERRCODE='22023';
  END IF;
  UPDATE public.crm_activities SET meeting_link=v_link WHERE id=c.id RETURNING * INTO c;
  RETURN c;
END $function$;
REVOKE ALL ON FUNCTION public.crm_set_call_meeting_link(uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_call_meeting_link(uuid,text,timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Resultado "sinal"
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.crm_activities DROP CONSTRAINT crm_call_input;
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_call_input CHECK (((call_type IS NULL) OR ((call_type = ANY (ARRAY['qualificacao'::text, 'fechamento_closer'::text])) AND (activity_type = 'reuniao'::text) AND (assigned_to IS NOT NULL) AND (scheduled_at IS NOT NULL) AND isfinite(scheduled_at) AND (((NOT is_completed) AND (outcome IS NULL) AND (completed_at IS NULL)) OR (is_completed AND (completed_at IS NOT NULL) AND (outcome = ANY (ARRAY['avancou'::text, 'followup_sdr'::text, 'lead_perdido'::text, 'venda_concluida'::text, 'venda_perdida'::text, 'devolvido_sdr'::text, 'followup'::text, 'repassado_closer'::text, 'sinal'::text])))))));

ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS deposit_amount numeric(12,2);
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS deposit_at timestamptz;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_deposit CHECK (
  (deposit_amount IS NULL AND deposit_at IS NULL)
  OR (deposit_amount > 0 AND deposit_amount <= 100000000 AND deposit_at IS NOT NULL)
);
COMMENT ON COLUMN public.crm_leads.deposit_amount IS
  'Sinal pago pelo lead para segurar a vaga (resultado "sinal" da call na /agenda). O lead segue com o Closer até a venda ser registrada; /vendas já abre com esse valor.';

CREATE OR REPLACE FUNCTION public.crm_transition(p_lead_id uuid, p_action text, p_expected_version bigint, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS crm_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE l public.crm_leads; c public.crm_activities; d public.crm_leads; v_when timestamptz; v_assignee uuid; v_outcome text; v_note text;
  v_deposit numeric; -- NOVO
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
      IF NOT public.crm_user_can(auth.uid(),'executive') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente responsável ou executive pode atribuir' USING ERRCODE='42501'; END IF;
      v_assignee:=NULLIF(p_data->>'closer_id','')::uuid;
    END IF;
    IF v_assignee IS NOT NULL AND NOT public.crm_user_can(v_assignee,'closer') THEN RAISE EXCEPTION 'Responsável sem capacidade Closer' USING ERRCODE='22023'; END IF;
    IF v_assignee IS NULL AND EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed) THEN RAISE EXCEPTION 'Atribua a call pendente a um responsável' USING ERRCODE='PT409'; END IF;
    UPDATE public.crm_activities SET assigned_to=v_assignee WHERE lead_id=l.id AND call_type='fechamento_closer' AND NOT is_completed;
    UPDATE public.crm_leads SET closer_id=v_assignee WHERE id=l.id;
  ELSIF p_action IN ('close','return') THEN
    PERFORM public.crm_require_role('closer');
    IF l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'Lead já encerrado ou fora da fila Closer' USING ERRCODE='PT409'; END IF;
    IF NOT public.crm_user_can(auth.uid(),'executive') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Assuma o lead antes de registrar o resultado' USING ERRCODE='42501'; END IF;
    v_outcome:=CASE WHEN p_action='return' THEN 'devolvido_sdr' ELSE p_data->>'outcome' END;
    IF v_outcome IS NULL OR v_outcome NOT IN ('venda_concluida','venda_perdida','followup','devolvido_sdr','sinal') THEN RAISE EXCEPTION 'Selecione o resultado do fechamento' USING ERRCODE='22023'; END IF; -- NOVO: 'sinal'
    IF v_outcome='followup' THEN
      v_when:=(p_data->>'next_at')::timestamptz;
      IF v_when IS NULL OR NOT isfinite(v_when) OR v_when<=now() THEN RAISE EXCEPTION 'Follow-up exige uma próxima data futura' USING ERRCODE='22023'; END IF;
    END IF;
    -- NOVO: o sinal exige o valor pago (reais com até 2 casas, ponto decimal).
    IF v_outcome='sinal' THEN
      IF COALESCE(p_data->>'deposit_amount','') !~ '^[0-9]{1,9}([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Informe o valor do sinal' USING ERRCODE='22023'; END IF;
      v_deposit:=(p_data->>'deposit_amount')::numeric;
      IF v_deposit<=0 OR v_deposit>100000000 THEN RAISE EXCEPTION 'Informe o valor do sinal' USING ERRCODE='22023'; END IF;
    END IF;
    UPDATE public.crm_activities SET performed_at=CASE WHEN p_action='close' AND p_data->>'call_performed'='true' AND call_type='fechamento_closer' THEN COALESCE(performed_at,clock_timestamp()) ELSE performed_at END,
   performed_by=CASE WHEN p_action='close' AND p_data->>'call_performed'='true' AND call_type='fechamento_closer' THEN COALESCE(performed_by,auth.uid()) ELSE performed_by END,
   is_completed=true,completed_at=clock_timestamp(),outcome=v_outcome WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed;
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,outcome,is_completed,completed_at)
      VALUES(l.id,auth.uid(),'fechamento','Resultado do fechamento',
        CASE WHEN v_outcome='sinal' THEN concat_ws(E'\n','Sinal pago: R$ '||translate(to_char(v_deposit,'FM999,999,999,990.00'),',.','.,'),v_note) ELSE v_note END, -- NOVO
        v_outcome,true,clock_timestamp());
    v_note:=NULL;
    UPDATE public.crm_leads SET pipeline_stage=CASE v_outcome WHEN 'venda_concluida' THEN 'fechado_ganho' WHEN 'venda_perdida' THEN 'fechado_perdido' WHEN 'devolvido_sdr' THEN 'em_qualificacao' ELSE 'repassado_closer' END,
      closer_id=CASE WHEN v_outcome='devolvido_sdr' THEN NULL ELSE COALESCE(closer_id,auth.uid()) END,
      closed_at=CASE WHEN v_outcome IN ('venda_concluida','venda_perdida') THEN clock_timestamp() ELSE NULL END,
      closed_by=CASE WHEN v_outcome IN ('venda_concluida','venda_perdida') THEN auth.uid() ELSE NULL END,
      deposit_amount=CASE WHEN v_outcome='sinal' THEN v_deposit ELSE deposit_amount END, -- NOVO
      deposit_at=CASE WHEN v_outcome='sinal' THEN clock_timestamp() ELSE deposit_at END, -- NOVO
      next_followup_at=v_when,last_contact_at=clock_timestamp() WHERE id=l.id;
  ELSIF p_action IN ('note','contact','followup') THEN
    IF p_action IN ('note','contact') AND v_note IS NULL THEN RAISE EXCEPTION 'Escreva uma anotação' USING ERRCODE='22023'; END IF;
    IF p_action='followup' THEN
      IF l.pipeline_stage IN ('fechado_ganho','fechado_perdido','lead_perdido') THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE='PT409'; END IF;
      PERFORM public.crm_require_role(CASE WHEN l.pipeline_stage='repassado_closer' THEN 'closer' ELSE 'sdr' END);
      IF l.pipeline_stage='repassado_closer' AND NOT public.crm_user_can(auth.uid(),'executive') AND l.closer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o responsável pode agendar retorno' USING ERRCODE='42501'; END IF;
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
END; $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Venda livre, com sinal
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'integral';
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS deposit_amount numeric(12,2);
ALTER TABLE public.vendas ADD CONSTRAINT vendas_payment CHECK (
  (payment_type = 'integral' AND deposit_amount IS NULL)
  OR (payment_type = 'sinal' AND deposit_amount > 0 AND deposit_amount <= valor_venda)
);
COMMENT ON COLUMN public.vendas.payment_type IS
  'integral: pago por inteiro; sinal: o comprador pagou deposit_amount e falta o restante. O faturamento, a comissão e a Arena contam valor_venda (o valor total) nos dois casos.';

-- Comprador opcional: em branco ou, se preenchido, válido como antes. NOT VALID como a regra anterior (linhas antigas não são relidas).
ALTER TABLE public.vendas DROP CONSTRAINT vendas_input_secure;
ALTER TABLE public.vendas ADD CONSTRAINT vendas_input_secure CHECK (
  valor_venda > 0 AND valor_venda <= 100000000
  AND char_length(btrim(nome_produto)) BETWEEN 1 AND 160
  AND (btrim(nome_comprador) = '' OR char_length(btrim(nome_comprador)) BETWEEN 2 AND 160)
  AND (btrim(whatsapp_comprador) = '' OR char_length(btrim(whatsapp_comprador)) BETWEEN 8 AND 32)
  AND char_length(email_comprador) <= 254
  AND (email_comprador = '' OR email_comprador ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
  AND (consideracoes_gerais IS NULL OR char_length(consideracoes_gerais) <= 5000)
) NOT VALID;

-- Produto e ticket deixam de ser obrigatórios na inserção (o resto da política fica igual).
DROP POLICY vendas_insert ON public.vendas;
CREATE POLICY vendas_insert ON public.vendas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (
  (auth.uid() IS NOT NULL) AND (user_id = auth.uid()) AND (approval_status = 'pendente'::text)
  AND (COALESCE(commission_amount, (0)::numeric) = (0)::numeric) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL)
  AND (rejection_reason IS NULL) AND (NOT withdrawn) AND (withdrawal_id IS NULL) AND (withdrawn_at IS NULL)
);

CREATE OR REPLACE FUNCTION public.enforce_catalog_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_product public.products; v_ticket public.product_tickets;
BEGIN
  PERFORM public.dashboard_require_access();
  IF TG_OP = 'UPDATE' THEN
    IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
      OR NEW.nome_produto IS DISTINCT FROM OLD.nome_produto OR NEW.ticket_name IS DISTINCT FROM OLD.ticket_name
      OR NEW.valor_venda IS DISTINCT FROM OLD.valor_venda THEN
      IF current_setting('dashboard.sale_edit',true) IS DISTINCT FROM OLD.id::text THEN
        RAISE EXCEPTION 'Utilize Editar venda no módulo Vendas.' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- NOVO: catálogo opcional. Ticket escolhido sem produto leva o produto do ticket.
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.product_tickets WHERE id = NEW.ticket_id FOR SHARE;
    IF v_ticket.id IS NULL OR NOT v_ticket.active THEN
      RAISE EXCEPTION 'Ticket não está disponível. Atualize o catálogo.' USING ERRCODE = '22023';
    END IF;
    NEW.product_id := COALESCE(NEW.product_id, v_ticket.product_id);
  END IF;
  IF NEW.product_id IS NOT NULL THEN
    SELECT * INTO v_product FROM public.products WHERE id = NEW.product_id FOR SHARE;
    IF v_product.id IS NULL OR NOT v_product.active OR (v_ticket.id IS NOT NULL AND v_ticket.product_id IS DISTINCT FROM NEW.product_id) THEN
      RAISE EXCEPTION 'Produto ou ticket não está disponível. Atualize o catálogo.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- NOVO: o valor é o digitado (sem ticket, ou diferente do ticket). Sem valor, vale o preço do ticket.
  NEW.valor_venda := COALESCE(NEW.valor_venda, v_ticket.price);
  NEW.nome_produto := COALESCE(v_product.name, NULLIF(btrim(NEW.nome_produto), ''), 'Produto não informado');
  NEW.ticket_name := v_ticket.name;
  -- NOVO: comprador opcional (em branco quando não informado).
  NEW.nome_comprador := COALESCE(btrim(NEW.nome_comprador), '');
  NEW.whatsapp_comprador := COALESCE(btrim(NEW.whatsapp_comprador), '');
  NEW.email_comprador := COALESCE(btrim(NEW.email_comprador), '');
  -- NOVO: pagamento integral não guarda sinal.
  NEW.payment_type := COALESCE(NEW.payment_type, 'integral');
  IF NEW.payment_type = 'integral' THEN NEW.deposit_amount := NULL; END IF;
  RETURN NEW;
END;
$function$;

-- O quadro de vendas (aprovação do executive, Vendas do time) mostra a forma de pagamento e o sinal.
CREATE OR REPLACE FUNCTION public.get_sales_board(p_status text DEFAULT 'pendente'::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_result jsonb; v_exec boolean;
BEGIN
  PERFORM public.dashboard_require_access();
  v_exec := public.is_executive(auth.uid());
  IF p_status NOT IN ('pendente', 'aprovada', 'rejeitada', 'cancelada', 'estornada', 'all')
    OR (p_status IN ('rejeitada','cancelada','estornada') AND NOT v_exec) THEN
    RAISE EXCEPTION 'Filtro invalido';
  END IF;
  WITH base AS (
    SELECT v.*, COALESCE(p.display_name, 'Vendedor') AS seller_name,
      p.avatar_url AS seller_avatar,
      COALESCE(r.display_name, 'Executivo') AS reviewer_name
    FROM public.vendas v
    LEFT JOIN public.profiles p ON p.user_id = v.user_id
    LEFT JOIN public.profiles r ON r.user_id = v.reviewed_by
    WHERE (v_exec OR v.approval_status IN ('pendente', 'aprovada'))
      AND (
        COALESCE(p_search, '') = '' OR
        strpos(lower(COALESCE(p.display_name, '') || ' ' || v.nome_produto || ' ' || COALESCE(v.ticket_name, '')), lower(p_search)) > 0
      )
  ), filtered AS (
    SELECT * FROM base WHERE p_status = 'all' OR approval_status = p_status
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN p_status = 'pendente' THEN created_at END ASC,
      CASE WHEN p_status = 'aprovada' THEN COALESCE(reviewed_at, created_at) ELSE created_at END DESC,
      id
      LIMIT greatest(1, least(COALESCE(p_page_size, 12), 50))
      OFFSET greatest(0, COALESCE(p_page, 0)) * greatest(1, least(COALESCE(p_page_size, 12), 50))
  ) SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'user_id', user_id,
        'seller_name', seller_name,
        'seller_avatar', seller_avatar,
        'nome_produto', nome_produto,
        'ticket_name', ticket_name,
        'valor_venda', valor_venda,
        'payment_type', payment_type, -- NOVO
        'deposit_amount', deposit_amount, -- NOVO
        'approval_status', approval_status,
        'created_at', created_at,
        'reviewed_at', reviewed_at
      ) || CASE WHEN v_exec THEN jsonb_build_object(
        'updated_at', updated_at,
        'nome_comprador', nome_comprador,
        'email_comprador', email_comprador,
        'whatsapp_comprador', whatsapp_comprador,
        'commission_amount', commission_amount,
        'rejection_reason', rejection_reason,
        'reviewer_name', reviewer_name,
        'withdrawn', withdrawn,
        'withdrawal_id', withdrawal_id,
        'consideracoes_gerais', consideracoes_gerais
      ) ELSE '{}'::jsonb END
    ) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'summary', (SELECT jsonb_build_object(
      'pending', count(*) FILTER (WHERE approval_status = 'pendente'),
      'approved', count(*) FILTER (WHERE approval_status = 'aprovada'),
      'rejected', count(*) FILTER (WHERE approval_status = 'rejeitada'),
      'pending_value', COALESCE(sum(valor_venda) FILTER (WHERE approval_status = 'pendente'), 0),
      'approved_value', COALESCE(sum(valor_venda) FILTER (WHERE approval_status = 'aprovada'), 0),
      'overdue', count(*) FILTER (WHERE approval_status = 'pendente' AND created_at < now() - interval '24 hours')
    ) FROM base),
    'fetched_at', clock_timestamp()
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Conferência: se qualquer uma falhar, a migração inteira é desfeita.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='vendas' AND policyname='vendas_insert'
                   AND with_check NOT LIKE '%product_id%') THEN
    RAISE EXCEPTION 'FAIL política de inserção de vendas';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.crm_set_call_meeting_link(uuid,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL permissão do link da reunião';
  END IF;
  IF (SELECT count(*) FROM public.vendas WHERE payment_type <> 'integral' OR deposit_amount IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'FAIL vendas antigas devem ficar como pagamento integral';
  END IF;
END $$;

UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp() WHERE topic IN ('crm', 'sales');
NOTIFY pgrst, 'reload schema';
COMMIT;
