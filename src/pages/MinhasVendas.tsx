import { useState, useEffect, useMemo } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  ShoppingCart, Clock, CheckCircle, XCircle, DollarSign,
  RefreshCw, Info, Trash2, TrendingUp, AlertCircle
} from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { useToast } from '@/hooks/use-toast'

interface Venda {
  id: string
  nome_produto: string
  valor_venda: number
  nome_comprador: string
  email_comprador: string
  whatsapp_comprador: string
  approval_status: string
  commission_amount: number | null
  rejection_reason: string | null
  reviewed_at: string | null
  created_at: string
  withdrawn: boolean
}

export default function MinhasVendas() {
  const { user } = useAuth()
  const { commissionRate, loading: rolesLoading } = useRoles()
  const { toast } = useToast()

  const [vendas, setVendas] = useState<Venda[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<Venda | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [rejectionDetail, setRejectionDetail] = useState<Venda | null>(null)

  const fetchVendas = async () => {
    if (!user) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('vendas')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error
      setVendas((data || []) as Venda[])
    } catch (err: any) {
      console.error('Error fetching vendas:', err)
      toast({ title: 'Erro ao carregar vendas', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchVendas() }, [user])

  // Realtime subscription
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`minhas-vendas-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'vendas',
        filter: `user_id=eq.${user.id}`
      }, () => fetchVendas())
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [user])

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('vendas')
        .delete()
        .eq('id', deleteConfirm.id)
        .eq('user_id', user!.id)
        .eq('approval_status', 'pendente')

      if (error) throw error
      toast({ title: 'Venda excluída com sucesso' })
      setDeleteConfirm(null)
      fetchVendas()
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err.message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  // KPI calculations
  const kpis = useMemo(() => {
    const total = vendas.length
    const volumeTotal = vendas.reduce((s, v) => s + Number(v.valor_venda), 0)
    const comissaoAprovada = vendas
      .filter(v => v.approval_status === 'aprovada')
      .reduce((s, v) => s + (Number(v.commission_amount) || Number(v.valor_venda) * commissionRate / 100), 0)
    const disponivelSaque = vendas
      .filter(v => v.approval_status === 'aprovada' && !v.withdrawn)
      .reduce((s, v) => s + (Number(v.commission_amount) || Number(v.valor_venda) * commissionRate / 100), 0)
    const pendente = vendas
      .filter(v => v.approval_status === 'pendente')
      .reduce((s, v) => s + (Number(v.commission_amount) || Number(v.valor_venda) * commissionRate / 100), 0)

    return { total, volumeTotal, comissaoAprovada, disponivelSaque, pendente }
  }, [vendas, commissionRate])

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>
      case 'aprovada':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Aprovada</Badge>
      case 'rejeitada':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Rejeitada</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <ShoppingCart className="w-8 h-8 text-primary" />
              Minhas Vendas
            </h1>
            <p className="text-muted-foreground mt-1">
              Acompanhe o status das suas vendas e comissões
              {!rolesLoading && <span className="ml-2 text-primary font-medium">• Taxa de comissão: {commissionRate}%</span>}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchVendas} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <ShoppingCart className="w-3.5 h-3.5" /> Total de vendas
              </div>
              <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <DollarSign className="w-3.5 h-3.5" /> Volume total
              </div>
              <p className="text-sm font-bold text-foreground">{formatCurrency(kpis.volumeTotal)}</p>
            </CardContent>
          </Card>
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <CheckCircle className="w-3.5 h-3.5 text-green-400" /> Comissão aprovada
              </div>
              <p className="text-sm font-bold text-green-400">{formatCurrency(kpis.comissaoAprovada)}</p>
            </CardContent>
          </Card>
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-green-400" /> Disponível p/ saque
              </div>
              <p className="text-sm font-bold text-green-400">{formatCurrency(kpis.disponivelSaque)}</p>
            </CardContent>
          </Card>
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <Clock className="w-3.5 h-3.5 text-yellow-400" /> Pendente aprovação
              </div>
              <p className="text-sm font-bold text-yellow-400">{formatCurrency(kpis.pendente)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabela de Vendas */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Minhas Vendas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-3 p-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : vendas.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Nenhuma venda registrada ainda</p>
                <p className="text-sm mt-1">Registre sua primeira venda para começar a acompanhar suas comissões</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left p-3 font-medium">Data</th>
                      <th className="text-left p-3 font-medium">Cliente</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Produto</th>
                      <th className="text-left p-3 font-medium">Valor</th>
                      <th className="text-left p-3 font-medium">Comissão</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendas.map(v => {
                      const commissionValue = Number(v.commission_amount) || Number(v.valor_venda) * commissionRate / 100
                      return (
                        <tr key={v.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="p-3 text-muted-foreground text-xs">
                            {new Date(v.created_at).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="p-3">
                            <p className="font-medium text-foreground">{v.nome_comprador}</p>
                            {v.email_comprador && (
                              <p className="text-xs text-muted-foreground">{v.email_comprador}</p>
                            )}
                          </td>
                          <td className="p-3 hidden md:table-cell text-muted-foreground">
                            {v.nome_produto}
                          </td>
                          <td className="p-3 font-semibold text-foreground">
                            {formatCurrency(Number(v.valor_venda))}
                          </td>
                          <td className="p-3">
                            <p className={`font-medium ${v.approval_status === 'aprovada' ? 'text-green-400' : 'text-muted-foreground'}`}>
                              {formatCurrency(commissionValue)}
                            </p>
                            <p className="text-xs text-muted-foreground">{commissionRate}%</p>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              {getStatusBadge(v.approval_status)}
                              {v.approval_status === 'rejeitada' && v.rejection_reason && (
                                <button
                                  onClick={() => setRejectionDetail(v)}
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title="Ver motivo da rejeição"
                                >
                                  <Info className="w-4 h-4" />
                                </button>
                              )}
                              {v.approval_status === 'aprovada' && v.withdrawn && (
                                <Badge variant="outline" className="text-xs">Sacado</Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            {v.approval_status === 'pendente' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteConfirm(v)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Banner informativo */}
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Como funciona o saldo disponível?</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Apenas comissões de vendas com status <span className="text-green-400 font-medium">Aprovada</span> e ainda não sacadas
                são contabilizadas no saldo disponível para saque. Vendas com status <span className="text-yellow-400 font-medium">Pendente</span> aguardam aprovação do executive.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modal de motivo de rejeição */}
      <Dialog open={!!rejectionDetail} onOpenChange={() => setRejectionDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" />
              Motivo da Rejeição
            </DialogTitle>
            <DialogDescription>
              Venda rejeitada: {rejectionDetail?.nome_produto} — {rejectionDetail?.nome_comprador}
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
            <p className="text-sm text-foreground">{rejectionDetail?.rejection_reason}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Rejeitado em: {rejectionDetail?.reviewed_at
              ? new Date(rejectionDetail.reviewed_at).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
                })
              : '—'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectionDetail(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmação de exclusão */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Venda</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a venda de <strong>{deleteConfirm?.nome_comprador}</strong>
              {' '}({formatCurrency(Number(deleteConfirm?.valor_venda || 0))})? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Excluindo...' : 'Excluir Venda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
