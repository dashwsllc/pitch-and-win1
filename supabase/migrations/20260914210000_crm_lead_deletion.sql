-- Lead deletion is a versioned, audited CRM operation. Calls, history and
-- context follow the lead cascade; an existing sale remains financially intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_crm_lead_id_fkey;
ALTER TABLE public.vendas ADD CONSTRAINT vendas_crm_lead_id_fkey
  FOREIGN KEY (crm_lead_id) REFERENCES public.crm_leads(id) ON DELETE SET NULL;

-- The lead-delete RPC is the only owner-level flow allowed to detach a sale.
-- Browser updates still cannot add, replace or remove CRM sale links directly.
CREATE OR REPLACE FUNCTION public.crm_guard_sale_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE l public.crm_leads; v_owner name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid=TG_RELID;
  IF TG_OP='UPDATE' AND NEW.crm_lead_id IS DISTINCT FROM OLD.crm_lead_id
    AND NOT (
      current_user=v_owner
      AND NEW.crm_lead_id IS NULL
      AND OLD.crm_lead_id::text=current_setting('crm.lead_delete',true)
    ) THEN
    RAISE EXCEPTION 'Vínculo com lead é imutável' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' AND NEW.crm_lead_id IS NOT NULL THEN
    IF NOT public.crm_can('sales') OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Registre a venda com o usuário Closer logado' USING ERRCODE='42501';
    END IF;
    SELECT * INTO l FROM public.crm_leads WHERE id=NEW.crm_lead_id FOR UPDATE;
    IF NOT FOUND OR l.pipeline_stage<>'fechado_ganho' THEN
      RAISE EXCEPTION 'Selecione um lead com venda concluída' USING ERRCODE='22023';
    END IF;
    IF NOT public.crm_can('admin') AND l.closer_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Somente Closer responsável pode cadastrar esta venda' USING ERRCODE='42501';
    END IF;
    IF EXISTS(SELECT 1 FROM public.vendas WHERE crm_lead_id=l.id) THEN
      RAISE EXCEPTION 'Venda já cadastrada para este fechamento' USING ERRCODE='PT409';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- Keep the existing sale-review rules while allowing the FK to clear only the
-- link named by crm_delete_lead. Every commercial and financial field must be
-- byte-for-byte identical at this point in the trigger chain.
CREATE OR REPLACE FUNCTION public.dashboard_guard_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  PERFORM public.dashboard_require_access();
  IF TG_OP='UPDATE'
    AND NEW.crm_lead_id IS NULL
    AND OLD.crm_lead_id::text=current_setting('crm.lead_delete',true)
    AND (to_jsonb(NEW)-'crm_lead_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'crm_lead_id') THEN
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND OLD.approval_status='pendente' AND OLD.user_id=auth.uid()
    AND current_setting('dashboard.sale_decision',true) IS DISTINCT FROM OLD.id::text THEN
    INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data)
      VALUES(auth.uid(),COALESCE((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Vendedor'),
        'sale.cancel',OLD.id,OLD.nome_produto,'Solicitação pendente cancelada pelo vendedor',to_jsonb(OLD));
    RETURN OLD;
  END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
      NEW.approval_status IS DISTINCT FROM OLD.approval_status OR
      NEW.commission_amount IS DISTINCT FROM OLD.commission_amount OR
      NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
      NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason OR
      NEW.withdrawn IS DISTINCT FROM OLD.withdrawn OR NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id OR
      NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at OR OLD.approval_status <> 'pendente')) THEN
    IF NOT public.is_executive(auth.uid()) OR current_setting('dashboard.sale_decision',true) IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'Utilize a revisão executiva para alterar ou excluir esta venda' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'Vendedor e data de registro são imutáveis';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;

CREATE FUNCTION public.crm_delete_lead(p_lead_id uuid,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  l public.crm_leads;
  v_actor text;
  v_activities integer;
  v_contexts integer;
  v_sales integer;
BEGIN
  PERFORM public.crm_require_role('leads');
  SELECT * INTO l FROM public.crm_leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead não encontrado ou já excluído' USING ERRCODE='P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM l.version THEN
    RAISE EXCEPTION 'Este lead foi alterado. A lista foi atualizada; confira e tente novamente.' USING ERRCODE='PT409';
  END IF;
  SELECT count(*) INTO v_activities FROM public.crm_activities WHERE lead_id=l.id;
  SELECT count(*) INTO v_contexts FROM public.crm_lead_contexts WHERE lead_id=l.id;
  SELECT count(*) INTO v_sales FROM public.vendas WHERE crm_lead_id=l.id;
  SELECT COALESCE(display_name,auth.uid()::text) INTO v_actor
    FROM public.profiles WHERE user_id=auth.uid();
  INSERT INTO public.executive_audit_events(
    actor_id,actor_name,action,target_id,target_label,reason,before_data
  ) VALUES (
    auth.uid(),COALESCE(v_actor,'Usuário'),'crm.lead.delete',l.id,
    COALESCE(NULLIF(btrim(l.athlete_name),''),NULLIF(btrim(l.name),''),'Lead sem nome'),
    'Lead excluído no CRM',
    jsonb_build_object(
      'athlete_name',l.athlete_name,
      'responsible_name',l.name,
      'pipeline_stage',l.pipeline_stage,
      'temperature',l.temperature,
      'activities_count',v_activities,
      'contexts_count',v_contexts,
      'linked_sales_count',v_sales
    )
  );
  PERFORM set_config('crm.lead_delete',l.id::text,true);
  DELETE FROM public.crm_leads WHERE id=l.id;
  PERFORM set_config('crm.lead_delete','',true);
  RETURN jsonb_build_object('lead_id',l.id,'detached_sales',v_sales);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('crm.lead_delete','',true);
  RAISE;
END; $$;

-- Route every client deletion through the audited, conflict-safe RPC.
DROP POLICY IF EXISTS crm_leads_delete ON public.crm_leads;
REVOKE DELETE ON public.crm_leads FROM authenticated;
REVOKE ALL ON FUNCTION public.crm_delete_lead(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_delete_lead(uuid,bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
