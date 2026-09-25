BEGIN;
DROP TRIGGER meta_traffic_signal ON public.meta_traffic_daily;
CREATE TRIGGER meta_import_batch_signal
AFTER INSERT ON public.meta_import_batches
FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
COMMIT;
