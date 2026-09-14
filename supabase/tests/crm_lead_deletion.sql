-- Isolated fixtures; the runner always wraps this file in a transaction.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) VALUES
  ('ae140000-0000-4000-8000-000000000001','lead-delete-admin@example.invalid','{"display_name":"Lead Delete Admin"}','{}',now(),now()),
  ('ae140000-0000-4000-8000-000000000002','lead-delete-seller@example.invalid','{"display_name":"Lead Delete Seller"}','{}',now(),now()),
  ('ae140000-0000-4000-8000-000000000003','lead-delete-no-access@example.invalid','{"display_name":"Lead Delete BDR"}','{}',now(),now());
INSERT INTO public.registration_requests(user_id,display_name,email,requested_role,status,reviewed_at)
SELECT id,raw_user_meta_data->>'display_name',email,'seller','approved',now()
FROM auth.users WHERE id::text LIKE 'ae140000-%'
ON CONFLICT(user_id) DO UPDATE SET status='approved',reviewed_at=now();
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ae140000-%';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES
  ('ae140000-0000-4000-8000-000000000001','executive',false),
  ('ae140000-0000-4000-8000-000000000002','seller',false),
  ('ae140000-0000-4000-8000-000000000003','bdr',false);
UPDATE public.user_roles SET commission_rate=20
  WHERE user_id='ae140000-0000-4000-8000-000000000002';

CREATE TEMP TABLE crm_delete_state(
  lead_id uuid,
  lead_version bigint,
  sale_id uuid,
  product_id uuid,
  ticket_id uuid
);
GRANT ALL ON crm_delete_state TO authenticated;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims','{"sub":"ae140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE p public.products; BEGIN
  p:=public.executive_create_product('Lead Delete QA',NULL,'Plano QA',100,true);
  INSERT INTO crm_delete_state(product_id,ticket_id)
    SELECT p.id,id FROM public.product_tickets WHERE product_id=p.id;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ae140000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE l public.crm_leads; v public.vendas; s crm_delete_state; r jsonb; BEGIN
  SELECT * INTO s FROM crm_delete_state;
  INSERT INTO public.crm_leads(name,athlete_name,phone)
    VALUES('Responsável Delete QA','Atleta Delete QA','11999999999') RETURNING * INTO l;
  PERFORM public.crm_add_lead_context(l.id,'manual_note','Contexto que deve acompanhar a exclusão');
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description)
    VALUES(l.id,auth.uid(),'nota','Histórico descartável','Atividade QA');
  l:=public.crm_transition(l.id,'handoff',l.version,jsonb_build_object('closer_id',auth.uid()));
  l:=public.crm_transition(l.id,'close',l.version,'{"outcome":"venda_concluida"}');
  INSERT INTO public.vendas(
    user_id,product_id,ticket_id,nome_produto,valor_venda,
    nome_comprador,email_comprador,whatsapp_comprador,crm_lead_id
  ) VALUES (
    auth.uid(),s.product_id,s.ticket_id,'Lead Delete QA',100,
    'Comprador preservado','buyer@example.invalid','11999998888',l.id
  ) RETURNING * INTO v;
  UPDATE crm_delete_state SET lead_id=l.id,lead_version=l.version,sale_id=v.id;
  BEGIN
    DELETE FROM public.crm_leads WHERE id=l.id;
    RAISE EXCEPTION 'FAIL: direct lead deletion bypassed RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.vendas SET crm_lead_id=NULL WHERE id=v.id;
    RAISE EXCEPTION 'FAIL: direct sale detachment bypassed CRM deletion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.crm_delete_lead(l.id,l.version-1);
    RAISE EXCEPTION 'FAIL: stale lead deletion';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  IF NOT EXISTS(SELECT 1 FROM public.crm_leads WHERE id=l.id)
    OR NOT EXISTS(SELECT 1 FROM public.vendas WHERE id=v.id AND crm_lead_id=l.id) THEN
    RAISE EXCEPTION 'FAIL: stale deletion changed data';
  END IF;
END; $$;

-- The hardest link to detach is an approved sale because all financial fields
-- are frozen. Approval happens first so the deletion proves they remain frozen.
SELECT set_config('request.jwt.claims','{"sub":"ae140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s crm_delete_state; BEGIN
  SELECT * INTO s FROM crm_delete_state;
  PERFORM public.executive_review_sale(s.sale_id,'approve');
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ae140000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE s crm_delete_state; BEGIN
  SELECT * INTO s FROM crm_delete_state;
  BEGIN
    PERFORM public.crm_delete_lead(s.lead_id,s.lead_version);
    RAISE EXCEPTION 'FAIL: user without CRM access deleted lead';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ae140000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE s crm_delete_state; r jsonb; BEGIN
  SELECT * INTO s FROM crm_delete_state;
  r:=public.crm_delete_lead(s.lead_id,s.lead_version);
  IF r->>'lead_id'<>s.lead_id::text OR r->>'detached_sales'<>'1' THEN
    RAISE EXCEPTION 'FAIL: deletion result';
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_leads WHERE id=s.lead_id)
    OR EXISTS(SELECT 1 FROM public.crm_activities WHERE lead_id=s.lead_id)
    OR EXISTS(SELECT 1 FROM public.crm_lead_contexts WHERE lead_id=s.lead_id) THEN
    RAISE EXCEPTION 'FAIL: lead dependents were not deleted';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.vendas
    WHERE id=s.sale_id AND crm_lead_id IS NULL AND valor_venda=100
      AND nome_comprador='Comprador preservado' AND approval_status='aprovada'
      AND commission_amount=20
  ) THEN RAISE EXCEPTION 'FAIL: linked sale was changed or removed'; END IF;
  IF EXISTS(SELECT 1 FROM public.executive_audit_events WHERE target_id=s.lead_id) THEN
    RAISE EXCEPTION 'FAIL: seller can read administrative deletion audit';
  END IF;
  BEGIN
    PERFORM public.crm_delete_lead(s.lead_id,s.lead_version);
    RAISE EXCEPTION 'FAIL: deleted lead was deleted twice';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END; $$;

SELECT set_config('request.jwt.claims','{"sub":"ae140000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE s crm_delete_state; audit jsonb; BEGIN
  SELECT * INTO s FROM crm_delete_state;
  SELECT before_data INTO audit FROM public.executive_audit_events
    WHERE target_id=s.lead_id AND action='crm.lead.delete';
  IF audit IS NULL OR audit->>'athlete_name'<>'Atleta Delete QA'
    OR (audit->>'activities_count')::integer<2
    OR audit->>'contexts_count'<>'1'
    OR audit->>'linked_sales_count'<>'1' THEN
    RAISE EXCEPTION 'FAIL: deletion audit is incomplete';
  END IF;
END; $$;

RESET ROLE;
