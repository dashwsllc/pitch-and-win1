BEGIN;
SET LOCAL statement_timeout='90s';
DO $$ BEGIN
 PERFORM pg_temp.assert(to_regprocedure('public.meta_capture_open(text,text,date,date,jsonb,jsonb,text,uuid)') IS NOT NULL,'capture contracts missing');
 PERFORM pg_temp.assert(to_regprocedure('public.meta_capture_abort(uuid,uuid,text)') IS NOT NULL,'terminal capture abort contract missing');
END $$;
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
DO $$
DECLARE actor uuid; run uuid; claim uuid; old_claim uuid; review uuid; again uuid; version bigint; item jsonb; many jsonb; response jsonb; fact public.meta_traffic_daily; legacy public.meta_import_batches;
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES('92001','Synthetic','BRL','America/Sao_Paulo','active',actor);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 run:=public.meta_capture_open('92001','campaign','2026-10-08','2026-10-09','{"level":"campaign","time_range":"{\"since\":\"2026-10-08\",\"until\":\"2026-10-09\"}"}','{"id":"92001","currency":"BRL","timezone":"America/Sao_Paulo"}','cron',NULL);
 claim:=(public.meta_capture_claim(run)->>'claim_token')::uuid;
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_prepare(%L,%L)',run,claim),'55000');
 old_claim:=claim;
 UPDATE public.meta_sync_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=run;
 claim:=(public.meta_capture_claim(run)->>'claim_token')::uuid;
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_abort(%L,%L,%L)',run,old_claim,'Cursor expirado'),'PT409');
 PERFORM pg_temp.assert((SELECT status='running' FROM public.meta_sync_runs WHERE id=run),'old owner aborted new lease');
 PERFORM public.meta_capture_release(run,claim);
 item:='{"date":"2026-10-09","level":"campaign","account_id":"92001","campaign_id":"A","campaign_name":"A","spend":10,"leads":2,"purchases":0,"available_metrics":["spend","leads"],"metric_metadata":{"definition_version":"canonical-v1"}}';
 -- Open resumes the unfinished run instead of abandoning its persisted pages.
 review:=pg_temp.capture('92001','2026-10-08','2026-10-09',jsonb_build_array(item,item||'{"campaign_id":"B"}'));
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_abort(%L,%L,%L)',run,claim,'Conclusão antiga'),'PT409');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 response:=public.meta_capture_review_part(review,1,0,500);
 PERFORM pg_temp.assert((response->>'total')::int=2,'replayed page duplicated rows');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_edit(%L,1,0,%L,%L)',review,'{"campaign_id":"B"}','Corrigir identificação'),'23505');
 PERFORM public.meta_capture_review_edit(review,1,0,'{"spend":12}','Corrigir gasto');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_decide(%L,1,%L)',review,'aprovar'),'PT409');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 EXECUTE 'RESET ROLE';
 SELECT * INTO fact FROM public.meta_traffic_daily WHERE campaign_id='A' AND account_id='92001';
 PERFORM pg_temp.assert(fact.spend=12 AND fact.capture_review_id=review,'review did not publish edited value');
 -- A changed published fact blocks every write in the decision transaction.
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 again:=pg_temp.capture('92001','2026-10-09','2026-10-09',jsonb_build_array(item,item||'{"campaign_id":"C"}'));
 EXECUTE 'RESET ROLE';
 UPDATE public.meta_traffic_daily SET spend=99,updated_at=clock_timestamp() WHERE id=fact.id;
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_decide(%L,1,%L)',again,'aprovar'),'PT409');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id='92001' AND campaign_id='C'),'partial publication after conflict');
 -- Empty complete captures propose removals, while edited facts require a decision.
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 review:=pg_temp.capture('92001','2026-10-09','2026-10-09','[]');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND operation='remove'),'empty capture did not propose removals');
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_decide(%L,1,%L)',again,'aprovar'),'PT409');
 EXECUTE 'RESET ROLE';
 -- The revision exceeds one legacy batch; approval still has one atomic boundary.
 SELECT jsonb_agg(item||jsonb_build_object('campaign_id','many-'||n)) INTO many FROM generate_series(1,2001) n;
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 review:=pg_temp.capture('92001','2026-10-09','2026-10-09',many);
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 response:=public.meta_capture_review_part(review,1,0,2000);
 PERFORM pg_temp.assert((response->>'total')::int>=2001 AND jsonb_array_length(response->'rows')=2000,'large revision incomplete');
 response:=public.meta_capture_review_part(review,1,2000,2000);
 PERFORM pg_temp.assert(jsonb_array_length(response->'rows')>=1,'missing second review part');
 EXECUTE 'RESET ROLE';
 SELECT r.row_no INTO version FROM public.meta_capture_review_rows r WHERE review_id=review AND conflict_details IS NOT NULL;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.meta_capture_review_resolve(review,1,version::int,'keep_published',NULL,'Conservar dado corrigido');
 response:=public.meta_capture_review_decide(review,2,'aprovar');
 PERFORM pg_temp.assert((response->>'inserted')::int=2001 AND (response->>'removed')::int=1,'revision did not apply all parts atomically');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert((SELECT count(*)=2001 FROM public.meta_traffic_daily WHERE account_id='92001' AND campaign_id LIKE 'many-%'),'large revision only partially published');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_audit_events WHERE action='metric.removed' AND summary->>'review_id'=review::text),'review deletion not audited');
 -- Staging is hidden even from an active dashboard reviewer.
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error('SELECT * FROM public.meta_insights_pages','42501');
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub','',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_part(%L,1)',review),'42501');
 EXECUTE 'RESET ROLE';
