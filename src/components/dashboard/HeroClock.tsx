import { Activity } from 'lucide-react'
import { useLiveClock, useLiveClockSelector } from '@/hooks/useLiveClock'
import { BRASILIA_TIME_ZONE, brasiliaParts, formatBrasiliaDate } from '@/lib/brasilia-time'

// The dashboard header shows a wall clock. Each piece below owns its own timer so
// the once-per-second tick re-renders a single <time> element instead of the
// whole page (charts, rankings, sales lists) that sits around it.
const MINUTE_MS = 60_000
// toLocaleTimeString(locale, options) builds a new Intl formatter on every call.
const clockFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: BRASILIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function HeroDateText() {
  const now = useLiveClock(MINUTE_MS)
  return <>{formatBrasiliaDate(now, { weekday: 'long', day: 'numeric', month: 'long', year: undefined })}</>
}

export function HeroGreetingText() {
  const hour = useLiveClockSelector((now) => brasiliaParts(now).hour, MINUTE_MS)
  return <>{hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'}</>
}

export function HeroClock() {
  const now = useLiveClock()
  return (
    <time
      data-live-clock
      dateTime={now.toISOString()}
      aria-label="Horário de Brasília"
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/[0.035] px-3 text-xs tabular-nums text-muted-foreground shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]"
    >
      <Activity className="h-3.5 w-3.5 text-electric" />
      {clockFormatter.format(now)}
    </time>
  )
}
