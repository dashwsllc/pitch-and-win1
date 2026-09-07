-- Executive controls, public team scoreboard, authoritative authentication timestamps.
-- Applied as one transaction. Private customer/authentication fields never enter the team feed.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_executive(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id
    AND r.role::text IN ('executive', 'super_admin'))
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _user_id AND p.suspended);
$$;

CREATE OR REPLACE FUNCTION public.dashboard_require_access(p_executive boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND suspended)
    OR (p_executive AND NOT public.is_executive(auth.uid())) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE TABLE public.dashboard_events (
  topic text PRIMARY KEY CHECK (topic IN ('sales','users','audit','goals')),
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.dashboard_events(topic) VALUES ('sales'),('users'),('audit'),('goals');
ALTER TABLE public.dashboard_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY dashboard_events_read ON public.dashboard_events FOR SELECT TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.suspended)
    AND (topic IN ('sales','goals') OR public.is_executive(auth.uid())));
REVOKE ALL ON public.dashboard_events FROM anon, authenticated;
GRANT SELECT ON public.dashboard_events TO authenticated;

CREATE TABLE public.executive_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_name text NOT NULL,
  action text NOT NULL,
  target_id uuid NOT NULL,
  target_label text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX executive_audit_events_time ON public.executive_audit_events(created_at DESC);
ALTER TABLE public.executive_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY executive_audit_read ON public.executive_audit_events FOR SELECT TO authenticated
  USING (public.is_executive(auth.uid()));
REVOKE ALL ON public.executive_audit_events FROM anon, authenticated;
GRANT SELECT ON public.executive_audit_events TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_signal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.dashboard_events SET revision = revision + 1, updated_at = clock_timestamp()
    WHERE topic = TG_ARGV[0];
  RETURN NULL;
END;
$$;
CREATE TRIGGER dashboard_sales_signal AFTER INSERT OR UPDATE OR DELETE ON public.vendas
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('sales');
CREATE TRIGGER dashboard_profiles_signal AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('users');
CREATE TRIGGER dashboard_roles_signal AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('users');
CREATE TRIGGER dashboard_auth_signal AFTER UPDATE OF last_sign_in_at, email, phone, banned_until ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('users');
CREATE TRIGGER dashboard_audit_signal AFTER INSERT ON public.executive_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('audit');
CREATE TRIGGER dashboard_goals_signal AFTER INSERT OR UPDATE OR DELETE ON public.company_goals
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('goals');
CREATE TRIGGER dashboard_approaches_signal AFTER INSERT OR UPDATE OR DELETE ON public.abordagens
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('sales');
ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_events;

-- Ledger values always derive from approved, frozen per-sale commissions.
CREATE OR REPLACE FUNCTION public.dashboard_refresh_balance(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric; v_paid numeric; v_reserved numeric;
BEGIN
  SELECT COALESCE(sum(commission_amount),0) INTO v_total FROM public.vendas
    WHERE user_id=p_user_id AND approval_status='aprovada';
  SELECT COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)) FILTER (WHERE status='pago'),0),
    COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)) FILTER (WHERE status IN ('pendente','processando','aprovado')),0)
    INTO v_paid,v_reserved FROM public.saques WHERE user_id=p_user_id;
  INSERT INTO public.saldos_disponiveis(user_id,valor_total_comissoes,valor_sacado,valor_liberado_para_saque)
    VALUES(p_user_id,v_total,v_paid,greatest(0,v_total-v_paid-v_reserved))
    ON CONFLICT(user_id) DO UPDATE SET valor_total_comissoes=EXCLUDED.valor_total_comissoes,
      valor_sacado=EXCLUDED.valor_sacado,valor_liberado_para_saque=EXCLUDED.valor_liberado_para_saque,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_refresh_balance(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_commission_on_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.dashboard_refresh_balance(CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END);
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS trigger_update_commission_on_sale_insert ON public.vendas;
DROP TRIGGER IF EXISTS trigger_update_commission_on_sale_update ON public.vendas;
DROP TRIGGER IF EXISTS trigger_update_commission_on_sale_delete ON public.vendas;
DROP TRIGGER IF EXISTS trigger_update_commission_on_sale ON public.vendas;
CREATE TRIGGER trigger_update_commission_on_sale AFTER INSERT OR UPDATE OR DELETE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.update_commission_on_sale();

CREATE OR REPLACE FUNCTION public.dashboard_withdrawal_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.dashboard_refresh_balance(CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END);
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS trigger_update_balance_on_withdrawal ON public.saques;
DROP TRIGGER IF EXISTS trigger_balance_on_withdrawal_insert ON public.saques;
DROP TRIGGER IF EXISTS trigger_restore_balance_on_rejection ON public.saques;
CREATE TRIGGER dashboard_withdrawal_balance AFTER INSERT OR UPDATE OR DELETE ON public.saques
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_withdrawal_balance();

CREATE OR REPLACE FUNCTION public.get_available_balance(p_seller_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric; v_committed numeric;
BEGIN
  PERFORM public.dashboard_require_access();
  IF p_seller_id <> auth.uid() AND NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(sum(commission_amount),0) INTO v_total FROM public.vendas
    WHERE user_id=p_seller_id AND approval_status='aprovada';
  SELECT COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)),0) INTO v_committed
    FROM public.saques WHERE user_id=p_seller_id AND status IN ('pendente','processando','aprovado','pago');
  RETURN greatest(0,v_total-v_committed);
