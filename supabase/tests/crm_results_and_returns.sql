-- Executed inside a transaction; the runner always rolls back every fixture.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-results-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Resultados QA '||n),'{}',now(),now()
FROM generate_series(1,5) n;
UPDATE public.registration_requests SET status='approved',reviewed_at=clock_timestamp()
WHERE user_id::text LIKE 'ce160000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ce160000-0000-4000-8000-000000000001','executive',true),
('ce160000-0000-4000-8000-000000000002','sdr',true),
('ce160000-0000-4000-8000-000000000003','closer',true),
('ce160000-0000-4000-8000-000000000004','closer',true);
CREATE TEMP TABLE results_qa(lead_id uuid,product_id uuid,ticket_id uuid,sale_id uuid);
GRANT ALL ON results_qa TO authenticated;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone,last_result_outcome,last_result_closer_name)
  VALUES('Lead Resultados QA','Atleta Resultados QA','11999999999','venda_concluida','Nome forjado') RETURNING * INTO l;
  IF l.last_result_outcome IS NOT NULL OR l.last_result_closer_name IS NOT NULL THEN RAISE EXCEPTION 'FAIL forged result'; END IF;
  PERFORM public.handoff_and_schedule_closer_call(l.id,l.version,now()+interval '1 day','ce160000-0000-4000-8000-000000000003','Call inicial');
  INSERT INTO results_qa(lead_id) VALUES(l.id);
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; original_date timestamptz; original_version bigint; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM results_qa);
  l:=public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_perdida","note":"Recusou a proposta"}');
  IF l.last_result_outcome<>'venda_perdida' OR l.last_result_at IS NULL
    OR l.last_result_closer_id<>auth.uid() OR l.last_result_closer_name<>'Resultados QA 3'
    OR l.remarketing_status<>'pending' THEN RAISE EXCEPTION 'FAIL loss result snapshot'; END IF;
  original_date:=l.last_result_at; original_version:=l.version;
  BEGIN
    PERFORM public.crm_reopen_result(l.id,l.version,'sdr',auth.uid(),now()+interval '2 days','Destino inválido');
    RAISE EXCEPTION 'FAIL wrong destination role allowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  l:=public.crm_reopen_result(l.id,l.version,'sdr','ce160000-0000-4000-8000-000000000002',now()+interval '2 days','Retomar qualificação');
  IF l.pipeline_stage<>'em_qualificacao' OR l.closed_at IS NOT NULL OR l.closer_id IS NOT NULL
    OR l.last_result_at<>original_date OR l.last_result_outcome<>'venda_perdida'
    OR l.last_result_closer_id<>auth.uid() OR l.remarketing_next_at IS NOT NULL OR l.remarketing_status<>'reactivated'
    OR NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type='qualificacao' AND NOT is_completed
      AND assigned_to=l.sdr_id AND scheduled_at=l.next_followup_at) THEN RAISE EXCEPTION 'FAIL synchronized SDR return'; END IF;
  BEGIN
    PERFORM public.crm_reopen_result(l.id,original_version,'sdr','ce160000-0000-4000-8000-000000000002',now()+interval '2 days','Clique duplicado');
    RAISE EXCEPTION 'FAIL stale return allowed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM results_qa);
  l:=public.crm_mark_negative(l.id,l.version,'Sem orçamento',now()+interval '3 days','Retomar no próximo mês');
  IF l.pipeline_stage<>'lead_perdido' OR l.remarketing_status<>'scheduled'
    OR l.remarketing_next_at<>l.next_followup_at OR l.last_result_outcome<>'lead_perdido'
    OR EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed)
    THEN RAISE EXCEPTION 'FAIL SDR remarketing'; END IF;
  l:=public.crm_update_remarketing(l.id,l.version,'contacted',now()+interval '4 days','Novo contato realizado');
  IF l.remarketing_attempt_count<>1 THEN RAISE EXCEPTION 'FAIL contact count'; END IF;
  l:=public.crm_reopen_result(l.id,l.version,'closer','ce160000-0000-4000-8000-000000000003',now()+interval '5 days','Lead pronto para retomar fechamento');
  IF l.pipeline_stage<>'repassado_closer' OR l.last_result_outcome<>'lead_perdido'
    OR NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type='fechamento_closer'
      AND assigned_to=l.closer_id AND scheduled_at=l.next_followup_at AND NOT is_completed)
    THEN RAISE EXCEPTION 'FAIL Closer return'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM results_qa);
  BEGIN
    PERFORM public.crm_mark_negative(l.id,l.version,'Recusa indevida',now()+interval '6 days','Outro closer');
    RAISE EXCEPTION 'FAIL other closer changed remarketing';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM results_qa);
  l:=public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_perdida"}');
  IF l.remarketing_status<>'pending' OR l.remarketing_next_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL repeat loss remains reactivated'; END IF;
  l:=public.crm_reopen_result(l.id,l.version,'closer',auth.uid(),now()+interval '6 days','Retomar proposta');
  l:=public.crm_mark_negative(l.id,l.version,'Aguardar próximo mês',now()+interval '7 days','Remarketing pelo Closer');
  IF l.pipeline_stage<>'fechado_perdido' OR l.remarketing_status<>'scheduled'
    OR EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed)
    THEN RAISE EXCEPTION 'FAIL Closer direct remarketing'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM results_qa);
  BEGIN
    PERFORM public.crm_reopen_result(l.id,l.version,'closer',auth.uid(),now()+interval '6 days','Devolução indevida');
    RAISE EXCEPTION 'FAIL other closer returned lead';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;

