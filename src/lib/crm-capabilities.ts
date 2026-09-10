// Mirrors crm_user_can in 20260910010000_crm_shared_workflow.sql.
// Closer includes sale registration to complete the explicit CRM → Vendas flow.
export function crmCapabilities(
  roles: readonly string[],
  crmAccess = false,
  active = true,
) {
  const admin =
    active && roles.some((role) => ["executive", "super_admin"].includes(role));
  const generalSeller =
    roles.includes("seller") &&
    !roles.some((role) => ["sdr", "closer"].includes(role));
  return {
    admin,
    leads:
      active &&
      (admin ||
        crmAccess ||
        roles.some((role) => ["seller", "sdr", "closer"].includes(role))),
    sdr: active && (admin || generalSeller || roles.includes("sdr")),
    closer: active && (admin || generalSeller || roles.includes("closer")),
    sales: active && (admin || generalSeller || roles.includes("closer")),
  };
}
