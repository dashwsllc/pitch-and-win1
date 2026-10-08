-- Isolated fixtures. The verification runner always wraps this file in a transaction and rolls back.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-followup-qa-'||n||'@example.invalid',
  jsonb_build_object('display_name','CRM Follow-up QA '||n),'{}',now(),now()
FROM generate_series(1,7) n;
UPDATE public.registration_requests
SET status='approved', reviewed_at=clock_timestamp()
WHERE user_id::text LIKE 'ce000000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ce000000-0000-4000-8000-000000000001','super_admin',true),
('ce000000-0000-4000-8000-000000000002','executive',true),
('ce000000-0000-4000-8000-000000000003','sdr',true),
('ce000000-0000-4000-8000-000000000004','sdr',true),
('ce000000-0000-4000-8000-000000000005','closer',true),
('ce000000-0000-4000-8000-000000000007','closer',true);
CREATE TEMP TABLE crm_followup_qa_state(qualified_id uuid,negative_id uuid,negative_version bigint);
GRANT ALL ON crm_followup_qa_state TO authenticated;
CREATE TEMP TABLE crm_followup_qa_calls(id uuid,updated_at timestamptz,actor text);
GRANT ALL ON crm_followup_qa_calls TO authenticated;
CREATE TEMP TABLE crm_followup_qa_extra(label text PRIMARY KEY,id uuid,version bigint);
GRANT ALL ON crm_followup_qa_extra TO authenticated;

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
  IF l.pipeline_stage<>'lead_perdido' OR l.followup_status<>'scheduled'
     OR l.followup_next_at IS NULL OR l.negative_reason<>'Sem orçamento no momento' THEN
    RAISE EXCEPTION 'FAIL: negative follow-up entry';
  END IF;
  INSERT INTO crm_followup_qa_state VALUES(
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
  INSERT INTO crm_followup_qa_calls VALUES(c.id,c.updated_at,'sdr');
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Qualificação compartilhada Closer','Atleta Closer','11999999994') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid());
  INSERT INTO crm_followup_qa_calls VALUES(c.id,c.updated_at,'closer');
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE call_row record; BEGIN
  SELECT * INTO call_row FROM crm_followup_qa_calls WHERE actor='sdr';
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
  SELECT * INTO call_row FROM crm_followup_qa_calls WHERE actor='sdr';
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
  SELECT * INTO call_row FROM crm_followup_qa_calls WHERE actor='closer';
  c:=public.resolve_sdr_qualification_call(call_row.id,'followup_sdr',call_row.updated_at,
    jsonb_build_object('summary','Closer concluiu a qualificação da fila compartilhada',
      'next_at',(now()+interval '2 days')::text));
  IF NOT c.is_completed OR c.outcome<>'followup_sdr' THEN
    RAISE EXCEPTION 'FAIL: Closer qualification result';
  END IF;
END; $$;
RESET ROLE;

-- Follow-up is a shared queue: another SDR works a colleague's lead without taking it over, and the history records who did it.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; a public.crm_activities; BEGIN
  SELECT * INTO s FROM crm_followup_qa_state;
  l:=public.crm_update_followup(s.negative_id,s.negative_version,'contacted',now()+interval '40 days','Outro SDR registrou o contato');
  IF l.followup_status<>'nurturing' OR l.followup_attempt_count<>1 OR l.followup_last_contact_at IS NULL
     OR l.sdr_id IS DISTINCT FROM 'ce000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION 'FAIL: other SDR follow-up';
  END IF;
  SELECT * INTO a FROM public.crm_activities WHERE lead_id=l.id AND activity_type='followup' ORDER BY created_at DESC LIMIT 1;
  IF a.title<>'Contato de follow-up realizado' OR a.outcome<>'contacted' OR a.user_id<>auth.uid() THEN
    RAISE EXCEPTION 'FAIL: follow-up history entry';
  END IF;
  UPDATE crm_followup_qa_state SET negative_version=l.version;
END; $$;
RESET ROLE;

-- A Closer also works the queue, even on a lead that never passed through them.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_state;
  l:=public.crm_update_followup(s.negative_id,s.negative_version,'schedule',now()+interval '41 days',NULL);
  IF l.followup_status<>'scheduled' OR l.followup_attempt_count<>1
     OR l.sdr_id IS DISTINCT FROM 'ce000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION 'FAIL: Closer follow-up';
  END IF;
  UPDATE crm_followup_qa_state SET negative_version=l.version;
END; $$;
RESET ROLE;

-- Seller has no SDR or Closer capability, so the queue stays closed to them.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; BEGIN
  SELECT * INTO s FROM crm_followup_qa_state;
  BEGIN
    PERFORM public.crm_update_followup(s.negative_id,s.negative_version,'contacted',now()+interval '42 days','Seller tentou acompanhar');
    RAISE EXCEPTION 'FAIL: Seller updated follow-up';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END; $$;
RESET ROLE;

-- Executive operates both desks and can correct a colleague's follow-up without becoming admin.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_state;
  l:=public.crm_update_followup(s.negative_id,s.negative_version,'contacted',now()+interval '45 days','Executive registrou a tentativa e o próximo passo');
  IF l.followup_status<>'nurturing' OR l.followup_attempt_count<>2 OR l.followup_last_contact_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: executive follow-up correction';
  END IF;
  UPDATE crm_followup_qa_state SET negative_version=l.version;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_state;
  l:=public.crm_update_followup(s.negative_id,s.negative_version,'reactivate',NULL,'Lead voltou a demonstrar interesse');
  IF l.pipeline_stage<>'em_qualificacao' OR l.followup_status<>'reactivated' OR l.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: follow-up reactivation';
  END IF;
END; $$;
RESET ROLE;

-- A lead that never had an SDR (registered by a Seller): a Closer follows it up without becoming its SDR; the first SDR to act takes it.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Responsável sem SDR','Atleta sem SDR','11999999995') RETURNING * INTO l;
  IF l.sdr_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL: seller lead should start without SDR'; END IF;
  l:=public.crm_mark_negative(l.id,l.version,'Sem disponibilidade',now()+interval '8 days','Seller enviou ao follow-up');
  INSERT INTO crm_followup_qa_extra VALUES('orphan',l.id,l.version);
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_extra WHERE label='orphan';
  l:=public.crm_update_followup(s.id,s.version,'contacted',now()+interval '2 days','Closer retomou o contato do lead sem SDR');
  IF l.followup_status<>'nurturing' OR l.sdr_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL: Closer became the lead SDR'; END IF;
  UPDATE crm_followup_qa_extra SET version=l.version WHERE label='orphan';
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_extra WHERE label='orphan';
  l:=public.crm_update_followup(s.id,s.version,'schedule',now()+interval '3 days',NULL);
  IF l.followup_status<>'scheduled' OR l.sdr_id IS DISTINCT FROM 'ce000000-0000-4000-8000-000000000004'::uuid THEN
    RAISE EXCEPTION 'FAIL: SDR did not take the lead without SDR';
  END IF;
END; $$;
RESET ROLE;

-- A sale lost by one Closer: another Closer and an SDR who never touched the lead keep following it up.
SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Responsável venda recusada','Atleta venda recusada','11999999996') RETURNING * INTO l;
  l:=public.crm_transition(l.id,'handoff',l.version,jsonb_build_object('closer_id','ce000000-0000-4000-8000-000000000005'));
  INSERT INTO crm_followup_qa_extra VALUES('closer_loss',l.id,l.version);
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_extra WHERE label='closer_loss';
  l:=public.crm_mark_negative(s.id,s.version,'Sem orçamento',now()+interval '3 days','Closer encerrou a venda');
  IF l.pipeline_stage<>'fechado_perdido' OR l.followup_status<>'scheduled' THEN
    RAISE EXCEPTION 'FAIL: Closer loss did not enter follow-up';
  END IF;
  UPDATE crm_followup_qa_extra SET version=l.version WHERE label='closer_loss';
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_extra WHERE label='closer_loss';
  l:=public.crm_update_followup(s.id,s.version,'contacted',now()+interval '5 days','Outro Closer retomou o contato');
  IF l.followup_status<>'nurturing' OR l.followup_attempt_count<>1 THEN RAISE EXCEPTION 'FAIL: other Closer follow-up'; END IF;
  UPDATE crm_followup_qa_extra SET version=l.version WHERE label='closer_loss';
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; l public.crm_leads; BEGIN
  SELECT * INTO s FROM crm_followup_qa_extra WHERE label='closer_loss';
  l:=public.crm_update_followup(s.id,s.version,'do_not_contact',NULL,'Lead pediu para não ser contatado');
  IF l.followup_status<>'do_not_contact' OR l.followup_next_at IS NOT NULL OR l.next_followup_at IS NOT NULL
     OR l.pipeline_stage<>'fechado_perdido' THEN
    RAISE EXCEPTION 'FAIL: SDR closed the Closer loss follow-up';
  END IF;
END; $$;
RESET ROLE;

-- The old name must be gone from the database: columns, functions and the history rows.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name ILIKE '%remarketing%')
     OR EXISTS(
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND (p.proname ILIKE '%remarketing%'
           OR CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ILIKE '%remarketing%' ELSE false END))
     OR EXISTS(SELECT 1 FROM public.crm_activities WHERE activity_type='remarketing' OR title ILIKE '%remarketing%') THEN
    RAISE EXCEPTION 'FAIL: the database still carries the old remarketing name';
  END IF;
END; $$;