END;
$$;

-- Serialize sales decisions and withdrawal reservations for a given seller.
CREATE OR REPLACE FUNCTION public.dashboard_guard_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric; v_committed numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,42));
  IF TG_OP='INSERT' THEN
    SELECT COALESCE(sum(commission_amount),0) INTO v_total FROM public.vendas
      WHERE user_id=NEW.user_id AND approval_status='aprovada';
    SELECT COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)),0) INTO v_committed FROM public.saques
      WHERE user_id=NEW.user_id AND status IN ('pendente','processando','aprovado','pago');
    IF NEW.valor_solicitado <= 0 OR NEW.valor_solicitado > greatest(0,v_total-v_committed) THEN
      RAISE EXCEPTION 'Saldo insuficiente para reservar este saque';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.is_executive(auth.uid()) THEN
      NEW.status := 'pendente'; NEW.valor_aprovado := NULL; NEW.pago_em := NULL;
      NEW.revisado_por := NULL; NEW.revisado_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dashboard_guard_withdrawal BEFORE INSERT OR UPDATE ON public.saques
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_guard_withdrawal();

-- Sensitive sale fields can only change inside the executive decision RPC.
CREATE OR REPLACE FUNCTION public.dashboard_guard_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  PERFORM public.dashboard_require_access();
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
CREATE TRIGGER dashboard_guard_sale BEFORE UPDATE OR DELETE ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_guard_sale();

