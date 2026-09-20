import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, Json } from "@/integrations/supabase/types";
import { useAuth } from "./useAuth";
import { useRoles } from "./useRoles";
import { validatePlainText } from "@/lib/plain-text";
import { validateContextFileText, type CRMContextFile } from "@/lib/crm-context-file";
import { normalizeContextMediaUrl } from "@/lib/crm-context-media";
import { fetchAllPages } from "@/lib/supabase-pages";

export type CRMLead = Tables<"crm_leads">;
export type CRMActivity = Tables<"crm_activities">;
export type CRMLeadContext = Tables<"crm_lead_contexts">;
export const PIPELINE_STAGES = [
  { value: "novo", label: "Novo" },
  { value: "em_qualificacao", label: "Em qualificação" },
  { value: "pronto_closer", label: "Pronto para Closer" },
  { value: "repassado_closer", label: "Repassado para Closer" },
  { value: "fechado_ganho", label: "Venda concluída" },
  { value: "lead_perdido", label: "Lead perdido" },
  { value: "fechado_perdido", label: "Venda perdida" },
  { value: "contato_feito", label: "Contato feito (anterior)" },
  { value: "proposta_enviada", label: "Proposta enviada (anterior)" },
  { value: "negociacao", label: "Negociação (anterior)" },
  { value: "reativacao", label: "Reativação (anterior)" },
];
export const LEAD_SOURCES = [
  "instagram",
  "facebook",
  "linkedin",
  "indicacao",
  "cold_outreach",
  "evento",
  "site",
  "whatsapp",
  "google_ads",
  "email_marketing",
  "outro",
];
export const CALL_OUTCOMES: Record<string, string> = {
  avancou: "Avançou",
  lead_perdido: "Lead perdido",
  venda_concluida: "Venda concluída",
  venda_perdida: "Venda perdida",
  devolvido_sdr: "Devolvido ao SDR",
};
export const APPROACH_STAGES = [
  { value: "nao_abordado", label: "Não abordados" },
  { value: "em_abordagem", label: "Em abordagem" },
  { value: "abordado", label: "Abordados" },
  { value: "reabordado", label: "Re-abordados" },
];
export const APPROACH_LABELS: Record<string, string> = {
  nao_abordado: "Não abordado",
  em_abordagem: "Em abordagem",
  abordado: "Abordado",
  reabordado: "Re-abordado",
};
const queryOptions = {
  staleTime: 5_000,
  refetchOnWindowFocus: false,
  retry: 1,
};

