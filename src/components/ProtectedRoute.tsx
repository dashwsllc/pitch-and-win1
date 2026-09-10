import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useRoles } from "@/hooks/useRoles";

interface ProtectedRouteProps {
  children: React.ReactNode;
  executiveOnly?: boolean;
  salesOnly?: boolean;
}

export function ProtectedRoute({
  children,
  executiveOnly = false,
  salesOnly = false,
}: ProtectedRouteProps) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile, loading: profileLoading, error, refetch } = useProfile();
  const {
    isExecutive,
    capabilities,
    loading: rolesLoading,
    error: rolesError,
    refetch: retryRoles,
  } = useRoles();
  useEffect(() => {
    if (profile?.suspended) void signOut();
  }, [profile?.suspended, signOut]);

  if (
    authLoading ||
    (user && (profileLoading || ((executiveOnly || salesOnly) && rolesLoading)))
  ) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (profile?.suspended) {
    return <Navigate to="/auth?suspended=true" replace />;
  }

  if (error || ((executiveOnly || salesOnly) && rolesError)) {
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
  if (salesOnly && !capabilities.sales) return <Navigate to="/" replace />;

  return <>{children}</>;
}
