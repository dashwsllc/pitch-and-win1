-- Defense-in-depth for the browser-exposed Data API.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Every business table is private to authenticated users and protected by RLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dashboard_events','executive_audit_events','abordagens','announcements','assinaturas',
    'closing_forms','company_goals','crm_activities','crm_leads','custom_positions',
    'document_categories','documents','message_reactions','password_reset_requests','playbooks',
    'profiles','saldos_disponiveis','saques','security_audit_log','team_member_history',
    'team_members','team_messages','traffic_metrics','user_roles','vendas',
    'workboard_completions','workboard_tasks'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
  END LOOP;
END;
$$;

-- Remove all previous permissive policies from the actively used tables. Each
-- operation is rebuilt explicitly below so USING and WITH CHECK both apply.
DO $$
DECLARE policy record;
BEGIN
  FOR policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY (ARRAY[
      'profiles','abordagens','vendas','assinaturas','user_roles','password_reset_requests',
      'crm_leads','crm_activities','saques','saldos_disponiveis','company_goals',
      'dashboard_events','executive_audit_events'
    ])
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', policy.policyname, policy.schemaname, policy.tablename);
  END LOOP;
END;
$$;

REVOKE ALL ON public.profiles, public.abordagens, public.vendas, public.assinaturas,
  public.user_roles, public.password_reset_requests, public.crm_leads, public.crm_activities,
  public.saques, public.saldos_disponiveis, public.company_goals, public.dashboard_events,
  public.executive_audit_events FROM authenticated;

GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.abordagens, public.vendas, public.assinaturas TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.password_reset_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads, public.crm_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.saques TO authenticated;
GRANT SELECT ON public.saldos_disponiveis, public.dashboard_events, public.executive_audit_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_goals TO authenticated;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY abordagens_select ON public.abordagens FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY abordagens_insert ON public.abordagens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY abordagens_update ON public.abordagens FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY abordagens_delete ON public.abordagens FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY vendas_select ON public.vendas FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY vendas_insert ON public.vendas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid() AND approval_status = 'pendente'
    AND COALESCE(commission_amount, 0) = 0 AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND rejection_reason IS NULL AND NOT withdrawn AND withdrawal_id IS NULL AND withdrawn_at IS NULL);
CREATE POLICY vendas_update_seller ON public.vendas FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid() AND approval_status = 'pendente')
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid() AND approval_status = 'pendente');
CREATE POLICY vendas_update_executive ON public.vendas FOR UPDATE TO authenticated
  USING (public.is_executive(auth.uid())) WITH CHECK (public.is_executive(auth.uid()));
CREATE POLICY vendas_delete_seller ON public.vendas FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid() AND approval_status = 'pendente');
CREATE POLICY vendas_delete_executive ON public.vendas FOR DELETE TO authenticated
  USING (public.is_executive(auth.uid()));

CREATE POLICY assinaturas_select ON public.assinaturas FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY assinaturas_insert ON public.assinaturas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY assinaturas_update ON public.assinaturas FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY assinaturas_delete ON public.assinaturas FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));

CREATE POLICY reset_requests_select ON public.password_reset_requests FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY reset_requests_insert ON public.password_reset_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()
    AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')) AND status = 'pending'
    AND processed_at IS NULL AND processed_by IS NULL);
CREATE POLICY reset_requests_update ON public.password_reset_requests FOR UPDATE TO authenticated
  USING (public.is_executive(auth.uid())) WITH CHECK (public.is_executive(auth.uid()));

CREATE POLICY crm_leads_select ON public.crm_leads FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.crm_access)));
CREATE POLICY crm_leads_insert ON public.crm_leads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid() AND (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.crm_access)));
CREATE POLICY crm_leads_update ON public.crm_leads FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.crm_access)))
  WITH CHECK (auth.uid() IS NOT NULL AND (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.crm_access)));
CREATE POLICY crm_leads_delete ON public.crm_leads FOR DELETE TO authenticated
  USING (public.is_executive(auth.uid()));

CREATE POLICY crm_activities_select ON public.crm_activities FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.crm_access)));
CREATE POLICY crm_activities_insert ON public.crm_activities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid() AND (public.is_executive(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.crm_access)));
CREATE POLICY crm_activities_update ON public.crm_activities FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())))
  WITH CHECK (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY crm_activities_delete ON public.crm_activities FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));

