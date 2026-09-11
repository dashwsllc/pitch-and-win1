import { useState, useEffect, useRef } from "react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { SalesChart } from "@/components/dashboard/SalesChart"
import { ProductsRanking } from "@/components/dashboard/ProductsRanking"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { FilterTabs } from "@/components/dashboard/FilterTabs"
import { GoalsProgress } from "@/components/dashboard/GoalsProgress"
import { LeaderboardPreview } from "@/components/dashboard/LeaderboardPreview"
import { RecentSales } from "@/components/dashboard/RecentSales"
import { SalesBoard } from "@/components/sales/SalesBoard"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useDashboardData } from "@/hooks/useDashboardData"
import { useRankingDataWithMock } from "@/hooks/useRankingDataWithMock"
import { useAuth } from "@/hooks/useAuth"
import { useProfile } from "@/hooks/useProfile"
import { useRoles } from "@/hooks/useRoles"
import { useGSAP } from "@/hooks/useGSAP"
import { 
  CircleDollarSign,
  ShoppingBag,
  ChartSpline,
  UsersRound,
  Target,
  Medal,
  Flame,
  RefreshCw,
  Crown,
  Activity,
  Radio,
} from "lucide-react"
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { AUTO_REFRESH_INTERVAL_LABEL } from '@/lib/sync'
import { BRASILIA_TIME_ZONE, brasiliaParts, formatBrasiliaDate } from '@/lib/brasilia-time'

gsap.registerPlugin(ScrollTrigger)

