import type { CRMLead } from "@/hooks/useCRM";
import { brasiliaDateKey, isValidDateKey } from "@/lib/brasilia-time";

export type CRMResultSale = {
  lead_id: string;
  sale_id: string | null;
  can_open: boolean;
  approval_status: string;
  seller_id: string;
  seller_name: string;
};

export function leadResult(lead: CRMLead) {
  return (
    lead.last_result_outcome ||
    (
      {
        fechado_ganho: "venda_concluida",
        fechado_perdido: "venda_perdida",
        lead_perdido: "lead_perdido",
      } as Record<string, string>
    )[lead.pipeline_stage] ||
    null
  );
}

export function resultDate(lead: CRMLead) {
  return lead.last_result_at || lead.closed_at;
}

export function inRemarketing(lead: CRMLead) {
  return (
    ["lead_perdido", "fechado_perdido"].includes(lead.pipeline_stage) &&
    !["reactivated", "do_not_contact"].includes(
      lead.remarketing_status || "pending",
    )
  );
}

export function resultMatches(
  lead: CRMLead,
  sale: CRMResultSale | undefined,
  filters: {
    search: string;
    outcome: string;
    approval: string;
    seller: string;
    from: string;
    to: string;
  },
) {
  const result = leadResult(lead);
  if (!result) return false;
  const date = resultDate(lead);
  const day = date ? brasiliaDateKey(date) : "";
  return (
    `${lead.name} ${lead.athlete_name || ""} ${lead.last_result_closer_name || ""} ${sale?.seller_name || ""}`
      .toLocaleLowerCase()
      .includes(filters.search.trim().toLocaleLowerCase()) &&
    (filters.outcome === "all" ||
      (filters.outcome === "won"
        ? result === "venda_concluida"
        : result !== "venda_concluida")) &&
    (filters.approval === "all" ||
      (sale?.approval_status || "unregistered") === filters.approval) &&
    (filters.seller === "all" ||
      (sale?.seller_id ||
        lead.last_result_closer_id ||
        lead.closer_id ||
        lead.sdr_id) === filters.seller) &&
    (!filters.from ||
      (isValidDateKey(filters.from) && !!day && day >= filters.from)) &&
    (!filters.to || (isValidDateKey(filters.to) && !!day && day <= filters.to))
  );
}

// Match every appointment, not just the earliest one: a return today must not
// hide a call tomorrow when tomorrow is the day selected in the conveyor.
export function leadScheduledOn(
  lead: Pick<CRMLead, "next_followup_at">,
  callDates: (string | null)[],
  day: string,
) {
  return (
    isValidDateKey(day) &&
    [lead.next_followup_at, ...callDates].some(
      (value) =>
        !!value &&
        Number.isFinite(Date.parse(value)) &&
        brasiliaDateKey(value) === day,
    )
  );
}

export function canReopenResult(
  lead: CRMLead,
  userId: string | undefined,
  capabilities: { executive: boolean; closer: boolean; sdr: boolean },
) {
  return (
    ["fechado_ganho", "fechado_perdido", "lead_perdido"].includes(
      lead.pipeline_stage,
    ) &&
    (capabilities.executive ||
      (capabilities.closer && !!userId && lead.closer_id === userId) ||
      (capabilities.sdr && !!userId && lead.sdr_id === userId))
  );
}
