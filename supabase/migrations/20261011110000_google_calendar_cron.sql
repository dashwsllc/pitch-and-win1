BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
COMMIT;

-- Named schedules are updated on reinstallation. No request is made until both
-- private Vault secrets exist and the company connection is active.
BEGIN;
SELECT cron.schedule('google-calendar-deliver', '* * * * *', $job$
  SELECT net.http_post(
    url := 'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || keys.anon_key,'x-cron-secret',keys.cron_secret),
    body := '{"mode":"deliver"}'::jsonb, timeout_milliseconds := 50000)
  FROM (SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='google_calendar_cron_anon_key') AS anon_key,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='google_calendar_cron_secret') AS cron_secret) keys
  WHERE keys.anon_key IS NOT NULL AND keys.cron_secret IS NOT NULL
    AND EXISTS (SELECT 1 FROM calendar_private.connection WHERE connection_status='connected' AND activated_at IS NOT NULL);
$job$);
SELECT cron.schedule('google-calendar-reconcile', '*/15 * * * *', $job$
  SELECT net.http_post(
    url := 'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || keys.anon_key,'x-cron-secret',keys.cron_secret),
    body := '{"mode":"reconcile"}'::jsonb, timeout_milliseconds := 50000)
  FROM (SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='google_calendar_cron_anon_key') AS anon_key,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='google_calendar_cron_secret') AS cron_secret) keys
  WHERE keys.anon_key IS NOT NULL AND keys.cron_secret IS NOT NULL
    AND EXISTS (SELECT 1 FROM calendar_private.connection WHERE connection_status='connected' AND activated_at IS NOT NULL);
$job$);
COMMIT;