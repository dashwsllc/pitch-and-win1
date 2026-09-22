import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { Award, Crown, Headphones, Medal, MessageCircleMore, Send, Target, Users } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SDRRankingUser } from '@/hooks/useRankingDataWithMock'
import { cn } from '@/lib/utils'

const colors = [
  'from-cyan-500 to-blue-600',
  'from-violet-500 to-fuchsia-600',
  'from-emerald-500 to-teal-600',
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

export function SDRRanking({ ranking, error }: { ranking: SDRRankingUser[]; error: string | null }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const maxRepasses = Math.max(1, ...ranking.map(item => item.repasses))
  const totalLeads = ranking.reduce((sum, item) => sum + item.totalLeads, 0)
  const totalApproachedLeads = ranking.reduce((sum, item) => sum + item.leadsAbordados, 0)
  const totalApproaches = ranking.reduce((sum, item) => sum + item.abordagens, 0)
  const totalHandoffs = ranking.reduce((sum, item) => sum + item.repasses, 0)
  const teamConversion = totalApproachedLeads > 0
    ? totalHandoffs / totalApproachedLeads * 100
    : 0

  useEffect(() => {
    if (!sectionRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.fromTo(
        '[data-sdr-rank-item]',
        { opacity: 0, y: 18, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.48, stagger: 0.06, ease: 'power2.out' },
      )
    }, sectionRef)
    return () => context.revert()
  }, [ranking.length])

  return (
    <section ref={sectionRef} className="space-y-4" aria-labelledby="sdr-ranking-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-cyan-400">
            <Headphones className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">Time de prospecção</span>
          </div>
          <h2 id="sdr-ranking-title" className="mt-1 text-2xl font-light tracking-tight text-foreground">
            Ranking de <span className="font-semibold">SDRs</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance por abordagens e repasses qualificados para Closers.
          </p>
        </div>
        <Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/5 text-cyan-300">
          Escala compacta
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: 'Leads na carteira', value: totalLeads, icon: Users },
          { label: 'Abordagens', value: totalApproaches, icon: MessageCircleMore },
          { label: 'Repasses ao Closer', value: totalHandoffs, icon: Send },
          { label: 'Conversão do time', value: `${teamConversion.toFixed(1)}%`, icon: Target },
        ].map(metric => (
          <Card key={metric.label} data-sdr-rank-item className="border-cyan-400/10 bg-cyan-400/[0.025]">
            <CardContent className="flex items-center gap-2.5 p-3">
              <metric.icon className="h-4 w-4 shrink-0 text-cyan-400" />
              <div className="min-w-0">
                <p className="text-lg font-bold tabular-nums text-foreground">{metric.value}</p>
                <p className="truncate text-[11px] text-muted-foreground">{metric.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-cyan-400/15 bg-gradient-to-br from-cyan-500/[0.035] to-violet-500/[0.025]">
        <CardHeader className="border-b border-border/30 px-4 py-3">
          <CardTitle className="text-sm font-semibold">Classificação SDR</CardTitle>
        </CardHeader>
        <CardContent className="p-2 sm:p-3">
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              Não foi possível atualizar o ranking de SDRs.
            </p>
          )}
          {!error && ranking.length === 0 && (
            <p className="p-5 text-center text-sm text-muted-foreground">Nenhum SDR elegível no ranking.</p>
          )}
          <div className="space-y-1.5">
            {ranking.map((sdr, index) => {
              const position = index + 1
              const progress = (sdr.repasses / maxRepasses) * 100
              return (
                <article
                  key={sdr.user_id}
                  data-sdr-rank-item
                  className={cn(
                    'grid gap-2 rounded-xl border border-transparent p-2.5 transition-colors hover:border-cyan-400/10 hover:bg-white/[0.025] sm:grid-cols-[auto_minmax(180px,1fr)_minmax(280px,1.35fr)] sm:items-center',
                    sdr.isCurrentUser && 'border-cyan-400/25 bg-cyan-400/[0.055]',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex w-6 justify-center">{medal(position)}</div>
                    <Avatar className="h-9 w-9">
                      {sdr.avatarUrl && <AvatarImage src={sdr.avatarUrl} alt={sdr.name} className="object-cover" />}
                      <AvatarFallback className={`bg-gradient-to-br ${colors[index % colors.length]} text-xs font-bold text-white`}>
                        {initials(sdr.name)}
                      </AvatarFallback>
                    </Avatar>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{sdr.name}</h3>
                      {sdr.isCurrentUser && <Badge variant="outline" className="h-5 border-cyan-400/30 px-1.5 text-[10px] text-cyan-300">Você</Badge>}
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/30">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-[width] duration-700"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <dl className="grid grid-cols-4 gap-1.5 text-center">
                    <div><dd className="text-sm font-bold tabular-nums">{sdr.abordagens}</dd><dt className="text-[10px] text-muted-foreground">Abordagens</dt></div>
                    <div><dd className="text-sm font-bold tabular-nums">{sdr.repasses}</dd><dt className="text-[10px] text-muted-foreground">Repasses</dt></div>
                    <div><dd className="text-sm font-bold tabular-nums">{sdr.vendasOriginadas}</dd><dt className="text-[10px] text-muted-foreground">Vendas</dt></div>
                    <div title={`${sdr.repasses} repasses ÷ leads abordados`}><dd className="text-sm font-bold tabular-nums text-cyan-300">{sdr.conversao.toFixed(1)}%</dd><dt className="text-[10px] text-muted-foreground">Conversão</dt></div>
                  </dl>
                </article>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
