-- Roda dentro de uma transação e termina sempre em ROLLBACK (scripts/check-agenda-meet-sale-db.mjs): nada é gravado.
-- Verifica: (1) o link da reunião por call e quem pode colocá-lo; (2) o resultado "sinal" da call (valor no lead, lead
-- segue com o Closer, Arena conta call realizada e não "venda não concluída"); (3) a venda livre (sem catálogo, sem
-- comprador, com sinal) e a venda registrada depois do sinal.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('a9e40000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'agenda-meet-qa-'||n||'@example.invalid',
  jsonb_build_object('display_name','Agenda QA '||n),'{}',now(),now() FROM generate_series(1,2) n;
UPDATE public.registration_requests SET status='approved',reviewed_at=clock_timestamp()
WHERE user_id::text LIKE 'a9e40000-0000-4000-8000-%';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'a9e40000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('a9e40000-0000-4000-8000-000000000001','sdr',true),     -- 1: SDR, Closer e vendedor (agenda, fecha e registra)
('a9e40000-0000-4000-8000-000000000001','closer',true),
('a9e40000-0000-4000-8000-000000000001','seller',true),
('a9e40000-0000-4000-8000-000000000002','sdr',true);     -- 2: outro SDR, sem relação com a call
CREATE TEMP TABLE meet_qa(label text PRIMARY KEY, lead_id uuid, call_id uuid);
GRANT ALL ON meet_qa TO authenticated;

-- ------------------------------------------------------------------------------------- 1: link da reunião e sinal
SELECT set_config('request.jwt.claims','{"sub":"a9e40000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Lead Meet QA','Atleta Meet QA','11999990301') RETURNING * INTO l;
  PERFORM public.handoff_and_schedule_closer_call(l.id,l.version,now()+interval '1 day','a9e40000-0000-4000-8000-000000000001','Call de teste');
  SELECT * INTO c FROM public.crm_activities WHERE lead_id=l.id AND call_type='fechamento_closer' AND NOT is_completed;
  INSERT INTO meet_qa VALUES('call',l.id,c.id);

  -- Colado sem https:// também vale.
  c := public.crm_set_call_meeting_link(c.id,'  meet.google.com/abc-defg-hij ',c.updated_at);
  IF c.meeting_link IS DISTINCT FROM 'https://meet.google.com/abc-defg-hij' THEN RAISE EXCEPTION 'FAIL link normalizado: %', c.meeting_link; END IF;
  -- Revisão antiga: recusado.
  BEGIN PERFORM public.crm_set_call_meeting_link(c.id,'https://meet.google.com/xyz-abcd-efg','2000-01-01');
    RAISE EXCEPTION 'FAIL revisão antiga aceita';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  -- Endereço que não é https: recusado.
  BEGIN PERFORM public.crm_set_call_meeting_link(c.id,'http://exemplo.com/sala',c.updated_at);
    RAISE EXCEPTION 'FAIL link http aceito';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- Apagar o link (em branco) vale.
  c := public.crm_set_call_meeting_link(c.id,'',c.updated_at);
  IF c.meeting_link IS NOT NULL THEN RAISE EXCEPTION 'FAIL link em branco não apagou'; END IF;
  c := public.crm_set_call_meeting_link(c.id,'https://meet.google.com/abc-defg-hij',c.updated_at);
END $$;
RESET ROLE;

-- Outro SDR, sem relação com a call, não coloca o link.
SELECT set_config('request.jwt.claims','{"sub":"a9e40000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c public.crm_activities; BEGIN
  SELECT * INTO c FROM public.crm_activities WHERE id=(SELECT call_id FROM meet_qa WHERE label='call');
  BEGIN PERFORM public.crm_set_call_meeting_link(c.id,'https://meet.google.com/aaa-bbbb-ccc',c.updated_at);
    RAISE EXCEPTION 'FAIL SDR sem relação colocou o link';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- O Closer encerra a call com sinal de R$ 500,00.
SELECT set_config('request.jwt.claims','{"sub":"a9e40000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; r public.crm_activities; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM meet_qa WHERE label='call');
  -- Sem valor: recusado.
  BEGIN PERFORM public.crm_transition(l.id,'close',l.version,'{"outcome":"sinal","call_performed":true}');
    RAISE EXCEPTION 'FAIL sinal sem valor aceito';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  l := public.crm_transition(l.id,'close',l.version,'{"outcome":"sinal","call_performed":true,"deposit_amount":"500","note":"Pagou por Pix"}');
  IF l.pipeline_stage<>'repassado_closer' OR l.deposit_amount<>500 OR l.deposit_at IS NULL OR l.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL sinal no lead: %', to_jsonb(l); END IF;
  SELECT * INTO c FROM public.crm_activities WHERE id=(SELECT call_id FROM meet_qa WHERE label='call');
  IF NOT c.is_completed OR c.outcome<>'sinal' OR c.performed_at IS NULL THEN RAISE EXCEPTION 'FAIL call encerrada com sinal: %', to_jsonb(c); END IF;
  SELECT * INTO r FROM public.crm_activities WHERE lead_id=l.id AND activity_type='fechamento' ORDER BY created_at DESC LIMIT 1;
  IF r.outcome<>'sinal' OR r.description NOT LIKE 'Sinal pago: R$ 500,00%Pagou por Pix' THEN RAISE EXCEPTION 'FAIL linha do tempo do sinal: %', r.description; END IF;
  -- Call encerrada: o link não é mais aceito.
  BEGIN PERFORM public.crm_set_call_meeting_link(c.id,'https://meet.google.com/abc-defg-hij',c.updated_at);
    RAISE EXCEPTION 'FAIL link aceito em call encerrada';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
RESET ROLE;

-- Arena: a call com sinal conta como realizada, nunca como "venda não concluída".
DO $$ DECLARE v_call uuid := (SELECT call_id FROM meet_qa WHERE label='call'); BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.activity_feed WHERE event_key='call.performed:'||v_call AND action_type='closing.performed') THEN
    RAISE EXCEPTION 'FAIL a Arena não registrou a call realizada'; END IF;
  IF EXISTS (SELECT 1 FROM public.activity_feed WHERE event_key='call.no_sale:'||v_call) THEN
    RAISE EXCEPTION 'FAIL o sinal virou "venda não concluída" na Arena'; END IF;
END $$;

-- ------------------------------------------------------------------------------------------------- 2: venda livre
SET LOCAL ROLE authenticated;
DO $$ DECLARE v public.vendas; l public.crm_leads; BEGIN
  -- Sem produto, sem ticket, sem comprador, com sinal.
  INSERT INTO public.vendas(user_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador,payment_type,deposit_amount)
    VALUES('a9e40000-0000-4000-8000-000000000001','',2997,'','','','sinal',500) RETURNING * INTO v;
  IF v.nome_produto<>'Produto não informado' OR v.valor_venda<>2997 OR v.payment_type<>'sinal' OR v.deposit_amount<>500
    OR v.approval_status<>'pendente' OR v.product_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL venda livre com sinal: %', to_jsonb(v); END IF;
  -- Integral não guarda sinal.
  INSERT INTO public.vendas(user_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador,payment_type,deposit_amount)
    VALUES('a9e40000-0000-4000-8000-000000000001','Mentoria avulsa',1000,'Comprador QA','11999990302','','integral',300) RETURNING * INTO v;
  IF v.deposit_amount IS NOT NULL OR v.nome_produto<>'Mentoria avulsa' THEN RAISE EXCEPTION 'FAIL integral com sinal guardado: %', to_jsonb(v); END IF;
  -- Sinal maior que o valor total: recusado.
  BEGIN INSERT INTO public.vendas(user_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador,payment_type,deposit_amount)
      VALUES('a9e40000-0000-4000-8000-000000000001','X',100,'','','','sinal',200);
    RAISE EXCEPTION 'FAIL sinal maior que a venda aceito';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- E-mail preenchido continua validado.
  BEGIN INSERT INTO public.vendas(user_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador)
      VALUES('a9e40000-0000-4000-8000-000000000001','X',100,'','','nao-e-email');
    RAISE EXCEPTION 'FAIL e-mail inválido aceito';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Venda depois do sinal: o Closer conclui a venda no CRM e registra a venda ligada ao lead, com o sinal.
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM meet_qa WHERE label='call');
  l := public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_concluida","note":"Venda registrada após o sinal"}');
  IF l.pipeline_stage<>'fechado_ganho' THEN RAISE EXCEPTION 'FAIL lead com sinal não concluiu a venda'; END IF;
  INSERT INTO public.vendas(user_id,crm_lead_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador,payment_type,deposit_amount)
    VALUES('a9e40000-0000-4000-8000-000000000001',l.id,'Mentoria',2997,l.name,l.phone,'','sinal',l.deposit_amount) RETURNING * INTO v;
  IF v.crm_lead_id<>l.id OR v.deposit_amount<>500 OR v.valor_venda<>2997 THEN RAISE EXCEPTION 'FAIL venda ligada ao lead com sinal: %', to_jsonb(v); END IF;
END $$;
RESET ROLE;
