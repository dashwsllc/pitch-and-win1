-- Isolated fixtures. Run using scripts/check-crm-db.mjs; always ROLLBACK.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('cd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'crm-qa-'||n||'@example.invalid',jsonb_build_object('display_name','CRM QA '||n),'{}',now(),now()
FROM generate_series(1,5) n;
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('cd000000-0000-4000-8000-000000000001','executive',true),
('cd000000-0000-4000-8000-000000000002','sdr',true),
('cd000000-0000-4000-8000-000000000003','closer',true),
('cd000000-0000-4000-8000-000000000004','closer',true);
CREATE TEMP TABLE crm_qa_state(lead_id uuid,call_id uuid,revision timestamptz,note_id uuid);
GRANT ALL ON crm_qa_state TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_activities; q public.crm_activities; nid uuid;
BEGIN
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('CRM QA Responsável','crm-qa@example.invalid','11999999999','CRM QA Atleta','2012-01-01','Meia') RETURNING * INTO l;
  IF l.athlete_height_cm IS NOT NULL OR l.athlete_weight_kg IS NOT NULL THEN RAISE EXCEPTION 'FAIL: optional metrics'; END IF;
  BEGIN INSERT INTO public.crm_leads(name) VALUES('CRM QA Missing'); RAISE EXCEPTION 'FAIL: required fields'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET athlete_position='Inválida' WHERE id=l.id; RAISE EXCEPTION 'FAIL: invalid position'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET athlete_birth_date=current_date+1 WHERE id=l.id; RAISE EXCEPTION 'FAIL: future birth'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET athlete_height_cm=999 WHERE id=l.id; RAISE EXCEPTION 'FAIL: height'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET athlete_weight_kg=-1 WHERE id=l.id; RAISE EXCEPTION 'FAIL: weight'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET performance_report_url='javascript:alert(1)' WHERE id=l.id; RAISE EXCEPTION 'FAIL: unsafe report'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET pipeline_stage='fechado_ganho' WHERE id=l.id; RAISE EXCEPTION 'FAIL: direct pipeline'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,author_name) VALUES(l.id,auth.uid(),'contexto_vida','Contexto','Primeira anotação','Forged') RETURNING id INTO nid;
  IF (SELECT author_name FROM public.crm_activities WHERE id=nid) <> 'CRM QA 2' THEN RAISE EXCEPTION 'FAIL: forged author'; END IF;
  BEGIN UPDATE public.crm_activities SET description='overwrite' WHERE id=nid; RAISE EXCEPTION 'FAIL: context overwritten'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.crm_activities WHERE id=nid; RAISE EXCEPTION 'FAIL: context deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  q:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '1 day',auth.uid(),'Qualificação QA');
  BEGIN PERFORM public.resolve_closer_call(q.id,'venda_concluida',q.updated_at); RAISE EXCEPTION 'FAIL: qualification closed sale'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  q:=public.resolve_closer_call(q.id,'avancou',q.updated_at);
  IF NOT q.is_completed OR q.completed_at IS NULL OR (SELECT pipeline_stage FROM public.crm_leads WHERE id=l.id)<>'em_qualificacao' THEN RAISE EXCEPTION 'FAIL: qualification advancement'; END IF;
  c:=public.schedule_closer_call(l.id,'fechamento_closer',now()+interval '2 day','cd000000-0000-4000-8000-000000000003','Pai e mãe na call');
  IF (SELECT pipeline_stage FROM public.crm_leads WHERE id=l.id)<>'repassado_closer' THEN RAISE EXCEPTION 'FAIL: atomic handoff'; END IF;
  BEGIN PERFORM public.schedule_closer_call(l.id,'fechamento_closer',now()+interval '2 day','cd000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL: duplicate pending call'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN UPDATE public.crm_activities SET outcome='venda_concluida',is_completed=true,completed_at=now() WHERE id=c.id; RAISE EXCEPTION 'FAIL: direct resolution'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.resolve_closer_call(c.id,'venda_concluida',c.updated_at); RAISE EXCEPTION 'FAIL: SDR closed sale'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  q:=public.reschedule_crm_call(c.id,now()+interval '3 day',c.updated_at);
  IF q.id<>c.id OR q.scheduled_at=c.scheduled_at THEN RAISE EXCEPTION 'FAIL: reschedule duplicated call'; END IF;
  BEGIN PERFORM public.reschedule_crm_call(c.id,now()+interval '4 day',c.updated_at); RAISE EXCEPTION 'FAIL: stale reschedule'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  INSERT INTO crm_qa_state VALUES(l.id,q.id,q.updated_at,nid);
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM crm_qa_state;
  BEGIN PERFORM public.resolve_closer_call(s.call_id,'venda_concluida',s.revision); RAISE EXCEPTION 'FAIL: other closer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities; BEGIN SELECT * INTO s FROM crm_qa_state;
  IF NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE id=s.call_id) OR NOT EXISTS(SELECT 1 FROM public.crm_activities WHERE id=s.note_id) THEN RAISE EXCEPTION 'FAIL: closer cannot read shared history'; END IF;
  BEGIN PERFORM public.resolve_closer_call(s.call_id,'invalid',s.revision); RAISE EXCEPTION 'FAIL: invalid outcome'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.resolve_closer_call(gen_random_uuid(),'venda_concluida',s.revision); RAISE EXCEPTION 'FAIL: missing call'; EXCEPTION WHEN no_data_found THEN NULL; END;
  c:=public.resolve_closer_call(s.call_id,'devolvido_sdr',s.revision);
  IF (SELECT pipeline_stage FROM public.crm_leads WHERE id=s.lead_id)<>'em_qualificacao' OR NOT c.is_completed THEN RAISE EXCEPTION 'FAIL: return to SDR'; END IF;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s record; c public.crm_activities; l public.crm_leads; p public.products; t public.product_tickets; v public.vendas;
