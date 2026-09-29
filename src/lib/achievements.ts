export interface AchievementDef {
  id: string;
  name: string;
  description: string;
}

// Catálogo fixo de conquistas -- todas calculáveis a partir do que já é
// buscado pra montar o nível (nenhuma tabela nova). Se um critério novo for
// necessário no futuro, adicionar aqui e em unlockedAchievementIds.
export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  { id: "first-sale", name: "Primeira venda", description: "Aprovou a primeira venda" },
  { id: "first-goal", name: "Meta batida", description: "Bateu uma meta pessoal" },
  { id: "streak-3", name: "Em ritmo", description: "3 dias seguidos com atividade registrada" },
  { id: "streak-7", name: "Sequência forte", description: "7 dias seguidos com atividade registrada" },
  { id: "streak-30", name: "Veterano", description: "30 dias seguidos com atividade registrada" },
  { id: "level-5", name: "Nível 5", description: "Chegou ao nível 5" },
  { id: "multi-goal", name: "Multimetas", description: "Bateu 5 metas pessoais" },
  { id: "five-sales", name: "5 vendas", description: "Aprovou 5 vendas" },
];

export interface AchievementInput {
  level: number;
  streakDays: number;
  achievedCount: number;
  saleCount: number;
}

export function unlockedAchievementIds(input: AchievementInput): Set<string> {
  const unlocked = new Set<string>();
  if (input.saleCount >= 1) unlocked.add("first-sale");
  if (input.achievedCount >= 1) unlocked.add("first-goal");
  if (input.streakDays >= 3) unlocked.add("streak-3");
  if (input.streakDays >= 7) unlocked.add("streak-7");
  if (input.streakDays >= 30) unlocked.add("streak-30");
  if (input.level >= 5) unlocked.add("level-5");
  if (input.achievedCount >= 5) unlocked.add("multi-goal");
  if (input.saleCount >= 5) unlocked.add("five-sales");
  return unlocked;
}
