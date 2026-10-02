import { CalendarClockIcon } from 'lucide-react'
import { HeroGreetingText } from '@/components/dashboard/HeroClock'
import { useLiveClock } from '@/hooks/useLiveClock'
import { formatarDiaDaSemana, formatarHoraCompleta } from '../lib/tempo'

// Cada peça abaixo tem o próprio relógio: o tique de 1 s re-renderiza só o <time>, não a página em volta.
function DataDeHoje() {
  const agora = useLiveClock(60_000)
  return <>{formatarDiaDaSemana(agora)}</>
}

function RelogioDeBrasilia() {
  const agora = useLiveClock()
  return (
    <time data-live-clock dateTime={agora.toISOString()} aria-label="Horário de Brasília" className="tabular-nums">
      {formatarHoraCompleta(agora)}
    </time>
  )
}

/**
 * Cabeçalho da página: a saudação (como o painel antigo), o título, o dia e a hora de Brasília e uma frase verdadeira
 * sobre a atualização (o painel se atualiza sozinho: Realtime e verificação de revisão).
 */
export function Cabecalho({ nome, escopo }: { nome: string; escopo: string }) {
  return (
    <div data-dashboard-section="greeting" className="mb-5 flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary dark:text-viz-1">
        <HeroGreetingText />, {nome}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-heading md:text-4xl">Visão geral</h1>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <CalendarClockIcon className="size-4" aria-hidden="true" />
        <span>
          <DataDeHoje /> · <RelogioDeBrasilia /> · {escopo} · atualiza sozinho a cada venda e abordagem · horários de Brasília
        </span>
      </p>
    </div>
  )
}
