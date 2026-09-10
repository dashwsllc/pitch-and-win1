import { useRoles } from "@/hooks/useRoles";
import { ExecutiveUserManagement } from "@/components/executive/ExecutiveUserManagement";

export function CRMUserManagement() {
  const { isExecutive, loading } = useRoles();
  if (loading) return <p role="status">Verificando acesso...</p>;
  if (!isExecutive)
    return <p role="alert">Acesso restrito a executive e super_admin.</p>;
  return <ExecutiveUserManagement />;
}
