import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { 
  User, 
  DollarSign, 
  MessageSquare, 
  UserCheck,
  TrendingUp,
  Calendar,
  RefreshCw
} from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAllUsers } from '@/hooks/useRoles'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { SalesChart } from '@/components/dashboard/SalesChart'

interface SellerStats {
  totalSales: number
  totalRevenue: number
  totalApproaches: number
  totalSubscriptions: number
  activeSubscriptions: number
  conversionRate: number
  recentSales: any[]
  recentApproaches: any[]
  salesByDay: any[]
}

export function ExecutiveSellerDetails() {
  const { users, loading: usersLoading } = useAllUsers()
  const [selectedSeller, setSelectedSeller] = useState<string>('')
  const [stats, setStats] = useState<SellerStats>({
    totalSales: 0,
    totalRevenue: 0,
    totalApproaches: 0,
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    conversionRate: 0,
    recentSales: [],
    recentApproaches: [],
    salesByDay: []
  })
  const [loading, setLoading] = useState(false)

  const fetchSellerStats = async (sellerId: string) => {
    if (!sellerId) return

    setLoading(true)
    
    try {
      // Buscar vendas do seller
      const { data: sales } = await supabase
        .from('vendas')
        .select('*')
        .eq('user_id', sellerId)
        .order('created_at', { ascending: false })

      // Buscar abordagens do seller
      const { data: approaches } = await supabase
        .from('abordagens')
        .select('*')
        .eq('user_id', sellerId)
        .order('created_at', { ascending: false })

      // Buscar assinaturas do seller
      const { data: subscriptions } = await supabase
        .from('assinaturas')
        .select('*')
        .eq('user_id', sellerId)

      const totalSales = sales?.length || 0
      const totalRevenue = sales?.reduce((sum, sale) => sum + Number(sale.valor_venda), 0) || 0
      const totalApproaches = approaches?.length || 0
      const totalSubscriptions = subscriptions?.length || 0
      const activeSubscriptions = subscriptions?.filter(sub => sub.status === 'ativa').length || 0
      const conversionRate = totalApproaches > 0 ? (totalSales / totalApproaches) * 100 : 0

      // Vendas dos últimos 7 dias
      const salesByDay = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        
        const daySales = sales?.filter(sale => 
          sale.created_at.startsWith(dateStr)
        ) || []
        
        const dayApproaches = approaches?.filter(approach => 
          approach.created_at.startsWith(dateStr)
        ) || []
        
        salesByDay.push({
          period: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          vendas: daySales.length,
          abordagens: dayApproaches.length,
          valor: daySales.reduce((sum, sale) => sum + Number(sale.valor_venda), 0)
        })
      }

      setStats({
        totalSales,
        totalRevenue,
        totalApproaches,
        totalSubscriptions,
        activeSubscriptions,
        conversionRate,
        recentSales: sales?.slice(0, 5) || [],
        recentApproaches: approaches?.slice(0, 5) || [],
        salesByDay
      })

    } catch (error) {
      console.error('Error fetching seller stats:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedSeller) {
      fetchSellerStats(selectedSeller)
    }
  }, [selectedSeller])

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`
  }

  const selectedUser = users.find(user => user.user_id === selectedSeller)

  return (
    <div className="space-y-6">
      {/* User Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Detalhes por Vendedor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um vendedor para ver os detalhes" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.user_id}>
                      {user.display_name || user.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedSeller && (
              <Button 
                onClick={() => fetchSellerStats(selectedSeller)}
                variant="outline" 
                size="sm"
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedSeller && (
        <>
          {/* Seller Info */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-primary text-white text-lg font-semibold flex items-center justify-center">
                  {(selectedUser?.display_name || selectedUser?.user_id || 'U').substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {selectedUser?.display_name || 'Vendedor'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    ID: {selectedUser?.user_id?.substring(0, 8)}...
                  </p>
                </div>
                <Badge variant="secondary" className="ml-auto">
                  <UserCheck className="w-3 h-3 mr-1" />
                  Seller
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <MetricCard
              title="Total de Vendas"
              value={stats.totalSales.toString()}
              icon={<DollarSign className="w-5 h-5" />}
              loading={loading}
            />
            <MetricCard
              title="Faturamento Total"
              value={formatCurrency(stats.totalRevenue)}
              icon={<TrendingUp className="w-5 h-5" />}
              loading={loading}
            />
            <MetricCard
              title="Taxa de Conversão"
              value={formatPercent(stats.conversionRate)}
              icon={<MessageSquare className="w-5 h-5" />}
              loading={loading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <MetricCard
              title="Total de Abordagens"
              value={stats.totalApproaches.toString()}
              icon={<MessageSquare className="w-5 h-5" />}
              loading={loading}
            />
            <MetricCard
              title="Assinaturas Ativas"
              value={stats.activeSubscriptions.toString()}
              subtitle={`${stats.totalSubscriptions} total`}
              icon={<UserCheck className="w-5 h-5" />}
              loading={loading}
            />
            <MetricCard
              title="Assinaturas Inativas"
              value={(stats.totalSubscriptions - stats.activeSubscriptions).toString()}
              icon={<UserCheck className="w-5 h-5" />}
              loading={loading}
            />
          </div>

          {/* Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SalesChart data={stats.salesByDay} loading={loading} />
            
            <Card>
              <CardHeader>
                <CardTitle>Vendas Recentes</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.recentSales.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhuma venda encontrada.
                      </p>
                    ) : (
                      stats.recentSales.map((sale, index) => (
                        <div key={index} className="flex items-center justify-between p-3 border rounded">
                          <div>
                            <p className="font-medium text-sm">{sale.nome_produto}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(sale.created_at).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <p className="font-semibold text-foreground">
                            {formatCurrency(Number(sale.valor_venda))}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Abordagens Recentes</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.recentApproaches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhuma abordagem encontrada.
                    </p>
                  ) : (
                    stats.recentApproaches.map((approach, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <p className="font-medium text-sm">{approach.nomes_abordados} pessoas abordadas</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(approach.created_at).toLocaleDateString('pt-BR')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {approach.mostrou_ia ? 'Mostrou IA' : 'Não mostrou IA'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {approach.tempo_medio_abordagem}min
                          </p>
                          <p className="text-xs text-muted-foreground">
                            tempo médio
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}