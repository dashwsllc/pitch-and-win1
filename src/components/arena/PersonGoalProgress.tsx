import { progressPercent, type ArenaCycle, type ArenaMember } from "@/lib/arena";

const states = {
  low: { label: "Vamos acelerar", emoji: "😔" },
  middle: { label: "No caminho", emoji: "😐" },
  achieved: { label: "Meta batida!", emoji: "🤑" },
  exceeded: { label: "Além da meta!", emoji: "🤑" },
  unassigned: { label: "Sem meta definida", emoji: "—" },
} as const;

const periods = { daily: "Meta de hoje", weekly: "Meta da semana", monthly: "Meta do mês" };
const format = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function PersonGoalProgress({ name, member, period }: {
  name: string;
  member?: ArenaMember;
  period?: ArenaCycle["period"];
}) {
  const hasGoal = !!member && member.target > 0;
  const percent = hasGoal ? progressPercent(member.actual, member.target) : 0;
  const state = !hasGoal ? "unassigned"
    : percent > 100 ? "exceeded"
      : percent >= 100 ? "achieved"
        : percent >= 50 ? "middle" : "low";
  const { label, emoji } = states[state];
  const filled = Math.min(100, Math.max(0, percent));
  const goalLabel = period ? periods[period] : "Meta atual";

  return (
    <div className="arena-person-progress" data-state={state}>
      <div className="arena-progress-mood" aria-hidden="true">
        <span className="arena-progress-emoji" key={state}>{emoji}</span>
        {state === "exceeded" && <span className="arena-progress-sparkle">✨</span>}
      </div>
      <div className="arena-progress-body">
        <div className="arena-progress-heading">
          <span className="arena-progress-label">{label}</span>
          <strong className="arena-progress-value">{hasGoal ? `${format(percent)}%` : "—"}</strong>
        </div>
        <div
          className="arena-progress-track"
          role={hasGoal ? "progressbar" : undefined}
          aria-label={hasGoal ? `${goalLabel} de ${name}` : undefined}
          aria-valuemin={hasGoal ? 0 : undefined}
          aria-valuemax={hasGoal ? 100 : undefined}
          aria-valuenow={hasGoal ? filled : undefined}
          aria-valuetext={hasGoal ? `${format(percent)}% da meta. ${label}` : undefined}
          aria-hidden={!hasGoal || undefined}
        >
          <div className="arena-progress-fill" style={{ width: `${filled}%` }} />
          <span className="arena-progress-midpoint" aria-hidden="true" />
        </div>
        <div className="arena-progress-caption">
          <span>{hasGoal ? goalLabel : "Aguardando uma meta"}</span>
          {hasGoal && <span>{percent > 100
            ? `+${format(percent - 100)}% além da meta`
            : percent >= 100 ? "Objetivo conquistado"
              : `Faltam ${format(100 - percent)}%`}</span>}
        </div>
      </div>
    </div>
  );
}