export default function Dashboard() {
  const [selectedFilter, setSelectedFilter] = useState("hoje")
  const { user } = useAuth()
  const { metrics, loading, error, refetch } = useDashboardData(selectedFilter)
  const { ranking } = useRankingDataWithMock()
  const { profile } = useProfile()
  const { isExecutive } = useRoles()
  const dashboardRef = useRef<HTMLDivElement>(null)
  const metricsRef = useRef<HTMLDivElement>(null)

  useGSAP()

  const userName = profile?.display_name || user?.user_metadata?.display_name || user?.email?.split('@')[0] || "Usuário"
  const userPosition = ranking.findIndex(r => r.isCurrentUser) + 1
  
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!dashboardRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const context = gsap.context(() => {
      gsap.fromTo(
        '[data-hero-item]',
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.62, stagger: 0.07, ease: 'power2.out', clearProps: 'transform' }
      )

      gsap.utils.toArray<HTMLElement>('[data-scroll-reveal]').forEach((section) => {
        gsap.fromTo(section,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.62,
            ease: 'power2.out',
            clearProps: 'transform',
            scrollTrigger: {
              trigger: section,
              start: 'top 88%',
              once: true,
            },
          }
        )
      })

      gsap.to('[data-ambient-orb]', {
        yPercent: 24,
        ease: 'none',
        scrollTrigger: {
          trigger: dashboardRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.8,
        },
      })
    }, dashboardRef)

    return () => context.revert()
  }, [])

  useEffect(() => {
    if (loading || !metricsRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const context = gsap.context(() => {
      gsap.fromTo(metricsRef.current!.children,
        { opacity: 0, y: 18, scale: 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: 0.48, stagger: 0.055, ease: 'power2.out', clearProps: 'transform' }
      )
      ScrollTrigger.refresh()
    }, metricsRef)

    return () => context.revert()
  }, [loading, selectedFilter])

  const getGreeting = () => {
    const hour = brasiliaParts(currentTime).hour
    if (hour < 12) return 'Bom dia'
    if (hour < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <DashboardLayout>
      <div ref={dashboardRef} className="relative mx-auto max-w-[1520px] space-y-7 pb-8">
        <section className="surface-panel relative overflow-hidden rounded-3xl p-5 sm:p-7 lg:p-8">
          <div data-ambient-orb aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-electric-violet/10 blur-[90px]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-[12%] h-48 w-72 rounded-full bg-ember/[0.07] blur-[80px]" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-ember/30 to-transparent" />

          <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div data-hero-item className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.045] px-2.5 py-1 shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]">
                  <Radio className="h-3.5 w-3.5 text-success" />
                  Dados ao vivo
                </span>
                <span className="capitalize">{formatBrasiliaDate(currentTime, { weekday: 'long', day: 'numeric', month: 'long', year: undefined })}</span>
              </div>

              <h1 data-hero-item className="mt-5 text-balance text-[clamp(2rem,5vw,3.35rem)] font-light leading-[0.98] tracking-[-0.045em] text-white">
                {getGreeting()}, <span className="text-ash">{userName}</span>
              </h1>

              <p data-hero-item className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {isExecutive
                  ? 'Visão consolidada da operação comercial, das metas e da performance do time.'
                  : 'Sua performance comercial, metas e próximos movimentos em uma única visão.'}
              </p>
            </div>

            <div data-hero-item className="flex flex-wrap items-center gap-2.5">
              {userPosition > 0 && (
                <Badge className="h-10 gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3.5 text-xs font-medium text-ash hover:bg-white/[0.065]">
                  <Crown className="h-3.5 w-3.5 text-amber-400" />
                  #{userPosition} no ranking
                </Badge>
              )}

              <div className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/[0.035] px-3 text-xs tabular-nums text-muted-foreground shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]">
                <Activity className="h-3.5 w-3.5 text-electric" />
                {currentTime.toLocaleTimeString('pt-BR', { timeZone: BRASILIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>

              <Button
                onClick={() => refetch()}
                size="sm"
                className="h-10 rounded-lg border-0 bg-gradient-ember px-4 text-white shadow-none transition-opacity hover:opacity-90"
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </section>

        <section data-scroll-reveal><RecentSales /></section>

        <section data-scroll-reveal className="space-y-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-ember">
                <Flame className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.14em]">Performance</span>
              </div>
              <h2 className="mt-1.5 text-xl font-normal tracking-[-0.025em] text-white sm:text-2xl">Metas em andamento</h2>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">Tempo real · verificação a cada {AUTO_REFRESH_INTERVAL_LABEL}</span>
          </div>
          <GoalsProgress />
        </section>

        <section data-scroll-reveal className="sticky top-20 z-20 rounded-2xl border border-white/[0.05] bg-[#0e0918]/78 p-1.5 backdrop-blur-xl">
          <FilterTabs value={selectedFilter} onValueChange={setSelectedFilter} />
        </section>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}. Tente atualizar novamente.
          </div>
        )}

        <section data-scroll-reveal className="space-y-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Visão do período</span>
              <h2 className="mt-1.5 text-xl font-normal tracking-[-0.025em] text-white sm:text-2xl">Indicadores comerciais</h2>
            </div>
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Somente vendas aprovadas
            </span>
          </div>

        <div ref={metricsRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title="Total de Vendas"
            value={new Intl.NumberFormat('pt-BR', { 
              style: 'currency', 
              currency: 'BRL' 
            }).format(metrics.totalVendas)}
            subtitle="Receita aprovada no período"
            icon={<CircleDollarSign className="h-5 w-5" strokeWidth={1.8} />}
            gradient
            accent="ember"
            loading={loading}
          />
          
          <MetricCard
            title="Quantidade de Vendas"
            value={metrics.quantidadeVendas}
            subtitle="Negócios confirmados"
            icon={<ShoppingBag className="h-5 w-5" strokeWidth={1.8} />}
            accent="success"
            loading={loading}
          />
          
          <MetricCard
            title="Ticket Médio"
            value={new Intl.NumberFormat('pt-BR', { 
              style: 'currency', 
              currency: 'BRL' 
            }).format(metrics.ticketMedio)}
            subtitle="Receita média por venda"
            icon={<ChartSpline className="h-5 w-5" strokeWidth={1.8} />}
            accent="electric"
            loading={loading}
          />
          
          <MetricCard
            title="Abordagens"
            value={metrics.abordagens}
            subtitle="Contatos registrados"
            icon={<UsersRound className="h-5 w-5" strokeWidth={1.8} />}
            accent="neutral"
            loading={loading}
          />
          
          <MetricCard
            title="Taxa Conversão"
            value={`${metrics.conversao.toFixed(1)}%`}
            subtitle="Vendas por abordagem"
            icon={<Target className="h-5 w-5" strokeWidth={1.8} />}
            accent="electric"
            loading={loading}
          />
          
          <MetricCard
            title="Posição Ranking"
            value={userPosition > 0 ? `#${userPosition}` : '—'}
            subtitle={userPosition > 0 ? 'de ' + ranking.length + ' vendedores' : 'Ranking não iniciado'}
            icon={<Medal className="h-5 w-5" strokeWidth={1.8} />}
            accent="ember"
            loading={loading}
          />
        </div>
        </section>

        <section data-scroll-reveal><SalesBoard compact /></section>

        <section data-scroll-reveal className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <SalesChart data={metrics.vendasMes} loading={loading} />
            <ProductsRanking data={metrics.produtosMaisVendidos} loading={loading} />
          </div>
          
          <div className="space-y-4">
            <LeaderboardPreview />
            <QuickActions />
          </div>
        </section>
      </div>
    </DashboardLayout>
  )
}
