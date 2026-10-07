import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "./useAuth";
import { useRoles } from "./useRoles";
import {
  paymentSummaryFromRow,
  type PaymentStatus,
  type PaymentSummary,
} from "@/lib/crm-payments";

export type CRMLeadPayment = Tables<"crm_lead_payments">;

const queryOptions = {
  staleTime: 5_000,
  refetchOnWindowFocus: false,
  retry: 1,
};

// Todas as consultas ficam sob ["crm"]: o canal em tempo real do CRM (useCRMRealtime) já as atualiza.
export function useCRMPaymentSummaries() {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  return useQuery({
    queryKey: ["crm", "payments", "summary", user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const byLead = new Map<string, PaymentSummary>();
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .rpc("crm_lead_payment_summaries")
          .order("lead_id")
          .range(from, from + 499);
        if (error) throw error;
        data.forEach((row) => byLead.set(row.lead_id, paymentSummaryFromRow(row)));
        if (data.length < 500) return byLead;
      }
    },
  });
}

export function useLeadPayments(leadId: string) {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  return useQuery({
    queryKey: ["crm", "payments", "lead", user?.id, leadId],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_payments")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true })
        .order("id");
      if (error) throw error;
      return data;
    },
  });
}

export interface PaymentSaveData {
  description: string;
  amount: number;
  method: string;
  dueDate: string | null;
  notes: string | null;
  proofUrl: string | null;
}

export function useCRMPaymentActions() {
  const client = useQueryClient();
  // Mesmo quando a operação falha (ex.: lançamento alterado por outra pessoa), a tela relê o estado real.
  const refresh = () => client.invalidateQueries({ queryKey: ["crm"] });
  const save = async (
    leadId: string,
    payment: CRMLeadPayment | null,
    data: PaymentSaveData,
  ) => {
    try {
      const { data: saved, error } = await supabase.rpc("crm_payment_save", {
        p_lead_id: leadId,
        p_payment_id: payment?.id ?? null,
        p_description: data.description,
        p_amount: data.amount,
        p_method: data.method,
        p_due_date: data.dueDate,
        p_notes: data.notes,
        p_proof_url: data.proofUrl,
        p_expected_revision: payment?.updated_at ?? null,
      });
      if (error) throw error;
      return saved;
    } finally {
      await refresh();
    }
  };
  const setStatus = async (
    payment: CRMLeadPayment,
    status: PaymentStatus,
    extra: { paidAt: string | null; reason: string | null },
  ) => {
    try {
      const { data, error } = await supabase.rpc("crm_payment_set_status", {
        p_payment_id: payment.id,
        p_status: status,
        p_paid_at: extra.paidAt,
        p_reason: extra.reason,
        p_expected_revision: payment.updated_at,
      });
      if (error) throw error;
      return data;
    } finally {
      await refresh();
    }
  };
  const remove = async (payment: CRMLeadPayment, reason: string) => {
    try {
      const { data, error } = await supabase.rpc("crm_payment_delete", {
        p_payment_id: payment.id,
        p_reason: reason,
        p_expected_revision: payment.updated_at,
      });
      if (error) throw error;
      return data;
    } finally {
      await refresh();
    }
  };
  return { save, setStatus, remove };
}
