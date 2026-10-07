-- Customer payments on a CRM lead. A lead has any number of entries (entrada, parcelas...), each one
-- Pendente / Pago / Não pago, marked by hand by a Closer (or Executive). The lead badge is derived from its
-- entries and never changes by itself, not even after a due date:
--   every entry Pago -> Pago; any entry Não pago -> Não pago; anything else -> Pendente; no entries -> no badge.
-- Informational only: it does not touch sale approval, commission, Arena points or withdrawals.
-- Writes go through the SECURITY DEFINER functions below (revisioned, with a timeline entry); the table is read-only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.crm_lead_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  method text NOT NULL DEFAULT 'pix',
  due_date date,
  status text NOT NULL DEFAULT 'pendente',
  paid_at timestamptz,
  status_reason text,
  proof_url text,
  notes text,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT crm_lead_payments_input CHECK (
    char_length(btrim(description)) BETWEEN 1 AND 120
    AND amount > 0 AND amount <= 10000000
    AND method IN ('pix','cartao_credito','cartao_debito','boleto','transferencia','dinheiro','outro')
    AND char_length(COALESCE(notes,'')) <= 1000
    AND char_length(COALESCE(status_reason,'')) <= 500
    AND (proof_url IS NULL OR (char_length(proof_url) <= 2048 AND proof_url ~ '^https://drive[.]google[.]com/[^[:space:]]+$'))
  ),
  CONSTRAINT crm_lead_payments_status CHECK (
    status IN ('pendente','pago','nao_pago')
    AND ((status = 'pago') = (paid_at IS NOT NULL))
    AND (status <> 'nao_pago' OR char_length(btrim(COALESCE(status_reason,''))) >= 3)
    AND (status = 'nao_pago' OR status_reason IS NULL)
  )
);
CREATE INDEX crm_lead_payments_lead_idx ON public.crm_lead_payments(lead_id, created_at);

ALTER TABLE public.crm_lead_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_lead_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_lead_payments TO authenticated;
CREATE POLICY crm_lead_payments_select ON public.crm_lead_payments FOR SELECT TO authenticated
  USING (public.crm_has_access());
CREATE POLICY dashboard_active_account ON public.crm_lead_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.dashboard_account_active()) WITH CHECK (public.dashboard_account_active());
CREATE POLICY registration_access ON public.crm_lead_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.registration_has_access())) WITH CHECK ((SELECT public.registration_has_access()));
CREATE POLICY crm_active_access ON public.crm_lead_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.crm_has_access()) WITH CHECK (public.crm_has_access());

CREATE TRIGGER dashboard_crm_payments_signal AFTER INSERT OR UPDATE OR DELETE ON public.crm_lead_payments
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('crm');
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_payments;

-- What the lead timeline shows for a payment (the screen renders only the keys that changed).
CREATE FUNCTION private.crm_payment_state(p public.crm_lead_payments) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('payment_status',p.status,'payment_amount',p.amount,'payment_method',p.method,
    'payment_due_date',p.due_date,'payment_paid_at',p.paid_at);
