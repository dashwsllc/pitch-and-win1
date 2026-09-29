import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, useRoles, type UserRole } from "@/hooks/useRoles";
import { useBrasiliaToday } from "@/hooks/useGoals";
import { arenaRpc } from "@/lib/arena-api";
import type { ArenaCycle } from "@/lib/arena";
import {
  levelProgress,
  personalCycleSamples,
  personalHistorySamples,
  totalXp,
  type PersonalGoalSample,
  type PersonalHistoryRow,
} from "@/lib/level";

const HISTORY_LIMIT = 300;

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

  const progress = useMemo(() => {
    const samples: PersonalGoalSample[] = [...closedSamples, ...liveSamples];
    return levelProgress(totalXp(samples));
  }, [closedSamples, liveSamples]);

  return {
    ...progress,
    roleLabel: ROLE_LABELS[primaryRole],
    series,
    achievedCount,
    hasData: closedSamples.length > 0 || liveSamples.length > 0,
    loading: rolesLoading || visibleGoals.isLoading || history.isLoading,
    refreshing: visibleGoals.isFetching || history.isFetching,
    error: visibleGoals.error ?? history.error ?? null,
    refetch: () => Promise.all([visibleGoals.refetch(), history.refetch()]),
  };
}