END $$;
-- Additional migration compatibility, preservation and audit atomicity checks.
DO $$
DECLARE actor uuid; run uuid; claim uuid; review uuid; first_review uuid; prior public.meta_import_batches; item jsonb; fact public.meta_traffic_daily; row_no int; ver bigint; event_count int;
BEGIN
 actor:=pg_temp.seed_meta_actor('approved',false,'executive');
 INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES('92002','Synthetic','BRL','America/Sao_Paulo','active',actor);
 item:='{"date":"2026-10-08","level":"campaign","account_id":"92002","campaign_id":"original","campaign_name":"Original","spend":10,"leads":2,"purchases":0,"available_metrics":["spend","leads"]}';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 INSERT INTO public.meta_sync_runs(kind,account_id,triggered_by) VALUES('insights','92002','cron') RETURNING id INTO run;
 PERFORM public.meta_import_daily_system(jsonb_build_array(item,item||'{"date":"2026-10-07","campaign_id":"outside"}'),run,NULL);
 SELECT * INTO prior FROM public.meta_import_batches WHERE account_id='92002' AND status='pendente';
 SELECT ordinality-1 INTO row_no FROM jsonb_array_elements(prior.rows) WITH ORDINALITY WHERE value->>'campaign_id'='original';
 PERFORM public.meta_edit_import_row('metrics',prior.id,row_no,prior.updated_at,'{"campaign_id":"edited","spend":15}','Identificação corrigida');
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 review:=pg_temp.capture('92002','2026-10-08','2026-10-08',jsonb_build_array(item));
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert((SELECT replaced_by_review_id=review AND status='pendente' FROM public.meta_import_batches WHERE id=prior.id),'legacy evidence lost or approved');
 PERFORM pg_temp.assert((SELECT count(*)=2 FROM public.meta_capture_review_rows WHERE review_id=review),'outside or edited legacy row lost');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND original_key->>2='original' AND payload->>'campaign_id'='edited' AND (payload->>'spend')::numeric=15),'original-key edit not retained');
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error(format('SELECT public.meta_review_traffic_import(%L,%L,%L)',prior.id,'aprovar',prior.updated_at),'PT409');
 SELECT (value->>'row_no')::int INTO row_no FROM jsonb_array_elements(public.meta_capture_review_part(review,1)->'rows') WHERE value->'conflict_details'<>'null'::jsonb;
 PERFORM public.meta_capture_review_resolve(review,1,row_no,'use_edited','{}','Conservar edição do lote legado');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 EXECUTE 'RESET ROLE';
 first_review:=review;
 SELECT * INTO fact FROM public.meta_traffic_daily WHERE account_id='92002' AND campaign_id='edited';
 PERFORM pg_temp.assert(fact.original_key->>2='original' AND fact.first_origin->>'source'='api' AND fact.traffic_edited_at IS NOT NULL,'first identity or manual edit lost');
 -- A complete empty capture does not silently delete a manually corrected fact.
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 review:=pg_temp.capture('92002','2026-10-08','2026-10-08','[]');
 EXECUTE 'RESET ROLE';
 SELECT r.row_no INTO row_no FROM public.meta_capture_review_rows r WHERE review_id=review;
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_decide(%L,1,%L)',review,'aprovar'),'PT409');
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_resolve(%L,1,%s,%L,NULL,%L)',review,row_no,'remove','x'),'22023');
 PERFORM public.meta_capture_review_resolve(review,1,row_no,'keep_published',NULL,'Conservar correção publicada');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE id=fact.id),'keep published deleted fact');
 -- Incoming collision with an edited original is frozen, not silently discarded.
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 review:=pg_temp.capture('92002','2026-10-08','2026-10-08',jsonb_build_array(item));
 EXECUTE 'RESET ROLE';
 SELECT r.row_no INTO row_no FROM public.meta_capture_review_rows r WHERE review_id=review AND conflict_details IS NOT NULL;
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.meta_capture_review_resolve(review,1,row_no,'use_incoming',NULL,'Usar identificação recebida');
 PERFORM public.meta_capture_review_decide(review,2,'aprovar');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(spend)=10 FROM public.meta_traffic_daily WHERE account_id='92002' AND date='2026-10-08'),'incoming identity duplicated corrected fact');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_traffic_daily d WHERE d.id=fact.id AND campaign_id='original' AND d.first_origin=fact.first_origin),'incoming identity lost stable fact/origin');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=review AND action='capture.conflict_resolved' AND summary->'candidates' IS NOT NULL),'resolution candidates not audited');
 -- Rollback must include data if the final audit write fails.
 PERFORM set_config('request.jwt.claim.role','service_role',true); EXECUTE 'SET LOCAL ROLE service_role';
 review:=pg_temp.capture('92002','2026-10-09','2026-10-09',jsonb_build_array(item||'{"date":"2026-10-09","campaign_id":"audit-failure"}'));
 EXECUTE 'RESET ROLE';
 EXECUTE 'CREATE FUNCTION pg_temp.fail_capture_audit() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.action=''capture.aprovado'' THEN RAISE EXCEPTION ''synthetic audit failure''; END IF; RETURN NEW; END $f$';
 EXECUTE 'CREATE TRIGGER qa_fail_capture_audit BEFORE INSERT ON public.meta_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_capture_audit()';
 PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_review_decide(%L,1,%L)',review,'aprovar'),'P0001');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id='92002' AND campaign_id='audit-failure'),'failed audit published data');
 PERFORM pg_temp.assert((SELECT status='pendente' AND version=1 FROM public.meta_capture_reviews WHERE id=review),'failed audit advanced decision');
 EXECUTE 'DROP TRIGGER qa_fail_capture_audit ON public.meta_audit_events';
END $$;
SELECT 'PASS: complete capture, replay, atomic review, conflicts, legacy edits, first origin, audit rollback and role boundaries' AS verification;
ROLLBACK;
