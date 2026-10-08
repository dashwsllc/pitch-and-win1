-- Follow-up: a fila de leads que não compraram sempre foi follow-up (retomada do contato), não remarketing.
-- 1) Troca o nome em tudo o que carregava o termo antigo: colunas, restrição, índice, gatilho, funções e o histórico já gravado.
-- 2) A fila passa a ser compartilhada: qualquer SDR e qualquer Closer (Executive e Super Admin incluídos) acompanha qualquer
--    lead em follow-up. Antes só o SDR responsável (ou o Executive) podia agir, então o Closer que perdia a venda não
--    conseguia retomar o próprio lead. Seller continua sem acesso.
-- Os valores guardados (pending, scheduled, nurturing, reactivated, do_not_contact) não mudam.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Renomeações. São só metadados: os dados, o índice e a restrição acompanham a coluna.
ALTER TABLE public.crm_leads RENAME COLUMN remarketing_status TO followup_status;
ALTER TABLE public.crm_leads RENAME COLUMN remarketing_next_at TO followup_next_at;
ALTER TABLE public.crm_leads RENAME COLUMN remarketing_last_contact_at TO followup_last_contact_at;
ALTER TABLE public.crm_leads RENAME COLUMN remarketing_attempt_count TO followup_attempt_count;
ALTER TABLE public.crm_leads RENAME CONSTRAINT crm_qualification_remarketing_input TO crm_qualification_followup_input;
ALTER INDEX public.crm_remarketing_queue RENAME TO crm_followup_queue;
ALTER TRIGGER zz_crm_prepare_remarketing_state ON public.crm_leads RENAME TO zz_crm_prepare_followup_state;
-- O nome do gatilho continua depois de zz_crm_capture_result, então a ordem de execução não muda.
ALTER FUNCTION public.crm_prepare_remarketing_state() RENAME TO crm_prepare_followup_state;
-- A renomeação preserva dono, SECURITY DEFINER e permissões; o corpo é reescrito logo abaixo.
ALTER FUNCTION public.crm_update_remarketing(uuid,bigint,text,timestamptz,text) RENAME TO crm_update_followup;

COMMENT ON COLUMN public.crm_leads.followup_status IS
  'Situação do follow-up do lead que não comprou (lead_perdido ou fechado_perdido): pending, scheduled, nurturing, reactivated ou do_not_contact.';
COMMENT ON COLUMN public.crm_leads.followup_next_at IS
  'Data e hora do próximo follow-up do lead; também é copiada em next_followup_at para a ordenação e os avisos do CRM.';
COMMENT ON COLUMN public.crm_leads.followup_last_contact_at IS
  'Último contato de follow-up registrado com o lead.';
COMMENT ON COLUMN public.crm_leads.followup_attempt_count IS
  'Quantidade de contatos de follow-up já registrados.';

-- 2. Estado inicial do follow-up quando o lead entra numa etapa negativa (mesma lógica, colunas novas).
CREATE OR REPLACE FUNCTION public.crm_prepare_followup_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.pipeline_stage IN ('lead_perdido','fechado_perdido')
     AND (TG_OP='INSERT' OR OLD.pipeline_stage IS DISTINCT FROM NEW.pipeline_stage) THEN
    IF NEW.followup_status IS NULL OR NEW.followup_status='reactivated' THEN
      NEW.followup_status:='pending'; NEW.followup_next_at:=NULL;
    END IF;
    NEW.negative_reason:=COALESCE(NEW.negative_reason,
      CASE WHEN NEW.pipeline_stage='fechado_perdido' THEN 'Venda recusada no fechamento' ELSE 'Negativa registrada' END);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Acompanhamento do follow-up. Qualquer SDR ou Closer age em qualquer lead da fila. Quem registra o contato não