CREATE POLICY saques_select ON public.saques FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));
CREATE POLICY saques_insert ON public.saques FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid() AND status = 'pendente'
    AND valor_aprovado IS NULL AND pago_em IS NULL AND revisado_por IS NULL AND revisado_em IS NULL);
CREATE POLICY saques_update_executive ON public.saques FOR UPDATE TO authenticated
  USING (public.is_executive(auth.uid())) WITH CHECK (public.is_executive(auth.uid()));

CREATE POLICY saldos_select ON public.saldos_disponiveis FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_executive(auth.uid())));

CREATE POLICY goals_select ON public.company_goals FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.suspended));
CREATE POLICY goals_insert ON public.company_goals FOR INSERT TO authenticated
  WITH CHECK (public.is_executive(auth.uid()) AND created_by = auth.uid());
CREATE POLICY goals_update ON public.company_goals FOR UPDATE TO authenticated
  USING (public.is_executive(auth.uid())) WITH CHECK (public.is_executive(auth.uid()));
CREATE POLICY goals_delete ON public.company_goals FOR DELETE TO authenticated
  USING (public.is_executive(auth.uid()));

CREATE POLICY dashboard_events_read ON public.dashboard_events FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.suspended)
    AND (topic IN ('sales','goals') OR public.is_executive(auth.uid())));
CREATE POLICY executive_audit_read ON public.executive_audit_events FOR SELECT TO authenticated
  USING (public.is_executive(auth.uid()));

-- Server-side validation. NOT VALID preserves legacy rows while enforcing all
-- new and changed rows immediately.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_secure;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_name_secure
  CHECK (display_name IS NULL OR (char_length(btrim(display_name)) BETWEEN 2 AND 120)) NOT VALID;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_secure;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_url_secure
  CHECK (avatar_url IS NULL OR (char_length(avatar_url) <= 2048 AND avatar_url ~ '^https://')) NOT VALID;

ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_input_secure;
ALTER TABLE public.vendas ADD CONSTRAINT vendas_input_secure CHECK (
  valor_venda > 0 AND valor_venda <= 100000000
  AND char_length(btrim(nome_produto)) BETWEEN 1 AND 160
  AND char_length(btrim(nome_comprador)) BETWEEN 2 AND 160
  AND char_length(btrim(whatsapp_comprador)) BETWEEN 8 AND 32
  AND char_length(email_comprador) <= 254
  AND email_comprador ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  AND (consideracoes_gerais IS NULL OR char_length(consideracoes_gerais) <= 5000)
) NOT VALID;

ALTER TABLE public.abordagens DROP CONSTRAINT IF EXISTS abordagens_input_secure;
ALTER TABLE public.abordagens ADD CONSTRAINT abordagens_input_secure CHECK (
  tempo_medio_abordagem BETWEEN 1 AND 1440
  AND char_length(btrim(nomes_abordados)) BETWEEN 1 AND 2000
  AND char_length(dados_abordados) BETWEEN 1 AND 5000
  AND char_length(visao_geral) BETWEEN 1 AND 10000
) NOT VALID;

