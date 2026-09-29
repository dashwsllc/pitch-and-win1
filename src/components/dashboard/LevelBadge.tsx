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
          className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.045] py-1 pl-1.5 pr-3 text-xs font-medium text-ash shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset] transition-colors hover:bg-white/[0.065]"
        >
          <LevelRing percent={percent} size={28} strokeWidth={3}>
            <span className="text-[10px] font-semibold tabular-nums text-white">{level}</span>
          </LevelRing>
          <span className="hidden sm:inline">Nível {level} · {roleLabel}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        Faltam {xpToNext.toLocaleString("pt-BR")} XP para o nível {level + 1}
      </TooltipContent>
    </Tooltip>
  )
}
