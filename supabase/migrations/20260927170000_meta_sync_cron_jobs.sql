BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net;
COMMIT;

-- cron.schedule nao roda dentro da mesma transacao/lock do restante da migration
-- por design da extensao; mantido em BEGIN/COMMIT proprios por clareza de leitura.
BEGIN;
-- Os dois segredos abaixo (meta_cron_anon_key, meta_sync_cron_secret) sao criados
-- manualmente uma unica vez via SQL Editor do dashboard (Vault), nunca commitados.
-- Ate la, estes jobs disparam e falham de forma inofensiva (POST com header nulo);
-- ver docs/META_ADS_OFFICIAL_API_SETUP_2026-09-27.md.
SELECT cron.schedule('meta-insights-sync-frequent', '*/30 * * * *', $$
  SELECT net.http_post(
    url := 'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/meta-insights-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_cron_anon_key'),
      'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_sync_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$$);

SELECT cron.schedule('meta-insights-sync-deep', '0 3 * * *', $$
  SELECT net.http_post(
    url := 'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/meta-insights-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_cron_anon_key'),
      'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_sync_cron_secret')),
    body := '{"days":8}'::jsonb, timeout_milliseconds := 20000);
$$);

SELECT cron.schedule('meta-leads-reconciliation-hourly', '15 * * * *', $$
  SELECT net.http_post(
    url := 'https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/meta-leads-reconciliation',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_cron_anon_key'),
      'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_sync_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$$);
COMMIT;
