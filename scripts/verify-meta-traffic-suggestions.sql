-- Synthetic fixtures only; execute with scripts/helpers/meta-db-fixtures.sql after BEGIN.
BEGIN;
DO $$
DECLARE actor uuid:=pg_temp.seed_meta_actor('approved',false,'executive'); other uuid:=pg_temp.seed_meta_actor('approved',false,'seller'); suggestion uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 suggestion:=public.traffic_create_suggestion('Sugestão sintética','Conferir métricas da campanha','synthetic-campaign');
 PERFORM public.traffic_reply_suggestion(suggestion,'Resposta sintética');
 PERFORM public.traffic_set_suggestion_status(suggestion,'em_analise');
 PERFORM pg_temp.assert((SELECT status='em_analise' FROM public.traffic_suggestions WHERE id=suggestion),'suggestion state');
 PERFORM pg_temp.assert((SELECT count(*)=2 FROM public.traffic_suggestion_replies WHERE suggestion_id=suggestion),'suggestion reply history');
 PERFORM set_config('request.jwt.claim.sub',other::text,true);
 PERFORM pg_temp.expect_error(format('SELECT public.traffic_set_suggestion_status(%L::uuid,%L)',suggestion,'resolvida'),'42501');
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.assert((SELECT count(*)=0 FROM public.traffic_suggestions WHERE id=suggestion),'seller cannot read traffic suggestions');
 EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
