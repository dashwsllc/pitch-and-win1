import { useState, useEffect, useRef } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Wallet, Clock, CheckCircle, DollarSign, Loader2, ArrowRight,
  TrendingDown, RefreshCw, AlertCircle, Calendar, XCircle
} from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

export default function Saques() {
  const { user } = useAuth()
  const { toast } = useToast()
  const historyRef = useRef<HTMLDivElement>(null)

  const [availableBalance, setAvailableBalance] = useState(0)
  const [pendingCommission, setPendingCommission] = useState(0)
  const [totalWithdrawn, setTotalWithdrawn] = useState(0)
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [amount, setAmount] = useState('')
  const [pixKey, setPixKey] = useState('')
  const [pixKeyType, setPixKeyType] = useState('')
  const [holderName, setHolderName] = useState('')
  const [holderCpf, setHolderCpf] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successAmount, setSuccessAmount] = useState(0)

  // Inline validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})

  const fetchData = async () => {
    if (!user) return
    setLoading(true)
    try {
      // ✅ RPC retorna APENAS comissões aprovadas e não sacadas (withdrawn = false)
      const { data: balanceData, error: balanceError } = await supabase
        .rpc('get_available_balance', { p_seller_id: user.id })
      if (balanceError) console.error('Erro ao buscar saldo disponível:', balanceError)
      const balance = Number(balanceData) || 0

      // ✅ Comissão pendente via RPC segura
      const { data: pendingData, error: pendingError } = await supabase
        .rpc('get_pending_commission', { p_seller_id: user.id })
      if (pendingError) {
        // Fallback: calcular manualmente
        const { data: pendingVendas } = await supabase
          .from('vendas')
          .select('commission_amount, valor_venda')
          .eq('user_id', user.id)
          .eq('approval_status', 'pendente')
        const pending = (pendingVendas || []).reduce((s, v) => {
          return s + (Number(v.commission_amount) || 0)
        }, 0)
        setPendingCommission(pending)
      } else {
        setPendingCommission(Number(pendingData) || 0)
      }

      // ✅ Histórico de saques — usando schema correto da tabela saques
      const { data: saquesData, error: saquesError } = await supabase
        .from('saques')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (saquesError) console.error('Erro ao buscar saques:', saquesError)

      // ✅ Total sacado = apenas status 'pago' (enviado para conta)
      const withdrawn = (saquesData || [])
        .filter(s => s.status === 'pago')
        .reduce((s, w) => s + Number(w.valor_solicitado || 0), 0)

      setAvailableBalance(balance)
      setTotalWithdrawn(withdrawn)
      setWithdrawals(saquesData || [])
    } catch (err) {
      console.error('Error fetching balance:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [user])

  // ✅ Realtime: atualiza saldo quando vendas ou saques mudam
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`saques-realtime-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'vendas',
        filter: `user_id=eq.${user.id}`
      }, () => fetchData())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'saques',
        filter: `user_id=eq.${user.id}`
      }, () => fetchData())
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [user])

  const formatCpf = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 11)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
  }

  const isValidCpf = (cpf: string) => {
    const digits = cpf.replace(/\D/g, '')
    return digits.length === 11
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    const val = parseFloat(amount)
    if (!amount || isNaN(val) || val <= 0) newErrors.amount = 'Informe um valor válido'
    else if (val > availableBalance) newErrors.amount = `Valor máximo disponível: ${formatCurrency(availableBalance)}`
    if (!pixKey.trim()) newErrors.pixKey = 'Chave Pix obrigatória'
    if (!pixKeyType) newErrors.pixKeyType = 'Selecione o tipo da chave'
    if (!holderName.trim()) newErrors.holderName = 'Nome do titular obrigatório'
    if (!holderCpf.trim()) newErrors.holderCpf = 'CPF obrigatório'
    else if (!isValidCpf(holderCpf)) newErrors.holderCpf = 'CPF inválido — deve ter 11 dígitos'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validateForm()) return
    const val = parseFloat(amount)
    setSubmitting(true)
    setSuccessAmount(val)

    // UX mínimo de 1.5s para dar sensação de processamento real
    await new Promise(r => setTimeout(r, 1500))

    try {
      const { error } = await supabase
        .from('saques')
        .insert({
          user_id: user!.id,
          valor_solicitado: val,
          chave_pix: pixKey.trim(),
          tipo_chave_pix: pixKeyType,
          nome_titular: holderName.trim(),
          cpf_titular: holderCpf.replace(/\D/g, ''),
          status: 'pendente',
        })

      if (error) throw error

      setShowSuccess(true)
      setAmount('')
      setPixKey('')
      setPixKeyType('')
      setHolderName('')
      setHolderCpf('')
      setErrors({})

      // Auto-fechar confirmação após 6 segundos
      setTimeout(() => setShowSuccess(false), 6000)
      fetchData()
    } catch (err: any) {
      toast({ title: 'Erro ao solicitar saque', description: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente':
      case 'processando':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">🔄 Processando</Badge>
      case 'aprovado':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">✅ Aprovado</Badge>
      case 'pago':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">💰 Pago</Badge>
      case 'rejeitado':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">❌ Rejeitado</Badge>
      case 'cancelado':
        return <Badge className="bg-muted text-muted-foreground">Cancelado</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const isFormDisabled = submitting || showSuccess
  const val = parseFloat(amount) || 0
  const isOverBalance = val > availableBalance

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <Wallet className="w-8 h-8 text-green-400" />
              Meus Ganhos
            </h1>
            <p className="text-muted-foreground mt-1">Gerencie seus saques e comissões</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Disponível */}
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span>💰 Disponível para saque</span>
              </div>
              <p className="text-3xl font-bold text-green-400">
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : formatCurrency(availableBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Comissões aprovadas e não sacadas</p>
            </CardContent>
          </Card>

          {/* Pendente */}
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <Clock className="w-4 h-4 text-yellow-400" />
                <span>⏳ Pendente de aprovação</span>
              </div>
              <p className="text-3xl font-bold text-yellow-400">
                {loading ? '...' : formatCurrency(pendingCommission)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Aguarda validação do executive</p>
            </CardContent>
          </Card>

          {/* Histórico */}
          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <CheckCircle className="w-4 h-4 text-muted-foreground" />
                <span>✅ Total sacado</span>
              </div>
              <p className="text-3xl font-bold text-foreground">
                {loading ? '...' : formatCurrency(totalWithdrawn)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Histórico de saques realizados</p>
            </CardContent>
          </Card>
        </div>

        {/* Withdrawal Form */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-green-400" />
              Solicitar Saque
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showSuccess ? (
              // ✅ Tela de confirmação elegante
              <div className="text-center py-10 space-y-4 animate-fade-in">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto ring-4 ring-green-500/10">
                  <CheckCircle className="w-10 h-10 text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-foreground">Solicitação enviada com sucesso!</h3>
                <p className="text-muted-foreground max-w-sm mx-auto text-sm leading-relaxed">
                  Seu saque de <span className="text-green-400 font-semibold">{formatCurrency(successAmount)}</span> foi registrado.
                  O valor será liberado em sua conta em até <strong>3 dias úteis</strong> após a confirmação pelo financeiro.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSuccess(false)
                    historyRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }}
                >
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Ver meus saques
                </Button>
              </div>
            ) : submitting ? (
              // ✅ Loading overlay elegante (mínimo 1.5s)
              <div className="text-center py-14 space-y-4 animate-fade-in">
                <div className="relative w-16 h-16 mx-auto">
                  <div className="w-16 h-16 rounded-full border-4 border-muted" />
                  <div className="w-16 h-16 rounded-full border-4 border-green-400/30 border-t-green-400 animate-spin absolute top-0 left-0" />
                  <Wallet className="w-6 h-6 text-green-400 absolute top-5 left-5" />
                </div>
                <p className="text-foreground font-medium">Processando sua solicitação...</p>
                <p className="text-xs text-muted-foreground">Aguarde um momento</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/30">
                  <span className="text-sm text-muted-foreground">Saldo disponível</span>
                  <span className="text-lg font-bold text-green-400">{formatCurrency(availableBalance)}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* Valor */}
                  <div className="space-y-1.5">
                    <Label>Valor a sacar *</Label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="number"
                          value={amount}
                          onChange={e => { setAmount(e.target.value); setErrors(er => ({ ...er, amount: '' })) }}
                          placeholder="0,00"
                          min={0}
                          max={availableBalance}
                          className={isOverBalance || errors.amount ? 'border-red-500' : ''}
                          disabled={isFormDisabled}
                        />
                        {errors.amount && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.amount}</p>}
                        {isOverBalance && !errors.amount && <p className="text-xs text-red-400 mt-1">Valor acima do saldo disponível</p>}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setAmount(availableBalance.toFixed(2)); setErrors(er => ({ ...er, amount: '' })) }}
                        disabled={isFormDisabled || availableBalance <= 0}
                        className="self-start"
                      >
                        Tudo
                      </Button>
                    </div>
                  </div>

                  {/* Tipo Pix */}
                  <div className="space-y-1.5">
                    <Label>Tipo da chave Pix *</Label>
                    <Select value={pixKeyType} onValueChange={v => { setPixKeyType(v); setErrors(er => ({ ...er, pixKeyType: '' })) }} disabled={isFormDisabled}>
                      <SelectTrigger className={errors.pixKeyType ? 'border-red-500' : ''}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cpf">CPF</SelectItem>
                        <SelectItem value="cnpj">CNPJ</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="telefone">Telefone</SelectItem>
                        <SelectItem value="aleatoria">Chave aleatória</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.pixKeyType && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.pixKeyType}</p>}
                  </div>

                  {/* Chave Pix */}
                  <div className="space-y-1.5">
                    <Label>Chave Pix *</Label>
                    <Input
                      value={pixKey}
                      onChange={e => { setPixKey(e.target.value); setErrors(er => ({ ...er, pixKey: '' })) }}
                      placeholder="Sua chave Pix"
                      className={errors.pixKey ? 'border-red-500' : ''}
                      disabled={isFormDisabled}
                    />
                    {errors.pixKey && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.pixKey}</p>}
                  </div>

                  {/* Nome titular */}
                  <div className="space-y-1.5">
                    <Label>Nome do titular *</Label>
                    <Input
                      value={holderName}
                      onChange={e => { setHolderName(e.target.value); setErrors(er => ({ ...er, holderName: '' })) }}
                      placeholder="Nome completo"
                      className={errors.holderName ? 'border-red-500' : ''}
                      disabled={isFormDisabled}
                    />
                    {errors.holderName && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.holderName}</p>}
                  </div>

                  {/* CPF */}
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>CPF do titular *</Label>
                    <Input
                      value={holderCpf}
                      onChange={e => {
                        const formatted = formatCpf(e.target.value)
                        setHolderCpf(formatted)
                        setErrors(er => ({ ...er, holderCpf: '' }))
                      }}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className={errors.holderCpf ? 'border-red-500' : ''}
                      disabled={isFormDisabled}
                    />
                    {errors.holderCpf && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.holderCpf}</p>}
                  </div>
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={isFormDisabled || isOverBalance || availableBalance <= 0}
                  className="w-full h-12 text-base bg-green-600 hover:bg-green-700 text-white font-semibold transition-all"
                >
                  Solicitar Saque →
                </Button>

                {availableBalance <= 0 && (
                  <p className="text-center text-sm text-muted-foreground">
                    Você não possui saldo disponível para saque. Aguarde a aprovação de suas vendas.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Withdrawal History */}
        <div ref={historyRef}>
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Histórico de Saques
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded animate-pulse" />)}
                </div>
              ) : withdrawals.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">Nenhum saque realizado ainda</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs">
                        <th className="text-left pb-3 font-medium">Data</th>
                        <th className="text-left pb-3 font-medium">Valor</th>
                        <th className="text-left pb-3 font-medium hidden md:table-cell">Chave Pix</th>
                        <th className="text-left pb-3 font-medium">Status</th>
                        <th className="text-left pb-3 font-medium hidden lg:table-cell">Previsão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {withdrawals.map(w => (
                        <tr key={w.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-3 text-muted-foreground">
                            {new Date(w.created_at).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="py-3 font-semibold text-foreground">
                            {formatCurrency(Number(w.valor_solicitado || 0))}
                          </td>
                          <td className="py-3 text-muted-foreground hidden md:table-cell">
                            {w.chave_pix || '—'}
                          </td>
                          <td className="py-3">
                            <div className="space-y-1">
                              {getStatusBadge(w.status)}
                              {w.motivo_rejeicao && (
                                <p className="text-xs text-red-400">{w.motivo_rejeicao}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 text-muted-foreground hidden lg:table-cell">
                            {w.previsao_pagamento
                              ? new Date(w.previsao_pagamento).toLocaleDateString('pt-BR')
                              : w.status === 'pendente' || w.status === 'processando'
                                ? <span className="flex items-center gap-1 text-xs"><Calendar className="w-3 h-3" /> Até 3 dias úteis</span>
                                : '—'
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
