-- Isolated fixtures. The verification runner always wraps this file in a transaction and rolls back.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-remarketing-qa-'||n||'@example.invalid',
  jsonb_build_object('display_name','CRM Remarketing QA '||n),'{}',now(),now()
FROM generate_series(1,6) n;
UPDATE public.registration_requests
SET status='approved', reviewed_at=clock_timestamp()
WHERE user_id::text LIKE 'ce000000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ce000000-0000-4000-8000-000000000001','super_admin',true),
('ce000000-0000-4000-8000-000000000002','executive',true),
('ce000000-0000-4000-8000-000000000003','sdr',true),
('ce000000-0000-4000-8000-000000000004','sdr',true),
('ce000000-0000-4000-8000-000000000005','closer',true);
CREATE TEMP TABLE crm_remarketing_qa_state(qualified_id uuid,negative_id uuid,negative_version bigint);
GRANT ALL ON crm_remarketing_qa_state TO authenticated;
CREATE TEMP TABLE crm_remarketing_qa_calls(id uuid,updated_at timestamptz,actor text);
GRANT ALL ON crm_remarketing_qa_calls TO authenticated;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.crm_can('admin') OR NOT public.crm_can('executive') OR NOT public.crm_can('sdr') OR NOT public.crm_can('closer') THEN
    RAISE EXCEPTION 'FAIL: executive boundaries';
  END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT public.crm_can('admin') OR NOT public.crm_can('executive') THEN RAISE EXCEPTION 'FAIL: super admin capabilities'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.crm_can('sdr') OR public.crm_can('closer') OR NOT public.crm_can('sales') THEN RAISE EXCEPTION 'FAIL: seller boundaries'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE l public.crm_leads; c public.crm_activities;
BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Responsável qualificado','Atleta qualificado','11999999991') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid(),'Call SDR QA');
  c:=public.resolve_sdr_qualification_call(c.id,'avancou',c.updated_at,jsonb_build_object(
    'income_range','5k_10k','goal','Evolução esportiva','decision_maker','pais_responsaveis',
    'timeline','ate_30_dias','summary','Família engajada e pronta para conversar com o Closer'
  ));
  SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
  IF l.pipeline_stage<>'pronto_closer' OR l.qualification_income_range<>'5k_10k'
     OR l.qualification_completed_by<>auth.uid() OR NOT c.is_completed THEN
    RAISE EXCEPTION 'FAIL: qualified result';
  END IF;

  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Responsável negativo','Atleta negativo','11999999992') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid(),'Call negativa QA');
  c:=public.resolve_sdr_qualification_call(c.id,'lead_perdido',c.updated_at,jsonb_build_object(
    'income_range','ate_3k','decision_maker','pais_responsaveis','timeline','acima_90_dias',
    'goal','Aguardar novo momento financeiro','summary','Sem orçamento agora, mas autorizou novo contato',
    'negative_reason','Sem orçamento no momento','next_at',(now()+interval '30 days')::text
  ));
  SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
  IF l.pipeline_stage<>'lead_perdido' OR l.remarketing_status<>'scheduled'
     OR l.remarketing_next_at IS NULL OR l.negative_reason<>'Sem orçamento no momento' THEN
    RAISE EXCEPTION 'FAIL: negative remarketing entry';
  END IF;
  INSERT INTO crm_remarketing_qa_state VALUES(
    (SELECT id FROM public.crm_leads WHERE name='Responsável qualificado'),l.id,l.version
  );
END; $$;
RESET ROLE;

-- The SDR queue is shared: another SDR and a Closer can register a pending
-- qualification result. Neither receives administrative privileges, and SDR
-- still cannot operate as a Closer.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  IF NOT public.crm_can('sdr') OR public.crm_can('closer') THEN
    RAISE EXCEPTION 'FAIL: SDR acquired Closer capability';
  END IF;
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Qualificação compartilhada SDR','Atleta SDR','11999999993') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid());
  INSERT INTO crm_remarketing_qa_calls VALUES(c.id,c.updated_at,'sdr');
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Qualificação compartilhada Closer','Atleta Closer','11999999994') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid());
  INSERT INTO crm_remarketing_qa_calls VALUES(c.id,c.updated_at,'closer');
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE call_row record; BEGIN
  SELECT * INTO call_row FROM crm_remarketing_qa_calls WHERE actor='sdr';
  BEGIN
    PERFORM public.resolve_sdr_qualification_call(call_row.id,'followup_sdr',call_row.updated_at,
      jsonb_build_object('summary','Seller tentou concluir uma call SDR',
        'next_at',(now()+interval '2 days')::text));
    RAISE EXCEPTION 'FAIL: Seller concluded SDR qualification';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_activities; call_row record; BEGIN
  SELECT * INTO call_row FROM crm_remarketing_qa_calls WHERE actor='sdr';
  c:=public.resolve_sdr_qualification_call(call_row.id,'followup_sdr',call_row.updated_at,
    jsonb_build_object('summary','Outro SDR concluiu a qualificação da fila compartilhada',
      'next_at',(now()+interval '2 days')::text));
  IF NOT c.is_completed OR c.outcome<>'followup_sdr' THEN
    RAISE EXCEPTION 'FAIL: shared SDR qualification result';
  END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_activities; call_row record; BEGIN
  IF NOT public.crm_can('sdr') OR NOT public.crm_can('closer')
     OR public.crm_can('executive') OR public.crm_can('admin') THEN
    RAISE EXCEPTION 'FAIL: Closer capability inheritance';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_call_assignees()
    WHERE user_id=auth.uid() AND role='sdr') THEN
    RAISE EXCEPTION 'FAIL: Closer missing from SDR assignees';
  END IF;
  SELECT * INTO call_row FROM crm_remarketing_qa_calls WHERE actor='closer';
  c:=public.resolve_sdr_qualification_call(call_row.id,'followup_sdr',call_row.updated_at,
    jsonb_build_object('summary','Closer concluiu a qualificação da fila compartilhada',
      'next_at',(now()+interval '2 days')::text));
  IF NOT c.is_completed OR c.outcome<>'followup_sdr' THEN
    RAISE EXCEPTION 'FAIL: Closer qualification result';
  END IF;
END; $$;
RESET ROLE;

-- Another SDR can read the shared queue but cannot mutate a lead owned by a colleague.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; BEGIN
  SELECT * INTO s FROM crm_remarketing_qa_state;
  BEGIN
    PERFORM public.crm_update_remarketing(s.negative_id,s.negative_version,'contacted',now()+interval '40 days','Contato indevido');
    RAISE EXCEPTION 'FAIL: other SDR updated remarketing';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END; $$;
RESET ROLE;

-- Executive operates both desks and can correct a colleague's follow-up without becoming admin.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_remarketing_qa_state;
  l:=public.crm_update_remarketing(s.negative_id,s.negative_version,'contacted',now()+interval '45 days','Executive registrou a tentativa e o próximo passo');
  IF l.remarketing_status<>'nurturing' OR l.remarketing_attempt_count<>1 OR l.remarketing_last_contact_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: executive remarketing correction';
  END IF;
  UPDATE crm_remarketing_qa_state SET negative_version=l.version;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_remarketing_qa_state;
  l:=public.crm_update_remarketing(s.negative_id,s.negative_version,'reactivate',NULL,'Lead voltou a demonstrar interesse');
  IF l.pipeline_stage<>'em_qualificacao' OR l.remarketing_status<>'reactivated' OR l.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: remarketing reactivation';
  END IF;
END; $$;
