-- Liga o vinculo automatico site <-> formulario para os leads que ainda vao chegar.
-- Rode SO depois de conferir a simulacao (meta_link_site_answers(false)) e de aplicar o vinculo uma vez.
-- A cada 5 minutos aplica apenas pares inequivocos; casos ambiguos ficam sem vinculo para revisao humana.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $job$
DECLARE existing bigint;
BEGIN
 IF to_regprocedure('public.meta_link_site_answers(boolean)') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015021500_site_form_answers_link' USING ERRCODE='55000'; END IF;
 IF to_regnamespace('cron') IS NULL THEN RAISE EXCEPTION 'pg_cron nao esta instalado' USING ERRCODE='55000'; END IF;
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname='meta-site-form-link' LOOP PERFORM cron.unschedule(existing); END LOOP;
 PERFORM cron.schedule('meta-site-form-link','*/5 * * * *','SELECT public.meta_link_site_answers(true)');
END $job$;
COMMIT;
