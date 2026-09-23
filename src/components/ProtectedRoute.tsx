import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useRoles } from "@/hooks/useRoles";
import { canAccessArena, canAccessTraffic } from '@/lib/arena';

interface ProtectedRouteProps {
  children: React.ReactNode;
  executiveOnly?: boolean;
  superAdminOnly?: boolean;
  salesOnly?: boolean;
  arenaOnly?: boolean;
  trafficOnly?: boolean;
}

export function ProtectedRoute({
  children,
  executiveOnly = false,
  superAdminOnly = false,
  salesOnly = false,
  arenaOnly = false,
  trafficOnly = false,
}: ProtectedRouteProps) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile, loading: profileLoading, error, refetch } = useProfile();
  const {
    isExecutive,
    isSuperAdmin,
    capabilities,
    roles,
    loading: rolesLoading,
    error: rolesError,
    refetch: retryRoles,
  } = useRoles();
  const [suspensionDetected, setSuspensionDetected] = useState(false);
  useEffect(() => {
    if (profile?.suspended) {
      setSuspensionDetected(true);
      void signOut();
    }
  }, [profile?.suspended, signOut]);

  if (
    authLoading ||
    (user && (profileLoading || ((executiveOnly || superAdminOnly || salesOnly || arenaOnly || trafficOnly) && rolesLoading)))
  ) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (profile?.suspended || suspensionDetected) {
    return <Navigate to="/auth?suspended=true" replace />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (error || ((executiveOnly || superAdminOnly || salesOnly || arenaOnly || trafficOnly) && rolesError)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p>Não foi possível verificar seu acesso.</p>
        <button
          className="rounded-lg border px-4 py-2"
          onClick={() => {
            void refetch();
            void retryRoles();
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }
  if (executiveOnly && !isExecutive) return <Navigate to="/" replace />;
  if (superAdminOnly && !isSuperAdmin) return <Navigate to="/" replace />;
  if (salesOnly && !capabilities.sales) return <Navigate to="/" replace />;
  if (arenaOnly && !canAccessArena(roles)) return <Navigate to="/" replace />;
  if (trafficOnly && !canAccessTraffic(roles)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