BEGIN SELECT * INTO s FROM crm_qa_state;
  c:=public.schedule_closer_call(s.lead_id,'fechamento_closer',now()+interval '1 day','cd000000-0000-4000-8000-000000000003');
  c:=public.resolve_closer_call(c.id,'venda_concluida',c.updated_at);
  IF c.outcome<>'venda_concluida' OR NOT c.is_completed OR c.completed_at IS NULL OR (SELECT pipeline_stage FROM public.crm_leads WHERE id=s.lead_id)<>'fechado_ganho' THEN RAISE EXCEPTION 'FAIL: won atomic state'; END IF;
  IF EXISTS(SELECT 1 FROM public.vendas WHERE crm_lead_id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: automatic revenue'; END IF;
  BEGIN PERFORM public.resolve_closer_call(c.id,'venda_perdida',c.updated_at); RAISE EXCEPTION 'FAIL: double outcome'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  p:=public.executive_create_product('CRM QA Produto',NULL,'CRM QA Ticket',10,true);
  SELECT * INTO t FROM public.product_tickets WHERE product_id=p.id;
  INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador,crm_lead_id)
    VALUES(auth.uid(),p.id,t.id,p.name,10,'CRM QA Comprador','crm-qa@example.invalid','11999999999',s.lead_id) RETURNING * INTO v;
  IF NOT EXISTS(SELECT 1 FROM public.vendas sale JOIN public.crm_leads lead ON lead.id=sale.crm_lead_id WHERE sale.id=v.id AND lead.id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: sales linkage'; END IF;
  BEGIN UPDATE public.vendas SET crm_lead_id=NULL WHERE id=v.id; RAISE EXCEPTION 'FAIL: changed sales link'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.crm_leads(name,email,phone,athlete_name,athlete_birth_date,athlete_position)
    VALUES('CRM QA Perdido','crm-qa@example.invalid','11999999999','CRM QA Perdido','2012-01-01','Goleiro') RETURNING * INTO l;
  c:=public.schedule_closer_call(l.id,'fechamento_closer',now()+interval '1 day','cd000000-0000-4000-8000-000000000003');
  c:=public.resolve_closer_call(c.id,'venda_perdida',c.updated_at);
  IF (SELECT pipeline_stage FROM public.crm_leads WHERE id=l.id)<>'fechado_perdido' OR NOT c.is_completed OR c.completed_at IS NULL THEN RAISE EXCEPTION 'FAIL: lost atomic state'; END IF;
  BEGIN INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador,crm_lead_id)
    VALUES(auth.uid(),p.id,t.id,p.name,10,'CRM QA Comprador','crm-qa@example.invalid','11999999999',l.id); RAISE EXCEPTION 'FAIL: linked lost lead'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM crm_qa_state;
  IF EXISTS(SELECT 1 FROM public.crm_leads WHERE id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: no-access RLS'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_activities WHERE id=s.call_id) THEN RAISE EXCEPTION 'FAIL: no-access activity RLS'; END IF;
  BEGIN PERFORM public.schedule_closer_call(s.lead_id,'qualificacao',now()+interval '1 day',auth.uid()); RAISE EXCEPTION 'FAIL: no-access RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET suspended=true WHERE user_id='cd000000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM crm_qa_state;
  IF public.crm_has_access() OR EXISTS(SELECT 1 FROM public.crm_leads WHERE id=s.lead_id) THEN RAISE EXCEPTION 'FAIL: suspended access'; END IF;
  BEGIN PERFORM public.resolve_closer_call(s.call_id,'venda_concluida',s.revision); RAISE EXCEPTION 'FAIL: suspended RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
  BEGIN PERFORM public.resolve_closer_call(gen_random_uuid(),'venda_concluida',now()); RAISE EXCEPTION 'FAIL: unauthenticated RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.crm_call_assignees(); RAISE EXCEPTION 'FAIL: anonymous RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
