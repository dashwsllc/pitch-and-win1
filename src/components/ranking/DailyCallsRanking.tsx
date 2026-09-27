import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { Award, CalendarCheck, Crown, Headphones, Medal, PhoneCall, Send } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DailyCallRanking } from '@/hooks/useRankingDataWithMock'
import { cn } from '@/lib/utils'

const colors = [
  'from-violet-500 to-fuchsia-600',
  'from-blue-500 to-indigo-600',
  'from-cyan-500 to-blue-600',
  'from-orange-500 to-rose-600',
]

const initials = (name: string) =>
  name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2)

const medal = (position: number) => {
  if (position === 1) return <Crown className="h-4 w-4 text-amber-400" />
  if (position === 2) return <Medal className="h-4 w-4 text-slate-300" />
  if (position === 3) return <Award className="h-4 w-4 text-amber-700" />
  return <span className="text-xs font-bold text-muted-foreground">#{position}</span>
}

const dayLabel = (day?: string) => (day ? day.split('-').reverse().slice(0, 2).join('/') : 'Hoje')

export function DailyCallsRanking({ data, error }: { data: DailyCallRanking | null; error: string | null }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const ranking = data?.ranking ?? []
  const sdrCalls = data?.sdrCalls ?? 0
  const closerCalls = data?.closerCalls ?? 0
  const total = sdrCalls + closerCalls
  const maxTotal = Math.max(1, ...ranking.map(item => item.total))
  const outsideRanking = total - ranking.reduce((sum, item) => sum + item.total, 0)

  useEffect(() => {
    if (!sectionRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.fromTo(
        '[data-call-rank-item]',
        { opacity: 0, y: 18, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.48, stagger: 0.06, ease: 'power2.out' },
      )
    }, sectionRef)
    return () => context.revert()
  }, [ranking.length])

  return (
    <section ref={sectionRef} className="space-y-4" aria-labelledby="daily-calls-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-400">
            <PhoneCall className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">Agenda comercial</span>
          </div>
          <h2 id="daily-calls-title" className="mt-1 text-2xl font-light tracking-tight text-foreground">
            Calls <span className="font-semibold">marcadas hoje</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Por quem marcou · dia de Brasília · reagendamentos e cancelamentos não contam.
          </p>
        </div>
        <Badge variant="outline" className="border-violet-400/25 bg-violet-400/5 text-violet-300">
          <CalendarCheck className="mr-1 h-3 w-3" /> {dayLabel(data?.day)}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden border-violet-400/15 bg-gradient-to-br from-violet-500/[0.035] to-blue-500/[0.025]">
          <CardHeader className="border-b border-border/30 px-4 py-3">
            <CardTitle className="text-sm font-semibold">Classificação de calls do dia</CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-3">
            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                Não foi possível atualizar o ranking de calls.
              </p>
            )}
            {!error && ranking.length === 0 && (
              <p className="p-5 text-center text-sm text-muted-foreground">Nenhuma call marcada hoje.</p>
            )}
            <div className="space-y-1.5">
              {ranking.map((person, index) => {
                const position = index + 1
                const width = (person.total / maxTotal) * 100
                const sdrShare = person.total > 0 ? (person.sdrCalls / person.total) * 100 : 0
                return (
                  <article
                    key={person.user_id}
                    data-call-rank-item
                    className={cn(
                      'grid gap-2 rounded-xl border border-transparent p-2.5 transition-colors hover:border-violet-400/10 hover:bg-white/[0.025] sm:grid-cols-[auto_minmax(160px,1fr)_minmax(220px,1fr)] sm:items-center',
                      person.isCurrentUser && 'border-violet-400/25 bg-violet-400/[0.055]',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex w-6 justify-center">{medal(position)}</div>
                      <Avatar className="h-9 w-9">
                        {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt={person.name} className="object-cover" />}
                        <AvatarFallback className={`bg-gradient-to-br ${colors[index % colors.length]} text-xs font-bold text-white`}>
                          {initials(person.name)}
                        </AvatarFallback>
                      </Avatar>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{person.name}</h3>
                        {person.isCurrentUser && <Badge variant="outline" className="h-5 border-violet-400/30 px-1.5 text-[10px] text-violet-300">Você</Badge>}
                      </div>
                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/30"
                        title={`${person.sdrCalls} calls de SDR · ${person.closerCalls} calls para Closer`}
                      >
                        <div className="flex h-full overflow-hidden rounded-full transition-[width] duration-700" style={{ width: `${width}%` }}>
                          <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${sdrShare}%` }} />
                          <div className="h-full flex-1 bg-gradient-to-r from-amber-500 to-orange-600" />
                        </div>
                      </div>
                    </div>

                    <dl className="grid grid-cols-3 gap-1.5 text-center">
                      <div><dd className="text-sm font-bold tabular-nums text-cyan-300">{person.sdrCalls}</dd><dt className="text-[10px] text-muted-foreground">Calls SDR</dt></div>
                      <div><dd className="text-sm font-bold tabular-nums text-orange-300">{person.closerCalls}</dd><dt className="text-[10px] text-muted-foreground">Calls Closer</dt></div>
                      <div><dd className="text-sm font-bold tabular-nums">{person.total}</dd><dt className="text-[10px] text-muted-foreground">Total</dt></div>
                    </dl>
                  </article>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Card data-call-rank-item className="border-cyan-400/15 bg-cyan-400/[0.03]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10">
                <Headphones className="h-5 w-5 text-cyan-400" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold tabular-nums text-foreground">{sdrCalls}</p>
                <p className="text-xs text-muted-foreground">Calls de SDR (qualificação)</p>
              </div>
            </CardContent>
          </Card>

          <Card data-call-rank-item className="border-orange-400/15 bg-orange-400/[0.03]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-400/10">
                <Send className="h-5 w-5 text-orange-400" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold tabular-nums text-foreground">{closerCalls}</p>
                <p className="text-xs text-muted-foreground">Calls para Closer (fechamento)</p>
              </div>
            </CardContent>
          </Card>

          <Card data-call-rank-item className="border-border/30 sm:col-span-2 lg:col-span-1">
            <CardContent className="space-y-2.5 p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-xs text-muted-foreground">Total marcado hoje</p>
                <p className="text-lg font-bold tabular-nums">{total}</p>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-border/30" role="img" aria-label={`${sdrCalls} calls de SDR e ${closerCalls} calls para Closer`}>
                {total > 0 && (
                  <>
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${(sdrCalls / total) * 100}%` }} />
                    <div className="h-full flex-1 bg-gradient-to-r from-amber-500 to-orange-600" />
                  </>
                )}
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-400" /> SDR {total > 0 ? Math.round((sdrCalls / total) * 100) : 0}%</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" /> Closer {total > 0 ? Math.round((closerCalls / total) * 100) : 0}%</span>
              </div>
              {outsideRanking > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {outsideRanking} {outsideRanking === 1 ? 'call marcada' : 'calls marcadas'} por contas administrativas fora do ranking.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
