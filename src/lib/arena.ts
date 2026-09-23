import type { UserRole } from "@/hooks/useRoles";

export const canAccessArena = (roles: readonly UserRole[]) =>
  roles.some((role) =>
    ["sdr", "closer", "executive", "super_admin"].includes(role),
  );
export const canAccessTraffic = (roles: readonly UserRole[]) =>
  roles.some((role) =>
    ["traffic_manager", "executive", "super_admin"].includes(role),
  );
export const ARENA_REVISION_INTERVAL = 5_000;
export const eventLabels: Record<string, string> = {
  "q.scheduled": "Call Q agendada",
  "q.performed": "Call Q realizada",
  "q.handoff": "Qualificação encaminhada",
  "q.no_handoff": "Call Q sem avanço",
  "closing.scheduled": "Call enviada ao Closer",
  "closing.performed": "Call de fechamento realizada",
  "closing.no_sale": "Venda não concluída",
  "call.cancelled": "Agendamento cancelado",
  "sale.approved": "Venda aprovada",
  "sale.reversed": "Venda cancelada / estornada",
  "score.adjusted": "Pontuação corrigida",
};
export const stateLabels: Record<string, string> = {
  exceeded: "Meta excedida",
  achieved: "Meta batida",
  on_track: "No ritmo",
  at_risk: "Em risco",
  below: "Abaixo do ritmo",
  failed: "Não atingida",
  unassigned: "Sem participantes",
};
export const operationalLabels: Record<string, string> = {
  scheduled: "Agendado",
  not_scheduled: "Não agendado",
  scheduling: "Em agendamento",
  reapproach: "Re-abordagem",
};
export function progressPercent(actual: number, target: number) {
  return target > 0 ? (actual / target) * 100 : 0;
}
export function cycleState(actual: number, target: number, start: string, end: string, now: number) {
  if (target <= 0) return "unassigned";
  if (actual > target) return "exceeded";
  if (actual >= target) return "achieved";
  if (now >= Date.parse(end)) return "failed";
  const elapsed = Math.max(0, Math.min(1, (now - Date.parse(start)) / (Date.parse(end) - Date.parse(start))));
  if (actual / target >= elapsed) return "on_track";
  return actual / target >= 0.8 * elapsed ? "at_risk" : "below";
}
export function metricDelta(current: number | null, previous: number | null) {
  return current == null || previous == null || previous === 0
    ? null
    : ((current - previous) / Math.abs(previous)) * 100;
}
export function milestone(percent: number) {
  return percent > 100
    ? 101
    : percent >= 100
      ? 100
      : percent >= 90
        ? 90
        : percent >= 50
          ? 50
          : percent >= 25
            ? 25
            : 0;
}
export function countdown(end: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(end) - now) / 1000));
  const days = Math.floor(seconds / 86400);
  return `${days ? `${days}d ` : ""}${String(Math.floor((seconds % 86400) / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface ArenaMetrics {
  revenue: number;
  sales: number;
  ticket: number | null;
  conversion: number | null;
  cpl: number | null;
  appointments: number;
  approaches: number;
  spend: number | null;
  leads: number | null;
}
export interface ArenaPerson {
  user_id: string;
  name: string;
  avatarUrl: string | null;
  suspended: boolean;
  score: number;
  totalVendas?: number;
  quantidadeVendas?: number;
  repasses?: number;
  scheduled?: number;
  performed?: number;
  cancelled?: number;
  no_handoff?: number;
}
export interface ArenaMember {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  suspended: boolean;
  actual: number;
  target: number;
  state: string;
}
export interface ArenaResult {
  actual: number;
  target: number;
  state: string;
  members: ArenaMember[];
  sdrs?: ArenaPerson[];
  closers?: ArenaPerson[];
}
export interface ArenaCycle {
  id: string;
  goal_id: string;
  title: string;
  period: "daily" | "weekly" | "monthly";
  scope: string;
  role: string | null;
  metric: string;
  starts_at: string;
  ends_at: string;
  show_countdown: boolean;
  result: ArenaResult;
}
export interface ArenaEvent {
  id: string;
  action_type: string;
  responsible_id: string;
  responsible_name: string;
  responsible_role: string;
  score_delta: number;
  revenue_delta: number;
  occurred_at: string;
  avatar_url?: string | null;
  provenance: string;
}
export interface ArenaDashboard {
  server_time: string;
  revision: number;
  metrics: ArenaMetrics;
  previous: ArenaMetrics;
  series: {
    at: string;
    revenue: number;
    sales: number;
    appointments: number;
  }[];
  cycles: ArenaCycle[];
  feed: ArenaEvent[];
  sdrs: ArenaPerson[];
  closers: ArenaPerson[];
  ticket_reference: number;
}
export interface ArenaGoal {
  id: string;
  family_id: string;
  version: number;
  title: string;
  description: string | null;
  period: string;
  scope: string;
  target_role: string | null;
  assignee_id: string | null;
  target: number;
  metric: string;
  effective_at: string;
  cycle_start: string | null;
  cycle_end: string | null;
  recurring: boolean;
  show_countdown: boolean;
  ticket_reference: number;
  enabled: boolean;
}
export interface ArenaAssignee {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  suspended: boolean;
  arena_hidden: boolean;
  roles: string[];
}
export interface ArenaNotification {
  id: string;
  recipient_id: string;
  event_key: string;
  kind: string;
  title: string;
  created_at: string;
  read_at: string | null;
}
