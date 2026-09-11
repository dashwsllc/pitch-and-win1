import { useState, useEffect, useRef } from 'react'
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
import { errorMessage } from '@/lib/sales'
import { fetchAllPages } from '@/lib/supabase-pages'
import { addDaysToDateKey, brasiliaDateKey, formatBrasiliaDate, formatDateKey } from '@/lib/brasilia-time'

interface SellerSale {
  id: string
  nome_produto: string
  valor_venda: number
  created_at: string
}

interface SellerApproach {
  id: string
  nomes_abordados: string
  mostrou_ia: boolean
  tempo_medio_abordagem: number
  created_at: string
}

type SellerDay = {
  period: string
  vendas: number
  abordagens: number
  valor: number
};

interface SellerStats {
  totalSales: number
  totalRevenue: number
  totalApproaches: number
  totalSubscriptions: number
  activeSubscriptions: number
  conversionRate: number
  recentSales: SellerSale[]
  recentApproaches: SellerApproach[]
  salesByDay: SellerDay[]
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
  const [error, setError] = useState<string | null>(null)
  // Trocar de vendedor rapido dispara consultas concorrentes; so a ultima
  // pode escrever no estado.
  const latestRequest = useRef(0)

  const fetchSellerStats = async (sellerId: string) => {
    if (!sellerId) return
    const requestId = ++latestRequest.current

    setLoading(true)
    setError(null)
    
    try {
      // Buscar vendas do seller. Somente vendas aprovadas compoem faturamento,
      // conversao e ranking no restante do sistema.
      const [sales, approaches, subscriptions] = await Promise.all([
        fetchAllPages((from, to) => supabase
          .from('vendas')
          .select('id, nome_produto, valor_venda, created_at')
          .eq('user_id', sellerId)
          .eq('approval_status', 'aprovada')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)),
        fetchAllPages((from, to) => supabase
          .from('abordagens')
          .select('id, nomes_abordados, mostrou_ia, tempo_medio_abordagem, created_at')
          .eq('user_id', sellerId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)),
        fetchAllPages((from, to) => supabase
          .from('assinaturas')
          .select('id, status')
          .eq('user_id', sellerId)
          .order('id')
          .range(from, to)),
      ])

      const totalSales = sales.length
      const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.valor_venda), 0)
      const totalApproaches = approaches.length
      const totalSubscriptions = subscriptions.length
      const activeSubscriptions = subscriptions.filter(sub => sub.status === 'ativa').length
      const conversionRate = totalApproaches > 0 ? (totalSales / totalApproaches) * 100 : 0

      // Vendas dos últimos 7 dias
      const today = brasiliaDateKey()
      const salesByDay = Array.from({ length: 7 }, (_, index) => {
        const dateKey = addDaysToDateKey(today, index - 6)
        const daySales = sales.filter((sale) => brasiliaDateKey(sale.created_at) === dateKey)
        const dayApproaches = approaches.filter((approach) => brasiliaDateKey(approach.created_at) === dateKey)
        return {
          period: formatDateKey(dateKey, { day: '2-digit', month: '2-digit', year: undefined }),
          vendas: daySales.length,
          abordagens: dayApproaches.length,
          valor: daySales.reduce((sum, sale) => sum + Number(sale.valor_venda), 0)
        }
      })

      if (requestId !== latestRequest.current) return

      setStats({
        totalSales,
        totalRevenue,
        totalApproaches,
        totalSubscriptions,
        activeSubscriptions,
        conversionRate,
        recentSales: sales.slice(0, 5),
        recentApproaches: approaches.slice(0, 5),
        salesByDay
      })

    } catch (error) {
      console.error('Error fetching seller stats:', error)
      if (requestId === latestRequest.current) setError(errorMessage(error))
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
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
                    <SelectItem key={user.user_id} value={user.user_id}>
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

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar os indicadores deste vendedor: {error}
        </p>
      )}

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
                              {formatBrasiliaDate(sale.created_at)}
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
                          <p className="font-medium text-sm">Abordados: {approach.nomes_abordados}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBrasiliaDate(approach.created_at)}
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
