-- Disposable fixtures only. The runner always rolls back this entire test.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'a9e51000-0000-4000-8000-%') THEN
    RAISE EXCEPTION 'Manual sale QA fixture IDs already exist; refusing to reuse accounts';
  END IF;
END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT ('a9e51000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'manual-ticket-qa-'||n||'@example.invalid',jsonb_build_object('display_name','Manual Ticket QA '||n),'{}',now(),now()
FROM generate_series(1,2) n;
UPDATE public.registration_requests SET status='approved',reviewed_at=clock_timestamp()
WHERE user_id::text LIKE 'a9e51000-0000-4000-8000-%';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'a9e51000-0000-4000-8000-%';
INSERT INTO public.user_roles(user_id,role,commission_rate,crm_access) VALUES
('a9e51000-0000-4000-8000-000000000001','super_admin',10,true),
('a9e51000-0000-4000-8000-000000000002','closer',10,true);

CREATE TEMP TABLE manual_sync_baseline(key text PRIMARY KEY,value numeric);
SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO manual_sync_baseline
SELECT 'home',coalesce(sum(valor_venda),0) FROM public.dashboard_home_sales(NULL,NULL)
UNION ALL SELECT 'count',count(*) FROM public.dashboard_home_sales(NULL,NULL)
UNION ALL SELECT 'daily',(public.get_company_goal_totals()->'daily'->>'amount')::numeric
UNION ALL SELECT 'weekly',(public.get_company_goal_totals()->'weekly'->>'amount')::numeric
UNION ALL SELECT 'monthly',(public.get_company_goal_totals()->'monthly'->>'amount')::numeric
UNION ALL SELECT 'revision',revision FROM public.dashboard_events WHERE topic='sales';

SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.vendas(id,user_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador,payment_type,deposit_amount)
VALUES('a9e51000-0000-4000-8000-000000000010','a9e51000-0000-4000-8000-000000000002',
  'Manual Ticket Sync QA',1497.50,'Sync Ticket QA Buyer','11999999999','','sinal',200.25);
DO $$ DECLARE s public.vendas; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='a9e51000-0000-4000-8000-000000000010';
  IF s.valor_venda<>1497.50 OR s.ticket_id IS NOT NULL OR s.commission_amount<>0
    OR public.get_available_balance(s.user_id)<>0 OR public.get_pending_commission(s.user_id)<>149.75 THEN
    RAISE EXCEPTION 'Pending manual value, estimated commission or balance does not match';
  END IF;
  -- Both paths were blocked by mandatory catalog/email validation before this fix.
  s:=public.manage_sale(s.id,'edit',s.updated_at,'{"consideracoes_gerais":"Contact edit without email"}');
  s:=public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":1750.50}');
  IF s.valor_venda<>1750.50 OR s.email_comprador<>'' OR s.ticket_id IS NOT NULL
    OR public.get_pending_commission(s.user_id)<>175.05 THEN
    RAISE EXCEPTION 'Pending manual correction was not preserved';
  END IF;
END $$;
RESET ROLE;

-- Validate all aggregate consumers against the same recorded value, after approval and correction.
CREATE FUNCTION pg_temp.verify_manual_value(expected numeric, expected_commission numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s public.vendas; amount numeric; quantity bigint; board jsonb; ranking jsonb; period text; goals jsonb;
BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='a9e51000-0000-4000-8000-000000000010';
  IF s.valor_venda IS DISTINCT FROM expected OR s.commission_amount IS DISTINCT FROM expected_commission
    OR s.deposit_amount<>200.25 OR s.ticket_id IS NOT NULL THEN
    RAISE EXCEPTION 'Sale, cents, deposit or approved commission diverged';
  END IF;
  IF public.get_available_balance(s.user_id) IS DISTINCT FROM expected_commission
    OR public.get_pending_commission(s.user_id)<>0
    OR NOT EXISTS (SELECT 1 FROM public.saldos_disponiveis WHERE user_id=s.user_id
      AND valor_total_comissoes=expected_commission AND valor_liberado_para_saque=expected_commission) THEN
    RAISE EXCEPTION 'Available balance or commission ledger diverged';
  END IF;
  SELECT coalesce(sum(valor_venda),0),count(*) INTO amount,quantity FROM public.dashboard_home_sales(NULL,NULL);
  IF amount-(SELECT value FROM manual_sync_baseline WHERE key='home') IS DISTINCT FROM expected
    OR quantity-(SELECT value FROM manual_sync_baseline WHERE key='count')<>1 THEN
    RAISE EXCEPTION 'Home revenue/count diverged or deposit was counted twice';
  END IF;
  board:=public.get_sales_board('aprovada','Manual Ticket Sync QA',0,12);
  IF (board->'items'->0->>'valor_venda')::numeric IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Sales board diverged';
  END IF;
  goals:=public.get_company_goal_totals();
  FOREACH period IN ARRAY ARRAY['daily','weekly','monthly'] LOOP
    IF (goals->period->>'amount')::numeric-(SELECT value FROM manual_sync_baseline WHERE key=period) IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Company goal % diverged: got %, baseline %, expected increment %',period,goals->period->>'amount',(SELECT value FROM manual_sync_baseline WHERE key=period),expected;
    END IF;
  END LOOP;
  SELECT item INTO ranking FROM jsonb_array_elements(public.get_team_ranking()) item WHERE item->>'user_id'=s.user_id::text;
  IF (ranking->>'totalVendas')::numeric IS DISTINCT FROM expected OR (ranking->>'quantidadeVendas')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Closer ranking diverged';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_sale_facts WHERE sale_id=s.id AND active AND revenue=expected AND occurred_at=s.created_at)
    OR NOT EXISTS (SELECT 1 FROM public.arena_closer_weekly_sale_facts WHERE sale_id=s.id AND revenue=expected) THEN
    RAISE EXCEPTION 'Arena or weekly credit diverged';
  END IF;
  IF (SELECT revision FROM public.dashboard_events WHERE topic='sales') <= (SELECT value FROM manual_sync_baseline WHERE key='revision') THEN
    RAISE EXCEPTION 'Dashboard refresh revision was not signaled';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s public.vendas; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='a9e51000-0000-4000-8000-000000000010';
  -- Insertion uses clock_timestamp(), while the test transaction freezes now().
  -- Use the authorized date correction so the fixture belongs to every current-period reader.
  PERFORM public.super_admin_reschedule_sale(s.id,now()-interval '1 minute','Transactional manual value sync QA',s.created_at,s.approval_status);
  PERFORM public.executive_review_sale(s.id,'approve');
END $$;
RESET ROLE;
SELECT pg_temp.verify_manual_value(1750.50,175.05);

SET LOCAL ROLE authenticated;
DO $$ DECLARE s public.vendas; stale timestamptz; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='a9e51000-0000-4000-8000-000000000010';
  stale:=s.updated_at;
  s:=public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":1825.75}');
  BEGIN
    PERFORM public.manage_sale(s.id,'edit',stale,'{"valor_venda":1800}');
    RAISE EXCEPTION 'Stale edit was accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
    PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"email_comprador":"invalid"}');
    RAISE EXCEPTION 'Malformed email was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":0}');
    RAISE EXCEPTION 'Zero value was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":100}');
    RAISE EXCEPTION 'Value below paid deposit was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.verify_manual_value(1825.75,182.58);