CREATE OR REPLACE FUNCTION public.enforce_pending_sale_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.approval_status := 'pendente'; NEW.commission_amount := 0;
  NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.rejection_reason := NULL;
  NEW.withdrawn := false; NEW.withdrawn_at := NULL; NEW.withdrawal_id := NULL;
  NEW.created_at := clock_timestamp();
  IF NEW.valor_venda <= 0 THEN RAISE EXCEPTION 'A venda deve ter valor maior que zero'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.executive_review_sale(p_sale_id uuid,p_action text,p_reason text DEFAULT '',p_expected_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale public.vendas; v_after public.vendas; v_rate numeric; v_total numeric; v_committed numeric; v_actor text;
BEGIN
  PERFORM public.dashboard_require_access(true);
  SELECT * INTO v_sale FROM public.vendas WHERE id=p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada ou já excluída'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_sale.user_id::text,42));
  SELECT * INTO v_sale FROM public.vendas WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada ou já excluída'; END IF;
  IF p_expected_status IS NOT NULL AND p_expected_status <> v_sale.approval_status THEN
    RAISE EXCEPTION 'Esta venda foi alterada por outro executivo. Atualize e confira o status';
  END IF;
  IF p_action NOT IN ('approve','reject','delete') OR p_action IS NULL THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  IF p_action <> 'approve' AND length(btrim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Informe um motivo com pelo menos 5 caracteres'; END IF;
  IF p_action <> 'delete' AND v_sale.approval_status <> 'pendente' THEN RAISE EXCEPTION 'A venda já foi revisada'; END IF;
  PERFORM set_config('dashboard.sale_decision',p_sale_id::text,true);
  SELECT COALESCE(display_name,'Executivo') INTO v_actor FROM public.profiles WHERE user_id=auth.uid();
  IF p_action='delete' THEN
    IF v_sale.withdrawn OR v_sale.withdrawal_id IS NOT NULL OR EXISTS(
      SELECT 1 FROM public.saques WHERE p_sale_id=ANY(vendas_incluidas) AND status NOT IN ('rejeitado','cancelado')) THEN
      RAISE EXCEPTION 'Venda vinculada a saque. Regularize o saque antes da exclusão para preservar o histórico financeiro';
    END IF;
    IF v_sale.approval_status='aprovada' THEN
      SELECT COALESCE(sum(commission_amount),0) INTO v_total FROM public.vendas
        WHERE user_id=v_sale.user_id AND approval_status='aprovada' AND id<>p_sale_id;
      SELECT COALESCE(sum(COALESCE(valor_aprovado,valor_solicitado)),0) INTO v_committed FROM public.saques
        WHERE user_id=v_sale.user_id AND status IN ('pendente','processando','aprovado','pago');
      IF v_total < v_committed THEN RAISE EXCEPTION 'A comissão desta venda está comprometida com saques. Regularize os saques antes de excluir'; END IF;
    END IF;
    DELETE FROM public.vendas WHERE id=p_sale_id;
  ELSE
    SELECT COALESCE(commission_rate,0) INTO v_rate FROM public.user_roles WHERE user_id=v_sale.user_id
      ORDER BY updated_at DESC, id LIMIT 1;
    UPDATE public.vendas SET approval_status=CASE WHEN p_action='approve' THEN 'aprovada' ELSE 'rejeitada' END,
      commission_amount=CASE WHEN p_action='approve' THEN round(valor_venda*COALESCE(v_rate,0)/100,2) ELSE 0 END,
      reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),
      rejection_reason=CASE WHEN p_action='reject' THEN btrim(p_reason) ELSE NULL END
      WHERE id=p_sale_id RETURNING * INTO v_after;
  END IF;
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
    VALUES(auth.uid(),COALESCE(v_actor,'Executivo'),'sale.'||p_action,p_sale_id,v_sale.nome_produto,
      CASE WHEN p_action='approve' THEN 'Venda conferida e aprovada'||CASE WHEN length(btrim(p_reason))>0 THEN ': '||btrim(p_reason) ELSE '' END ELSE btrim(p_reason) END,
      to_jsonb(v_sale),CASE WHEN p_action='delete' THEN NULL ELSE to_jsonb(v_after) END);
  RETURN jsonb_build_object('id',p_sale_id,'action',p_action);
END;
$$;
CREATE OR REPLACE FUNCTION public.approve_sale(p_sale_id uuid)
RETURNS public.vendas LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale public.vendas;
BEGIN
  PERFORM public.executive_review_sale(p_sale_id,'approve');
  SELECT * INTO v_sale FROM public.vendas WHERE id=p_sale_id;
  RETURN v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_board(p_status text DEFAULT 'pendente',p_search text DEFAULT '',p_page integer DEFAULT 0,p_page_size integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_exec boolean;
BEGIN
  PERFORM public.dashboard_require_access();
  v_exec := public.is_executive(auth.uid());
  IF p_status NOT IN ('pendente','aprovada','rejeitada','all') OR (p_status='rejeitada' AND NOT v_exec) THEN
    RAISE EXCEPTION 'Filtro inválido';
  END IF;
  WITH base AS (
    SELECT v.*,COALESCE(p.display_name,'Vendedor') AS seller_name,p.avatar_url AS seller_avatar,
      COALESCE(r.display_name,'Executivo') AS reviewer_name
    FROM public.vendas v LEFT JOIN public.profiles p ON p.user_id=v.user_id
      LEFT JOIN public.profiles r ON r.user_id=v.reviewed_by
    WHERE (v_exec OR v.approval_status IN ('pendente','aprovada'))
      AND (COALESCE(p_search,'')='' OR strpos(lower(COALESCE(p.display_name,'')||' '||v.nome_produto),lower(p_search))>0)
  ), filtered AS (
    SELECT * FROM base WHERE p_status='all' OR approval_status=p_status
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN p_status='pendente' THEN created_at END ASC,
      CASE WHEN p_status='aprovada' THEN COALESCE(reviewed_at,created_at) ELSE created_at END DESC,id
      LIMIT greatest(1,least(COALESCE(p_page_size,12),50)) OFFSET greatest(0,COALESCE(p_page,0))*greatest(1,least(COALESCE(p_page_size,12),50))
  ) SELECT jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'seller_name',seller_name,
      'seller_avatar',seller_avatar,'nome_produto',nome_produto,'valor_venda',valor_venda,'approval_status',approval_status,
      'created_at',created_at,'reviewed_at',reviewed_at) || CASE WHEN v_exec THEN
        jsonb_build_object('nome_comprador',nome_comprador,'email_comprador',email_comprador,'whatsapp_comprador',whatsapp_comprador,
          'commission_amount',commission_amount,'rejection_reason',rejection_reason,'reviewer_name',reviewer_name,
          'withdrawn',withdrawn,'withdrawal_id',withdrawal_id,'consideracoes_gerais',consideracoes_gerais)
        ELSE '{}'::jsonb END) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),
    'summary',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE approval_status='pendente'),
      'approved',count(*) FILTER(WHERE approval_status='aprovada'),'rejected',count(*) FILTER(WHERE approval_status='rejeitada'),
      'pending_value',COALESCE(sum(valor_venda) FILTER(WHERE approval_status='pendente'),0),
      'approved_value',COALESCE(sum(valor_venda) FILTER(WHERE approval_status='aprovada'),0),
      'overdue',count(*) FILTER(WHERE approval_status='pendente' AND created_at<now()-interval '24 hours')) FROM base),
    'fetched_at',clock_timestamp()) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_ranking()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();
  SELECT COALESCE(jsonb_agg(x ORDER BY x."totalVendas" DESC,x."quantidadeVendas" DESC,x.name,x.user_id),'[]'::jsonb)
    INTO v_result FROM (
      SELECT p.user_id,COALESCE(p.display_name,'Vendedor') AS name,
        COALESCE(s.amount,0) AS "totalVendas",COALESCE(s.total,0) AS "quantidadeVendas",
        CASE WHEN COALESCE(a.total,0)>0 THEN round(COALESCE(s.total,0)::numeric/a.total*100,1) ELSE 0 END AS conversao
      FROM public.profiles p
      LEFT JOIN (SELECT user_id,count(*) AS total,sum(valor_venda) AS amount FROM public.vendas WHERE approval_status='aprovada' GROUP BY user_id) s USING(user_id)
      LEFT JOIN (SELECT user_id,count(*) AS total FROM public.abordagens GROUP BY user_id) a USING(user_id)
      WHERE NOT p.suspended AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id AND r.role::text IN ('seller','closer','sdr','bdr'))
    ) x;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.executive_list_users()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access(true);
  SELECT jsonb_build_object('users',COALESCE(jsonb_agg(jsonb_build_object(
      'id',p.id,'user_id',u.id,'display_name',p.display_name,'avatar_url',p.avatar_url,
      'suspended',COALESCE(p.suspended,false) OR COALESCE(u.banned_until>now(),false),
      'email',u.email,'phone',u.phone,'email_confirmed_at',u.email_confirmed_at,'phone_confirmed_at',u.phone_confirmed_at,
      'created_at',u.created_at,'updated_at',p.updated_at,'last_sign_in_at',u.last_sign_in_at,
      'account_revision',COALESCE(u.raw_app_meta_data->'dashboard_account'->>'revision',''),
      'user_roles',COALESCE((SELECT jsonb_agg(r ORDER BY r.created_at,r.id) FROM public.user_roles r WHERE r.user_id=u.id),'[]'::jsonb)
    ) ORDER BY u.created_at DESC),'[]'::jsonb),'fetched_at',clock_timestamp()) INTO v_result
    FROM auth.users u LEFT JOIN public.profiles p ON p.user_id=u.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_goal_totals()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_today timestamptz; v_week timestamptz; v_month timestamptz; v_result jsonb;
