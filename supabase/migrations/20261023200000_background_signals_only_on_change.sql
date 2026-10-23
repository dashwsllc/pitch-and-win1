-- Sinal do dashboard só quando algo muda de verdade (23/10/2026, depois das quedas de 22-23/10).
-- Antes: meta_sync_runs e meta_webhook_events tinham gatilhos FOR EACH STATEMENT incondicionais. O robô da Meta (a cada minuto) grava essas
-- tabelas de controle mesmo sem importar nada (304 de 304 execuções automáticas com 0 linhas em 4 h) e o Postgres dispara gatilho de comando
-- até para UPDATE que não altera linha nenhuma (meta_lead_events_claim sem evento na fila). Cada sinal faz TODA aba aberta reler TODAS as
-- consultas (DataSync -> invalidateQueries()): medido ~11 sinais/min sem ninguém mexer, o que anulava o piso de 45 s do polling.
-- Agora:
--   meta_sync_runs: sinal quando uma execução manual começa ou muda de status, e quando uma automática muda de status já tendo trazido linhas.
--     Os dados importados (meta_form_leads, meta_traffic_daily, meta_capture_reviews...) seguem sinalizando pelos próprios gatilhos, e as telas
--     de status da sincronização têm polling próprio (POLL.traffic).
--   meta_webhook_events: o mesmo meta_changed_signal das outras tabelas da Meta (sinal só se alguma linha mudou além de updated_at).
-- Teste: scripts/verify-background-signals-db.mjs.
BEGIN;

DROP TRIGGER IF EXISTS meta_sync_runs_signal ON public.meta_sync_runs;
CREATE TRIGGER meta_sync_runs_signal_manual_start AFTER INSERT ON public.meta_sync_runs
  FOR EACH ROW WHEN (NEW.triggered_by = 'manual')
  EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER meta_sync_runs_signal_status AFTER UPDATE ON public.meta_sync_runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND (NEW.triggered_by = 'manual' OR coalesce(NEW.rows_synced, 0) > 0))
  EXECUTE FUNCTION public.dashboard_signal('arena');

DROP TRIGGER IF EXISTS meta_webhook_events_signal ON public.meta_webhook_events;
CREATE TRIGGER meta_webhook_events_signal_insert AFTER INSERT ON public.meta_webhook_events
  REFERENCING NEW TABLE AS meta_signal_new FOR EACH STATEMENT
  EXECUTE FUNCTION public.meta_changed_signal('crm');
CREATE TRIGGER meta_webhook_events_signal_update AFTER UPDATE ON public.meta_webhook_events
  REFERENCING OLD TABLE AS meta_signal_old NEW TABLE AS meta_signal_new FOR EACH STATEMENT
  EXECUTE FUNCTION public.meta_changed_signal('crm');

COMMIT;
