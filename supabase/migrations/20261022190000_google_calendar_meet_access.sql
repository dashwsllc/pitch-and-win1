-- Acesso aberto do Meet das calls (quem tem o link entra sem pedir para entrar): so guarda o RESULTADO da ultima tentativa para a tela de Configuracoes.
-- ADITIVA: duas colunas na conexao, uma funcao nova (so service_role) e o status do admin com um campo a mais (meetAccess). Nao mexe em credenciais, fila nem calls.
BEGIN;
SET LOCAL lock_timeout='5s';

ALTER TABLE calendar_private.connection
  ADD COLUMN IF NOT EXISTS meet_access_state text NOT NULL DEFAULT 'unknown'
    CHECK(meet_access_state IN('unknown','open','scope_missing','api_disabled','not_permitted','error')),
  ADD COLUMN IF NOT EXISTS meet_access_checked_at timestamptz;

-- Grava o resultado. So escreve quando o estado muda ou o ultimo registro tem mais de 10 minutos (um job por minuto nao vira uma escrita por minuto).
CREATE OR REPLACE FUNCTION public.google_calendar_set_meet_access(p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_state IS NULL OR p_state NOT IN('unknown','open','scope_missing','api_disabled','not_permitted','error') THEN RAISE EXCEPTION 'invalid_meet_access_state' USING ERRCODE='22023'; END IF;
  UPDATE calendar_private.connection SET meet_access_state=p_state,meet_access_checked_at=clock_timestamp()
    WHERE singleton AND (meet_access_state IS DISTINCT FROM p_state OR meet_access_checked_at IS NULL OR meet_access_checked_at<clock_timestamp()-interval '10 minutes');
END $$;

-- Mesma funcao de antes (migration 20261011100000), com meetAccess no fim.
CREATE OR REPLACE FUNCTION public.google_calendar_admin_status(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c calendar_private.connection;
BEGIN
  PERFORM calendar_private.require_admin(p_actor);
  SELECT * INTO STRICT c FROM calendar_private.connection;
  RETURN jsonb_build_object('configured',c.calendar_id IS NOT NULL,'connection',c.connection_status,
    'calendar',CASE WHEN c.calendar_id IS NULL THEN NULL ELSE jsonb_build_object('id',c.calendar_id,'name',c.calendar_name,'accessRole','writer','timeZone',c.time_zone) END,
    'destinationLocked',EXISTS(SELECT 1 FROM calendar_private.bindings) OR EXISTS(SELECT 1 FROM calendar_private.activation_seeds),
    'activatedAt',c.activated_at,'lastRunAt',c.last_run_at,
    'pendingCount',(SELECT count(*) FROM calendar_private.outbox),
    'errorCount',(SELECT count(*) FROM calendar_private.outbox WHERE error_code IS NOT NULL),
    'backfillPending',EXISTS(SELECT 1 FROM calendar_private.activation_seeds),'errorCode',c.error_code,
    'meetAccess',jsonb_build_object('state',c.meet_access_state,'checkedAt',c.meet_access_checked_at));
END $$;

REVOKE ALL ON FUNCTION public.google_calendar_set_meet_access(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_set_meet_access(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