BEGIN
  PERFORM public.dashboard_require_access();
  v_today := date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_week := date_trunc('week',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_month := date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  SELECT jsonb_build_object('daily',jsonb_build_object('count',count(*) FILTER(WHERE created_at>=v_today),
      'amount',COALESCE(sum(valor_venda) FILTER(WHERE created_at>=v_today),0)),
    'weekly',jsonb_build_object('count',count(*) FILTER(WHERE created_at>=v_week),'amount',COALESCE(sum(valor_venda) FILTER(WHERE created_at>=v_week),0)),
    'monthly',jsonb_build_object('count',count(*) FILTER(WHERE created_at>=v_month),'amount',COALESCE(sum(valor_venda) FILTER(WHERE created_at>=v_month),0)))
    INTO v_result FROM public.vendas WHERE approval_status='aprovada' AND created_at>=least(v_week,v_month) AND created_at<=now();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.executive_cancel_withdrawal(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_saque public.saques; v_sale record;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Informe o motivo da regularização'; END IF;
  SELECT * INTO v_saque FROM public.saques WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saque não encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_saque.user_id::text,42));
  SELECT * INTO v_saque FROM public.saques WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_saque.status NOT IN ('pendente','processando','aprovado') THEN
    RAISE EXCEPTION 'Somente saques ainda não pagos podem ser regularizados';
  END IF;
  UPDATE public.saques SET status='rejeitado',motivo_rejeicao=btrim(p_reason),revisado_por=auth.uid(),revisado_em=clock_timestamp() WHERE id=p_id;
  FOR v_sale IN SELECT id FROM public.vendas WHERE withdrawal_id=p_id LOOP
    PERFORM set_config('dashboard.sale_decision',v_sale.id::text,true);
    UPDATE public.vendas SET withdrawn=false,withdrawn_at=NULL,withdrawal_id=NULL WHERE id=v_sale.id;
  END LOOP;
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
    VALUES(auth.uid(),COALESCE((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Executivo'),
      'withdrawal.reject',p_id,COALESCE((SELECT display_name FROM public.profiles WHERE user_id=v_saque.user_id),'Vendedor'),
      btrim(p_reason),to_jsonb(v_saque),jsonb_build_object('status','rejeitado'));
END; $$;
REVOKE ALL ON FUNCTION public.executive_cancel_withdrawal(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.executive_cancel_withdrawal(uuid,text) TO authenticated,service_role;
CREATE TRIGGER dashboard_withdrawal_signal AFTER INSERT OR UPDATE OR DELETE ON public.saques
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('sales');

-- Auth Admin API changes and profile/permission changes commit together.
-- raw_app_meta_data is writable only through trusted administrative APIs.
CREATE OR REPLACE FUNCTION public.apply_executive_account_patch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_patch jsonb; v_actor uuid; v_old jsonb; v_roles text[]; v_suspended boolean; v_rate numeric; v_profile public.profiles; v_actor_name text;
BEGIN
  v_patch := NEW.raw_app_meta_data->'dashboard_account';
  IF v_patch IS NULL OR v_patch IS NOT DISTINCT FROM OLD.raw_app_meta_data->'dashboard_account' THEN RETURN NEW; END IF;
  v_actor := (v_patch->>'actor_id')::uuid;
  IF NOT public.is_executive(v_actor) THEN RAISE EXCEPTION 'Acesso executivo necessário' USING ERRCODE='42501'; END IF;
  IF v_patch->>'expected_revision' IS DISTINCT FROM COALESCE(OLD.raw_app_meta_data->'dashboard_account'->>'revision','') THEN
    RAISE EXCEPTION 'A conta foi alterada por outro executivo. Atualize antes de salvar';
  END IF;
  IF length(btrim(COALESCE(v_patch->>'reason',''))) < 5 THEN RAISE EXCEPTION 'Motivo obrigatório (mínimo 5 caracteres)'; END IF;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_patch->'roles')) INTO v_roles;
  v_suspended := (v_patch->>'suspended')::boolean;
  v_rate := (v_patch->>'commission_rate')::numeric;
  IF cardinality(v_roles)=0 OR v_roles IS NULL OR v_suspended IS NULL OR v_rate IS NULL OR v_rate<0 OR v_rate>100
    OR length(btrim(COALESCE(v_patch->>'display_name','')))=0 THEN RAISE EXCEPTION 'Dados da conta inválidos'; END IF;
  IF (public.is_super_admin(NEW.id) OR 'super_admin'=ANY(v_roles)) AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Somente super admin pode alterar contas ou conceder papel super admin' USING ERRCODE='42501';
  END IF;
  IF NEW.id=v_actor AND (v_suspended OR NOT v_roles && ARRAY['executive','super_admin']) THEN
    RAISE EXCEPTION 'Você não pode suspender ou remover seu próprio acesso administrativo';
  END IF;
  PERFORM pg_advisory_xact_lock(927463002);
  IF public.is_executive(NEW.id) AND (v_suspended OR NOT v_roles && ARRAY['executive','super_admin']) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.user_id=r.user_id
    WHERE r.user_id<>NEW.id AND r.role::text IN ('executive','super_admin') AND NOT p.suspended
  ) THEN RAISE EXCEPTION 'É necessário manter ao menos um administrador ativo'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE user_id=NEW.id FOR UPDATE;
  IF (v_patch->>'expected_updated_at')::timestamptz IS DISTINCT FROM v_profile.updated_at THEN
    RAISE EXCEPTION 'O perfil foi atualizado enquanto você editava. Reabra a conta';
  END IF;
  v_old := jsonb_build_object('display_name',v_profile.display_name,'avatar_url',v_profile.avatar_url,'suspended',v_profile.suspended,
    'email',OLD.email,'phone',OLD.phone,'roles',(SELECT jsonb_agg(r) FROM public.user_roles r WHERE user_id=NEW.id));
  INSERT INTO public.profiles(user_id,display_name,avatar_url,suspended)
    VALUES(NEW.id,btrim(v_patch->>'display_name'),NULLIF(v_patch->>'avatar_url',''),v_suspended)
    ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,suspended=EXCLUDED.suspended;
  DELETE FROM public.user_roles WHERE user_id=NEW.id AND NOT role::text=ANY(v_roles);
  INSERT INTO public.user_roles(user_id,role,commission_rate,crm_access,can_view_sales,granted_by,granted_at)
    SELECT NEW.id,r::public.app_role,v_rate,(v_patch->>'crm_access')::boolean,(v_patch->>'can_view_sales')::boolean,v_actor,clock_timestamp()
    FROM unnest(v_roles) r ON CONFLICT(user_id,role) DO UPDATE SET commission_rate=EXCLUDED.commission_rate,
      crm_access=EXCLUDED.crm_access,can_view_sales=EXCLUDED.can_view_sales,granted_by=v_actor,granted_at=clock_timestamp();
  SELECT display_name INTO v_actor_name FROM public.profiles WHERE user_id=v_actor;
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
    VALUES(v_actor,COALESCE(v_actor_name,'Executivo'),'account.update',NEW.id,v_patch->>'display_name',btrim(v_patch->>'reason'),v_old,
      jsonb_build_object('display_name',v_patch->>'display_name','avatar_url',v_patch->>'avatar_url','suspended',v_suspended,
      'email',NEW.email,'phone',NEW.phone,'roles',to_jsonb(v_roles),'commission_rate',v_rate,
      'crm_access',(v_patch->>'crm_access')::boolean,'can_view_sales',(v_patch->>'can_view_sales')::boolean,
      'password_changed',NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password));
  RETURN NEW;
