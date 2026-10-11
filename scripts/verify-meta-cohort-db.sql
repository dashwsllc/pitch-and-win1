BEGIN;
SET LOCAL statement_timeout='60s';
CREATE FUNCTION pg_temp.cohort_capture(p_account text,p_rows jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE run uuid; claim uuid; review uuid; zone text;
BEGIN
 SELECT timezone INTO zone FROM public.meta_ad_accounts WHERE account_id=p_account;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 run:=public.meta_capture_open(p_account,'campaign','2026-10-07','2026-10-09',
  '{"level":"campaign","time_range":"{\"since\":\"2026-10-07\",\"until\":\"2026-10-09\"}"}',
  jsonb_build_object('id',p_account,'currency','BRL','timezone',zone),'cron',NULL);
 claim:=(public.meta_capture_claim(run)->>'claim_token')::uuid;
 PERFORM public.meta_capture_append(run,claim,0,md5(p_rows::text),p_rows,NULL);
 review:=public.meta_capture_prepare(run,claim);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM public.meta_capture_review_decide(review,1,'aprovar');
 RETURN review;
END $$;
DO $$
DECLARE actor uuid; sdr uuid; suspended uuid; form uuid; crm uuid; sale uuid; product uuid; ticket uuid;
 run uuid; claim uuid; review uuid; batch public.meta_import_batches; result jsonb; rows jsonb; item jsonb; n int; status text;
 prefix text:='qa-cohort-'||gen_random_uuid();
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 sdr:=pg_temp.seed_meta_actor('approved',false,'sdr');
 suspended:=pg_temp.seed_meta_actor('approved',true,'executive');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 -- Contract first: RED before the additive cohort RPC exists.
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123','A',NULL);
 INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES
 ('123','Synthetic SP','BRL','America/Sao_Paulo','active',actor),('124','Synthetic other zone','BRL','America/Los_Angeles','active',actor);
 SELECT jsonb_agg(jsonb_build_object('date',day::date,'account_id','123','level','campaign','campaign_id','A','campaign_name','A',
  'spend',100,'leads',0,'purchases',0,'available_metrics',jsonb_build_array('spend'),'metric_metadata',jsonb_build_object('definition_version','canonical-v1')))
 INTO rows FROM generate_series('2026-10-07'::date,'2026-10-09'::date,'1 day') day;
 review:=pg_temp.cohort_capture('123',rows);
 INSERT INTO public.products(name,created_by) VALUES('Synthetic cohort product',actor) RETURNING id INTO product;
 INSERT INTO public.product_tickets(product_id,name,price,created_by) VALUES(product,'Synthetic cohort ticket',200,actor) RETURNING id INTO ticket;
 FOR n IN 1..4 LOOP
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  form:=public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix||'-'||n,'page_id','qa-page','form_id','qa-form',
   'campaign_id','A','campaign_name','A','created_time',CASE n WHEN 1 THEN '2026-10-10T02:30:00Z' ELSE '2026-10-08T12:00:00Z' END,
   'full_name','Synthetic parent','phone','11999990000','email','qa@example.invalid','field_data',
   '[{"name":"athlete_name","values":["Synthetic athlete"]},{"name":"athlete_birth_date","values":["2010-03-15"]},{"name":"athlete_position","values":["Meia"]}]'::jsonb));
  IF n=4 THEN CONTINUE; END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.meta_review_form_lead(form,'aprovar',(SELECT updated_at FROM public.meta_form_leads WHERE id=form));
  SELECT crm_lead_id INTO STRICT crm FROM public.meta_form_leads WHERE id=form;
  UPDATE public.crm_leads SET pipeline_stage='fechado_ganho',closed_at=clock_timestamp(),closed_by=actor WHERE id=crm;
  INSERT INTO public.vendas(user_id,nome_produto,valor_venda,nome_comprador,whatsapp_comprador,email_comprador,product_id,ticket_id,crm_lead_id)
  VALUES(actor,'Synthetic',200,'Synthetic','11999990000','qa@example.invalid',product,ticket,crm) RETURNING id INTO sale;
  PERFORM set_config('dashboard.sale_decision',sale::text,true);
  UPDATE public.vendas SET approval_status='aprovada',reviewed_by=actor,reviewed_at=clock_timestamp() WHERE id=sale;
  IF n IN (2,3) THEN
   status:=CASE n WHEN 2 THEN 'cancelada' ELSE 'estornada' END;
   PERFORM public.arena_reverse_sale(sale,status,'Synthetic reversal test',(SELECT updated_at FROM public.vendas WHERE id=sale));
  END IF;
 END LOOP;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','act_123','A',NULL);
 PERFORM pg_temp.assert(result->>'state'='ready','verified full API cohort not ready');
 item:=result->'campaigns'->0;
 PERFORM pg_temp.assert((item->>'received')::int=4 AND (item->>'pending')::int=1 AND (item->>'approved')::int=3 AND (item->>'linked_crm')::int=3,'wrong approval funnel');
 PERFORM pg_temp.assert((item->>'confirmed_sales')::int=1 AND (item->>'confirmed_revenue')::numeric=200,'sale date, reversal or timezone mixed into generated cohort');
 PERFORM pg_temp.assert(item->>'coverage'='complete','full capture has unknown coverage');
 PERFORM pg_temp.assert(NOT (result::text ~ '(Synthetic parent|11999990000|qa@example.invalid)'),'cohort leaked contacts');
 EXECUTE 'RESET ROLE';
 -- Legacy inconsistent approval cannot turn a pending contact into a confirmed sale.
 UPDATE public.meta_form_leads SET approval_status='pendente' WHERE meta_lead_id=prefix||'-1';
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123','A',NULL);
 PERFORM pg_temp.assert((result->'campaigns'->0->>'confirmed_sales')::int=0,'pending contact generated attributed sale');
 UPDATE public.meta_form_leads SET approval_status='aprovado' WHERE meta_lead_id=prefix||'-1';
 -- An incomplete refresh stays visible until its replacement has been reviewed.
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 run:=public.meta_capture_open('123','campaign','2026-10-07','2026-10-09',
  '{"level":"campaign","time_range":"{\"since\":\"2026-10-07\",\"until\":\"2026-10-09\"}"}',
  '{"id":"123","currency":"BRL","timezone":"America/Sao_Paulo"}','cron',NULL);
 claim:=(public.meta_capture_claim(run)->>'claim_token')::uuid;
 PERFORM public.meta_capture_release(run,claim);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123','A',NULL);
 PERFORM pg_temp.assert(result->'campaigns'->0->>'coverage'='partial','unfinished refresh was hidden');
 PERFORM pg_temp.cohort_capture('123',rows);
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123','A',NULL);
 PERFORM pg_temp.assert(result->>'state'='ready','reviewed refresh did not restore complete coverage');
 -- CSV replaces one day of spend; commercial counts are not prorated by spend.
 result:=public.meta_import_daily('synthetic-cohort.csv','[{"date":"2026-10-08","account_id":"123","level":"campaign","campaign_id":"A","campaign_name":"A","spend":200,"leads":0,"purchases":0,"present_metrics":[]}]');
 SELECT * INTO batch FROM public.meta_import_batches WHERE id=(result->>'batch_id')::uuid;
 PERFORM public.meta_review_traffic_import(batch.id,'aprovar',batch.updated_at);
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123','A','api');
 PERFORM pg_temp.assert(result->>'state'='insufficient','partial source received complete coverage');
 PERFORM pg_temp.assert((result->'campaigns'->0->>'confirmed_sales')::int=1 AND (result->'campaigns'->0->>'confirmed_revenue')::numeric=200,'sale was prorated by source');
 -- A lead with an unknown campaign is visible as unattributed, never assigned by name.
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',prefix||'-unknown','page_id','qa-page','form_id','qa-form',
  'campaign_id','unknown-campaign','campaign_name','A','created_time','2026-10-08T12:00:00Z','field_data','[]'::jsonb));
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123',NULL,NULL);
 PERFORM pg_temp.assert((result->>'unattributed_contacts')::int=1,'unknown campaign hidden or guessed by name');
 -- Account identity must be unique across published history, even outside the range.
 PERFORM pg_temp.cohort_capture('124','[{"date":"2026-10-08","account_id":"124","level":"campaign","campaign_id":"A","campaign_name":"A","spend":50,"leads":0,"purchases":0,"available_metrics":["spend"]},{"date":"2026-10-08","account_id":"124","level":"campaign","campaign_id":"C","campaign_name":"C","spend":50,"leads":0,"purchases":0,"available_metrics":["spend"]}]');
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09',NULL,'A',NULL);
 PERFORM pg_temp.assert(result->'campaigns'->0->>'coverage'='unknown','ambiguous account identity guessed');
 result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','124','C',NULL);
 PERFORM pg_temp.assert(result->'campaigns'->0->>'coverage'='unknown','unique non-Brasilia campaign calendar accepted');
 PERFORM pg_temp.assert(result->>'state'='insufficient','other account calendar accepted for Brasilia cohort');
 PERFORM set_config('request.jwt.claim.sub',sdr::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error('SELECT public.meta_traffic_cohort(''2026-10-07'',''2026-10-09'')','42501');
 EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claim.sub',suspended::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error('SELECT public.meta_traffic_cohort(''2026-10-07'',''2026-10-09'')','42501');
 EXECUTE 'RESET ROLE';
END $$;
SELECT 'PASS: cohort generated date, Brasilia calendar, current approved sales, reversals, source coverage, identity, permissions and no contacts' AS verification;
ROLLBACK;
