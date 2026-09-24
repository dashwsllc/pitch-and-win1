-- Read-only guard for every table consumed by synchronized dashboards.
DO $verify$
DECLARE missing text;
BEGIN
  WITH required(table_name,trigger_name) AS (VALUES
    ('vendas','dashboard_sales_signal'),
    ('abordagens','dashboard_approaches_signal'),
    ('saques','dashboard_withdrawal_signal'),
    ('assinaturas','dashboard_subscriptions_signal'),
    ('profiles','dashboard_profiles_signal'),
    ('user_roles','dashboard_roles_signal'),
    ('registration_requests','dashboard_registration_signal'),
    ('company_goals','dashboard_goals_signal'),
    ('goal_cycles','arena_cycle_insert_signal'),
    ('goal_cycles','arena_cycle_update_signal'),
    ('daily_goal_tasks','dashboard_daily_goals_signal'),
    ('crm_leads','dashboard_crm_leads_signal'),
    ('crm_activities','dashboard_crm_activities_signal'),
    ('crm_lead_contexts','dashboard_crm_contexts_signal'),
    ('traffic_metrics','arena_traffic_signal'),
    ('products','dashboard_products_signal'),
    ('product_tickets','dashboard_product_tickets_signal'),
    ('executive_audit_events','dashboard_audit_signal'),
    ('password_reset_requests','dashboard_password_requests_signal'),
    ('arena_notifications','arena_notifications_signal'),
    ('activity_feed','arena_event_signal')
  )
  SELECT string_agg(r.table_name||'.'||r.trigger_name,', ' ORDER BY r.table_name,r.trigger_name) INTO missing
  FROM required r
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=r.table_name
      AND t.tgname=r.trigger_name AND t.tgenabled<>'D' AND NOT t.tgisinternal
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing sync triggers: %',missing; END IF;

  SELECT string_agg(name,', ' ORDER BY name) INTO missing
  FROM unnest(ARRAY['dashboard_events','activity_feed','arena_notifications']) AS name
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables p
    WHERE p.pubname='supabase_realtime' AND p.schemaname='public' AND p.tablename=name
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing Realtime publication: %',missing; END IF;

  SELECT string_agg(topic,', ' ORDER BY topic) INTO missing
  FROM unnest(ARRAY['sales','users','audit','goals','products','crm','arena']) AS topic
  WHERE NOT EXISTS (SELECT 1 FROM public.dashboard_events d WHERE d.topic=topic);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing revision topics: %',missing; END IF;

  IF (SELECT count(*) FROM public.arena_sale_facts WHERE active) IS DISTINCT FROM
     (SELECT count(*) FROM public.vendas WHERE approval_status='aprovada') THEN
    RAISE EXCEPTION 'Arena active sale facts disagree with approved sales';
  END IF;
  IF (SELECT count(*) FROM public.arena_closer_weekly_sale_facts) IS DISTINCT FROM
     (SELECT count(DISTINCT sale_id) FROM public.arena_closer_weekly_sale_facts) THEN
    RAISE EXCEPTION 'Closer weekly credit contains duplicate sales';
  END IF;
END $verify$;

SELECT jsonb_build_object('sync_schema','passed','read_only',true) result;
