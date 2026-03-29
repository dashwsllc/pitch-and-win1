import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CheckCircle, XCircle, Clock, Loader2, DollarSign } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

interface Sale {
  id: string
  user_id: string
  nome_produto: string
  valor_venda: number
  nome_comprador: string
  email_comprador: string
  whatsapp_comprador: string
  approval_status: string
  commission_amount: number
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  seller_name?: string
}

export function ExecutiveSalesApproval() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectDialogSale, setRejectDialogSale] = useState<Sale | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const fetchSales = async () => {
    setLoading(true)
    try {
      const { data: salesData, error } = await supabase
        .from('vendas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error

      // Get profiles for names
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')

      const profileMap = new Map<string, string>()
      profiles?.forEach(p => profileMap.set(p.user_id, p.display_name || 'Usuário'))

      const enriched = (salesData || []).map(s => ({
        ...s,
        seller_name: profileMap.get(s.user_id) || 'Vendedor'
      })) as Sale[]

      setSales(enriched)
    } catch (err) {
      console.error('Error fetching sales:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSales() }, [])

  const approveSale = async (sale: Sale) => {
    setProcessing(sale.id)
    try {
      const commissionAmount = Number(sale.valor_venda) * 0.10 // 10% commission

      const { error } = await supabase
        .from('vendas')
        .update({
          approval_status: 'aprovada',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          commission_amount: commissionAmount
        } as any)
        .eq('id', sale.id)

      if (error) throw error

      toast({ title: 'Venda aprovada!', description: `Comissão de R$ ${commissionAmount.toFixed(2)} liberada.` })
      fetchSales()
    } catch (err: any) {
      toast({ title: 'Erro ao aprovar', description: err.message, variant: 'destructive' })
    } finally {
      setProcessing(null)
    }
  }

  const rejectSale = async () => {
    if (!rejectDialogSale || !rejectionReason.trim()) {
      toast({ title: 'Motivo obrigatório', variant: 'destructive' })
      return
    }
    setProcessing(rejectDialogSale.id)
    try {
      const { error } = await supabase
        .from('vendas')
        .update({
          approval_status: 'rejeitada',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejectionReason.trim()
        } as any)
        .eq('id', rejectDialogSale.id)

      if (error) throw error

      toast({ title: 'Venda rejeitada' })
      setRejectDialogSale(null)
      setRejectionReason('')
      fetchSales()
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setProcessing(null)
    }
  }

  const pending = sales.filter(s => s.approval_status === 'pendente')
  const reviewed = sales.filter(s => s.approval_status !== 'pendente')

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente': return <Badge className="bg-yellow-500/20 text-yellow-400"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>
      case 'aprovada': return <Badge className="bg-green-500/20 text-green-400"><CheckCircle className="w-3 h-3 mr-1" />Aprovada</Badge>
      case 'rejeitada': return <Badge className="bg-red-500/20 text-red-400"><XCircle className="w-3 h-3 mr-1" />Rejeitada</Badge>
      default: return null
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Aprovação de Vendas
          {pending.length > 0 && (
            <Badge className="bg-yellow-500/20 text-yellow-400 ml-2">{pending.length} pendentes</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending">Pendentes ({pending.length})</TabsTrigger>
            <TabsTrigger value="history">Histórico ({reviewed.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-3 mt-4">
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-muted rounded animate-pulse" />)}
              </div>
            ) : pending.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Nenhuma venda pendente de aprovação</p>
            ) : (
              pending.map(sale => (
                <div key={sale.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-foreground">{sale.seller_name}</p>
                      <p className="text-sm text-muted-foreground">{sale.nome_produto}</p>
                      <p className="text-sm text-muted-foreground">
                        Cliente: {sale.nome_comprador} • {new Date(sale.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-foreground">{formatCurrency(Number(sale.valor_venda))}</p>
                      <p className="text-xs text-muted-foreground">Comissão: {formatCurrency(Number(sale.valor_venda) * 0.10)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setRejectDialogSale(sale); setRejectionReason('') }}
                      disabled={processing === sale.id}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Rejeitar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => approveSale(sale)}
                      disabled={processing === sale.id}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {processing === sale.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                      Aprovar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-3 mt-4">
            {reviewed.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Nenhuma venda revisada ainda</p>
            ) : (
              reviewed.map(sale => (
                <div key={sale.id} className="p-4 border rounded-lg flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-foreground text-sm">{sale.seller_name}</p>
                      {getStatusBadge(sale.approval_status)}
                    </div>
                    <p className="text-xs text-muted-foreground">{sale.nome_produto} • {sale.nome_comprador}</p>
                    {sale.rejection_reason && (
                      <p className="text-xs text-red-400 mt-1">Motivo: {sale.rejection_reason}</p>
                    )}
                  </div>
                  <p className="font-semibold text-foreground">{formatCurrency(Number(sale.valor_venda))}</p>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialogSale} onOpenChange={() => setRejectDialogSale(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Venda</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição da venda de {rejectDialogSale?.seller_name} ({formatCurrency(Number(rejectDialogSale?.valor_venda || 0))})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo da rejeição *</Label>
            <Textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="Explique o motivo da rejeição..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogSale(null)}>Cancelar</Button>
            <Button onClick={rejectSale} disabled={!!processing} className="bg-destructive text-destructive-foreground">
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Confirmar Rejeição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// Need Label import
import { Label } from '@/components/ui/label'
