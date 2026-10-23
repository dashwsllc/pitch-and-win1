-- Trabalho de fundo só quando há trabalho (23/10/2026, plano gratuito: cada chamada à toa disputa a CPU da Nano com as telas).
-- Medido antes:
--   meta-lead-worker (a cada minuto, sem descoberta): só processa a fila de webhooks da Meta, vazia desde 15/10 (o webhook não está ligado).
--     1.440 chamadas/dia à Edge Function, cada uma com ~4 chamadas à API, 2 gravações em meta_sync_runs, pg_net e histórico do cron, para nada.
--     A descoberta de leads (job de 5 em 5 min, com descoberta) também esvazia essa fila e continua igual.
--   google-calendar-deliver (a cada minuto): chamava a Edge Function mesmo com a fila da agenda vazia.
--   google_calendar_scan_page('reconcile') (a cada 15 min): recolocava na fila TODA call não concluída, sem olhar a data. Nenhuma call fica
--     "concluída" para a agenda, então a lista só crescia: de 45 calls reconferidas no Google (e com o Meet reaberto) a cada 15 min, 38 já
--     tinham terminado (23 há mais de 7 dias). Mudança feita no CRM continua indo na hora pelo gatilho calendar_private.call_changed;
--     a reconciliação só repara edição feita direto no Google, o que não faz sentido para reunião que já passou.
--   meta-insights-sync-frequent (*/30) e meta-insights-sync-deep (0 3): os dois últimos jobs no minuto :00 (o colapso de 23/10 começou no :00).
-- Teste: scripts/verify-background-idle-db.mjs.
BEGIN;

-- 1. Reconciliação da agenda só para call que ainda não terminou ou terminou há menos de 1 dia (call sem horário ou já apagada, que no LEFT JOIN
--    também fica com scheduled_at nulo, continua, por segurança).
CREATE OR REPLACE FUNCTION public.google_calendar_scan_page(p_mode text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE c calendar_private.connection; cur uuid; q record; n integer:=0; last_id uuid; cap integer:=greatest(1,least(500,p_limit)); more boolean;
BEGIN
  IF p_mode NOT IN ('backfill','reconcile') THEN RAISE EXCEPTION 'invalid_scan_mode' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM calendar_private.connection FOR SHARE;
  IF c.connection_status<>'connected' OR c.activated_at IS NULL THEN RETURN jsonb_build_object('processed',0,'done',true); END IF;
  SELECT cursor INTO cur FROM calendar_private.scan_state WHERE mode=p_mode FOR UPDATE;
  IF p_mode='backfill' THEN
    FOR q IN SELECT call_id,lead_id FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id ORDER BY call_id LIMIT cap
      LOOP PERFORM calendar_private.enqueue(q.call_id,q.lead_id); n:=n+1; last_id:=q.call_id; END LOOP;
    more:=EXISTS(SELECT 1 FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id);
  ELSE
    FOR q IN SELECT b.id,b.call_id,b.lead_id FROM calendar_private.bindings b LEFT JOIN public.crm_activities a ON a.id=b.call_id
      WHERE b.calendar_id=c.calendar_id AND NOT b.completed AND NOT b.removed AND (cur IS NULL OR b.id>cur)
        AND (a.scheduled_at IS NULL OR a.scheduled_at+make_interval(mins=>coalesce(a.duration_minutes,60))>clock_timestamp()-interval '1 day')
      ORDER BY b.id LIMIT cap
    LOOP
      -- Reconciliation rechecks Google even when the CRM revision did not change.
      INSERT INTO calendar_private.outbox(binding_id) VALUES(q.id) ON CONFLICT DO NOTHING;
      n:=n+1; last_id:=q.id;
    END LOOP;
    more:=n=cap AND EXISTS(SELECT 1 FROM calendar_private.bindings b LEFT JOIN public.crm_activities a ON a.id=b.call_id
      WHERE b.calendar_id=c.calendar_id AND NOT b.completed AND NOT b.removed AND b.id>last_id
        AND (a.scheduled_at IS NULL OR a.scheduled_at+make_interval(mins=>coalesce(a.duration_minutes,60))>clock_timestamp()-interval '1 day'));
  END IF;
  UPDATE calendar_private.scan_state SET cursor=CASE WHEN more THEN last_id ELSE NULL END WHERE mode=p_mode;
  RETURN jsonb_build_object('processed',n,'done',NOT more);
END $function$;

-- 2-4. Comandos do pg_cron: acrescenta a condição antes da guarda de pressão (que continua). Falha alto se o comando não for o esperado.
DO $jobs$
DECLARE j record; v_new text;
  v_guard constant text := 'AND NOT public.db_under_pressure();';
  v_webhook constant text := 'AND EXISTS(SELECT 1 FROM public.meta_webhook_events e WHERE (e.status IN (''pending'',''error'') AND e.next_attempt_at<=clock_timestamp()) OR (e.status=''processing'' AND e.lease_until<=clock_timestamp())) ';
  v_calendar constant text := 'AND (EXISTS(SELECT 1 FROM calendar_private.outbox o WHERE o.available_at<=clock_timestamp() AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())) OR EXISTS(SELECT 1 FROM calendar_private.activation_seeds)) ';
BEGIN
  -- 2. robô de leads sem descoberta: só com evento de webhook vencido (mesmo critério de meta_lead_events_claim).
  SELECT jobid, command INTO j FROM cron.job WHERE jobname='meta-lead-worker';
  IF NOT FOUND THEN RAISE EXCEPTION 'job meta-lead-worker nao existe'; END IF;
  IF position('public.meta_webhook_events' in j.command)=0 THEN
    IF j.command NOT LIKE '%"discover": false%' OR (length(j.command)-length(replace(j.command, v_guard, '')))/length(v_guard)<>1 THEN
      RAISE EXCEPTION 'meta-lead-worker: comando diferente do esperado';
    END IF;
    PERFORM cron.alter_job(job_id := j.jobid, command := replace(j.command, v_guard, v_webhook || v_guard));
  END IF;

  -- 3. entrega da agenda: só com item vencido e livre na fila, ou com chamada nova da ativação (mesmo critério de google_calendar_claim/backfill).
  SELECT jobid, command INTO j FROM cron.job WHERE jobname='google-calendar-deliver';
  IF NOT FOUND THEN RAISE EXCEPTION 'job google-calendar-deliver nao existe'; END IF;
  IF position('calendar_private.outbox' in j.command)=0 THEN
    IF j.command NOT LIKE '%"mode":"deliver"%' OR (length(j.command)-length(replace(j.command, v_guard, '')))/length(v_guard)<>1 THEN
      RAISE EXCEPTION 'google-calendar-deliver: comando diferente do esperado';
    END IF;
    PERFORM cron.alter_job(job_id := j.jobid, command := replace(j.command, v_guard, v_calendar || v_guard));
  END IF;

  -- 4. tira do minuto :00 os dois últimos jobs que caíam nele (minutos livres: nenhum outro job roda em 9, 39 ou 3:11).
  SELECT jobid, schedule INTO j FROM cron.job WHERE jobname='meta-insights-sync-frequent';
  IF FOUND AND j.schedule='*/30 * * * *' THEN PERFORM cron.alter_job(job_id := j.jobid, schedule := '9,39 * * * *'); END IF;
  SELECT jobid, schedule INTO j FROM cron.job WHERE jobname='meta-insights-sync-deep';
  IF FOUND AND j.schedule='0 3 * * *' THEN PERFORM cron.alter_job(job_id := j.jobid, schedule := '11 3 * * *'); END IF;
END $jobs$;

COMMIT;
