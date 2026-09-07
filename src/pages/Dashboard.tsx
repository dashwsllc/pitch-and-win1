import { useState, useEffect, useRef } from "react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { SalesChart } from "@/components/dashboard/SalesChart"
import { ProductsRanking } from "@/components/dashboard/ProductsRanking"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { FilterTabs } from "@/components/dashboard/FilterTabs"
import { GoalsProgress } from "@/components/dashboard/GoalsProgress"
import { LeaderboardPreview } from "@/components/dashboard/LeaderboardPreview"
import { AnimatedCounter } from "@/components/dashboard/AnimatedCounter"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useDashboardData } from "@/hooks/useDashboardData"
import { useRankingDataWithMock } from "@/hooks/useRankingDataWithMock"
import { useAuth } from "@/hooks/useAuth"
import { useProfile } from "@/hooks/useProfile"
import { 
  DollarSign, 
  ShoppingCart, 
  TrendingUp, 
  Users,
  Target,
  Trophy,
  Flame,
  RefreshCw,
  Crown,
  Zap
} from "lucide-react"
import gsap from 'gsap'

export default function Dashboard() {
  const [selectedFilter, setSelectedFilter] = useState("hoje")
  const { user } = useAuth()
  const { metrics, loading, error, refetch } = useDashboardData(selectedFilter)
  const { ranking } = useRankingDataWithMock()
  const { profile } = useProfile()
  const metricsRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)

  const userName = profile?.display_name || user?.user_metadata?.display_name || user?.email?.split('@')[0] || "Usuário"
  const userPosition = ranking.findIndex(r => r.isCurrentUser) + 1
  
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // GSAP animations on mount
  useEffect(() => {
    if (!loading && metricsRef.current) {
      const cards = metricsRef.current.children
      gsap.fromTo(cards,
        { opacity: 0, y: 30, scale: 0.95 },
        { 
          opacity: 1, y: 0, scale: 1,
          duration: 0.5, stagger: 0.08,
          ease: 'power2.out'
        }
      )
    }
  }, [loading])

  useEffect(() => {
    if (heroRef.current) {
      gsap.fromTo(heroRef.current,
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
      )
    }
  }, [])

  const getGreeting = () => {
    const hour = currentTime.getHours()
    if (hour < 12) return 'Bom dia'
    if (hour < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Hero Header */}
        <div ref={heroRef} className="relative overflow-hidden rounded-2xl p-6 lg:p-8" style={{ background: 'linear-gradient(135deg, rgba(253, 137, 37, 0.08) 0%, rgba(107, 33, 239, 0.08) 100%)' }}>
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-ember/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-electric/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
          
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                <span className="text-border">•</span>
                <span className="tabular-nums font-medium text-foreground/70">
                  {currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              
              <h1 className="text-3xl lg:text-4xl font-light text-foreground tracking-tight">
                {getGreeting()}, <span className="font-semibold">{userName}</span>
              </h1>
              
              <p className="text-muted-foreground">
                Acompanhe sua performance e conquiste suas metas
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {userPosition > 0 && (
                <Badge 
                  className="px-4 py-2 text-sm font-semibold bg-gradient-ember text-white border-0 animate-float"
                >
                  <Crown className="w-4 h-4 mr-1.5" />
                  #{userPosition} no Ranking
                </Badge>
              )}
              
              <Button 
                onClick={() => refetch()} 
                variant="outline"
                size="sm"
                className="border-border/50 hover:border-ember/30 hover:bg-ember/5"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </div>

        {/* Goals Progress Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-ember" />
            <h2 className="text-lg font-semibold text-foreground">Metas de Performance</h2>
          </div>
          <GoalsProgress />
        </div>

        {/* Filter Tabs */}
        <FilterTabs 
          value={selectedFilter} 
          onValueChange={setSelectedFilter} 
        />

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}. Tente atualizar novamente.
          </div>
        )}

        {/* Métricas principais */}
        <div ref={metricsRef} className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-3">
          <MetricCard
            title="Total de Vendas"
            value={new Intl.NumberFormat('pt-BR', { 
              style: 'currency', 
              currency: 'BRL' 
            }).format(metrics.totalVendas)}
            icon={<DollarSign className="w-7 h-7" />}
            trend={{ value: 12.5, isPositive: true }}
            gradient
            loading={loading}
          />
          
          <MetricCard
            title="Quantidade de Vendas"
            value={metrics.quantidadeVendas}
            icon={<ShoppingCart className="w-7 h-7" />}
            trend={{ value: 8.2, isPositive: true }}
            loading={loading}
          />
          
          <MetricCard
            title="Ticket Médio"
            value={new Intl.NumberFormat('pt-BR', { 
              style: 'currency', 
              currency: 'BRL' 
            }).format(metrics.ticketMedio)}
            icon={<TrendingUp className="w-7 h-7" />}
            trend={{ value: 5.1, isPositive: true }}
            loading={loading}
          />
          
          <MetricCard
            title="Abordagens"
            value={metrics.abordagens}
            icon={<Users className="w-7 h-7" />}
            trend={{ value: -2.4, isPositive: false }}
            loading={loading}
          />
          
          <MetricCard
            title="Taxa Conversão"
            value={`${metrics.conversao.toFixed(1)}%`}
            icon={<Target className="w-7 h-7" />}
            trend={{ value: 15.8, isPositive: true }}
            loading={loading}
          />
          
          <MetricCard
            title="Posição Ranking"
            value={userPosition > 0 ? `#${userPosition}` : '—'}
            subtitle={userPosition > 0 ? 'de ' + ranking.length + ' vendedores' : 'Ranking não iniciado'}
            icon={<Trophy className="w-7 h-7" />}
            className={userPosition > 0 && userPosition <= 3 ? 'animate-glow-ember' : ''}
            loading={loading}
          />
        </div>

        {/* Gráficos e Leaderboard */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <SalesChart data={metrics.vendasMes} loading={loading} />
            <ProductsRanking data={metrics.produtosMaisVendidos} loading={loading} />
          </div>
          
          <div className="space-y-6">
            <LeaderboardPreview />
            <QuickActions />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
