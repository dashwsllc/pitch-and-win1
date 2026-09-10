-- Always enclosed in a transaction and ROLLBACK by check-crm-db.mjs.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('ce100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'crm-shared-qa-'||n||'@example.invalid',
  jsonb_build_object('display_name','CRM Shared QA '||n),'{}',now(),now() FROM generate_series(1,9) n;
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ce100000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
('ce100000-0000-4000-8000-000000000001','seller',false),
('ce100000-0000-4000-8000-000000000002','executive',false),
('ce100000-0000-4000-8000-000000000003','sdr',false),
('ce100000-0000-4000-8000-000000000004','closer',false),
('ce100000-0000-4000-8000-000000000005','seller',false),
('ce100000-0000-4000-8000-000000000005','sdr',false),
('ce100000-0000-4000-8000-000000000006','seller',false),
('ce100000-0000-4000-8000-000000000006','closer',false),
('ce100000-0000-4000-8000-000000000007','bdr',false),
('ce100000-0000-4000-8000-000000000008','seller',false),
('ce100000-0000-4000-8000-000000000009','bdr',true);
UPDATE public.profiles SET suspended=true WHERE user_id='ce100000-0000-4000-8000-000000000008';
DO $$ DECLARE n int; u uuid; BEGIN
  FOR n IN 1..9 LOOP
    u:=('ce100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    IF public.crm_user_can(u,'leads') IS DISTINCT FROM (n NOT IN (7,8)) THEN RAISE EXCEPTION 'FAIL leads capability %',n; END IF;
    IF public.crm_user_can(u,'sdr') IS DISTINCT FROM (n IN (1,2,3,5)) THEN RAISE EXCEPTION 'FAIL SDR capability %',n; END IF;
    IF public.crm_user_can(u,'closer') IS DISTINCT FROM (n IN (1,2,4,6)) THEN RAISE EXCEPTION 'FAIL Closer capability %',n; END IF;
    IF public.crm_user_can(u,'sales') IS DISTINCT FROM (n IN (1,2,4,6)) THEN RAISE EXCEPTION 'FAIL sales capability %',n; END IF;
    IF public.crm_user_can(u,'admin') IS DISTINCT FROM (n=2) THEN RAISE EXCEPTION 'FAIL admin capability %',n; END IF;
  END LOOP;
END; $$;
CREATE TEMP TABLE crm_shared_state(lead_id uuid,product_id uuid,ticket_id uuid);
GRANT ALL ON crm_shared_state TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ce100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; old_version bigint; a public.crm_activities; BEGIN
  IF NOT public.crm_has_access() THEN RAISE EXCEPTION 'FAIL seller without crm_access'; END IF;
  BEGIN PERFORM public.executive_list_users(); RAISE EXCEPTION 'FAIL seller accessed user administration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('QA Responsável','QA Atleta','11999999999') RETURNING * INTO l;
  IF l.pipeline_stage<>'novo' OR l.approach_stage<>'nao_abordado' OR l.sdr_id<>auth.uid() OR l.email IS NOT NULL OR l.athlete_birth_date IS NOT NULL OR l.athlete_position IS NOT NULL THEN RAISE EXCEPTION 'FAIL minimal lead'; END IF;
  INSERT INTO crm_shared_state(lead_id) VALUES(l.id);
  BEGIN INSERT INTO public.crm_leads(name,phone) VALUES('QA Missing','11999999999'); RAISE EXCEPTION 'FAIL missing athlete'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET pipeline_stage='repassado_closer' WHERE id=l.id; RAISE EXCEPTION 'FAIL direct workflow update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.crm_leads SET temperature='quente' WHERE id=l.id; RAISE EXCEPTION 'FAIL direct classification'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  old_version:=l.version;
  l:=public.crm_transition(l.id,'edit',l.version,'{"name":"QA Responsável editado","athlete_name":"QA Atleta","phone":"11988888888","email":"","athlete_birth_date":null,"athlete_position":"","priority":null,"estimated_deal_value":null,"observations":null}');
  IF l.name<>'QA Responsável editado' OR l.email IS NOT NULL OR l.priority IS NOT NULL THEN RAISE EXCEPTION 'FAIL optional edit'; END IF;
  BEGIN PERFORM public.crm_transition(l.id,'edit',old_version,'{"name":"QA stale"}'); RAISE EXCEPTION 'FAIL stale edit'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.crm_transition(l.id,'edit',l.version,'{"closer_id":null}'); RAISE EXCEPTION 'FAIL editing protected field'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  l:=public.crm_transition(l.id,'approach',l.version,'{"stage":"em_abordagem"}');
  IF l.pipeline_stage<>'em_qualificacao' THEN RAISE EXCEPTION 'FAIL approach pipeline'; END IF;
  l:=public.crm_transition(l.id,'approach',l.version,'{"stage":"abordado"}');
  l:=public.crm_transition(l.id,'classify',l.version,'{"temperature":"quente"}');
  IF l.pipeline_stage<>'pronto_closer' OR l.closer_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL readiness/implicit handoff'; END IF;
  l:=public.crm_transition(l.id,'approach',l.version,'{"stage":"reabordado"}');
  l:=public.crm_transition(l.id,'contact',l.version,'{"note":"Nova tentativa de contato"}');
  l:=public.crm_transition(l.id,'approach',l.version,'{"stage":"nao_abordado"}');
  IF l.pipeline_stage<>'em_qualificacao' THEN RAISE EXCEPTION 'FAIL readiness cleared'; END IF;
  IF (SELECT count(DISTINCT new_state->>'approach_stage') FROM public.crm_activities WHERE lead_id=l.id)<4 THEN RAISE EXCEPTION 'FAIL approach audit'; END IF;
  l:=public.crm_transition(l.id,'followup',l.version,jsonb_build_object('next_at',now()+interval '1 day'));
  a:=public.schedule_closer_call(l.id,'qualificacao',now()+interval '2 days',auth.uid(),'Contexto de qualificação');
  SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
  BEGIN PERFORM public.reschedule_crm_call(a.id,now()+interval '3 days',a.updated_at-interval '1 second'); RAISE EXCEPTION 'FAIL stale reschedule'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  a:=public.reschedule_crm_call(a.id,now()+interval '3 days',a.updated_at);
  a:=public.resolve_closer_call(a.id,'avancou',a.updated_at);
  SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
  l:=public.crm_transition(l.id,'handoff',l.version,'{"note":"Repasse sem call de fechamento"}');
  IF l.pipeline_stage<>'repassado_closer' OR l.closer_id IS NOT NULL OR l.handed_off_at IS NULL THEN RAISE EXCEPTION 'FAIL shared queue'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed) THEN RAISE EXCEPTION 'FAIL open call after handoff'; END IF;
  l:=public.crm_transition(l.id,'classify',l.version,'{"temperature":"frio"}');
  IF l.pipeline_stage<>'repassado_closer' THEN RAISE EXCEPTION 'FAIL handoff overwritten'; END IF;
  BEGIN PERFORM public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_concluida"}'); RAISE EXCEPTION 'FAIL unclaimed close'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  old_version:=l.version;
  l:=public.crm_transition(l.id,'claim',l.version);
  BEGIN PERFORM public.crm_transition(l.id,'claim',old_version); RAISE EXCEPTION 'FAIL double claim'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  l:=public.crm_transition(l.id,'close',l.version,jsonb_build_object('outcome','followup','next_at',now()+interval '2 days','note','Follow-up QA'));
  IF l.pipeline_stage<>'repassado_closer' OR l.next_followup_at IS NULL THEN RAISE EXCEPTION 'FAIL followup outcome'; END IF;
  l:=public.crm_transition(l.id,'return',l.version,'{"note":"Retomar qualificação"}');
  IF l.pipeline_stage<>'em_qualificacao' OR l.closer_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL return'; END IF;
  l:=public.crm_transition(l.id,'handoff',l.version,jsonb_build_object('closer_id',auth.uid()));
  a:=public.schedule_closer_call(l.id,'fechamento_closer',now()+interval '1 day',auth.uid(),'Contexto fechamento');
  a:=public.reschedule_crm_call(a.id,now()+interval '2 days',a.updated_at);
  SELECT * INTO l FROM public.crm_leads WHERE id=l.id;
  l:=public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_concluida","note":"Venda ganha QA"}');
  IF l.pipeline_stage<>'fechado_ganho' OR l.closed_at IS NULL OR l.closed_by<>auth.uid() OR EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND call_type IS NOT NULL AND NOT is_completed) THEN RAISE EXCEPTION 'FAIL atomic close'; END IF;
  IF EXISTS(SELECT 1 FROM public.vendas WHERE crm_lead_id=l.id) THEN RAISE EXCEPTION 'FAIL automatic revenue'; END IF;
  BEGIN PERFORM public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_perdida"}'); RAISE EXCEPTION 'FAIL double close'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  l:=public.crm_transition(l.id,'classify',l.version,'{"temperature":"morno"}');
  IF l.pipeline_stage<>'fechado_ganho' THEN RAISE EXCEPTION 'FAIL closed stage overwritten'; END IF;
  BEGIN UPDATE public.crm_activities SET description='Tampering' WHERE lead_id=l.id; RAISE EXCEPTION 'FAIL mutable history'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=l.id AND (user_id<>auth.uid() OR author_name<>'CRM Shared QA 1')) THEN RAISE EXCEPTION 'FAIL author'; END IF;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ce100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE p public.products; t public.product_tickets; BEGIN
  PERFORM public.executive_list_users();
  p:=public.executive_create_product('CRM Shared QA Produto',NULL,'QA Ticket',10,true);
  SELECT * INTO t FROM public.product_tickets WHERE product_id=p.id;
  UPDATE crm_shared_state SET product_id=p.id,ticket_id=t.id;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ce100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s record; l public.crm_leads; v public.vendas; BEGIN
  SELECT * INTO s FROM crm_shared_state;
  INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador,crm_lead_id)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'CRM Shared QA Produto',10,'QA Comprador','crm-qa@example.invalid','11999999999',s.lead_id) RETURNING * INTO v;
  IF v.crm_lead_id<>s.lead_id OR v.user_id<>auth.uid() OR NOT EXISTS(SELECT 1 FROM public.crm_sale_links() WHERE lead_id=s.lead_id AND sale_id=v.id AND can_open) THEN RAISE EXCEPTION 'FAIL manual sale linkage'; END IF;
  BEGIN INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,email_comprador,whatsapp_comprador,crm_lead_id)
    VALUES(auth.uid(),s.product_id,s.ticket_id,'CRM Shared QA Produto',10,'QA Comprador','crm-qa@example.invalid','11999999999',s.lead_id); RAISE EXCEPTION 'FAIL duplicate sale'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('QA Perdido','QA Atleta','11999999999') RETURNING * INTO l;
  l:=public.crm_transition(l.id,'handoff',l.version,jsonb_build_object('closer_id',auth.uid()));
  l:=public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_perdida"}');
  IF l.pipeline_stage<>'fechado_perdido' THEN RAISE EXCEPTION 'FAIL lost sale'; END IF;
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('QA Lead Perdido','QA Atleta','11999999999') RETURNING * INTO l;
  l:=public.crm_transition(l.id,'lose',l.version);
  IF l.pipeline_stage<>'lead_perdido' THEN RAISE EXCEPTION 'FAIL lost lead'; END IF;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ce100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ DECLARE l public.crm_leads; s record; BEGIN
  SELECT * INTO s FROM crm_shared_state;
  IF NOT EXISTS(SELECT 1 FROM public.crm_sale_links() WHERE lead_id=s.lead_id AND sale_id IS NULL AND NOT can_open) THEN RAISE EXCEPTION 'FAIL shared sale status or sales disclosure'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=s.lead_id;
  BEGIN PERFORM public.crm_transition(l.id,'handoff',l.version); RAISE EXCEPTION 'FAIL closer performed SDR handoff'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ce100000-0000-4000-8000-000000000007","role":"authenticated"}',true);
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM crm_shared_state;
  IF public.crm_has_access() OR EXISTS(SELECT 1 FROM public.crm_leads WHERE id=s.lead_id) OR EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id) THEN RAISE EXCEPTION 'FAIL no-access RLS'; END IF;
  BEGIN PERFORM public.crm_transition(s.lead_id,'claim',1); RAISE EXCEPTION 'FAIL no-access RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{"sub":"ce100000-0000-4000-8000-000000000008","role":"authenticated"}',true);
DO $$ DECLARE s record; BEGIN SELECT * INTO s FROM crm_shared_state;
  IF public.crm_has_access() OR EXISTS(SELECT 1 FROM public.crm_leads WHERE id=s.lead_id) THEN RAISE EXCEPTION 'FAIL suspended RLS'; END IF;
  BEGIN PERFORM public.crm_transition(s.lead_id,'note',1,'{"note":"Forbidden"}'); RAISE EXCEPTION 'FAIL suspended RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.crm_transition(gen_random_uuid(),'claim',1); RAISE EXCEPTION 'FAIL anonymous RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_call_assignees(); RAISE EXCEPTION 'FAIL anonymous directory'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