END;
$$;
CREATE TRIGGER apply_executive_account_patch AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_executive_account_patch();

-- Keep protected fields out of self-service profile/role updates.
CREATE OR REPLACE FUNCTION public.dashboard_guard_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'Identificadores e datas históricas não podem ser alterados' USING ERRCODE='42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.suspended IS DISTINCT FROM OLD.suspended THEN
    RAISE EXCEPTION 'Use Editar conta para alterar o acesso com registro de auditoria' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dashboard_guard_profile BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.dashboard_guard_profile();

-- Existing CRM permission controls retain their behavior, with protection and audit.
CREATE OR REPLACE FUNCTION public.dashboard_guard_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  PERFORM public.dashboard_require_access(true);
  v_uid := CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  IF NOT public.is_super_admin(auth.uid()) AND (public.is_super_admin(v_uid)
    OR (TG_OP<>'DELETE' AND NEW.role::text='super_admin')) THEN
    RAISE EXCEPTION 'Papel super admin protegido' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' AND (TG_OP='DELETE' OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'Use Editar conta para alterar papéis com proteção de acesso' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.user_id<>OLD.user_id OR NEW.id<>OLD.id) THEN RAISE EXCEPTION 'Identificador imutável'; END IF;
  IF TG_OP<>'DELETE' AND (NEW.commission_rate<0 OR NEW.commission_rate>100) THEN RAISE EXCEPTION 'Comissão inválida'; END IF;
  UPDATE public.profiles SET updated_at=clock_timestamp() WHERE user_id=v_uid;
  SELECT display_name INTO v_actor FROM public.profiles WHERE user_id=auth.uid();
  INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
    VALUES(auth.uid(),COALESCE(v_actor,'Executivo'),'permissions.update',v_uid,
      COALESCE((SELECT display_name FROM public.profiles WHERE user_id=v_uid),'Usuário'),
      'Permissões atualizadas pelo controle administrativo',CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW,OLD);
