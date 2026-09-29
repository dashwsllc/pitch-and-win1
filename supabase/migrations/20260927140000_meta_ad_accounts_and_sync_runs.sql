BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE public.meta_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL UNIQUE CHECK (length(account_id) BETWEEN 1 AND 80),
  account_name text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency='BRL'),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  connected_by uuid NOT NULL REFERENCES auth.users(id),
  connected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paused_by uuid REFERENCES auth.users(id),
  paused_at timestamptz,
  paused_reason text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.meta_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('insights','leads_reconciliation')),
  account_id text, -- para kind='leads_reconciliation' guarda o Page ID (reuso documentado, nao e FK)
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('success','error','running')),
  triggered_by text NOT NULL CHECK (triggered_by IN ('cron','manual')),
  triggered_by_user uuid REFERENCES auth.users(id),
  window_start date,
  window_end date,
  rows_synced integer NOT NULL DEFAULT 0 CHECK (rows_synced>=0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);
-- Garante no maximo 1 execucao 'running' por (kind, conta/pagina) - trava de concorrencia do cron.
CREATE UNIQUE INDEX meta_sync_runs_one_running ON public.meta_sync_runs(kind, coalesce(account_id,''))
  WHERE status='running';
CREATE INDEX meta_sync_runs_recent ON public.meta_sync_runs(kind, account_id, started_at DESC);

ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_accounts, public.meta_sync_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meta_ad_accounts, public.meta_sync_runs TO authenticated;
GRANT SELECT ON public.meta_ad_accounts TO service_role;
CREATE POLICY meta_ad_accounts_read ON public.meta_ad_accounts FOR SELECT TO authenticated USING (public.traffic_has_access());
CREATE POLICY meta_sync_runs_read ON public.meta_sync_runs FOR SELECT TO authenticated USING (public.traffic_has_access());

-- Conectar/desconectar: so Executive/Super Admin de fato (mesma matriz ja usada em outros lugares do produto).
CREATE OR REPLACE FUNCTION public.meta_connect_ad_account(p_account_id text, p_account_name text,
  p_currency text DEFAULT 'BRL', p_timezone text DEFAULT 'America/Sao_Paulo')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_account text;
BEGIN
  IF NOT public.is_executive(auth.uid()) THEN RAISE EXCEPTION 'Acesso Executive necessário' USING ERRCODE='42501'; END IF;
  v_account:=btrim(coalesce(p_account_id,''));
  IF length(v_account) NOT BETWEEN 1 AND 80 OR p_currency<>'BRL' THEN RAISE EXCEPTION 'ID da conta ou moeda inválidos'; END IF;
  INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by,connected_at)
  VALUES(v_account,left(coalesce(p_account_name,''),160),p_currency,left(coalesce(p_timezone,'America/Sao_Paulo'),80),'active',auth.uid(),clock_timestamp())
  ON CONFLICT(account_id) DO UPDATE SET account_name=excluded.account_name,currency=excluded.currency,
    timezone=excluded.timezone,status='active',connected_by=excluded.connected_by,connected_at=clock_timestamp(),
    paused_by=NULL,paused_at=NULL,paused_reason=NULL,updated_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.meta_disconnect_ad_account(p_account_id text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.is_executive(auth.uid()) THEN RAISE EXCEPTION 'Acesso Executive necessário' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo (3 a 500 caracteres)'; END IF;
  UPDATE public.meta_ad_accounts SET status='paused',paused_by=auth.uid(),paused_at=clock_timestamp(),
    paused_reason=btrim(p_reason),updated_at=clock_timestamp() WHERE account_id=btrim(p_account_id) AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada ou já pausada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_connect_ad_account(text,text,text,text), public.meta_disconnect_ad_account(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_connect_ad_account(text,text,text,text), public.meta_disconnect_ad_account(text,text) TO authenticated;

-- Log de execucoes: so a Edge Function (service_role) escreve. Auto-expira 'running' travado ha
-- mais de 15 min (crash sem finish) antes de checar a trava de concorrencia.
CREATE OR REPLACE FUNCTION public.meta_sync_run_start(p_kind text, p_account_id text DEFAULT NULL,
  p_triggered_by text DEFAULT 'cron', p_triggered_by_user uuid DEFAULT NULL,
  p_window_start date DEFAULT NULL, p_window_end date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_kind NOT IN ('insights','leads_reconciliation') OR p_triggered_by NOT IN ('cron','manual')
  THEN RAISE EXCEPTION 'Parâmetros de sincronização inválidos'; END IF;
  UPDATE public.meta_sync_runs SET status='error', finished_at=clock_timestamp(),
    error_message=coalesce(error_message||' ','')||'[encerrado automaticamente: excedeu 15 min sem finalizar]'
  WHERE kind=p_kind AND coalesce(account_id,'')=coalesce(p_account_id,'') AND status='running'
    AND started_at < clock_timestamp() - interval '15 minutes';
  BEGIN
    INSERT INTO public.meta_sync_runs(kind,account_id,status,triggered_by,triggered_by_user,window_start,window_end)
    VALUES(p_kind,p_account_id,'running',p_triggered_by,
      CASE WHEN p_triggered_by='manual' THEN p_triggered_by_user ELSE NULL END,p_window_start,p_window_end)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma sincronização % em andamento para esta conta/página', p_kind USING ERRCODE='55006';
  END;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.meta_sync_run_finish(p_id uuid, p_status text, p_rows_synced integer DEFAULT 0, p_error_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_status NOT IN ('success','error') THEN RAISE EXCEPTION 'Status final inválido'; END IF;
  UPDATE public.meta_sync_runs SET status=p_status, rows_synced=coalesce(p_rows_synced,0),
    error_message=p_error_message, finished_at=clock_timestamp() WHERE id=p_id AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Execução não encontrada ou já finalizada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_sync_run_start(text,text,text,uuid,date,date), public.meta_sync_run_finish(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_sync_run_start(text,text,text,uuid,date,date), public.meta_sync_run_finish(uuid,text,integer,text) TO service_role;

CREATE TRIGGER meta_ad_accounts_signal AFTER INSERT OR UPDATE ON public.meta_ad_accounts FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER meta_sync_runs_signal AFTER INSERT OR UPDATE ON public.meta_sync_runs FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
NOTIFY pgrst,'reload schema';
COMMIT;
