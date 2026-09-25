import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SalesBoard } from "@/components/sales/SalesBoard";
import { GoalTasks } from "@/components/arena/GoalTasks";
import { GoalOverview } from "@/components/arena/GoalOverview";
import { GoalHistory } from "@/components/arena/GoalHistory";
import { ShiftApproachGoals } from "@/components/arena/ShiftApproachGoals";
import { GoalManagement } from "@/components/arena/GoalManagement";
import { EventAudit } from "@/components/arena/EventAudit";
import { NotificationInbox } from "@/components/arena/ArenaNotifications";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { useBrasiliaDateSelection } from "@/hooks/useGoals";
import { useArenaAssignees } from "@/hooks/useArena";
import { arenaRpc } from "@/lib/arena-api";
import { errorMessage, exactDate } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Audit = {
  id: string;
  actor_name: string;
  action: string;
  target_label: string;
  reason: string;
  created_at: string;
};
function ShiftGoalsSection({ isExecutive }: { isExecutive: boolean }) {
  const { date, setDate } = useBrasiliaDateSelection();
  const [person, setPerson] = useState("");
  const assignees = useArenaAssignees();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="shift-goals-date">Data das metas de turno</Label>
          <Input id="shift-goals-date" className="mt-1 w-44" type="date" value={date}
            onChange={(event) => setDate(event.target.value)} />
        </div>
        {isExecutive && <select aria-label="Filtrar colaborador nas metas de turno"
          className="h-10 rounded-lg border bg-background px-3 text-sm" value={person}
          onChange={(event) => setPerson(event.target.value)}>
          <option value="">Todos os colaboradores</option>
          {assignees.data?.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>
            {candidate.display_name}
          </option>)}
        </select>}
      </div>
      <ShiftApproachGoals date={date} person={person} management={isExecutive} />
    </div>
  );
}
function AuditRecords() {
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const size = 50;
  const query = useQuery({
    queryKey: ["arena-records", user?.id, "audit", page],
    enabled: !!user,
    queryFn: () =>
      arenaRpc<Audit[]>("arena_management", {
        p_tab: "audit",
        p_offset: page * size,
      }),
  });
  return (
    <section className="space-y-4">
      <h2 className="text-lg">Auditoria de ações</h2>
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      {query.data?.map((row) => (
        <article className="surface-panel rounded-xl p-4" key={row.id}>
          <p>{row.target_label} · <span className="text-ember">{row.action}</span></p>
          <p className="mt-1 text-sm">{row.reason}</p>
          <p className="mt-2 text-xs text-muted-foreground">{row.actor_name} · {exactDate(row.created_at)}</p>
        </article>
      ))}
      {!query.isLoading && !query.data?.length && (
        <p className="py-10 text-center text-muted-foreground">
          Nenhum registro nesta página.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          disabled={(query.data?.length ?? 0) < size}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </div>
    </section>
  );
}
export default function Metas() {
  const [params, setParams] = useSearchParams();
  const { isExecutive } = useRoles();
  const allowed = [
    ["vendas", "Vendas do time"],
    ["atribuicoes", "Minhas tarefas"],
    ["historico", "Histórico de metas"],
    ...(isExecutive
      ? [
          ["gestao", "Gestão de metas"],
          ["auditoria", "Auditoria"],
          ["configuracoes", "Configurações"],
        ]
      : []),
  ];
  const selected = params.get("tab") || "vendas";
  const tab = allowed.some(([key]) => key === selected) ? selected : "vendas";
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light tracking-tight">Metas</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Vendas, compromissos e resultados do time.
            </p>
          </div>
          {isExecutive && <NotificationInbox />}
        </header>
        <nav className="flex flex-wrap gap-2" aria-label="Central de metas">
          {allowed.map(([key, label]) => (
            <Button
              key={key}
              variant={tab === key ? "default" : "ghost"}
              size="sm"
              onClick={() => setParams({ tab: key })}
            >
              {label}
            </Button>
          ))}
        </nav>
        {tab === "vendas" && <SalesBoard management={isExecutive} />}
        {tab === "atribuicoes" && <><GoalOverview /><ShiftGoalsSection isExecutive={isExecutive} /><GoalTasks /></>}
        {tab === "gestao" && <GoalManagement />}
        {tab === "configuracoes" && <GoalManagement configuration />}
        {tab === "historico" && <GoalHistory management={isExecutive} />}
        {tab === "auditoria" && (
          <div className="space-y-8">
            <EventAudit />
            <AuditRecords />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