END; $$;
CREATE TRIGGER dashboard_guard_role BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.dashboard_guard_role();

-- Prevent legacy callable balance helpers from replacing the authoritative ledger.
CREATE OR REPLACE FUNCTION public.recalculate_all_balances()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.dashboard_require_access(true); END IF;
  FOR r IN SELECT user_id FROM public.vendas UNION SELECT user_id FROM public.saldos_disponiveis LOOP
    PERFORM public.dashboard_refresh_balance(r.user_id);
  END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION public.calculate_and_update_commissions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.dashboard_require_access(true); PERFORM public.recalculate_all_balances(); END;
$$;
REVOKE ALL ON FUNCTION public.process_withdrawal(uuid,numeric) FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.saldos_disponiveis FROM authenticated,anon;
REVOKE ALL ON FUNCTION public.get_company_goal_totals(),public.dashboard_guard_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_company_goal_totals() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.dashboard_signal(),public.dashboard_guard_sale(),public.dashboard_guard_profile(),
  public.apply_executive_account_patch(),public.dashboard_guard_withdrawal(),public.dashboard_withdrawal_balance() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dashboard_require_access(boolean),public.executive_review_sale(uuid,text,text,text),
  public.get_sales_board(text,text,integer,integer),public.get_team_ranking(),public.executive_list_users(),
  public.recalculate_all_balances(),public.calculate_and_update_commissions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dashboard_require_access(boolean),public.executive_review_sale(uuid,text,text,text),
  public.get_sales_board(text,text,integer,integer),public.get_team_ranking(),public.executive_list_users(),
  public.recalculate_all_balances(),public.calculate_and_update_commissions() TO authenticated,service_role;
SELECT public.recalculate_all_balances();

INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  VALUES('20260907180000','executive_sales_control',ARRAY['Applied executive controls transaction']) ON CONFLICT(version) DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
