import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Users, 
  DollarSign, 
  MessageSquare, 
  Trophy, 
  TrendingUp, 
  RefreshCw,
  UserCheck,
  UserX,
  Settings,
  Shield
} from 'lucide-react'
import { useExecutiveDashboard } from '@/hooks/useExecutiveDashboard'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { SalesChart } from '@/components/dashboard/SalesChart'
import { FilterTabs } from '@/components/dashboard/FilterTabs'
import { ExecutiveUserManagement } from '@/components/executive/ExecutiveUserManagement'
import { ExecutivePasswordRequests } from '@/components/executive/ExecutivePasswordRequests'
import { ExecutiveSellerDetails } from '@/components/executive/ExecutiveSellerDetails'

export default function ExecutiveDashboard() {
  const [selectedFilter, setSelectedFilter] = useState('30dias')
  const { data, loading, refetch } = useExecutiveDashboard(selectedFilter)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Dashboard Executive</h1>
            <p className="text-muted-foreground">Visão geral completa do negócio</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={refetch} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Badge variant="secondary" className="bg-gradient-primary text-white">
              <Shield className="w-3 h-3 mr-1" />
              Executive
            </Badge>
          </div>
        </div>

        {/* Filter Tabs */}
        <FilterTabs value={selectedFilter} onValueChange={setSelectedFilter} />

        {/* Main Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Total de Vendedores"
            value={data.totalSellers.toString()}
            icon={<Users className="w-5 h-5" />}
            loading={loading}
          />
          <MetricCard
            title="Vendas Totais"
            value={data.totalSales.toString()}
            icon={<DollarSign className="w-5 h-5" />}
            loading={loading}
          />
          <MetricCard
            title="Faturamento Total"
            value={formatCurrency(data.totalRevenue)}
            icon={<TrendingUp className="w-5 h-5" />}
            loading={loading}
          />
          <MetricCard
            title="Taxa de Conversão"
            value={formatPercent(data.conversionRate)}
            icon={<Trophy className="w-5 h-5" />}
            loading={loading}
          />
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            title="Total de Abordagens"
            value={data.totalApproaches.toString()}
            icon={<MessageSquare className="w-5 h-5" />}
            loading={loading}
          />
          <MetricCard
            title="Assinaturas Ativas"
            value={data.activeSubscriptions.toString()}
            subtitle={`${data.totalSubscriptions} total`}
            icon={<UserCheck className="w-5 h-5" />}
            loading={loading}
          />
          <MetricCard
            title="Assinaturas Inativas"
            value={(data.totalSubscriptions - data.activeSubscriptions).toString()}
            icon={<UserX className="w-5 h-5" />}
            loading={loading}
          />
        </div>

        {/* Charts and Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SalesChart data={data.salesByPeriod} loading={loading} />
          
          <Card>
            <CardHeader>
              <CardTitle>Top Vendedores</CardTitle>
              <CardDescription>Melhores performers do período</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {data.topSellers.map((seller, index) => (
                    <div key={seller.seller_name} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-primary text-white text-sm font-semibold flex items-center justify-center">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{seller.seller_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {seller.total_sales} vendas • {formatPercent(seller.conversion_rate)} conv.
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-foreground">{formatCurrency(seller.total_revenue)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Management Tabs */}
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="users">Gerenciar Usuários</TabsTrigger>
            <TabsTrigger value="passwords">Redefinir Senhas</TabsTrigger>
            <TabsTrigger value="details">Detalhes por Vendedor</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <ExecutiveUserManagement />
          </TabsContent>

          <TabsContent value="passwords">
            <ExecutivePasswordRequests />
          </TabsContent>

          <TabsContent value="details">
            <ExecutiveSellerDetails />
          </TabsContent>
        </Tabs>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Atividade Recente</CardTitle>
            <CardDescription>Últimas ações dos vendedores</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {data.recentActivity.map((activity, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      activity.type === 'sale' ? 'bg-green-100 text-green-600' :
                      activity.type === 'approach' ? 'bg-blue-100 text-blue-600' :
                      'bg-orange-100 text-orange-600'
                    }`}>
                      {activity.type === 'sale' ? <DollarSign className="w-4 h-4" /> :
                       activity.type === 'approach' ? <MessageSquare className="w-4 h-4" /> :
                       <UserCheck className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{activity.seller_name}</p>
                      <p className="text-xs text-muted-foreground">{activity.details}</p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(activity.created_at).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}