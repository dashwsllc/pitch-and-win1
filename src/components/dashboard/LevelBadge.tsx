import { Link } from "react-router-dom"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LevelRing } from "@/components/dashboard/LevelRing"
import { useLevelProgress } from "@/hooks/useLevel"

export function LevelBadge() {
  const { level, percent, xpToNext, roleLabel, loading } = useLevelProgress()

  if (loading) {
    return <div className="h-10 w-10 animate-pulse rounded-lg bg-white/[0.04] sm:w-32" aria-hidden="true" />
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/metas?tab=atribuicoes"
          aria-label={`Nível ${level}, ${roleLabel}. Faltam ${xpToNext.toLocaleString("pt-BR")} XP para o nível ${level + 1}.`}
          className="flex h-10 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] py-1 pl-1.5 pr-3 text-xs font-medium text-ash shadow-[rgba(52,211,153,0.1)_0_0_0_1px_inset] transition-colors hover:bg-emerald-400/[0.1]"
        >
          <LevelRing percent={percent} size={28} strokeWidth={3}>
            <span className="text-[10px] font-semibold tabular-nums text-white">{level}</span>
          </LevelRing>
          <span className="whitespace-nowrap">
            Nível {level}<span className="hidden text-muted-foreground sm:inline"> · {roleLabel}</span>
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        Faltam {xpToNext.toLocaleString("pt-BR")} XP para o nível {level + 1}
      </TooltipContent>
    </Tooltip>
  )
}
