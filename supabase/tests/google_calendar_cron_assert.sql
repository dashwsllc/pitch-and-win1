DO $$ DECLARE job record; BEGIN
 IF (SELECT count(*) FROM cron.job)<>2 OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='google-calendar-reconcile' AND schedule='*/15 * * * *') THEN RAISE EXCEPTION 'cron schedules wrong'; END IF;
 FOR job IN SELECT command FROM cron.job LOOP EXECUTE job.command; END LOOP;
 IF EXISTS(SELECT 1 FROM net.test_requests) THEN RAISE EXCEPTION 'cron ran without keys'; END IF;
 INSERT INTO vault.secrets(name,secret) VALUES('google_calendar_cron_anon_key','qa-anon'),('google_calendar_cron_secret','qa-cron');
 FOR job IN SELECT command FROM cron.job LOOP EXECUTE job.command; END LOOP;
 IF EXISTS(SELECT 1 FROM net.test_requests) THEN RAISE EXCEPTION 'cron ran without connection'; END IF;
 UPDATE calendar_private.connection SET connection_status='connected',activated_at=now();
 FOR job IN SELECT command FROM cron.job LOOP EXECUTE job.command; END LOOP;
 IF (SELECT count(*) FROM net.test_requests)<>2 OR NOT EXISTS(SELECT 1 FROM net.test_requests WHERE body->>'mode'='deliver' AND headers->>'x-cron-secret'='qa-cron' AND headers->>'Authorization'='Bearer qa-anon') THEN RAISE EXCEPTION 'cron delivery broken'; END IF;
 UPDATE calendar_private.connection SET connection_status='disconnected';
 FOR job IN SELECT command FROM cron.job LOOP EXECUTE job.command; END LOOP;
 IF (SELECT count(*) FROM net.test_requests)<>2 THEN RAISE EXCEPTION 'cron ran while disconnected'; END IF;
END $$;
