-- Roda dentro de uma transação e termina sempre em ROLLBACK (scripts/check-crm-closer-approach-db.mjs): nada é gravado.
-- Verifica (1) que qualquer SDR ou Closer escolhe e troca o Closer responsável por um fechamento, inclusive a si mesmo, e
-- (2) que cada lead cadastrado conta como uma abordagem de quem o cadastrou.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('cf170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'crm-self-qa-'||n||'@example.invalid',
  jsonb_build_object('display_name','Closer e abordagem QA '||n),'{}',now(),now() FROM generate_series(1,5) n;
UPDATE public.registration_requests SET status='approved',reviewed_at=clock_timestamp()
WHERE user_id::text LIKE 'cf170000-0000-4000-8000-%';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'cf170000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('cf170000-0000-4000-8000-000000000001','sdr',true),      -- 1: SDR que também é Closer (o caso do Pedro Iago)
('cf170000-0000-4000-8000-000000000001','closer',true),
('cf170000-0000-4000-8000-000000000002','sdr',true),      -- 2: SDR puro
('cf170000-0000-4000-8000-000000000003','closer',true),   -- 3: Closer puro
('cf170000-0000-4000-8000-000000000004','closer',true),   -- 4: outro Closer
('cf170000-0000-4000-8000-000000000005','seller',false);  -- 5: vendedor, sem papel de CRM
CREATE TEMP TABLE self_qa(label text PRIMARY KEY, lead_id uuid, call_id uuid, abordagens_antes bigint);
GRANT ALL ON self_qa TO authenticated;
INSERT INTO self_qa(label,abordagens_antes) VALUES ('base',(SELECT count(*) FROM public.abordagens));

-- ---------------------------------------------------------------------------------------------------------- 2: SDR puro cadastra
SELECT set_config('request.jwt.claims','{"sub":"cf170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; a public.abordagens; v_antes bigint; v_depois bigint; BEGIN
  SELECT count(*) INTO v_antes FROM public.dashboard_home_approaches();
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Lead Cadastro QA','Atleta Cadastro QA','11999990001') RETURNING * INTO l;
  INSERT INTO self_qa(label,lead_id) VALUES ('cadastro',l.id);
  SELECT * INTO a FROM public.abordagens WHERE crm_lead_id=l.id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'FAIL cadastrar o lead não gerou a abordagem'; END IF;
  IF a.user_id<>'cf170000-0000-4000-8000-000000000002' OR a.tempo_medio_abordagem<>1 OR a.mostrou_ia OR a.created_at<>l.created_at
    OR a.nomes_abordados<>'Lead Cadastro QA' OR a.dados_abordados NOT LIKE 'Atleta Atleta Cadastro QA · 11999990001%' THEN
    RAISE EXCEPTION 'FAIL abordagem do cadastro com dados errados: %', to_jsonb(a); END IF;
  SELECT count(*) INTO v_depois FROM public.dashboard_home_approaches();
  IF v_depois<>v_antes+1 THEN RAISE EXCEPTION 'FAIL a Visão geral conta % abordagens, esperado %', v_depois, v_antes+1; END IF;
  -- Cada lead, uma abordagem: um segundo lead soma mais uma, e nunca duas para o mesmo lead.
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Lead Cadastro QA 2','Atleta 2','11999990002') RETURNING * INTO l;
  IF (SELECT count(*) FROM public.abordagens WHERE crm_lead_id=l.id)<>1 THEN RAISE EXCEPTION 'FAIL mais de uma abordagem por lead'; END IF;
  SELECT count(*) INTO v_depois FROM public.dashboard_home_approaches();
  IF v_depois<>v_antes+2 THEN RAISE EXCEPTION 'FAIL dois cadastros devem somar duas abordagens'; END IF;
  -- Editar o lead não cria outra abordagem.
  PERFORM public.crm_transition(l.id,'edit',l.version,'{"name":"Lead Cadastro QA 2 editado","athlete_name":"Atleta 2","phone":"11999990002"}');
  IF (SELECT count(*) FROM public.abordagens WHERE crm_lead_id=l.id)<>1 THEN RAISE EXCEPTION 'FAIL editar criou outra abordagem'; END IF;
END; $$;
RESET ROLE;
-- O evento da Arena do cadastro: um por lead, do SDR, peso 0.
DO $$ DECLARE v_lead uuid := (SELECT lead_id FROM self_qa WHERE label='cadastro'); e public.activity_feed; BEGIN
  SELECT * INTO e FROM public.activity_feed WHERE event_key='lead.approached:'||v_lead||':registered';
  IF e.id IS NULL OR e.action_type<>'lead.approached' OR e.responsible_id<>'cf170000-0000-4000-8000-000000000002'
    OR e.responsible_role<>'sdr' OR e.score_delta<>0 THEN RAISE EXCEPTION 'FAIL evento da Arena do cadastro: %', to_jsonb(e); END IF;
  -- A contagem do ranking de SDRs enxerga o cadastro (uma abordagem do SDR no período).
  IF COALESCE((SELECT (x->>'abordagens')::int FROM jsonb_array_elements(public.arena_sdr_ranking(now()-interval '1 hour',now()+interval '1 hour')) x
    WHERE x->>'user_id'='cf170000-0000-4000-8000-000000000002'),0)<2 THEN
    RAISE EXCEPTION 'FAIL o ranking de SDRs não contou os dois cadastros'; END IF;
END; $$;
-- Lead que veio do Meta não conta: ninguém o abordou (lead sem autor também não, pelo mesmo desenho da regra).
DO $$ DECLARE v_id uuid; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone,lead_source,created_by,sdr_id)
    VALUES('Lead Meta QA','Atleta Meta','11999990003','meta_ads_form','cf170000-0000-4000-8000-000000000002','cf170000-0000-4000-8000-000000000002') RETURNING id INTO v_id;
  IF EXISTS (SELECT 1 FROM public.abordagens WHERE crm_lead_id=v_id) OR EXISTS (SELECT 1 FROM public.activity_feed WHERE event_key='lead.approached:'||v_id||':registered')
    THEN RAISE EXCEPTION 'FAIL lead do Meta contou como abordagem'; END IF;
  -- Excluir o lead leva a abordagem junto (a contagem acompanha o cadastro).
  v_id := (SELECT lead_id FROM self_qa WHERE label='cadastro');
  DELETE FROM public.crm_leads WHERE id=v_id;
  IF EXISTS (SELECT 1 FROM public.abordagens WHERE crm_lead_id=v_id) THEN RAISE EXCEPTION 'FAIL a abordagem sobrou depois de excluir o lead'; END IF;
END; $$;
-- Invariante: nenhuma abordagem do CRM repetida para o mesmo lead (índice único) e toda ligação aponta para um lead real.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.abordagens a WHERE a.crm_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id=a.crm_lead_id))
    OR EXISTS (SELECT crm_lead_id FROM public.abordagens WHERE crm_lead_id IS NOT NULL GROUP BY 1 HAVING count(*)>1)
  THEN RAISE EXCEPTION 'FAIL abordagem do CRM sem lead ou repetida'; END IF;
