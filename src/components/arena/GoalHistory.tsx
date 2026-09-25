import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useArenaAssignees } from "@/hooks/useArena";
import { arenaRpc } from "@/lib/arena-api";
import { progressPercent } from "@/lib/arena";
import { exactDate, errorMessage, money } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Outcome = "all" | "achieved" | "failed" | "unassigned";
type GoalHistoryRow = {
  cycle_id: string;
  goal_id: string;
  goal_version: number;
  title: string;
  scope: "global" | "role" | "user";
  period: "daily" | "weekly" | "monthly";
  target_role: string | null;
  metric: string;
  starts_at: string;
  ends_at: string;
  closed_at: string;
  user_id: string | null;
  display_name: string | null;
  actual: number;
  target: number;
  state: string;
  outcome: Exclude<Outcome, "all">;
};
type GoalHistoryResponse = {
  summary: { total: number; achieved: number; failed: number; unassigned: number };
  items: GoalHistoryRow[];
};

const scopeLabels = { global: "Coletiva", role: "Do cargo", user: "Individual" };
const periodLabels = { daily: "Diária", weekly: "Semanal", monthly: "Mensal" };
const outcomeLabels = { achieved: "Cumprida", failed: "Não cumprida", unassigned: "Sem apuração" };
const pageSize = 20;

export function GoalHistory({ management = false }: { management?: boolean }) {
  const { user } = useAuth();
  const assignees = useArenaAssignees();
  const [person, setPerson] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["goal-outcome-history", user?.id, management, person, outcome, page],
    enabled: !!user,
    queryFn: () => arenaRpc<GoalHistoryResponse>("arena_goal_history", {
      p_person: management ? person || null : null,
      p_outcome: outcome,
      p_offset: page * pageSize,
      p_limit: pageSize,
    }),
    refetchInterval: 30_000,
  });
  const summary = query.data?.summary;
  const items = query.data?.items ?? [];
  const options: { key: Outcome; label: string; count?: number }[] = [
    { key: "all", label: "Todas", count: summary?.total },
    { key: "achieved", label: "Cumpridas", count: summary?.achieved },
    { key: "failed", label: "Não cumpridas", count: summary?.failed },
    { key: "unassigned", label: "Sem apuração", count: summary?.unassigned },
  ];

  return <section className="space-y-5" aria-label="Histórico de metas encerradas">
    <div>
      <h2 className="text-lg">Histórico de metas</h2>
      <p className="text-sm text-muted-foreground">
        Resultados encerrados e preservados no servidor. Tarefas e checklists têm acompanhamento separado.
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {options.map(({ key, label, count }) => <Button key={key} type="button" size="sm"
        variant={outcome === key ? "default" : "outline"} aria-pressed={outcome === key}
        onClick={() => { setOutcome(key); setPage(0); }}>
        {label}{count !== undefined ? ` · ${count}` : ""}
      </Button>)}
      {management && <select aria-label="Filtrar histórico por colaborador"
        className="h-9 rounded-lg border bg-background px-3 text-sm" value={person}
        onChange={(event) => { setPerson(event.target.value); setPage(0); }}>
        <option value="">Todos os colaboradores e metas coletivas</option>
        {assignees.data?.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>
          {candidate.display_name}
        </option>)}
      </select>}
    </div>
    {query.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error)}</p>}
    <div className="space-y-3">
      {items.map((row) => {
        const percentage = progressPercent(row.actual, row.target);
        const measured = row.metric === "revenue"
          ? `${money(row.actual)} / ${money(row.target)}`
          : `${row.actual.toLocaleString("pt-BR")} / ${row.target.toLocaleString("pt-BR")} pontos`;
        return <article key={`${row.cycle_id}:${row.user_id ?? "collective"}`}
          className="surface-panel space-y-3 rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">{row.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {scopeLabels[row.scope] ?? row.scope} · {periodLabels[row.period] ?? row.period}
                {row.target_role ? ` · ${row.target_role.toUpperCase()}` : ""}
                {management && row.display_name ? ` · ${row.display_name}` : ""}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.outcome === "achieved"
              ? "bg-emerald-400/10 text-emerald-300"
              : row.outcome === "failed" ? "bg-rose-400/10 text-rose-300"
                : "bg-white/5 text-muted-foreground"}`}>
              {outcomeLabels[row.outcome]}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm tabular-nums">{measured}</p>
            <span className="text-sm tabular-nums">{percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
          </div>
          <Progress value={Math.min(100, Math.max(0, percentage))} className="h-2"
            aria-label={`${percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta encerrada`} />
          <p className="text-xs text-muted-foreground">
            Período: {exactDate(row.starts_at)} → {exactDate(row.ends_at)}
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Dados para auditoria</summary>
            <div className="mt-2 space-y-1 break-all">
              <p>Fechada em: {exactDate(row.closed_at)}</p>
              <p>ID do ciclo: {row.cycle_id}</p>
              <p>ID da meta: {row.goal_id} · versão {row.goal_version}</p>
              {row.user_id && <p>ID do colaborador: {row.user_id}</p>}
            </div>
          </details>
        </article>;
      })}
      {!query.isLoading && !query.isError && !items.length && <p className="surface-panel rounded-xl p-6 text-center text-sm text-muted-foreground">
        Nenhuma meta encerrada para este filtro.
      </p>}
    </div>
    {(page > 0 || items.length === pageSize) && <div className="flex justify-end gap-2">
      <Button variant="outline" disabled={!page} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
      <Button variant="outline" disabled={items.length < pageSize} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
    </div>}
  </section>;
}