ALTER TABLE public.assinaturas DROP CONSTRAINT IF EXISTS assinaturas_input_secure;
ALTER TABLE public.assinaturas ADD CONSTRAINT assinaturas_input_secure CHECK (
  char_length(btrim(nome_produto)) BETWEEN 1 AND 160
  AND char_length(btrim(nome_cliente)) BETWEEN 2 AND 160
  AND char_length(btrim(whatsapp_cliente)) BETWEEN 8 AND 32
  AND char_length(email_cliente) <= 254
  AND email_cliente ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
) NOT VALID;

ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_input_secure;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_input_secure CHECK (
  char_length(btrim(name)) BETWEEN 2 AND 160
  AND (age IS NULL OR age BETWEEN 13 AND 120)
  AND (email IS NULL OR (char_length(email) <= 254 AND email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'))
  AND (phone IS NULL OR char_length(phone) BETWEEN 8 AND 32)
  AND conversion_probability BETWEEN 0 AND 100
  AND (estimated_deal_value IS NULL OR estimated_deal_value >= 0)
  AND temperature IN ('frio','morno','quente')
  AND priority IN ('baixa','normal','alta','urgente')
  AND char_length(COALESCE(observations, '')) <= 10000
) NOT VALID;

ALTER TABLE public.crm_activities DROP CONSTRAINT IF EXISTS crm_activities_input_secure;
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_activities_input_secure CHECK (
  char_length(btrim(title)) BETWEEN 1 AND 200
  AND char_length(COALESCE(description, '')) <= 10000
  AND char_length(COALESCE(outcome, '')) <= 5000
) NOT VALID;

ALTER TABLE public.saques DROP CONSTRAINT IF EXISTS saques_input_secure;
ALTER TABLE public.saques ADD CONSTRAINT saques_input_secure CHECK (
  valor_solicitado > 0 AND valor_solicitado <= 100000000
  AND (valor_aprovado IS NULL OR (valor_aprovado > 0 AND valor_aprovado <= valor_solicitado))
  AND (chave_pix IS NULL OR char_length(chave_pix) BETWEEN 3 AND 254)
  AND (nome_titular IS NULL OR char_length(btrim(nome_titular)) BETWEEN 2 AND 160)
  AND (cpf_titular IS NULL OR cpf_titular ~ '^[0-9]{11}$')
  AND char_length(COALESCE(observacoes, '')) <= 5000
  AND char_length(COALESCE(motivo_rejeicao, '')) <= 2000
) NOT VALID;

ALTER TABLE public.company_goals DROP CONSTRAINT IF EXISTS company_goals_input_secure;
ALTER TABLE public.company_goals ADD CONSTRAINT company_goals_input_secure CHECK (
  char_length(btrim(title)) BETWEEN 2 AND 160
  AND char_length(COALESCE(description, '')) <= 2000
  AND target > 0 AND period IN ('daily','weekly','monthly')
  AND COALESCE(status, 'active') IN ('active','inactive','completed')
) NOT VALID;

-- Prevent ownership/audit-column tampering even if a future grant is widened.
CREATE OR REPLACE FUNCTION public.security_guard_crm_lead()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := clock_timestamp();
  ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Identificadores e autoria são imutáveis' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS security_guard_crm_lead ON public.crm_leads;
CREATE TRIGGER security_guard_crm_lead BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.security_guard_crm_lead();

CREATE OR REPLACE FUNCTION public.security_guard_crm_activity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    NEW.created_at := clock_timestamp();
  ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Identificadores e autoria são imutáveis' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS security_guard_crm_activity ON public.crm_activities;
CREATE TRIGGER security_guard_crm_activity BEFORE INSERT OR UPDATE ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.security_guard_crm_activity();

CREATE OR REPLACE FUNCTION public.dashboard_guard_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id
    OR NEW.created_at <> OLD.created_at OR NEW.suspended IS DISTINCT FROM OLD.suspended
    OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Campos protegidos da conta não podem ser alterados diretamente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Audit logs keep evidence of the action without duplicating buyer, bank or
-- authentication PII. Supabase provides encryption at rest for the source rows.
CREATE OR REPLACE FUNCTION public.security_redact_audit_payload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE sensitive_keys text[] := ARRAY[
  'email','phone','email_comprador','whatsapp_comprador','nome_comprador',
  'email_cliente','whatsapp_cliente','nome_cliente','chave_pix','cpf_titular','nome_titular'
];
BEGIN
  NEW.before_data := NEW.before_data - sensitive_keys;
  NEW.after_data := NEW.after_data - sensitive_keys;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS security_redact_audit_payload ON public.executive_audit_events;
CREATE TRIGGER security_redact_audit_payload BEFORE INSERT OR UPDATE ON public.executive_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.security_redact_audit_payload();
UPDATE public.executive_audit_events SET
  before_data = before_data - ARRAY['email','phone','email_comprador','whatsapp_comprador','nome_comprador','email_cliente','whatsapp_cliente','nome_cliente','chave_pix','cpf_titular','nome_titular'],
  after_data = after_data - ARRAY['email','phone','email_comprador','whatsapp_comprador','nome_comprador','email_cliente','whatsapp_cliente','nome_cliente','chave_pix','cpf_titular','nome_titular'];

-- Replace the legacy unauthenticated balance helper.
CREATE OR REPLACE FUNCTION public.get_pending_commission(p_seller_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result numeric;
BEGIN
  PERFORM public.dashboard_require_access();
  IF p_seller_id <> auth.uid() AND NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(sum(CASE WHEN commission_amount > 0 THEN commission_amount ELSE 0 END), 0)
    INTO result FROM public.vendas WHERE user_id = p_seller_id AND approval_status = 'pendente';
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result text;
BEGIN
  PERFORM public.dashboard_require_access();
  IF uid <> auth.uid() AND NOT public.is_executive(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT role::text INTO result FROM public.user_roles WHERE user_id = uid ORDER BY created_at LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.executive_set_crm_access(p_user_id uuid, p_enabled boolean, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE before_roles jsonb; after_roles jsonb; actor_name text; target_name text;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF p_user_id IS NULL OR p_enabled IS NULL OR char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Usuário, decisão e motivo são obrigatórios';
  END IF;
  SELECT jsonb_agg(r ORDER BY r.created_at, r.id) INTO before_roles
    FROM public.user_roles r WHERE r.user_id = p_user_id;
  IF before_roles IS NULL THEN RAISE EXCEPTION 'Usuário sem papel cadastrado'; END IF;
  UPDATE public.user_roles SET crm_access = p_enabled,
    granted_by = CASE WHEN p_enabled THEN auth.uid() ELSE granted_by END,
    granted_at = CASE WHEN p_enabled THEN clock_timestamp() ELSE granted_at END,
    updated_at = clock_timestamp()
    WHERE user_id = p_user_id;
  SELECT jsonb_agg(r ORDER BY r.created_at, r.id) INTO after_roles
    FROM public.user_roles r WHERE r.user_id = p_user_id;
  SELECT display_name INTO actor_name FROM public.profiles WHERE user_id = auth.uid();
  SELECT display_name INTO target_name FROM public.profiles WHERE user_id = p_user_id;
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
    VALUES (auth.uid(), COALESCE(actor_name, 'Executivo'),
      CASE WHEN p_enabled THEN 'crm.grant' ELSE 'crm.revoke' END,
      p_user_id, COALESCE(target_name, 'Usuário'), btrim(p_reason),
      jsonb_build_object('roles', before_roles), jsonb_build_object('roles', after_roles));
END;
$$;

-- Restrict the public RPC surface. Trigger functions remain executable by their
-- owner; browser roles receive only the reviewed endpoints used by the app.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
      'has_role','is_executive','is_super_admin','dashboard_require_access','executive_review_sale',
      'approve_sale','get_sales_board','get_team_ranking','executive_list_users','get_company_goal_totals',
      'executive_cancel_withdrawal','get_available_balance','get_pending_commission','get_user_role',
      'executive_set_crm_access','recalculate_all_balances','calculate_and_update_commissions','log_security_event'
    ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.signature);
  END LOOP;
END;
$$;

-- Pin every elevated function to schemas attackers cannot modify.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', fn.signature);
  END LOOP;
END;
$$;

-- Enforce avatar restrictions in Storage as well as in the browser.
UPDATE storage.buckets SET file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']
  WHERE id = 'avatars';
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY avatars_public_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'avatars');
CREATE POLICY avatars_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid() IS NOT NULL
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(storage.extension(name)) IN ('png','jpg','jpeg','webp'));
CREATE POLICY avatars_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
    AND lower(storage.extension(name)) IN ('png','jpg','jpeg','webp'));
CREATE POLICY avatars_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- A bootstrap administrator with a password committed to Git is compromised by
-- definition. Revoke its roles and ban it; provision a new admin through Auth.
WITH compromised AS (
  SELECT id FROM auth.users WHERE lower(email) = 'executive@wsltda.site'
)
DELETE FROM public.user_roles r USING compromised c WHERE r.user_id = c.id;
UPDATE public.profiles p SET suspended = true, updated_at = clock_timestamp()
  FROM auth.users u WHERE p.user_id = u.id AND lower(u.email) = 'executive@wsltda.site';
UPDATE auth.users SET banned_until = 'infinity'::timestamptz, updated_at = clock_timestamp()
  WHERE lower(email) = 'executive@wsltda.site';

NOTIFY pgrst, 'reload schema';
COMMIT;