END; $$;

-- ------------------------------------------------------------------------ 1: SDR que também é Closer escolhe a si mesmo
SELECT set_config('request.jwt.claims','{"sub":"cf170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Lead Self QA','Atleta Self QA','11999990011') RETURNING * INTO l;
  -- Repassa o lead e agenda o fechamento para ele mesmo (antes: "deve ser agendada pelo SDR para outro colaborador").
  PERFORM public.handoff_and_schedule_closer_call(l.id,l.version,now()+interval '1 day','cf170000-0000-4000-8000-000000000001','Eu mesmo fecho');
  SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
  SELECT * INTO c FROM public.crm_activities WHERE lead_id=l.id AND call_type='fechamento_closer' AND NOT is_completed;
  IF l.pipeline_stage<>'repassado_closer' OR l.closer_id<>'cf170000-0000-4000-8000-000000000001'
    OR c.id IS NULL OR c.assigned_to<>'cf170000-0000-4000-8000-000000000001' OR c.user_id<>'cf170000-0000-4000-8000-000000000001'
  THEN RAISE EXCEPTION 'FAIL SDR+Closer não conseguiu agendar o fechamento para si mesmo'; END IF;
  UPDATE self_qa SET lead_id=l.id,call_id=c.id WHERE label='base';
END; $$;
RESET ROLE;