-- Owners still cannot alter an approved sale.
SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s public.vendas; BEGIN
  SELECT * INTO s FROM public.vendas WHERE id='a9e51000-0000-4000-8000-000000000010';
  BEGIN
    PERFORM public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":1900}');
    RAISE EXCEPTION 'Seller changed approved value';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Existing catalog-linked records and older clients retain their catalog metadata.
SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000001","role":"authenticated"}',true);
CREATE TEMP TABLE manual_sync_catalog(product_id uuid,ticket_id uuid);
GRANT ALL ON manual_sync_catalog TO authenticated;
DO $$ DECLARE p public.products; BEGIN
  p:=public.executive_create_product('Manual Sync Catalog QA',NULL,'Legacy',2997,true);
  INSERT INTO manual_sync_catalog SELECT p.id,id FROM public.product_tickets WHERE product_id=p.id;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s public.vendas; c record; BEGIN
  SELECT * INTO c FROM manual_sync_catalog;
  INSERT INTO public.vendas(user_id,product_id,ticket_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador)
  VALUES('a9e51000-0000-4000-8000-000000000002',c.product_id,c.ticket_id,'Manual Sync Catalog QA',2997,'Legacy QA Buyer','11999999998','') RETURNING * INTO s;
  s:=public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":2500.75}');
  IF s.valor_venda<>2500.75 OR s.product_id<>c.product_id OR s.ticket_id<>c.ticket_id OR s.ticket_name<>'Legacy' THEN
    RAISE EXCEPTION 'Legacy catalog metadata changed or replaced the corrected value';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000001","role":"authenticated"}',true);
UPDATE public.product_tickets SET active=false WHERE id IN (SELECT ticket_id FROM manual_sync_catalog);
UPDATE public.products SET active=false WHERE id IN (SELECT product_id FROM manual_sync_catalog);
SELECT set_config('request.jwt.claims','{"sub":"a9e51000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s public.vendas; c record; BEGIN
  SELECT * INTO c FROM manual_sync_catalog;
  SELECT * INTO s FROM public.vendas WHERE product_id=c.product_id;
  s:=public.manage_sale(s.id,'edit',s.updated_at,'{"valor_venda":2450.50}');
  IF s.valor_venda<>2450.50 OR s.product_id<>c.product_id OR s.ticket_id<>c.ticket_id OR s.ticket_name<>'Legacy' THEN
    RAISE EXCEPTION 'Inactive legacy catalog metadata blocked or changed a value-only correction';
  END IF;
END $$;
RESET ROLE;
SELECT jsonb_build_object('validation','passed','fixtures','rolled_back',
  'checks',jsonb_build_array('manual value','optional email','pending edit','approval','approved edit','cents',
    'home revenue','sales board','commissions','available balance','daily/weekly/monthly goals','ranking',
    'Arena/weekly credit','realtime revision','stale edit','invalid input','approved-sale permissions')) AS result;
