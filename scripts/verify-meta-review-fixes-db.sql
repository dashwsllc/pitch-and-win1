BEGIN;
SET LOCAL statement_timeout='90s';
CREATE FUNCTION pg_temp.capture(p_account text,p_start date,p_end date,p_rows jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE id uuid; claim uuid; part jsonb; nxt jsonb; n int:=0; total int:=jsonb_array_length(p_rows); count_rows int;
BEGIN
 id:=public.meta_capture_open(p_account,'campaign',p_start,p_end,
   jsonb_build_object('level','campaign','time_increment','1','fields','spend,actions','time_range',jsonb_build_object('since',p_start,'until',p_end)::text),
   jsonb_build_object('id',p_account,'name','Synthetic account','currency','BRL','timezone','America/Sao_Paulo'),'cron',NULL);
 claim:=(public.meta_capture_claim(id)->>'claim_token')::uuid;
 LOOP
  SELECT coalesce(jsonb_agg(value),'[]') INTO part FROM jsonb_array_elements(p_rows) WITH ORDINALITY r(value,pos) WHERE pos>n*500 AND pos<=(n+1)*500;
  nxt:=CASE WHEN (n+1)*500<total THEN jsonb_build_object('path','/act_'||p_account||'/insights','params',jsonb_build_object('after','page-'||(n+1))) END;
  PERFORM public.meta_capture_append(id,claim,n,md5(part::text),part,nxt);
  PERFORM public.meta_capture_append(id,claim,n,md5(part::text),part,nxt);
  n:=n+1; EXIT WHEN nxt IS NULL;
 END LOOP;
 RETURN public.meta_capture_prepare(id,claim);
END $$;

CREATE FUNCTION pg_temp.begin_case(acct text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES(acct,'Synthetic','BRL','America/Sao_Paulo','active',actor);
END $$;
CREATE FUNCTION pg_temp.capture_case(acct text, items jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE review uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 review:=pg_temp.capture(acct,'2026-10-09','2026-10-09',items);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 RETURN review;
END $$;
-- CASE identity

DO $$
DECLARE item jsonb:='{"date":"2026-10-09","account_id":"93001","level":"campaign","campaign_id":"A","campaign_name":"A","spend":10,"leads":2,"purchases":0}'; review uuid; fact public.meta_traffic_daily; row_no int;
BEGIN
 PERFORM pg_temp.begin_case('93001');
 review:=pg_temp.capture_case('93001',jsonb_build_array(item));
 PERFORM public.meta_capture_review_decide(review,1,'aprovar');
 SELECT * INTO fact FROM public.meta_traffic_daily WHERE account_id='93001';
 PERFORM public.meta_edit_traffic_row(fact.id,fact.updated_at,'{"campaign_id":"B"}','Corrigir identidade');
 review:=pg_temp.capture_case('93001',jsonb_build_array(item));
 SELECT r.row_no INTO row_no FROM public.meta_capture_review_rows r WHERE review_id=review;
 PERFORM public.meta_capture_review_resolve(review,1,row_no,'use_incoming',NULL,'Restaurar identidade recebida');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(spend)=10 FROM public.meta_traffic_daily WHERE account_id='93001'),'identity resolution duplicated published totals');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_traffic_daily d WHERE d.id=fact.id AND campaign_id='A' AND first_origin=fact.first_origin AND original_key=fact.original_key),'identity resolution lost stable ID or first origin');
END $$;
-- CASE pending-divergence

DO $$
DECLARE item jsonb; review uuid; row_no int; acct text;
BEGIN
 FOREACH acct IN ARRAY ARRAY['93002','93003'] LOOP
  PERFORM pg_temp.begin_case(acct);
  item:=jsonb_build_object('date','2026-10-09','account_id',acct,'level','campaign','campaign_id','A','campaign_name','A','spend',10,'leads',2,'purchases',0);
  review:=pg_temp.capture_case(acct,jsonb_build_array(item));
  PERFORM public.meta_capture_review_edit(review,1,0,CASE WHEN acct='93003' THEN '{"spend":12,"campaign_id":"B"}'::jsonb ELSE '{"spend":12}'::jsonb END,'Correção pendente');
  review:=pg_temp.capture_case(acct,jsonb_build_array(item||'{"spend":20}'));
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND conflict_details->'incoming'->>'spend'='20' AND conflict_details->'edited'->>'spend'='12'),'recapture hid divergence from pending edited proposal');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_decide(%L,1,%L)',review,'aprovar'),'PT409');
  PERFORM public.meta_capture_review_resolve(review,1,0,'use_edited','{}','Manter correção deliberadamente');
  PERFORM public.meta_capture_review_decide(review,2,'aprovar');
  PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(spend)=12 FROM public.meta_traffic_daily WHERE account_id=acct),'recapture resolution did not preserve selected edit');
 END LOOP;
END $$;
-- CASE pending-absence

DO $$
DECLARE item jsonb:='{"date":"2026-10-09","account_id":"93004","level":"campaign","campaign_id":"A","campaign_name":"A","spend":10,"leads":2,"purchases":0}'; review uuid;
BEGIN
 PERFORM pg_temp.begin_case('93004');
 review:=pg_temp.capture_case('93004',jsonb_build_array(item));
 PERFORM public.meta_capture_review_edit(review,1,0,'{"spend":12}','Correção pendente');
 review:=pg_temp.capture_case('93004','[]');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND conflict_details->>'reason'='edited_absent_requires_review' AND conflict_details->'incoming'='null'::jsonb),'complete empty capture hid absent edited proposal');
 PERFORM public.meta_capture_review_resolve(review,1,0,'remove',NULL,'Descartar proposta ausente');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id='93004'),'discarded unpublished proposal was published');
