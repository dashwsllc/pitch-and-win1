import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLevelProgress } from '@/hooks/useLevel'

const TAMANHO = 28
const ESPESSURA = 3

/** Anel pequeno do nível (decorativo: o número e o texto do link dizem tudo). */
function AnelNivel({ percent, nivel }: { percent: number; nivel: number }) {
  const raio = (TAMANHO - ESPESSURA) / 2
  const circunferencia = 2 * Math.PI * raio
  const f = Math.min(100, Math.max(0, percent)) / 100
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: TAMANHO, height: TAMANHO }} aria-hidden="true">
      <svg width={TAMANHO} height={TAMANHO} viewBox={`0 0 ${TAMANHO} ${TAMANHO}`} className="-rotate-90">
        <circle cx={TAMANHO / 2} cy={TAMANHO / 2} r={raio} fill="none" className="stroke-viz-track" strokeWidth={ESPESSURA} />
        <circle
          cx={TAMANHO / 2}
          cy={TAMANHO / 2}
          r={raio}
          fill="none"
          className="stroke-ok transition-[stroke-dashoffset] duration-700 ease-out"
          strokeWidth={ESPESSURA}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={circunferencia * (1 - f)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-heading">{nivel}</span>
    </span>
  )
}

/** Nível e XP da pessoa, no padrão visual do painel (mesma fonte do selo antigo: useLevelProgress). */
function NivelPillBase() {
  const { level, percent, xpToNext, roleLabel } = useLevelProgress()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/metas?tab=atribuicoes"
          aria-label={`Nível ${level}, ${roleLabel}. Faltam ${xpToNext.toLocaleString('pt-BR')} XP para o nível ${level + 1}.`}
          className="inline-flex h-9 items-center gap-2 rounded-full border bg-card/60 py-1 pl-1 pr-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 sm:pr-3"
        >
          <AnelNivel percent={percent} nivel={level} />
          <span className="hidden whitespace-nowrap sm:inline">
            Nível {level}
            <span className="hidden text-muted-foreground lg:inline"> · {roleLabel}</span>
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="border-0 bg-foreground text-xs text-background">
        Faltam {xpToNext.toLocaleString('pt-BR')} XP para o nível {level + 1}
      </TooltipContent>
    </Tooltip>
  )
}

export const NivelPill = memo(NivelPillBase)
