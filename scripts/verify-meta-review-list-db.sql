BEGIN;
SET LOCAL statement_timeout='60s';
DO $$
DECLARE actor uuid; result jsonb; detail text; run uuid; claim uuid; review uuid; item jsonb;
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 result:=public.meta_traffic_review_list('metrics','pendente',0,50);
 -- Large historical arrays never enter the list response.
 INSERT INTO public.meta_import_batches(imported_by,filename,row_count,rows)
 SELECT actor,'Synthetic review '||n,500,jsonb_agg(jsonb_build_object('campaign_name',repeat('x',1000)))
 FROM generate_series(1,100) n CROSS JOIN generate_series(1,500) row GROUP BY n;
 result:=public.meta_traffic_review_list('metrics','pendente',0,50);
 PERFORM pg_temp.assert((result->>'count')::int=100 AND jsonb_array_length(result->'rows')=50,'list not paginated');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') r WHERE r ? 'rows'),'embedded batch arrays fetched');
 PERFORM pg_temp.assert(pg_column_size(result)<50000,'list scales with internal rows');
 INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES('93001','Synthetic review account','BRL','America/Sao_Paulo','active',actor);
 item:='{"date":"2026-10-09","level":"campaign","account_id":"93001","campaign_id":"A","campaign_name":"A","spend":10,"leads":2,"purchases":0,"available_metrics":["spend","leads"]}';
 FOR stage IN 1..2 LOOP
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  run:=public.meta_capture_open('93001','campaign','2026-10-09','2026-10-09','{"level":"campaign","time_range":"{\"since\":\"2026-10-09\",\"until\":\"2026-10-09\"}"}',
    '{"id":"93001","currency":"BRL","timezone":"America/Sao_Paulo"}','cron',NULL);
  claim:=(public.meta_capture_claim(run)->>'claim_token')::uuid;
  PERFORM public.meta_capture_append(run,claim,0,md5(stage::text),CASE stage WHEN 1 THEN jsonb_build_array(item,item||'{"campaign_id":"B"}') ELSE jsonb_build_array(item) END,NULL);
  review:=public.meta_capture_prepare(run,claim);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF stage=1 THEN
   PERFORM public.meta_capture_review_decide(review,1,'aprovar');
   PERFORM pg_temp.assert((public.meta_capture_review_part(review,2,0,500)->>'total')::int=2,'approved history unreadable');
   PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_part(%L,1,0,500)',review),'40001');
  END IF;
 END LOOP;
 result:=public.meta_traffic_review_list('metrics','pendente',0,50);
 SELECT r::text INTO detail FROM jsonb_array_elements(result->'rows') r WHERE r->>'id'=review::text;
 -- The new revision may sort outside page 1 because all CSV fixtures share now(). Find it on the remaining page.
 IF detail IS NULL THEN result:=public.meta_traffic_review_list('metrics','pendente',50,50);SELECT r::text INTO detail FROM jsonb_array_elements(result->'rows') r WHERE r->>'id'=review::text; END IF;
 IF detail IS NULL THEN result:=public.meta_traffic_review_list('metrics','pendente',100,50);SELECT r::text INTO detail FROM jsonb_array_elements(result->'rows') r WHERE r->>'id'=review::text; END IF;
 PERFORM pg_temp.assert((detail::jsonb->>'row_count')::int=2 AND (detail::jsonb->>'remove_count')::int=1,'summary omitted a removal outside captured rows');
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error('SELECT public.meta_traffic_review_list(''metrics'',NULL,0,51)','22023');
 EXECUTE 'RESET ROLE';PERFORM set_config('request.jwt.claim.sub','',true);EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error('SELECT public.meta_traffic_review_list(''metrics'',NULL,0,50)','42501');
 EXECUTE 'RESET ROLE';
END $$;
SELECT 'PASS: review metadata pagination, bounded payload, whole-revision removal summary and permissions' AS verification;
ROLLBACK;
