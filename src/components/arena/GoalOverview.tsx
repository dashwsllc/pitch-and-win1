import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useBrasiliaToday } from "@/hooks/useGoals";
import { arenaRpc } from "@/lib/arena-api";
import { progressPercent, stateLabels, type ArenaCycle } from "@/lib/arena";
import { errorMessage, exactDate, money } from "@/lib/sales";
import { Progress } from "@/components/ui/progress";

export function GoalOverview() {
  const { user } = useAuth();
  const today = useBrasiliaToday();
  const query = useQuery({
    queryKey: ["visible-goals", user?.id, today],
    enabled: !!user,
    queryFn: () => arenaRpc<ArenaCycle[]>("arena_visible_goals", {}),
    staleTime: 8_000,
  });
  const goals = query.data?.filter((cycle) =>
    cycle.scope === "global" || cycle.result.members.some((member) => member.user_id === user?.id),
  ) ?? [];

  return (
    <section className="space-y-3" aria-label="Metas em andamento">
      <div>
        <h2 className="text-lg">Metas em andamento</h2>
        <p className="text-sm text-muted-foreground">
          Metas coletivas para o time e metas individuais atribuídas a você.
        </p>
      </div>
      {query.isError && <p role="alert" className="text-destructive">{errorMessage(query.error)}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {goals.map((cycle) => {
          const individual = cycle.scope === "user";
          const { actual, target, state } = cycle.result;
          const percentage = progressPercent(actual, target);
          const value = cycle.metric === "revenue"
            ? `${money(actual)} / ${money(target)}`
            : `${actual.toLocaleString("pt-BR")} / ${target.toLocaleString("pt-BR")} pontos`;
          return (
            <article key={cycle.id} className="surface-panel space-y-3 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium">{cycle.title}</h3>
                <span className="text-xs text-ember">{individual ? "Individual" : "Coletiva"}</span>
              </div>
              <p className="text-lg tabular-nums">{value}</p>
              <Progress value={Math.min(100, Math.max(0, percentage))} aria-label={`${percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta`} />
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{stateLabels[state] ?? state} · {percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                <span>Até {exactDate(cycle.ends_at)}</span>
              </div>
            </article>
          );
        })}
      </div>
      {!query.isLoading && !query.isError && goals.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma meta ativa no momento.</p>
      )}
    </section>
  );
}
