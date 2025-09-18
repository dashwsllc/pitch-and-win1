import { useState } from "react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { MetricCard } from "@/components/dashboard/MetricCard"
import { SalesChart } from "@/components/dashboard/SalesChart"
import { ProductsRanking } from "@/components/dashboard/ProductsRanking"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { FilterTabs } from "@/components/dashboard/FilterTabs"
import { useDashboardData } from "@/hooks/useDashboardData"
import { useRankingDataWithMock } from "@/hooks/useRankingDataWithMock"
import { useAuth } from "@/hooks/useAuth"
import { 
  DollarSign, 
  ShoppingCart, 
  TrendingUp, 
  Users,
  Target,
  Clock
} from "lucide-react"

export default function Dashboard() {
  const [selectedFilter, setSelectedFilter] = useState("hoje")
  const { user } = useAuth()
  const { metrics, loading } = useDashboardData(selectedFilter)
  const { ranking } = useRankingDataWithMock()

  const userName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || "Usuário"
  const userPosition = ranking.findIndex(r => r.isCurrentUser) + 1

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Bem-vindo de volta, {userName}! 👋
              </h1>
              <p className="text-muted-foreground mt-1">
                Aqui está um resumo da sua performance de vendas
              </p>
            </div>
          </div>
          
          <FilterTabs 
            value={selectedFilter} 
            onValueChange={setSelectedFilter} 
          />
        </div>

        {/* Métricas principais */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            title="Total de Vendas"
            value={new Intl.NumberFormat('pt-BR', { 
              style: 'currency', 
              currency: 'BRL' 
            }).format(metrics.totalVendas)}
            icon={<DollarSign className="w-6 h-6" />}
            trend={{ value: 12.5, isPositive: true }}
            gradient
            loading={loading}
          />
          
          <MetricCard
            title="Quantidade de Vendas"
            value={metrics.quantidadeVendas}
            icon={<ShoppingCart className="w-6 h-6" />}
            trend={{ value: 8.2, isPositive: true }}
            loading={loading}
          />
          
          <MetricCard
            title="Ticket Médio"
            value={new Intl.NumberFormat('pt-BR', { 
              style: 'currency', 
              currency: 'BRL' 
            }).format(metrics.ticketMedio)}
            icon={<TrendingUp className="w-6 h-6" />}
            trend={{ value: 5.1, isPositive: true }}
            loading={loading}
          />
          
          <MetricCard
            title="Abordagens"
            value={metrics.abordagens}
            icon={<Users className="w-6 h-6" />}
            trend={{ value: -2.4, isPositive: false }}
            loading={loading}
          />
          
          <MetricCard
            title="Taxa Conversão"
            value={`${metrics.conversao.toFixed(1)}%`}
            icon={<Target className="w-6 h-6" />}
            trend={{ value: 15.8, isPositive: true }}
            loading={loading}
          />
          
          <MetricCard
            title="Posição Ranking"
            value="—"
            subtitle="Ranking ainda não iniciado"
            icon={<Clock className="w-6 h-6" />}
            className="animate-pulse-glow"
            loading={loading}
          />
        </div>

        {/* Gráficos e ações */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <SalesChart data={metrics.vendasMes} loading={loading} />
            <ProductsRanking data={metrics.produtosMaisVendidos} loading={loading} />
          </div>
          
          <div>
            <QuickActions />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}