import { useQuery } from '@tanstack/react-query'
import { CheckCircle, Clock, DollarSign, ShoppingCart, TrendingUp } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent } from '@/components/ui/card'
import { CRMLinkedSale } from '@/components/crm/CRMLinkedSale'
import { RecentSalesManagement } from '@/components/sales/RecentSalesManagement'
import { useManagedSales } from '@/hooks/useManagedSales'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { supabase } from '@/integrations/supabase/client'
import { errorMessage, money } from '@/lib/sales'
import { AUTO_REFRESH_INTERVAL_MS } from '@/lib/sync'

export default function MinhasVendas() {
  const { user } = useAuth()
  const { commissionRate, loading: rolesLoading } = useRoles()
  const sales = useManagedSales(true)
  const balance = useQuery({
    queryKey: ['sales-balance', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_available_balance', { p_seller_id: user!.id })
      if (error) throw error
      return Number(data)
    },
    staleTime: 0,
    refetchInterval: AUTO_REFRESH_INTERVAL_MS,
  })
  const rows = sales.data ?? []
  const approved = rows.filter(sale => sale.approval_status === 'aprovada')
  const metrics = [
    { label: 'Vendas aprovadas', value: approved.length, icon: ShoppingCart },
    { label: 'Receita aprovada', value: money(approved.reduce((sum, sale) => sum + Number(sale.valor_venda), 0)), icon: DollarSign },
    { label: 'Comissão aprovada', value: money(approved.reduce((sum, sale) => sum + Number(sale.commission_amount ?? 0), 0)), icon: CheckCircle },
    { label: 'Disponível para saque', value: balance.isPending || balance.isError ? '—' : money(balance.data), icon: TrendingUp },
    { label: 'Comissão pendente', value: money(rows.filter(sale => sale.approval_status === 'pendente').reduce((sum, sale) => sum + Number(sale.valor_venda) * commissionRate / 100, 0)), icon: Clock },
  ]
  return <DashboardLayout>
    <CRMLinkedSale />
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
      <div><h1 className="flex items-center gap-3 text-3xl font-bold"><ShoppingCart className="h-8 w-8 text-primary" />Minhas Vendas</h1><p className="mt-2 text-sm text-muted-foreground">Acompanhe suas vendas e comissões.{!rolesLoading && ` Taxa de comissão: ${commissionRate}%.`}</p></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(metric => <Card key={metric.label} className="border-border/50"><CardContent className="p-4"><p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><metric.icon className="h-3.5 w-3.5" />{metric.label}</p><p className="text-lg font-semibold tabular-nums">{sales.isPending || sales.isError ? '—' : metric.value}</p></CardContent></Card>)}
      </div>
      {balance.isError && <p role="alert" className="text-sm text-destructive">Não foi possível atualizar o saldo: {errorMessage(balance.error)}</p>}
      <RecentSalesManagement mineOnly />
      <p className="rounded-xl border border-border/50 p-4 text-sm text-muted-foreground">Apenas comissões de vendas aprovadas entram no saldo disponível, descontando os valores comprometidos com saques. Vendas pendentes aguardam aprovação da administração.</p>
    </div>
  </DashboardLayout>
}
