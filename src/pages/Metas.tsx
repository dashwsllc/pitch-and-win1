import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SalesBoard } from "@/components/sales/SalesBoard";
import { GoalTasks } from "@/components/arena/GoalTasks";
import { GoalOverview } from "@/components/arena/GoalOverview";
import { GoalManagement } from "@/components/arena/GoalManagement";
import { EventAudit } from "@/components/arena/EventAudit";
import { NotificationInbox } from "@/components/arena/ArenaNotifications";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { arenaRpc } from "@/lib/arena-api";
import type { ArenaResult } from "@/lib/arena";
import { progressPercent, stateLabels } from "@/lib/arena";
import { errorMessage, exactDate } from "@/lib/sales";
import { Button } from "@/components/ui/button";

type History = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  closed_at: string;
  result: ArenaResult;
};
type Audit = {
  id: string;
  actor_name: string;
  action: string;
  target_label: string;
  reason: string;
  created_at: string;
};
function GoalRecords({ tab }: { tab: "history" | "audit" }) {
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const size = tab === "history" ? 30 : 50;
  const query = useQuery({
    queryKey: ["arena-records", user?.id, tab, page],
    enabled: !!user,
    queryFn: () =>
      arenaRpc<(History & Audit)[]>("arena_management", {
        p_tab: tab,
        p_offset: page * size,
      }),
  });
  return (
    <section className="space-y-4">
      <h2 className="text-lg">
        {tab === "history" ? "Ciclos consolidados" : "Auditoria de ações"}
      </h2>
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      {query.data?.map((row) => (
        <article className="surface-panel rounded-xl p-4" key={row.id}>
          {tab === "history" ? (
            <>
              <div className="flex justify-between gap-3">
                <h3>{row.title}</h3>
                <span className="text-sm text-ember">
                  {stateLabels[row.result.state]}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {exactDate(row.starts_at)} → {exactDate(row.ends_at)}
              </p>
              <p className="mt-2 tabular-nums">
                {progressPercent(row.result.actual, row.result.target).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta
              </p>
              <details className="mt-3 text-sm">
                <summary>Resultados individuais e ranking preservado</summary>
                <div className="mt-2 space-y-1">
                  {row.result.members.map((p) => (
                    <p key={p.user_id}>
                      {p.display_name} · {progressPercent(p.actual, p.target).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta ·{" "}
                      {stateLabels[p.state]}
                    </p>
                  ))}
                  {(["sdrs", "closers"] as const).map((role) =>
                    row.result[role]?.map((p, i) => (
                      <p key={`${role}:${p.user_id}`}>
                        {role === "sdrs" ? "SDR" : "Closer"} · {i + 1}. {p.name}{" "}
                        · {role === "sdrs" ? `${p.repasses ?? 0} repasses` : `${p.quantidadeVendas ?? 0} vendas`}
                      </p>
                    )),
                  )}
                </div>
              </details>
            </>
          ) : (
            <>
              <p>
                {row.target_label} ·{" "}
                <span className="text-ember">{row.action}</span>
              </p>
              <p className="mt-1 text-sm">{row.reason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {row.actor_name} · {exactDate(row.created_at)}
              </p>
            </>
          )}
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
    ...(isExecutive
      ? [
          ["gestao", "Gestão de metas"],
          ["historico", "Histórico"],
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
        {tab === "atribuicoes" && <><GoalOverview /><GoalTasks /></>}
        {tab === "gestao" && <GoalManagement />}
        {tab === "configuracoes" && <GoalManagement configuration />}
        {tab === "historico" && <GoalRecords key="history" tab="history" />}
        {tab === "auditoria" && (
          <div className="space-y-8">
            <EventAudit />
            <GoalRecords key="audit" tab="audit" />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
