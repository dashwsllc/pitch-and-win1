import { useRoles } from "@/hooks/useRoles";
import { ExecutiveUserManagement } from "@/components/executive/ExecutiveUserManagement";

export function CRMUserManagement() {
  const { isSuperAdmin, loading } = useRoles();
  if (loading) return <p role="status">Verificando acesso...</p>;
  if (!isSuperAdmin)
    return <p role="alert">Acesso restrito ao Super Admin.</p>;
  return <ExecutiveUserManagement compact />;
}
