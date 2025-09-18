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
  const [valorSelecionado, setValorSelecionado] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!user) return

    setIsSubmitting(true)

    const formData = new FormData(e.currentTarget)
    
    // Captura o produto selecionado do Select
    const nomeProduto = formData.get('nome_produto') as string
    
    const data = {
      user_id: user.id,
      nome_produto: nomeProduto,
      valor_venda: parseFloat(valorSelecionado),
      nome_comprador: formData.get('nome_comprador') as string,
      whatsapp_comprador: formData.get('whatsapp_comprador') as string,
      email_comprador: formData.get('email_comprador') as string
    }

    const { error } = await supabase
      .from('vendas')
      .insert([data])

    if (error) {
      toast({
        title: 'Erro ao registrar venda',
        description: error.message,
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Venda registrada com sucesso!',
        description: `Venda de ${VALORES_VENDA.find(v => v.value === valorSelecionado)?.label} registrada`
      })
      navigate('/')
    }

    setIsSubmitting(false)
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
                  <Label htmlFor="nome_produto">Nome Do Produto Vendido *</Label>
                  <Select
                    name="nome_produto"
                    required
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
                  <Label htmlFor="valor_venda">Valor Da Venda *</Label>
                  <Select
                    name="valor_venda"
                    value={valorSelecionado}
                    onValueChange={setValorSelecionado}
                    required
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
                  name="nome_comprador"
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
                    name="whatsapp_comprador"
                    placeholder="(11) 99999-9999"
                    required
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email_comprador">Email Do Comprador *</Label>
                  <Input
                    id="email_comprador"
                    name="email_comprador"
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
                  disabled={isSubmitting || !valorSelecionado}
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