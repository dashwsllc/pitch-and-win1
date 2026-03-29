
-- =============================================
-- PART 1: Add approval_status to vendas table
-- =============================================
ALTER TABLE public.vendas 
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS commission_amount numeric(12,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_vendas_approval_status ON public.vendas(user_id, approval_status);

-- =============================================
-- PART 2: Add columns to user_roles
-- =============================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS crm_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS granted_by uuid,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) NOT NULL DEFAULT 10;

-- =============================================
-- PART 3: Create CRM tables
-- =============================================
CREATE TABLE IF NOT EXISTS public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  age integer,
  email text,
  phone text,
  company text,
  job_title text,
  linkedin_url text,
  profile_photo_url text,
  temperature text NOT NULL DEFAULT 'frio',
  priority text NOT NULL DEFAULT 'normal',
  conversion_probability integer DEFAULT 0,
  estimated_deal_value numeric(12,2),
  pipeline_stage text NOT NULL DEFAULT 'novo',
  lead_source text,
  approached boolean NOT NULL DEFAULT false,
  approached_at timestamptz,
  approach_count integer NOT NULL DEFAULT 0,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  expected_close_at date,
  assigned_to uuid,
  observations text,
  observations_updated_at timestamptz,
  observations_updated_by uuid,
  tags text[],
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_temperature ON public.crm_leads(temperature, priority, next_followup_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON public.crm_leads(assigned_to, next_followup_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_pipeline ON public.crm_leads(pipeline_stage);

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  activity_type text NOT NULL,
  title text NOT NULL,
  description text,
  outcome text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  is_completed boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON public.crm_activities(lead_id, created_at DESC);

-- =============================================
-- PART 4: RLS for CRM tables
-- =============================================
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

-- CRM Leads policies
CREATE POLICY "crm_leads_select" ON public.crm_leads FOR SELECT
  USING (
    is_executive(auth.uid()) OR 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND crm_access = true)
  );

CREATE POLICY "crm_leads_insert" ON public.crm_leads FOR INSERT
  WITH CHECK (
    is_executive(auth.uid()) OR 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND crm_access = true)
  );

CREATE POLICY "crm_leads_update" ON public.crm_leads FOR UPDATE
  USING (
    is_executive(auth.uid()) OR 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND crm_access = true)
  );

CREATE POLICY "crm_leads_delete" ON public.crm_leads FOR DELETE
  USING (is_executive(auth.uid()));

-- CRM Activities policies
CREATE POLICY "crm_activities_all" ON public.crm_activities FOR ALL
  USING (
    is_executive(auth.uid()) OR 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND crm_access = true)
  );

-- =============================================
-- PART 5: RPC function for available balance
-- =============================================
CREATE OR REPLACE FUNCTION public.get_available_balance(p_seller_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    SUM(v.commission_amount), 0
  )
  FROM public.vendas v
  WHERE v.user_id = p_seller_id
    AND v.approval_status = 'aprovada'
$$;

-- =============================================
-- PART 6: Update trigger for updated_at on crm_leads
-- =============================================
CREATE TRIGGER update_crm_leads_updated_at
  BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
