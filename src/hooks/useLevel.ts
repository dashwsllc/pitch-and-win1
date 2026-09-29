import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, useRoles, type UserRole } from "@/hooks/useRoles";
import { useBrasiliaToday } from "@/hooks/useGoals";
import { arenaClient, arenaRpc } from "@/lib/arena-api";
import type { ArenaCycle } from "@/lib/arena";
import { addDaysToDateKey, brasiliaDateKey } from "@/lib/brasilia-time";
import {
  ACHIEVEMENT_CATALOG,
  unlockedAchievementIds,
  type AchievementDef,
} from "@/lib/achievements";
import {
  levelProgress,
  personalCycleSamples,
  personalHistorySamples,
  totalXp,
  xpFromActivityScore,
  type PersonalGoalSample,
  type PersonalHistoryRow,
} from "@/lib/level";

// A RPC arena_goal_history rejeita p_limit > 50 (ver migration) -- usar 60
// aqui fazia TODA chamada falhar com "Filtro de histórico inválido" e
// derrubar o card inteiro. 50 é o teto real permitido pelo banco.
const HISTORY_LIMIT = 50;

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
        .select("score_delta, action_type, occurred_at")
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

  const saleCount = useMemo(
    () => (activity.data ?? []).filter((row) => row.action_type === "sale.approved").length,
    [activity.data],
  );

  // Sequência ativa: dias seguidos (fuso de Brasília) com pelo menos uma
  // atividade registrada, contando pra trás a partir de hoje. Se ainda não
  // houve atividade hoje, conta a partir de ontem -- assim a sequência não
  // zera só porque o dia ainda não terminou.
  const streakDays = useMemo(() => {
    const days = new Set((activity.data ?? []).map((row) => brasiliaDateKey(row.occurred_at)));
    if (days.size === 0) return 0;
    let cursor = days.has(today) ? today : addDaysToDateKey(today, -1);
    let count = 0;
    while (days.has(cursor)) {
      count++;
      cursor = addDaysToDateKey(cursor, -1);
    }
    return count;
  }, [activity.data, today]);

  const progress = useMemo(() => {
    const samples: PersonalGoalSample[] = [...closedSamples, ...liveSamples];
    return levelProgress(totalXp(samples) + activityXp);
  }, [closedSamples, liveSamples, activityXp]);

  const achievements: (AchievementDef & { unlocked: boolean })[] = useMemo(() => {
    const unlocked = unlockedAchievementIds({ level: progress.level, streakDays, achievedCount, saleCount });
    return ACHIEVEMENT_CATALOG.map((achievement) => ({ ...achievement, unlocked: unlocked.has(achievement.id) }));
  }, [progress.level, streakDays, achievedCount, saleCount]);

  return {
    ...progress,
    roleLabel: ROLE_LABELS[primaryRole],
    series,
    achievedCount,
    streakDays,
    achievements,
    achievementsUnlockedCount: achievements.filter((achievement) => achievement.unlocked).length,
    hasData: closedSamples.length > 0 || liveSamples.length > 0 || activityXp > 0,
    loading: rolesLoading || visibleGoals.isLoading || history.isLoading || activity.isLoading,
    refreshing: visibleGoals.isFetching || history.isFetching || activity.isFetching,
    error: visibleGoals.error ?? history.error ?? activity.error ?? null,
    refetch: () => Promise.all([visibleGoals.refetch(), history.refetch(), activity.refetch()]),
  };
}
