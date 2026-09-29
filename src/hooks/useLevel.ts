import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, useRoles, type UserRole } from "@/hooks/useRoles";
import { useBrasiliaToday } from "@/hooks/useGoals";
import { arenaClient, arenaRpc } from "@/lib/arena-api";
import type { ArenaCycle } from "@/lib/arena";
import {
  levelProgress,
  personalCycleSamples,
  personalHistorySamples,
  totalXp,
  xpFromActivityScore,
  type PersonalGoalSample,
  type PersonalHistoryRow,
} from "@/lib/level";

const HISTORY_LIMIT = 60;

export interface LevelHistoryPoint {
  at: string;
  xp: number;
  cumulativeXp: number;
}

export function useLevelProgress() {
  const { user } = useAuth();
  const { roles, primaryRole, loading: rolesLoading } = useRoles();
  const today = useBrasiliaToday();

  // Mesma queryKey de GoalOverview -- quando as duas telas estão montadas
  // juntas (ex.: Metas), a requisição é compartilhada em vez de duplicada.
  const visibleGoals = useQuery({
    queryKey: ["visible-goals", user?.id, today],
    enabled: !!user,
    queryFn: () => arenaRpc<ArenaCycle[]>("arena_visible_goals", {}),
    staleTime: 8_000,
  });

  const history = useQuery({
    queryKey: ["goal-history", "level", user?.id],
    enabled: !!user,
    queryFn: () =>
      arenaRpc<{ items: PersonalHistoryRow[] }>("arena_goal_history", {
        p_person: null,
        p_outcome: "all",
        p_offset: 0,
        p_limit: HISTORY_LIMIT,
      }),
    staleTime: 5 * 60_000,
  });

  // Score real de cada ação (venda aprovada, call feita, lead abordado...),
  // liberado por RLS pra quem tem acesso à Arena. É a fonte que garante o
  // nível evoluir mesmo sem meta configurada pro cargo.
  const activity = useQuery({
    queryKey: ["activity-feed", "my-score", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await arenaClient
        .from("activity_feed")
        .select("score_delta")
        .eq("responsible_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const closedSamples = useMemo(
    () => (user ? personalHistorySamples(history.data?.items ?? [], user.id, roles) : []),
    [history.data, user, roles],
  );
  const liveSamples = useMemo(
    () => (user ? personalCycleSamples(visibleGoals.data ?? [], user.id, roles) : []),
    [visibleGoals.data, user, roles],
  );

  const series: LevelHistoryPoint[] = useMemo(() => {
    const sorted = [...closedSamples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let cumulative = 0;
    return sorted.map((sample) => {
      const xp = totalXp([sample]);
      cumulative += xp;
      return { at: sample.at, xp, cumulativeXp: cumulative };
    });
  }, [closedSamples]);

  const achievedCount = useMemo(
    () =>
      user
        ? (history.data?.items ?? []).filter((row) => {
            if (row.user_id !== user.id || row.outcome !== "achieved") return false;
            return row.scope === "user" || (row.scope === "role" && roles.includes(row.target_role as UserRole));
          }).length
        : 0,
    [history.data, user, roles],
  );

  const activityXp = useMemo(
    () => xpFromActivityScore((activity.data ?? []).reduce((sum, row) => sum + (row.score_delta ?? 0), 0)),
    [activity.data],
  );

  const progress = useMemo(() => {
    const samples: PersonalGoalSample[] = [...closedSamples, ...liveSamples];
    return levelProgress(totalXp(samples) + activityXp);
  }, [closedSamples, liveSamples, activityXp]);

  return {
    ...progress,
    roleLabel: ROLE_LABELS[primaryRole],
    series,
    achievedCount,
    hasData: closedSamples.length > 0 || liveSamples.length > 0 || activityXp > 0,
    loading: rolesLoading || visibleGoals.isLoading || history.isLoading || activity.isLoading,
    refreshing: visibleGoals.isFetching || history.isFetching || activity.isFetching,
    error: visibleGoals.error ?? history.error ?? activity.error ?? null,
    refetch: () => Promise.all([visibleGoals.refetch(), history.refetch(), activity.refetch()]),
  };
}
