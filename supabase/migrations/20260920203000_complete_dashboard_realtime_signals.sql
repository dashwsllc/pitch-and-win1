-- Complete the revision feed used by the dashboard realtime client. These
-- tables were previously visible only after the 50-second polling fallback.
BEGIN;

DROP TRIGGER IF EXISTS dashboard_subscriptions_signal ON public.assinaturas;
CREATE TRIGGER dashboard_subscriptions_signal
  AFTER INSERT OR UPDATE OR DELETE ON public.assinaturas
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('sales');

DROP TRIGGER IF EXISTS dashboard_password_requests_signal ON public.password_reset_requests;
CREATE TRIGGER dashboard_password_requests_signal
  AFTER INSERT OR UPDATE OR DELETE ON public.password_reset_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('users');

COMMIT;
