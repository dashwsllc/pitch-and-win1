import type { UserRole } from "@/hooks/useRoles";
import { progressPercent, type ArenaCycle } from "@/lib/arena";

export type GoalPeriod = "daily" | "weekly" | "monthly";

// Cada ciclo fechado ou em andamento rende XP proporcional ao quanto da meta
// pessoal foi cumprido; ciclos mais longos valem mais porque exigem esforço
// sustentado. Acima de 200% da meta o excedente para de contar, pra um único
// resultado fora da curva não pular vários níveis de uma vez.
const XP_PER_PERIOD: Record<GoalPeriod, number> = {
  daily: 40,
  weekly: 120,
  monthly: 320,
};
const MAX_PERCENT_PER_CYCLE = 200;

export function xpFromPercent(period: GoalPeriod, percent: number): number {
  const clamped = Math.max(0, Math.min(MAX_PERCENT_PER_CYCLE, percent));
  return Math.round(XP_PER_PERIOD[period] * (clamped / 100));
}

// Curva de nível estilo RPG: cada nível pede ~15% de XP a mais que o
// anterior, então o começo é rápido e níveis altos exigem consistência.
const LEVEL_BASE_XP = 260;
const LEVEL_GROWTH = 1.15;

function xpRequiredForSingleLevel(level: number): number {
  return Math.round(LEVEL_BASE_XP * LEVEL_GROWTH ** (level - 1));
}

// XP acumulado necessário para alcançar `level` (nível 1 começa em 0 XP).
export function xpForLevel(level: number): number {
  let total = 0;
  for (let current = 1; current < level; current++) {
    total += xpRequiredForSingleLevel(current);
  }
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export interface LevelState {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  xpToNext: number;
  percent: number;
}

export function levelProgress(xp: number): LevelState {
  const safeXp = Math.max(0, Math.round(xp));
  const level = levelFromXp(safeXp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = ceil - floor;
  return {
    level,
    xp: safeXp,
    xpIntoLevel: safeXp - floor,
    xpForNextLevel: span,
    xpToNext: ceil - safeXp,
    percent: span > 0 ? ((safeXp - floor) / span) * 100 : 100,
  };
}

export interface PersonalGoalSample {
  period: GoalPeriod;
  percent: number;
  at: string;
}

// Meta pessoal com base no cargo: prioriza um ciclo individual (scope
// "user") atribuído à pessoa; na ausência dele, usa o ciclo do cargo dela
// (scope "role") -- mesmo critério que GoalOverview usa pra decidir o que
// conta como "a meta" de cada um.
export function personalCycleSamples(
  cycles: ArenaCycle[],
  userId: string,
  roles: readonly UserRole[],
): PersonalGoalSample[] {
  const samples: PersonalGoalSample[] = [];
  for (const cycle of cycles) {
    const isPersonal = cycle.scope === "user" || (cycle.scope === "role" && roles.includes(cycle.role as UserRole));
    if (!isPersonal) continue;
    const member = cycle.result.members.find((candidate) => candidate.user_id === userId);
    if (!member || member.target <= 0) continue;
    samples.push({ period: cycle.period, percent: progressPercent(member.actual, member.target), at: cycle.ends_at });
  }
  return samples;
}

export interface PersonalHistoryRow {
  scope: "global" | "role" | "user";
  target_role: string | null;
  user_id: string | null;
  period: GoalPeriod;
  actual: number;
  target: number;
  closed_at: string;
  outcome: "achieved" | "failed" | "unassigned";
}

export function personalHistorySamples(
  rows: PersonalHistoryRow[],
  userId: string,
  roles: readonly UserRole[],
): PersonalGoalSample[] {
  return rows
    .filter((row) => row.user_id === userId && row.target > 0)
    .filter((row) => row.scope === "user" || (row.scope === "role" && roles.includes(row.target_role as UserRole)))
    .map((row) => ({ period: row.period, percent: progressPercent(row.actual, row.target), at: row.closed_at }));
}

export function totalXp(samples: PersonalGoalSample[]): number {
  return samples.reduce((sum, sample) => sum + xpFromPercent(sample.period, sample.percent), 0);
}

// XP por atividade exercida: cada ação registrada na Arena (venda aprovada,
// call feita, lead abordado etc.) já tem um "score" calibrado em
// arena_score_weights (ex.: venda aprovada = 10 pontos). Essa é a fonte que
// faz o nível evoluir a cada ação real, independente de existir meta
// configurada para o cargo -- diferente das metas, nunca fica vazia à toa.
const ACTIVITY_XP_PER_SCORE_POINT = 25;

export function xpFromActivityScore(totalScore: number): number {
  return Math.max(0, Math.round(totalScore * ACTIVITY_XP_PER_SCORE_POINT));
}
