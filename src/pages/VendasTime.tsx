import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { SalesBoard } from '@/components/sales/SalesBoard'

export default function VendasTime() {
  return <DashboardLayout><div className="mx-auto max-w-[1400px] space-y-6"><div><h1 className="text-3xl font-light tracking-tight text-white">O time em movimento</h1><p className="mt-2 text-sm text-muted-foreground">Acompanhe as solicitações e as vendas aprovadas de todos os vendedores.</p></div><SalesBoard /></div></DashboardLayout>
}