-- The seller-only Lead action works without granting SDR/Closer access.
SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Lead vendedor','Atleta vendedor','11999999998') RETURNING * INTO l;
  l:=public.crm_mark_negative(l.id,l.version,'Sem disponibilidade',now()+interval '8 days','Agendar nova tentativa');
  IF l.remarketing_status<>'scheduled' THEN RAISE EXCEPTION 'FAIL seller Lead action'; END IF;
  IF public.crm_can('sdr') THEN RAISE EXCEPTION 'FAIL expanded seller permissions'; END IF;
  BEGIN
    PERFORM public.crm_reopen_result(l.id,l.version,'closer','ce160000-0000-4000-8000-000000000003',now()+interval '9 days','Sem permissão');
    RAISE EXCEPTION 'FAIL seller reopens result';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM * FROM public.crm_result_sale_links();
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; p public.products; BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id=(SELECT lead_id FROM results_qa);
  l:=public.crm_reopen_result(l.id,l.version,'closer','ce160000-0000-4000-8000-000000000003',now()+interval '10 days','Executive devolveu ao Closer');
  l:=public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_concluida"}');
  IF l.last_result_outcome<>'venda_concluida' OR l.last_result_closer_id<>'ce160000-0000-4000-8000-000000000003' THEN RAISE EXCEPTION 'FAIL executive overwrote seller attribution'; END IF;
  p:=public.executive_create_product('Resultados QA Produto',NULL,'Ticket QA',10,true);
  UPDATE results_qa SET product_id=p.id,ticket_id=(SELECT id FROM public.product_tickets WHERE product_id=p.id LIMIT 1);
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s results_qa; v public.vendas; BEGIN
  SELECT * INTO s FROM results_qa;
  INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador,crm_lead_id)
  VALUES(auth.uid(),s.product_id,s.ticket_id,'Resultados QA Produto',10,'QA Comprador','results-qa@example.invalid','11999999999',s.lead_id) RETURNING * INTO v;
  UPDATE results_qa SET sale_id=v.id;
  IF NOT EXISTS(SELECT 1 FROM public.crm_result_sale_links() WHERE lead_id=s.lead_id AND sale_id=v.id
    AND can_open AND seller_id=auth.uid() AND approval_status='pendente') THEN RAISE EXCEPTION 'FAIL pending linked sale'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; s results_qa; BEGIN
  SELECT * INTO s FROM results_qa;
  PERFORM public.executive_review_sale(s.sale_id,'reject','Revisão de teste','pendente');
  SELECT * INTO l FROM public.crm_leads WHERE id=s.lead_id;
  l:=public.crm_reopen_result(l.id,l.version,'sdr','ce160000-0000-4000-8000-000000000002',now()+interval '11 days','Revisar venda concluída');
  IF l.last_result_outcome<>'venda_concluida' THEN RAISE EXCEPTION 'FAIL won result lost on return'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_result_sale_links() WHERE lead_id=l.id AND sale_id=s.sale_id
    AND approval_status='rejeitada' AND seller_name='Resultados QA 3') THEN RAISE EXCEPTION 'FAIL approval metadata lost on return'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ce160000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s results_qa; BEGIN
  SELECT * INTO s FROM results_qa;
  IF NOT EXISTS(SELECT 1 FROM public.crm_result_sale_links() WHERE lead_id=s.lead_id AND sale_id IS NULL
    AND NOT can_open AND approval_status='rejeitada') THEN RAISE EXCEPTION 'FAIL shared metadata or private sale disclosure'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.dashboard_events WHERE topic='crm' AND revision>0) THEN RAISE EXCEPTION 'FAIL realtime revision not visible'; END IF;
END; $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.crm_result_sale_links(); RAISE EXCEPTION 'FAIL anonymous results'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
