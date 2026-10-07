import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useRoles } from "./useRoles";
import { isPaymentStatus, type PaymentStatus } from "@/lib/crm-payments";

const statusKey = (userId?: string) => ["crm", "payment-status", userId];

export function useCRMPaymentStatuses() {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  return useQuery({
    queryKey: statusKey(user?.id),
    enabled: !!user && hasCRMAccess,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      const byLead = new Map<string, PaymentStatus>();
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("crm_lead_payment_status")
          .select("lead_id,status")
          .order("lead_id")
          .range(from, from + 499);
        if (error) throw error;
        for (const row of data) {
          if (!isPaymentStatus(row.status)) throw new Error("Status de pagamento inválido.");
          byLead.set(row.lead_id, row.status);
        }
        if (data.length < 500) return byLead;
      }
    },
  });
}

export function useSetCRMPaymentStatus() {
  const client = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: PaymentStatus }) => {
      const { data, error } = await supabase.rpc("crm_set_payment_status", {
        p_lead_id: leadId,
        p_status: status,
      });
      if (error) throw error;
      if (!isPaymentStatus(data.status)) throw new Error("Status de pagamento inválido.");
      return { leadId: data.lead_id, status: data.status };
    },
    onSuccess: async ({ leadId, status }) => {
      // Paint only the server-confirmed value, without an older in-flight read undoing it.
      await client.cancelQueries({ queryKey: statusKey(user?.id) });
      client.setQueryData<Map<string, PaymentStatus>>(statusKey(user?.id), old =>
        new Map(old).set(leadId, status),
      );
    },
    // History, duplicate cards and realtime consumers reread the persisted value, also on failure.
    onSettled: () => client.invalidateQueries({ queryKey: ["crm"] }),
  });
}