$$;
REVOKE ALL ON FUNCTION private.crm_payment_state(public.crm_lead_payments) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.crm_payment_log(p_lead_id uuid, p_title text, p_description text, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.crm_activities(lead_id,user_id,activity_type,title,description,is_completed,completed_at,previous_state,new_state)
    VALUES(p_lead_id,auth.uid(),'transicao',p_title,p_description,true,clock_timestamp(),p_before,p_after);
END; $$;
REVOKE ALL ON FUNCTION private.crm_payment_log(uuid,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;

-- Create (p_payment_id NULL) or edit an entry. An edit needs the revision (updated_at) the screen was showing.
CREATE FUNCTION public.crm_payment_save(
  p_lead_id uuid,
  p_payment_id uuid,
  p_description text,
  p_amount numeric,
  p_method text,
  p_due_date date,
  p_notes text,
  p_proof_url text,
  p_expected_revision timestamptz
) RETURNS public.crm_lead_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  l public.crm_leads;
  o public.crm_lead_payments;
  c public.crm_lead_payments;
  v_desc text := NULLIF(btrim(p_description),'');
  v_notes text := NULLIF(btrim(p_notes),'');
  v_amount numeric(12,2);
  v_proof text;
BEGIN
  PERFORM public.crm_require_role('leads');
  PERFORM public.crm_require_role('closer');
  IF v_desc IS NULL OR char_length(v_desc) > 120 THEN
    RAISE EXCEPTION 'Informe uma descrição de até 120 caracteres' USING ERRCODE='22023';
  END IF;
  IF p_amount IS NULL OR p_amount > 10000000 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero' USING ERRCODE='22023';
  END IF;
  v_amount := round(p_amount,2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero' USING ERRCODE='22023';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('pix','cartao_credito','cartao_debito','boleto','transferencia','dinheiro','outro') THEN
    RAISE EXCEPTION 'Escolha uma forma de pagamento válida' USING ERRCODE='22023';
  END IF;
  IF char_length(COALESCE(v_notes,'')) > 1000 THEN
    RAISE EXCEPTION 'A observação aceita até 1000 caracteres' USING ERRCODE='22023';
  END IF;
  v_proof := private.crm_normalize_drive_url(p_proof_url);
  -- Same lock order as the rest of the CRM: the lead first, then its entry.
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_payment_id IS NULL THEN
    INSERT INTO public.crm_lead_payments(lead_id,description,amount,method,due_date,notes,proof_url,created_by,updated_by)
      VALUES(l.id,v_desc,v_amount,p_method,p_due_date,v_notes,v_proof,auth.uid(),auth.uid()) RETURNING * INTO c;
    PERFORM private.crm_payment_log(l.id,'Lançamento de pagamento criado',v_desc,NULL,private.crm_payment_state(c));
    RETURN c;
  END IF;
  SELECT * INTO o FROM public.crm_lead_payments WHERE id=p_payment_id AND lead_id=l.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS DISTINCT FROM o.updated_at THEN
    RAISE EXCEPTION 'Lançamento alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF (v_desc,v_amount,p_method,p_due_date,v_notes,v_proof)
    IS NOT DISTINCT FROM (o.description,o.amount,o.method,o.due_date,o.notes,o.proof_url) THEN
    RETURN o;
  END IF;
  UPDATE public.crm_lead_payments SET description=v_desc,amount=v_amount,method=p_method,due_date=p_due_date,
    notes=v_notes,proof_url=v_proof,updated_by=auth.uid(),updated_at=clock_timestamp()
    WHERE id=o.id RETURNING * INTO c;
  PERFORM private.crm_payment_log(l.id,'Lançamento de pagamento editado',v_desc,
    private.crm_payment_state(o),private.crm_payment_state(c));
  RETURN c;
END; $$;

-- Mark an entry Pago (date defaults to now, never in the future), Não pago (reason required) or back to Pendente.
CREATE FUNCTION public.crm_payment_set_status(
  p_payment_id uuid,
  p_status text,
  p_paid_at timestamptz,
  p_reason text,
  p_expected_revision timestamptz
) RETURNS public.crm_lead_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  l public.crm_leads;
  o public.crm_lead_payments;
  c public.crm_lead_payments;
  v_lead uuid;
  v_reason text := NULLIF(btrim(p_reason),'');
  v_paid timestamptz;
BEGIN
  PERFORM public.crm_require_role('leads');
  PERFORM public.crm_require_role('closer');
  IF p_status IS NULL OR p_status NOT IN ('pendente','pago','nao_pago') THEN
    RAISE EXCEPTION 'Status de pagamento inválido' USING ERRCODE='22023';
  END IF;
  SELECT lead_id INTO v_lead FROM public.crm_lead_payments WHERE id=p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO o FROM public.crm_lead_payments WHERE id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS DISTINCT FROM o.updated_at THEN
    RAISE EXCEPTION 'Lançamento alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  IF p_status = 'pago' THEN
    v_paid := COALESCE(p_paid_at,clock_timestamp());
    IF NOT isfinite(v_paid) OR v_paid > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'A data do pagamento não pode estar no futuro' USING ERRCODE='22023';
    END IF;
  ELSIF p_status = 'nao_pago' THEN
    IF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'Informe o motivo (de 3 a 500 caracteres)' USING ERRCODE='22023';
    END IF;
  END IF;
  IF o.status = p_status
    AND (p_status <> 'pago' OR p_paid_at IS NULL OR p_paid_at = o.paid_at)
    AND (p_status <> 'nao_pago' OR v_reason IS NOT DISTINCT FROM o.status_reason) THEN
    RETURN o;
  END IF;
  UPDATE public.crm_lead_payments SET status=p_status,
    paid_at=CASE WHEN p_status='pago' THEN v_paid END,
    status_reason=CASE WHEN p_status='nao_pago' THEN v_reason END,
    updated_by=auth.uid(),updated_at=clock_timestamp()
    WHERE id=o.id RETURNING * INTO c;
  PERFORM private.crm_payment_log(l.id,
    CASE p_status WHEN 'pago' THEN 'Pagamento marcado como Pago'
      WHEN 'nao_pago' THEN 'Pagamento marcado como Não pago'
      ELSE 'Pagamento voltou para Pendente' END,
    c.description || CASE WHEN v_reason IS NOT NULL AND p_status='nao_pago' THEN ' — Motivo: ' || v_reason ELSE '' END,
    private.crm_payment_state(o),private.crm_payment_state(c));
  RETURN c;
END; $$;

CREATE FUNCTION public.crm_payment_delete(
  p_payment_id uuid,
  p_reason text,
  p_expected_revision timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  l public.crm_leads;
  o public.crm_lead_payments;
  v_lead uuid;
  v_reason text := NULLIF(btrim(p_reason),'');
BEGIN
  PERFORM public.crm_require_role('leads');
  PERFORM public.crm_require_role('closer');
  IF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Informe o motivo da remoção (de 3 a 500 caracteres)' USING ERRCODE='22023';
  END IF;
  SELECT lead_id INTO v_lead FROM public.crm_lead_payments WHERE id=p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id=v_lead FOR UPDATE;
  SELECT * INTO o FROM public.crm_lead_payments WHERE id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS DISTINCT FROM o.updated_at THEN
    RAISE EXCEPTION 'Lançamento alterado. Atualize e tente novamente.' USING ERRCODE='PT409';
  END IF;
  PERFORM private.crm_payment_log(l.id,'Lançamento de pagamento removido',
    o.description || ' — Motivo: ' || v_reason,private.crm_payment_state(o),NULL);
  DELETE FROM public.crm_lead_payments WHERE id=o.id;
  RETURN jsonb_build_object('payment_id',o.id,'lead_id',l.id);
END; $$;

-- One row per lead that has entries: the badge status plus what the card and the sheet header show.
CREATE FUNCTION public.crm_lead_payment_summaries()
RETURNS TABLE(lead_id uuid, total_count integer, paid_count integer, unpaid_count integer, pending_count integer,
  total_amount numeric, paid_amount numeric, status text, next_due_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.crm_require_role('leads');
  RETURN QUERY
  SELECT p.lead_id,
    count(*)::integer,
    (count(*) FILTER (WHERE p.status='pago'))::integer,
    (count(*) FILTER (WHERE p.status='nao_pago'))::integer,
    (count(*) FILTER (WHERE p.status='pendente'))::integer,
    COALESCE(sum(p.amount),0),
    COALESCE(sum(p.amount) FILTER (WHERE p.status='pago'),0),
    CASE WHEN count(*) FILTER (WHERE p.status='nao_pago') > 0 THEN 'nao_pago'
      WHEN count(*) FILTER (WHERE p.status='pago') = count(*) THEN 'pago'
      ELSE 'pendente' END,
    min(p.due_date) FILTER (WHERE p.status='pendente')
  FROM public.crm_lead_payments p
  GROUP BY p.lead_id;
END; $$;

REVOKE ALL ON FUNCTION public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_payment_delete(uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_lead_payment_summaries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_payment_save(uuid,uuid,text,numeric,text,date,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_payment_set_status(uuid,text,timestamptz,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_payment_delete(uuid,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lead_payment_summaries() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
