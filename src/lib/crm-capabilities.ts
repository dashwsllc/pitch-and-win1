// Mirrors crm_user_can in the latest CRM permissions migration.
export function crmCapabilities(
  roles: readonly string[],
  crmAccess = false,
  active = true,
) {
  const admin = active && roles.includes("super_admin");
  const executive =
    active && (admin || roles.includes("executive"));
  return {
    admin,
    executive,
    leads:
      active &&
      (executive ||
        crmAccess ||
        roles.some((role) => ["seller", "sdr", "closer"].includes(role))),
    sdr: active && (executive || roles.includes("sdr") || roles.includes("closer")),
    closer:
      active &&
      (executive || roles.includes("closer")),
    sales:
      active &&
      (executive || roles.some((role) => ["seller", "closer"].includes(role))),
  };
}
