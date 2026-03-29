import { useState, useEffect } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Wallet, Clock, CheckCircle, DollarSign, Loader2, ArrowRight } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

export default function Saques() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [availableBalance, setAvailableBalance] = useState(0)
  const [pendingCommission, setPendingCommission] = useState(0)
  const [totalWithdrawn, setTotalWithdrawn] = useState(0)
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Form
  const [amount, setAmount] = useState('')
  const [pixKey, setPixKey] = useState('')
  const [pixKeyType, setPixKeyType] = useState('')
  const [holderName, setHolderName] = useState('')
  const [holderCpf, setHolderCpf] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const fetchData = async () => {
    if (!user) return
    setLoading(true)
    try {
      // Available balance from approved sales
      const { data: balanceData } = await supabase.rpc('get_available_balance', { p_seller_id: user.id })
      const balance = Number(balanceData) || 0

      // Pending commission (vendas pendentes)
      const { data: pendingVendas } = await supabase
        .from('vendas')
        .select('valor_venda')
        .eq('user_id', user.id)
        .eq('approval_status', 'pendente')
      
      const pending = (pendingVendas || []).reduce((s, v) => s + Number(v.valor_venda) * 0.10, 0)

      // Total withdrawn
      const { data: saquesData } = await supabase
        .from('saques')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      const withdrawn = (saquesData || [])
        .filter(s => s.status === 'aprovado' || s.status === 'processado')
        .reduce((s, w) => s + Number(w.valor_solicitado), 0)

      // Pending withdrawals
      const pendingWithdrawals = (saquesData || [])
        .filter(s => s.status === 'pendente')
        .reduce((s, w) => s + Number(w.valor_solicitado), 0)

      setAvailableBalance(Math.max(0, balance - withdrawn - pendingWithdrawals))
      setPendingCommission(pending)
      setTotalWithdrawn(withdrawn)
      setWithdrawals(saquesData || [])
    } catch (err) {
      console.error('Error fetching balance:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [user])

  const handleSubmit = async () => {
    const val = parseFloat(amount)
    if (!val || val <= 0) {
      toast({ title: 'Valor inválido', variant: 'destructive' })
      return
    }
    if (val > availableBalance) {
      toast({ title: 'Saldo insuficiente', description: 'O valor ultrapassa seu saldo disponível.', variant: 'destructive' })
      return
    }
    if (!pixKey.trim()) {
      toast({ title: 'Chave Pix obrigatória', variant: 'destructive' })
      return
    }
    if (!holderName.trim()) {
      toast({ title: 'Nome do titular obrigatório', variant: 'destructive' })
      return
    }

    setSubmitting(true)

    // Minimum UX delay
    await new Promise(r => setTimeout(r, 1500))

    try {
      const { error } = await supabase
        .from('saques')
        .insert({
          user_id: user!.id,
          valor_solicitado: val,
          chave_pix: pixKey.trim(),
          status: 'pendente',
          observacoes: `Tipo: ${pixKeyType || 'N/A'} | Titular: ${holderName} | CPF: ${holderCpf}`
        })

      if (error) throw error

      setShowSuccess(true)
      setAmount('')
      setPixKey('')
      setPixKeyType('')
      setHolderName('')
      setHolderCpf('')
      
      setTimeout(() => setShowSuccess(false), 6000)
      fetchData()
    } catch (err: any) {
      toast({ title: 'Erro ao solicitar saque', description: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente': return <Badge className="bg-blue-500/20 text-blue-400">🔄 Processando</Badge>
      case 'aprovado': case 'processado': return <Badge className="bg-green-500/20 text-green-400">✅ Pago</Badge>
      case 'rejeitado': return <Badge className="bg-red-500/20 text-red-400">❌ Rejeitado</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Wallet className="w-8 h-8 text-primary" />
            Meus Ganhos
          </h1>
          <p className="text-muted-foreground mt-1">Gerencie seus saques e comissões</p>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-green-500/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <DollarSign className="w-4 h-4 text-green-400" /> Disponível para saque
              </div>
              <p className="text-3xl font-bold text-green-400">
                {loading ? '...' : formatCurrency(availableBalance)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-yellow-500/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <Clock className="w-4 h-4 text-yellow-400" /> Pendente de aprovação
              </div>
              <p className="text-3xl font-bold text-yellow-400">
                {loading ? '...' : formatCurrency(pendingCommission)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <CheckCircle className="w-4 h-4 text-muted-foreground" /> Já sacado
              </div>
              <p className="text-3xl font-bold text-foreground">
                {loading ? '...' : formatCurrency(totalWithdrawn)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Withdrawal Form */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Solicitar Saque</CardTitle>
          </CardHeader>
          <CardContent>
            {showSuccess ? (
              <div className="text-center py-8 space-y-4 animate-fade-in">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-foreground">Solicitação enviada com sucesso!</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Seu saque foi registrado. O valor será liberado em sua conta em até 3 dias úteis após a confirmação pelo financeiro.
                </p>
                <Button variant="outline" onClick={() => setShowSuccess(false)}>
                  <ArrowRight className="w-4 h-4 mr-2" /> Ver meus saques
                </Button>
              </div>
            ) : submitting ? (
              <div className="text-center py-12 space-y-4 animate-fade-in">
                <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
                <p className="text-muted-foreground">Processando sua solicitação...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Saldo disponível: <span className="text-green-400 font-semibold">{formatCurrency(availableBalance)}</span></p>
                
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Valor a sacar *</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="0,00"
                        min={0}
                        max={availableBalance}
                      />
                      <Button variant="outline" size="sm" onClick={() => setAmount(availableBalance.toString())}>
                        Tudo
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo da chave Pix</Label>
                    <Select value={pixKeyType} onValueChange={setPixKeyType}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cpf">CPF</SelectItem>
                        <SelectItem value="cnpj">CNPJ</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="telefone">Telefone</SelectItem>
                        <SelectItem value="aleatoria">Chave aleatória</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Chave Pix *</Label>
                    <Input value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="Sua chave Pix" />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome do titular *</Label>
                    <Input value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Nome completo" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>CPF do titular</Label>
                    <Input value={holderCpf} onChange={e => setHolderCpf(e.target.value)} placeholder="000.000.000-00" />
                  </div>
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance || !pixKey.trim() || !holderName.trim()}
                  className="w-full bg-green-600 hover:bg-green-700 text-white h-12 text-base"
                >
                  Solicitar Saque
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Withdrawal History */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Histórico de Saques</CardTitle>
          </CardHeader>
          <CardContent>
            {withdrawals.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">Nenhum saque realizado ainda</p>
            ) : (
              <div className="space-y-3">
                {withdrawals.map(w => (
                  <div key={w.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium text-foreground">{formatCurrency(Number(w.valor_solicitado))}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(w.created_at).toLocaleDateString('pt-BR')} • Pix: {w.chave_pix}
                      </p>
                    </div>
                    {getStatusBadge(w.status)}
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