--    vira o SDR do lead: o sdr_id só é preenchido (quando estava vazio) por quem tem o papel SDR, como antes.
CREATE OR REPLACE FUNCTION public.crm_update_followup(
  p_lead_id uuid,
  p_expected_version bigint,
  p_action text,
  p_next_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.crm_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  l public.crm_leads;
  v_note text := NULLIF(btrim(p_note),'');
  v_title text;
  v_claims_sdr boolean;
BEGIN
  IF NOT (public.crm_user_can(auth.uid(),'sdr') OR public.crm_user_can(auth.uid(),'closer')) THEN
    RAISE EXCEPTION 'Sua função não permite esta ação no CRM' USING ERRCODE='42501';
  END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN
    RAISE EXCEPTION 'Lead alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF l.pipeline_stage NOT IN ('lead_perdido','fechado_perdido') THEN
    RAISE EXCEPTION 'Lead fora da fila de follow-up' USING ERRCODE='PT409';
  END IF;
  IF p_action NOT IN ('schedule','contacted','reactivate','do_not_contact') THEN
    RAISE EXCEPTION 'Ação de follow-up inválida' USING ERRCODE='22023';
  END IF;
  IF p_action IN ('schedule','contacted')
     AND (p_next_at IS NULL OR NOT isfinite(p_next_at) OR p_next_at<=now()) THEN
    RAISE EXCEPTION 'Escolha uma próxima data futura' USING ERRCODE='22023';
  END IF;
  IF p_action IN ('contacted','do_not_contact') AND (v_note IS NULL OR char_length(v_note)<3) THEN
    RAISE EXCEPTION 'Registre o resultado do contato' USING ERRCODE='22023';
  END IF;
  IF char_length(COALESCE(v_note,''))>5000 THEN
    RAISE EXCEPTION 'Anotação excede 5000 caracteres' USING ERRCODE='22023';
  END IF;

  v_title := CASE p_action
    WHEN 'schedule' THEN 'Follow-up agendado'
    WHEN 'contacted' THEN 'Contato de follow-up realizado'
    WHEN 'reactivate' THEN 'Lead reativado pelo follow-up'
    ELSE 'Follow-up encerrado — não contatar'
  END;
  v_claims_sdr := EXISTS(
    SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='sdr'
  );
  UPDATE public.crm_leads
  SET sdr_id=COALESCE(sdr_id,CASE WHEN v_claims_sdr THEN auth.uid() END),
      followup_status=CASE p_action
        WHEN 'schedule' THEN 'scheduled'
        WHEN 'contacted' THEN 'nurturing'
        WHEN 'reactivate' THEN 'reactivated'
        ELSE 'do_not_contact'
      END,
      followup_next_at=CASE WHEN p_action IN ('schedule','contacted') THEN p_next_at ELSE NULL END,
      followup_last_contact_at=CASE WHEN p_action='contacted' THEN clock_timestamp() ELSE followup_last_contact_at END,
      followup_attempt_count=followup_attempt_count+CASE WHEN p_action='contacted' THEN 1 ELSE 0 END,
      pipeline_stage=CASE WHEN p_action='reactivate' THEN 'em_qualificacao' ELSE pipeline_stage END,
      next_followup_at=CASE WHEN p_action IN ('schedule','contacted') THEN p_next_at ELSE NULL END,
      closed_at=CASE WHEN p_action='reactivate' THEN NULL ELSE closed_at END,
      closed_by=CASE WHEN p_action='reactivate' THEN NULL ELSE closed_by END,
      last_contact_at=CASE WHEN p_action='contacted' THEN clock_timestamp() ELSE last_contact_at END
  WHERE id=l.id
  RETURNING * INTO l;
  INSERT INTO public.crm_activities(
    lead_id,user_id,activity_type,title,description,outcome,is_completed,completed_at,new_state
  ) VALUES(
    l.id,auth.uid(),'followup',v_title,v_note,p_action,true,clock_timestamp(),
    jsonb_build_object('action',p_action,'next_at',p_next_at,'status',l.followup_status)
  );
  RETURN l;
END;
$$;

COMMENT ON FUNCTION public.crm_update_followup(uuid,bigint,text,timestamptz,text) IS
  'Acompanha um lead da fila de follow-up. Qualquer SDR ou Closer (Executive e Super Admin incluídos) pode agir em qualquer lead da fila.';

-- 4. Funções que só citavam as colunas ou o termo antigo: reaplica a definição que está no banco com os nomes novos,
--    para não divergir da lógica em produção. Se sobrar qualquer "remarketing", a migration inteira é desfeita.
DO $rename_followup_in_functions$
DECLARE
  signature text;
  definition text;
  patched text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.crm_mark_negative(uuid,bigint,text,timestamptz,text)',
    'public.crm_reopen_result(uuid,bigint,text,uuid,timestamptz,text)',
    'public.resolve_sdr_qualification_call(uuid,text,timestamptz,jsonb)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
    IF definition IS NULL THEN
      RAISE EXCEPTION 'Função obrigatória ausente: %', signature;
    END IF;
    patched := replace(definition, 'remarketing_', 'followup_');
    patched := replace(patched, 'Agende o primeiro follow-up de remarketing', 'Agende o primeiro follow-up');
    patched := replace(patched, 'enviar este lead ao remarketing', 'enviar este lead ao follow-up');
    patched := replace(patched, '''remarketing'',''Negativa enviada ao remarketing''', '''followup'',''Negativa enviada ao follow-up''');
    IF patched = definition THEN
      RAISE EXCEPTION 'Nenhum termo de remarketing localizado em %', signature;
    END IF;
    IF patched ILIKE '%remarketing%' THEN
      RAISE EXCEPTION 'Ainda há "remarketing" em %', signature;
    END IF;
    EXECUTE patched;
  END LOOP;
END;
$rename_followup_in_functions$;

-- 5. Histórico já gravado: os registros da fila passam a usar o tipo e os títulos novos. A guarda de autoria exige um
--    usuário autenticado e a migration roda sem sessão; ela é desligada só neste UPDATE (e a transação desfaz tudo se falhar).
ALTER TABLE public.crm_activities DISABLE TRIGGER security_guard_crm_activity;
UPDATE public.crm_activities
SET activity_type='followup',
    title=CASE title
      WHEN 'Negativa enviada ao remarketing' THEN 'Negativa enviada ao follow-up'
      WHEN 'Follow-up de remarketing agendado' THEN 'Follow-up agendado'
      WHEN 'Contato de remarketing realizado' THEN 'Contato de follow-up realizado'
      WHEN 'Lead reativado pelo remarketing' THEN 'Lead reativado pelo follow-up'
      WHEN 'Remarketing encerrado — não contatar' THEN 'Follow-up encerrado — não contatar'
      ELSE title
    END
WHERE activity_type='remarketing';
ALTER TABLE public.crm_activities ENABLE TRIGGER security_guard_crm_activity;

DO $assert_no_remarketing_left$
BEGIN
  IF EXISTS(SELECT 1 FROM public.crm_activities WHERE activity_type='remarketing' OR title ILIKE '%remarketing%') THEN
    RAISE EXCEPTION 'Ainda há registros do histórico com o termo antigo';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name ILIKE '%remarketing%') THEN
    RAISE EXCEPTION 'Ainda há colunas com o termo antigo';
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND (p.proname ILIKE '%remarketing%'
        OR CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ILIKE '%remarketing%' ELSE false END)
  ) THEN
    RAISE EXCEPTION 'Ainda há funções com o termo antigo';
  END IF;
END;
$assert_no_remarketing_left$;

REVOKE ALL ON FUNCTION public.crm_update_followup(uuid,bigint,text,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_prepare_followup_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_followup(uuid,bigint,text,timestamptz,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
