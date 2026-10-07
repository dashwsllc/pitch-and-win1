-- Manual, informational payment status. It does not alter leads, sales, commissions or Arena.
-- Expand/migrate only: legacy installments and reader/mutation definitions remain for rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Stop in-flight legacy writes before snapshotting the aggregate. Clients that still call
-- the old RPCs get permission denied and must refresh to the status-only UI.
LOCK TABLE public.crm_lead_payments IN SHARE ROW EXCLUSIVE MODE;
REVOKE ALL ON FUNCTION public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_payment_delete(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE TABLE public.crm_lead_payment_status (
  lead_id uuid PRIMARY KEY REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pago','pendente','nao_pago')),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- An RPC admitted before REVOKE can resume after the table lock is released. Preserve
-- its original definition for rollback but reject its writes at the table boundary.
CREATE FUNCTION private.crm_legacy_payment_readonly() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF auth.role() IN ('authenticated','anon') THEN
    IF TG_OP='DELETE' AND OLD.lead_id::text=current_setting('crm.lead_delete',true)
      AND NOT EXISTS(SELECT 1 FROM public.crm_leads WHERE id=OLD.lead_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Pagamentos agora usam um status por lead. Atualize a página para continuar.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.crm_legacy_payment_readonly() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_legacy_payment_readonly BEFORE INSERT OR UPDATE OR DELETE ON public.crm_lead_payments
  FOR EACH ROW EXECUTE FUNCTION private.crm_legacy_payment_readonly();

-- Preserve the badge the old UI displayed: any Não pago wins, all Pago means Pago,
-- otherwise Pendente. No entries means no new row. Keep the latest recorded author/time.
INSERT INTO public.crm_lead_payment_status(lead_id,status,updated_by,updated_at)
SELECT a.lead_id,a.status,last_change.updated_by,last_change.updated_at
FROM (
  SELECT lead_id,CASE WHEN bool_or(status='nao_pago') THEN 'nao_pago'
    WHEN bool_and(status='pago') THEN 'pago' ELSE 'pendente' END status
  FROM public.crm_lead_payments GROUP BY lead_id
) a
JOIN LATERAL (
  SELECT updated_by,updated_at FROM public.crm_lead_payments p
  WHERE p.lead_id=a.lead_id ORDER BY updated_at DESC,id DESC LIMIT 1
) last_change ON true;

ALTER TABLE public.crm_lead_payment_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_payment_status FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_lead_payment_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.crm_lead_payment_status TO authenticated;
CREATE POLICY crm_payment_status_select ON public.crm_lead_payment_status FOR SELECT TO authenticated
  USING(public.crm_has_access());
CREATE POLICY dashboard_active_account ON public.crm_lead_payment_status AS RESTRICTIVE FOR ALL TO authenticated
  USING(public.dashboard_account_active()) WITH CHECK(public.dashboard_account_active());
CREATE POLICY registration_access ON public.crm_lead_payment_status AS RESTRICTIVE FOR ALL TO authenticated
  USING((SELECT public.registration_has_access())) WITH CHECK((SELECT public.registration_has_access()));
CREATE POLICY crm_active_access ON public.crm_lead_payment_status AS RESTRICTIVE FOR ALL TO authenticated
  USING(public.crm_has_access()) WITH CHECK(public.crm_has_access());

CREATE TRIGGER dashboard_crm_payment_status_signal AFTER INSERT OR UPDATE OR DELETE ON public.crm_lead_payment_status
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_payment_status;

CREATE FUNCTION public.crm_set_payment_status(p_lead_id uuid,p_status text)
RETURNS public.crm_lead_payment_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_before public.crm_lead_payment_status;
  v_after public.crm_lead_payment_status;
  v_label text;
BEGIN
  PERFORM public.crm_require_role('leads');
  PERFORM public.crm_require_role('closer');
  -- SECURITY DEFINER bypasses RLS, so apply its account/registration guards explicitly.
  IF NOT public.dashboard_account_active() OR NOT public.registration_has_access() THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pago','pendente','nao_pago') THEN
    RAISE EXCEPTION 'Status de pagamento inválido' USING ERRCODE='22023';
  END IF;
  -- Serialize first selections and subsequent changes with CRM's existing lead lock order.
  -- A row lock changes no lead fields or version and also protects concurrent deletion.
  PERFORM 1 FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_before FROM public.crm_lead_payment_status WHERE lead_id=p_lead_id;
  IF FOUND AND v_before.status=p_status THEN RETURN v_before; END IF;
  INSERT INTO public.crm_lead_payment_status(lead_id,status,updated_by,updated_at)
  VALUES(p_lead_id,p_status,auth.uid(),clock_timestamp())
  ON CONFLICT(lead_id) DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
  RETURNING * INTO v_after;
  v_label:=CASE p_status WHEN 'pago' THEN 'Pago' WHEN 'nao_pago' THEN 'Não pago' ELSE 'Pendente' END;
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,is_completed,completed_at,previous_state,new_state)
  VALUES(p_lead_id,auth.uid(),'transicao','Pagamento marcado como '||v_label,
    'Status informativo de pagamento atualizado manualmente',true,v_after.updated_at,
    CASE WHEN v_before.lead_id IS NOT NULL THEN jsonb_build_object('payment_status',v_before.status) END,
    jsonb_build_object('payment_status',v_after.status));
  RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.crm_set_payment_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_set_payment_status(uuid,text) TO authenticated;

-- Rollback keeps all legacy history: revert the UI, disable crm_legacy_payment_readonly,
-- and regrant authenticated EXECUTE on the three preserved legacy mutations.
-- Export any manually selected new statuses first;
-- they cannot reconstruct amounts/installments. Do not drop either table as part of rollback.
NOTIFY pgrst,'reload schema';
COMMIT;