END $$;
-- CASE csv-stale-target

DO $$
DECLARE item jsonb:='{"date":"2026-10-09","account_id":"93005","level":"campaign","campaign_id":"A","campaign_name":"A","spend":10,"leads":2,"purchases":0,"present_metrics":["leads","purchases"]}'; b public.meta_import_batches; rival public.meta_import_batches; fact public.meta_traffic_daily; response jsonb;
BEGIN
 PERFORM pg_temp.begin_case('93005');
 response:=public.meta_import_daily('initial.csv',jsonb_build_array(item));
 SELECT * INTO b FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 PERFORM public.meta_review_traffic_import(b.id,'aprovar',b.updated_at);
 response:=public.meta_import_daily('stale.csv',jsonb_build_array(item||'{"spend":20}'));
 SELECT * INTO b FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 SELECT * INTO fact FROM public.meta_traffic_daily WHERE account_id='93005';
 PERFORM public.meta_edit_traffic_row(fact.id,fact.updated_at,'{"spend":15}','Correção após upload');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_review_traffic_import(%L,%L,%L)',b.id,'aprovar',b.updated_at),'PT409');
 PERFORM pg_temp.assert((SELECT spend=15 FROM public.meta_traffic_daily WHERE id=fact.id),'stale CSV overwrote intervening published edit');
 response:=public.meta_import_daily('absent.csv',jsonb_build_array(item||'{"campaign_id":"B"}'));
 SELECT * INTO b FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 response:=public.meta_import_daily('rival.csv',jsonb_build_array(item||'{"campaign_id":"B","spend":30}'));
 SELECT * INTO rival FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 PERFORM public.meta_review_traffic_import(rival.id,'aprovar',rival.updated_at);
 PERFORM pg_temp.expect_error(format('SELECT public.meta_review_traffic_import(%L,%L,%L)',b.id,'aprovar',b.updated_at),'PT409');
 PERFORM pg_temp.assert((SELECT spend=30 FROM public.meta_traffic_daily WHERE account_id='93005' AND campaign_id='B'),'stale absent target overwrote rival publication');
END $$;
-- CASE manual-availability

DO $$
DECLARE item jsonb:='{"date":"2026-10-09","account_id":"93006","level":"campaign","campaign_id":"A","campaign_name":"A","spend":10,"leads":0,"purchases":0,"available_metrics":["spend"],"metric_metadata":{"definition_version":"canonical-v1","lead_action":null,"purchase_action":null}}'; review uuid; fact public.meta_traffic_daily;
BEGIN
 PERFORM pg_temp.begin_case('93006');
 review:=pg_temp.capture_case('93006',jsonb_build_array(item));
 PERFORM public.meta_capture_review_edit(review,1,0,'{"leads":10}','Informar resultado ausente');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND payload->'available_metrics' ? 'leads'),'pending manual metric remains unavailable');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 SELECT * INTO fact FROM public.meta_traffic_daily WHERE account_id='93006';
 PERFORM public.meta_edit_traffic_row(fact.id,fact.updated_at,'{"purchases":2}','Informar compras ausentes');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE id=fact.id AND purchases=2 AND available_metrics @> ARRAY['leads','purchases'] AND metric_metadata->'manual_metrics' ? 'purchases'),'published manual metric remains unavailable or lacks provenance');
 review:=pg_temp.capture_case('93006',jsonb_build_array(item));
 PERFORM public.meta_capture_review_resolve(review,1,0,'use_edited','{"leads":7}','Correção explícita no conflito');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND payload->'available_metrics' ? 'leads' AND payload->'metric_metadata'->'manual_metrics' ? 'leads'),'resolved manual metric remains unavailable');
END $$;
-- CASE manual-zero
DO $$
DECLARE item jsonb:='{"date":"2026-10-09","account_id":"93007","level":"campaign","campaign_id":"A","campaign_name":"A","spend":10,"leads":0,"purchases":0,"available_metrics":["spend"]}'; review uuid; fact public.meta_traffic_daily; b public.meta_import_batches; response jsonb;
BEGIN
 PERFORM pg_temp.begin_case('93007');
 review:=pg_temp.capture_case('93007',jsonb_build_array(item));
 PERFORM public.meta_capture_review_decide(review,1,'aprovar');
 SELECT * INTO fact FROM public.meta_traffic_daily WHERE account_id='93007';
 PERFORM public.meta_edit_traffic_row(fact.id,fact.updated_at,'{"leads":0}','Confirmar zero antes ausente');
 PERFORM pg_temp.assert((SELECT available_metrics @> ARRAY['leads'] FROM public.meta_traffic_daily WHERE id=fact.id),'explicit published zero remains unavailable');
 response:=public.meta_import_daily('zero.csv',jsonb_build_array((item-'available_metrics')||'{"campaign_id":"B","present_metrics":[]}'));
 SELECT * INTO b FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 PERFORM public.meta_edit_import_row('metrics',b.id,0,b.updated_at,'{"leads":0}','Confirmar zero no CSV');
 PERFORM pg_temp.assert((SELECT rows->0->'present_metrics' ? 'leads' FROM public.meta_import_batches WHERE id=b.id),'explicit CSV zero remains unavailable');
END $$;
SELECT 'PASS: final review identity, divergence/absence, stale CSV and manual availability regressions' AS verification;
ROLLBACK;
