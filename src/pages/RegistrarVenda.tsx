import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { ShoppingCart, ArrowLeft } from 'lucide-react'

const PRODUTOS_MENTORIA = [
  { value: 'Mentoria Jogador De Elite', label: 'Mentoria Jogador De Elite' },
  { value: 'Mentoria Jogador Milionário', label: 'Mentoria Jogador Milionário' }
]

const VALORES_VENDA = [
  { value: '2997', label: 'R$ 2.997,00' },
  { value: '1497', label: 'R$ 1.497,00' },
  { value: '1247', label: 'R$ 1.247,00' },
  { value: '987', label: 'R$ 987,00' },
  { value: '847', label: 'R$ 847,00' },
  { value: '500', label: 'R$ 500,00' },
  { value: '275', label: 'R$ 275,00' },
  { value: '250', label: 'R$ 250,00' }
]

export default function RegistrarVenda() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [produtoSelecionado, setProdutoSelecionado] = useState('')
  const [valorSelecionado, setValorSelecionado] = useState('')
  const [nomeComprador, setNomeComprador] = useState('')
  const [whatsappComprador, setWhatsappComprador] = useState('')
  const [emailComprador, setEmailComprador] = useState('')

  const resetForm = () => {
    setProdutoSelecionado('')
    setValorSelecionado('')
    setNomeComprador('')
    setWhatsappComprador('')
    setEmailComprador('')
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!user) {
      toast({
        title: 'Erro de autenticação',
        description: 'Você precisa estar logado para registrar uma venda.',
        variant: 'destructive'
      })
      return
    }

    // Validate all fields before submitting
    if (!produtoSelecionado) {
      toast({ title: 'Campo obrigatório', description: 'Selecione o produto vendido.', variant: 'destructive' })
      return
    }
    if (!valorSelecionado) {
      toast({ title: 'Campo obrigatório', description: 'Selecione o valor da venda.', variant: 'destructive' })
      return
    }
    if (!nomeComprador.trim()) {
      toast({ title: 'Campo obrigatório', description: 'Informe o nome do comprador.', variant: 'destructive' })
      return
    }
    if (!whatsappComprador.trim()) {
      toast({ title: 'Campo obrigatório', description: 'Informe o WhatsApp do comprador.', variant: 'destructive' })
      return
    }
    if (!emailComprador.trim()) {
      toast({ title: 'Campo obrigatório', description: 'Informe o email do comprador.', variant: 'destructive' })
      return
    }

    setIsSubmitting(true)

    try {
      const { error } = await supabase
        .from('vendas')
        .insert([{
          user_id: user.id,
          nome_produto: produtoSelecionado,
          valor_venda: parseFloat(valorSelecionado),
          nome_comprador: nomeComprador.trim(),
          whatsapp_comprador: whatsappComprador.trim(),
          email_comprador: emailComprador.trim()
        }])

      if (error) {
        throw error
      }

      toast({
        title: 'Venda registrada com sucesso!',
        description: 'Sua venda está aguardando aprovação do executive. O saldo será atualizado após a validação.'
      })
      resetForm()
    } catch (error: any) {
      console.error('Erro ao registrar venda:', error)
      toast({
        title: 'Erro ao registrar venda',
        description: error?.message || 'Não foi possível registrar a venda. Tente novamente.',
        variant: 'destructive'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-success flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Registrar Venda</h1>
              <p className="text-muted-foreground">Registre uma nova venda realizada</p>
            </div>
          </div>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground">Dados da Venda</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome Do Produto Vendido *</Label>
                  <Select
                    value={produtoSelecionado}
                    onValueChange={setProdutoSelecionado}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUTOS_MENTORIA.map((produto) => (
                        <SelectItem key={produto.value} value={produto.value}>
                          {produto.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Valor Da Venda *</Label>
                  <Select
                    value={valorSelecionado}
                    onValueChange={setValorSelecionado}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o valor" />
                    </SelectTrigger>
                    <SelectContent>
                      {VALORES_VENDA.map((valor) => (
                        <SelectItem key={valor.value} value={valor.value}>
                          {valor.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nome_comprador">Nome Do Comprador *</Label>
                <Input
                  id="nome_comprador"
                  value={nomeComprador}
                  onChange={(e) => setNomeComprador(e.target.value)}
                  placeholder="Nome completo do cliente"
                  required
                  className="w-full"
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp_comprador">WhatsApp Do Comprador *</Label>
                  <Input
                    id="whatsapp_comprador"
                    value={whatsappComprador}
                    onChange={(e) => setWhatsappComprador(e.target.value)}
                    placeholder="(11) 99999-9999"
                    required
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email_comprador">Email Do Comprador *</Label>
                  <Input
                    id="email_comprador"
                    value={emailComprador}
                    onChange={(e) => setEmailComprador(e.target.value)}
                    type="email"
                    placeholder="cliente@email.com"
                    required
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/')}
                  className="flex-1 md:flex-none"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !valorSelecionado || !produtoSelecionado}
                  className="flex-1 md:flex-none bg-gradient-success hover:opacity-90"
                >
                  {isSubmitting ? 'Registrando...' : 'Registrar Venda'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
