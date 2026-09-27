BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.crm_leads ADD COLUMN lead_generated_at timestamptz;

-- Backfill em massa sem ator: desliga guardas de auditoria/imutabilidade
-- só ao redor do UPDATE, como em 20260921160000_crm_results_and_returns.sql.
ALTER TABLE public.crm_leads DISABLE TRIGGER security_guard_crm_lead;
ALTER TABLE public.crm_leads DISABLE TRIGGER crm_audit_lead;
UPDATE public.crm_leads SET lead_generated_at = created_at WHERE lead_generated_at IS NULL;
ALTER TABLE public.crm_leads ENABLE TRIGGER crm_audit_lead;
ALTER TABLE public.crm_leads ENABLE TRIGGER security_guard_crm_lead;

ALTER TABLE public.crm_leads ALTER COLUMN lead_generated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_set_lead_generated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  NEW.lead_generated_at := COALESCE(NEW.lead_generated_at, NEW.created_at, clock_timestamp());
  RETURN NEW;
END; $$;
CREATE TRIGGER crm_leads_default_generated_at BEFORE INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_lead_generated_at();
REVOKE ALL ON FUNCTION public.crm_set_lead_generated_at() FROM PUBLIC,anon,authenticated;

COMMENT ON COLUMN public.crm_leads.lead_generated_at IS
  'Momento real de geracao do lead (ex.: preenchimento do formulario Meta). '
  'Distinto de created_at (momento de insercao no CRM, imutavel via '
  'security_guard_crm_lead). Nao usar em leadApproachReference (esteira, '
  'src/lib/crm-pipeline-period.ts) nem no ranking Arena '
  '(20260923180000_arena_sync_all_roles.sql) — ambos continuam em created_at. '
  'Uso: coorte de atribuicao Meta em meta_crm_attribution_daily e SLA futuro.';
NOTIFY pgrst,'reload schema';
COMMIT;
