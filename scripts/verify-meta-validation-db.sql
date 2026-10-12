BEGIN;
SET LOCAL statement_timeout='90s';
-- The runner inserts scripts/helpers/meta-db-fixtures.sql here.
DO $$
DECLARE manager uuid; pending uuid; suspended uuid; item jsonb; invalid jsonb; response jsonb; batch public.meta_import_batches; published public.meta_traffic_daily;
BEGIN
 manager:=pg_temp.seed_meta_actor('approved',false,'traffic_manager');
 pending:=pg_temp.seed_meta_actor('pending',false,'executive');
 suspended:=pg_temp.seed_meta_actor('approved',true,'executive');
 PERFORM set_config('request.jwt.claim.sub',manager::text,true);
 item:='{"date":"2026-10-09","level":"campaign","account_id":"123","campaign_id":"A","campaign_name":"Campanha A","currency":"BRL","spend":10,"leads":2,"purchases":0}';
 FOR invalid IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
   item||'{"spend":-1}',item||'{"level":null}',item||'{"leads":1.5}',item||'{"currency":"USD"}',
   item||'{"account_id":"act_act_123"}',item||'{"date":"2026-02-30"}',item||'{"date":"2026-02-29"}',
   item||'{"level":"ad"}',item||'{"spend":"Infinity"}',item||'{"impressions":9007199254740992}'
 )) LOOP
   PERFORM pg_temp.expect_error(format('SELECT public.meta_validate_traffic_row(%L::jsonb)',invalid),'22023');
 END LOOP;
 PERFORM public.meta_validate_traffic_row(item||'{"date":"2024-02-29"}');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_import_daily(%L,%L::jsonb)','duplicate.csv',jsonb_build_array(item,item)),'22023');
 response:=public.meta_import_daily('collision.csv',jsonb_build_array(item,item||'{"campaign_id":"B","spend":20}'));
 SELECT * INTO batch FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 PERFORM pg_temp.expect_error(format('SELECT public.meta_edit_import_row(%L,%L,0,%L,%L::jsonb,%L)','metrics',batch.id,batch.updated_at,'{"campaign_id":"B"}','Corrigir identificação'),'23505');
 PERFORM pg_temp.assert((SELECT rows->0->>'campaign_id'='A' AND jsonb_array_length(rows)=2 FROM public.meta_import_batches WHERE id=batch.id),'collision lost pending row');
 batch:=public.meta_review_traffic_import(batch.id,'aprovar',batch.updated_at);
 SELECT * INTO published FROM public.meta_traffic_daily WHERE campaign_id='A' AND account_id='123';
 response:=public.meta_import_daily('partial.csv',jsonb_build_array(item||'{"spend":12,"leads":0,"present_metrics":[]}'));
 SELECT * INTO batch FROM public.meta_import_batches WHERE id=(response->>'batch_id')::uuid;
 PERFORM public.meta_review_traffic_import(batch.id,'aprovar',batch.updated_at);
 PERFORM pg_temp.assert((SELECT spend=12 AND leads=2 FROM public.meta_traffic_daily WHERE id=published.id),'partial CSV erased lead count');
 PERFORM set_config('request.jwt.claim.sub',pending::text,true);
 PERFORM pg_temp.expect_error('SELECT public.meta_connect_ad_account(''456'',''QA'')','42501');
 PERFORM set_config('request.jwt.claim.sub',suspended::text,true);
 PERFORM pg_temp.expect_error('SELECT public.meta_connect_ad_account(''456'',''QA'')','42501');
 PERFORM set_config('request.jwt.claim.sub',manager::text,true);
 response:=public.meta_import_leads('incomplete.csv','[{"meta_lead_id":"synthetic-incomplete","full_name":"","phone":"","email":"","field_data":[{"name":"Motivação","values":["Livre"]}]}]');
 PERFORM pg_temp.assert(response->>'status'='recebido' AND (response->'result'->>'received')::int=1
   AND EXISTS(SELECT 1 FROM public.meta_form_leads WHERE meta_lead_id='synthetic-incomplete' AND approval_status='pendente' AND wave_id IS NOT NULL AND crm_lead_id IS NULL),'incomplete lead discarded');
END $$;
SELECT 'PASS: traffic validation, collision, access and partial imports' AS verification;
ROLLBACK;
