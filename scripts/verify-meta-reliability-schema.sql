-- Read-only deployment preflight. An existing object without migration history
-- is reported explicitly; this script never repairs history or applies SQL.
WITH required(version,signature) AS (VALUES
 ('20261011120000','public.meta_normalize_account_id(text)'),
 ('20261011130000','public.meta_capture_review_decide(uuid,bigint,text,text)'),
 ('20261011140000','public.meta_lead_events_claim(integer,integer,text[])'),
 ('20261011150000','public.meta_traffic_cohort(date,date,text,text,text)'),
 ('20261011160000','public.meta_traffic_review_list(text,text,integer,integer)'),
 ('20261011161000','public.meta_traffic_operation()'),
 ('20261011170000','public.meta_lead_run_start(text,boolean)'),
 ('20261011190000','public.meta_sync_run_finish(uuid,text,integer,text)')
), history AS (SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
 THEN query_to_xml('SELECT version FROM supabase_migrations.schema_migrations',true,false,'')::text ELSE '' END AS versions),
checks AS (
 SELECT 'migration:'||version AS name,to_regprocedure(signature) IS NOT NULL AND versions LIKE '%<version>'||version||'</version>%' AS ok,
   CASE WHEN to_regprocedure(signature) IS NULL THEN 'missing_object' WHEN versions NOT LIKE '%<version>'||version||'</version>%' THEN 'present_unrecorded' ELSE 'applied' END AS detail FROM required CROSS JOIN history
 UNION ALL
 SELECT 'trigger:'||suffix,EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.meta_traffic_daily'::regclass AND tgname='meta_traffic_signal_'||suffix AND tgenabled='O'), 'enabled' FROM (VALUES('insert'),('update'),('delete')) operations(suffix)
 UNION ALL
 SELECT 'private:'||name,c.relrowsecurity AND NOT has_table_privilege('authenticated',c.oid,'SELECT') AND NOT has_table_privilege('anon',c.oid,'SELECT'), 'RLS + no client SELECT'
 FROM (VALUES('meta_insights_pages'),('meta_capture_review_rows'),('meta_lead_discovery_state')) objects(name) LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||name)
 UNION ALL
 SELECT 'service_rpc:'||signature,coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false)
   AND NOT coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),true)
   AND NOT coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true),'service only'
 FROM (VALUES('public.meta_lead_events_claim(integer,integer,text[])'),('public.meta_capture_prepare(uuid,uuid)'),('public.meta_lead_run_start(text,boolean)'),('public.meta_sync_run_finish(uuid,text,integer,text)')) functions(signature)
 UNION ALL
 SELECT 'review_rpc',coalesce(has_function_privilege('authenticated',to_regprocedure('public.meta_capture_review_decide(uuid,bigint,text,text)'),'EXECUTE'),false)
   AND NOT coalesce(has_function_privilege('anon',to_regprocedure('public.meta_capture_review_decide(uuid,bigint,text,text)'),'EXECUTE'),true),'authenticated only'
)
SELECT jsonb_build_object('ready',bool_and(coalesce(ok,false)),'checks',jsonb_agg(jsonb_build_object('name',name,'ok',coalesce(ok,false),'detail',detail) ORDER BY name)) AS preflight FROM checks;