-- ------------------------------------------------------------- 2: SDR puro troca o Closer; o dono da call se escolhe de volta
SELECT set_config('request.jwt.claims','{"sub":"cf170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_activities; l public.crm_leads; BEGIN
  SELECT * INTO c FROM public.crm_activities WHERE id=(SELECT call_id FROM self_qa WHERE label='base');
  c:=public.update_crm_call(c.id,'cf170000-0000-4000-8000-000000000004',NULL,c.updated_at);
  SELECT * INTO l FROM public.crm_leads WHERE id=c.lead_id;
  IF c.assigned_to<>'cf170000-0000-4000-8000-000000000004' OR l.closer_id<>'cf170000-0000-4000-8000-000000000004'
  THEN RAISE EXCEPTION 'FAIL SDR não trocou o Closer da call'; END IF;
  -- Responsável sem a capacidade Closer continua recusado (o próprio SDR puro, por exemplo).
  BEGIN PERFORM public.update_crm_call(c.id,'cf170000-0000-4000-8000-000000000002',NULL,c.updated_at);
    RAISE EXCEPTION 'FAIL SDR puro virou Closer da call';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"cf170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_activities; l public.crm_leads; BEGIN
  SELECT * INTO c FROM public.crm_activities WHERE id=(SELECT call_id FROM self_qa WHERE label='base');
  -- Quem agendou a call (conta 1) volta a se escolher: antes "deve ficar com outro colaborador, não com quem a agendou".
  c:=public.update_crm_call(c.id,'cf170000-0000-4000-8000-000000000001',NULL,c.updated_at);
  SELECT * INTO l FROM public.crm_leads WHERE id=c.lead_id;
  IF c.assigned_to<>'cf170000-0000-4000-8000-000000000001' OR l.closer_id<>'cf170000-0000-4000-8000-000000000001'
  THEN RAISE EXCEPTION 'FAIL quem agendou não conseguiu se escolher na troca do responsável'; END IF;
END; $$;
RESET ROLE;

-- ------------------------------------------------------------------------------ 3: Closer puro agenda o fechamento (antes não podia)
SELECT set_config('request.jwt.claims','{"sub":"cf170000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Lead Closer Puro QA','Atleta CP','11999990021') RETURNING * INTO l;
  l:=public.crm_transition(l.id,'handoff',l.version,'{"closer_id":"cf170000-0000-4000-8000-000000000004"}');
  c:=public.schedule_closer_call(l.id,'fechamento_closer',now()+interval '2 days','cf170000-0000-4000-8000-000000000003','Closer agendando');
  IF c.call_type<>'fechamento_closer' OR c.assigned_to<>'cf170000-0000-4000-8000-000000000003' OR c.user_id<>'cf170000-0000-4000-8000-000000000003'
  THEN RAISE EXCEPTION 'FAIL Closer puro não agendou o fechamento'; END IF;
END; $$;
RESET ROLE;

-- ---------------------------------------------------------------------------- 4: quem não tem papel de CRM continua sem agendar
SELECT set_config('request.jwt.claims','{"sub":"cf170000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_lead uuid := (SELECT lead_id FROM self_qa WHERE label='base'); BEGIN
  BEGIN PERFORM public.schedule_closer_call(v_lead,'fechamento_closer',now()+interval '3 days','cf170000-0000-4000-8000-000000000003','Sem permissão');
    RAISE EXCEPTION 'FAIL vendedor sem papel de CRM agendou fechamento';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,call_type,assigned_to,scheduled_at)
      VALUES(v_lead,auth.uid(),'reuniao','Fechamento direto','fechamento_closer','cf170000-0000-4000-8000-000000000003',now()+interval '3 days');
    RAISE EXCEPTION 'FAIL vendedor inseriu call de fechamento direto';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