export function useCRMRealtime() {
  const { user, session } = useAuth();
  const client = useQueryClient();
  const [realtimeUnavailable, setRealtimeUnavailable] = useState(false);

  useEffect(() => {
    if (!user || !session?.access_token) return;

    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void client.invalidateQueries({ queryKey: ["crm"] });
      }, 120);
    };
    const channel = supabase
      .channel(`crm-live-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_activities" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_lead_contexts" }, refresh);

    void supabase.realtime.setAuth(session.access_token)
      .then(() => {
        if (disposed) return;
        channel.subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") setRealtimeUnavailable(false);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setRealtimeUnavailable(true);
          }
        });
      })
      .catch(() => {
        if (!disposed) setRealtimeUnavailable(true);
      });

    return () => {
      disposed = true;
      window.clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [user, session?.access_token, client]);

  return { realtimeUnavailable };
}

export function useCRMLeads() {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["crm", "leads", user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const rows: CRMLead[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("crm_leads")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    },
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["crm"] });
  const createLead = async (lead: TablesInsert<"crm_leads">) => {
    const { data, error } = await supabase
      .from("crm_leads")
      .insert(lead)
      .select()
      .single();
    if (error) throw error;
    await refresh();
    return data;
  };
  const transition = async (lead: CRMLead, action: string, data: Json = {}) => {
    try {
      const { data: updated, error } = await supabase.rpc("crm_transition", {
        p_lead_id: lead.id,
        p_action: action,
        p_expected_version: lead.version,
        p_data: data,
      });
      if (error) throw error;
      client.setQueryData<CRMLead[]>(["crm", "leads", user?.id], (rows) =>
        rows?.map((row) => (row.id === updated.id ? updated : row)),
      );
      return updated;
    } finally {
      await refresh();
    }
  };
  const deleteLead = async (lead: CRMLead) => {
    try {
      const { data, error } = await supabase.rpc("crm_delete_lead", {
        p_lead_id: lead.id,
        p_expected_version: lead.version,
      });
      if (error) throw error;
      client.setQueryData<CRMLead[]>(["crm", "leads", user?.id], (rows) =>
        rows?.filter((row) => row.id !== lead.id),
      );
      return data;
    } finally {
      await Promise.all([
        refresh(),
        client.invalidateQueries({ queryKey: ["sales-board"] }),
        client.invalidateQueries({ queryKey: ["managed-sales"] }),
      ]);
    }
  };
  return {
    leads: hasCRMAccess ? (query.data ?? []) : [],
    // isPending fica sempre verdadeiro numa consulta desabilitada; isLoading
    // significa "primeira carga em andamento", que e o que a tela quer saber.
    loading: query.isLoading,
    error: query.error,
    fetchLeads: refresh,
    createLead,
    transition,
    deleteLead,
  };
}

export function useCRMActivities(leadId: string | null, callsOnly = false) {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["crm", "activities", user?.id, leadId, callsOnly],
    enabled: !!user && hasCRMAccess && (!!leadId || callsOnly),
    ...queryOptions,
    queryFn: async () => {
      const rows: CRMActivity[] = [];
      for (let from = 0; ; from += 500) {
        let request = supabase
          .from("crm_activities")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, from + 499);
        if (leadId) request = request.eq("lead_id", leadId);
        if (callsOnly) request = request.not("call_type", "is", null);
        const { data, error } = await request;
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    },
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["crm"] });
  const createActivity = async (activity: TablesInsert<"crm_activities">) => {
    const { error } = await supabase.from("crm_activities").insert(activity);
    if (error) throw error;
    await refresh();
  };
  return {
    activities: hasCRMAccess ? (query.data ?? []) : [],
    loading: query.isLoading,
    error: query.error,
    fetchActivities: refresh,
    createActivity,
  };
}

export function useCRMContextSummary() {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  const query = useQuery({
    queryKey: ["crm", "context-summary", user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const leadIds = new Set<string>();
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("crm_lead_contexts")
          .select("lead_id")
          .order("lead_id")
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        data.forEach((row) => leadIds.add(row.lead_id));
        if (data.length < 500) return leadIds;
      }
    },
  });
  return {
    leadIds: query.data ?? new Set<string>(),
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCRMContexts(leadId: string | null) {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  const client = useQueryClient();
  const key = ["crm", "contexts", user?.id, leadId];
  const query = useQuery({
    queryKey: key,
    enabled: !!user && hasCRMAccess && !!leadId,
    ...queryOptions,
    queryFn: async () => {
      return fetchAllPages((from, to) => supabase
        .from("crm_lead_contexts")
        .select("*")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to));
    },
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["crm"] });
  };
  const importContext = async (
    contextType: "whatsapp_summary" | "call_transcript" | "manual_note",
    content: string,
    attachment?: CRMContextFile,
    mediaUrl?: string | null,
  ) => {
    if (!leadId) throw new Error("Lead não selecionado.");
    const sanitized = attachment ? validateContextFileText(content) : validatePlainText(content, 50_000);
    const normalizedMediaUrl = normalizeContextMediaUrl(mediaUrl ?? "");
    if (!sanitized) throw new Error("Cole ou anexe um conteúdo antes de salvar.");
    const { data, error } = attachment ? await supabase.rpc("crm_import_txt_context_with_media", {
      p_lead_id: leadId,
      p_context_type: contextType,
      p_content: sanitized,
      p_source_name: attachment.sourceName,
      p_source_content: attachment.content,
      p_media_url: normalizedMediaUrl,
    }) : await supabase.rpc("crm_add_lead_context_with_media", {
      p_lead_id: leadId,
      p_context_type: contextType,
      p_content: sanitized,
      p_media_url: normalizedMediaUrl,
    });
    if (error) throw error;
    await refresh();
    return data;
  };
  const updateContext = async (
    context: CRMLeadContext,
    contextType: "whatsapp_summary" | "call_transcript" | "manual_note",
    content: string,
    mediaUrl?: string | null,
  ) => {
    const sanitized = validatePlainText(content, 50_000);
    const normalizedMediaUrl = normalizeContextMediaUrl(mediaUrl ?? "");
    if (!sanitized) throw new Error("O contexto não pode ficar vazio.");
    const { data, error } = await supabase.rpc("crm_update_lead_context_with_media", {
      p_context_id: context.id,
      p_context_type: contextType,
      p_content: sanitized,
      p_media_url: normalizedMediaUrl,
      p_expected_version: context.version,
    });
    if (error) throw error;
    await refresh();
    return data;
  };
  return {
    contexts: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    importContext,
    updateContext,
  };
}

export function useCRMAssignees() {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  return useQuery({
    queryKey: ["crm", "assignees", user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const rows: { user_id: string; display_name: string; role: string }[] =
        [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .rpc("crm_call_assignees")
          .order("user_id")
          .order("role")
          .range(from, from + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    },
  });
}

export function useCRMSaleLinks() {
  const { user } = useAuth();
  const { hasCRMAccess } = useRoles();
  return useQuery({
    queryKey: ["crm", "sales", user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const rows: {
        lead_id: string;
        sale_id: string | null;
        can_open: boolean;
      }[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .rpc("crm_sale_links")
          .order("lead_id")
          .order("sale_id")
          .range(from, from + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    },
  });
}
