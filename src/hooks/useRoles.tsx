import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "./useAuth";
import { useProfile } from "./useProfile";
import { crmCapabilities } from "@/lib/crm-capabilities";

export type UserRole =
  | "seller"
  | "executive"
  | "super_admin"
  | "closer"
  | "sdr"
  | "bdr"
  | "traffic_manager";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  executive: "Executivo",
  closer: "Closer",
  sdr: "SDR",
  bdr: "BDR",
  traffic_manager: "Gestor de Tráfego",
  seller: "Vendedor",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: "bg-role-admin",
  executive: "bg-role-admin",
  closer: "bg-role-closer",
  sdr: "bg-role-sdr",
  bdr: "bg-role-bdr",
  traffic_manager: "bg-role-traffic",
  seller: "bg-role-seller",
};

export const ROLE_DEPARTMENTS: Record<string, UserRole[]> = {
  Administração: ["super_admin", "executive"],
  Comercial: ["closer", "sdr"],
  Prospecção: ["bdr"],
  Tráfego: ["traffic_manager"],
  Vendas: ["seller"],
};

export function useRoles() {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const query = useQuery({
    queryKey: ["executive-users", "my-roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, crm_access, commission_rate, can_view_sales")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const roles: UserRole[] = query.data?.map((row) => row.role) ?? [];
  const capabilities = crmCapabilities(
    roles,
    !!query.data?.some((r) => r.crm_access),
    !!profile && !profile.suspended,
  );
  const isExecutive = capabilities.admin;
  return {
    roles,
    primaryRole: roles[0] || "seller",
    isExecutive,
    capabilities,
    hasCRMAccess: capabilities.leads,
    canViewSales: isExecutive || !!query.data?.some((r) => r.can_view_sales),
    commissionRate: Number(
      query.data?.find((r) => r.commission_rate != null)?.commission_rate ?? 10,
    ),
    hasRole: (role: UserRole) => roles.includes(role),
    loading: !!user && (query.isPending || profileLoading),
    error: query.error,
    refetch: query.refetch,
  };
}

export interface ExecutiveUser {
  id: string | null;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  suspended: boolean;
  email: string | null;
  phone: string | null;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  created_at: string;
  updated_at: string | null;
  last_sign_in_at: string | null;
  account_revision: string;
  user_roles: Tables<"user_roles">[];
}

export function useAllUsers() {
  const { user } = useAuth();
  const { isExecutive, loading: rolesLoading } = useRoles();
  const query = useQuery({
    queryKey: ["executive-users", "directory", user?.id],
    enabled: !!user && isExecutive,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("executive_list_users");
      if (error) throw error;
      return data as unknown as { users: ExecutiveUser[]; fetched_at: string };
    },
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  return {
    users: query.data?.users ?? [],
    fetchedAt: query.data?.fetched_at ?? null,
    loading: rolesLoading || (isExecutive && query.isPending),
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
