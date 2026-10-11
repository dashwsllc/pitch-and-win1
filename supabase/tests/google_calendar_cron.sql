-- Isolated WASM cron/HTTP interfaces; never install this file in production.
ALTER TABLE vault.secrets ADD COLUMN name text UNIQUE;
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret,name FROM vault.secrets;
CREATE SCHEMA cron; CREATE SCHEMA net;
CREATE TABLE cron.job(jobname text PRIMARY KEY,schedule text,command text);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO cron.job VALUES($1,$2,$3) ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command RETURNING 1::bigint
$$;
CREATE TABLE net.test_requests(body jsonb,headers jsonb);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.test_requests VALUES(body,headers) RETURNING 1::bigint $$;
