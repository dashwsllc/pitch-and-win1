import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { MessageSquare, ArrowLeft } from 'lucide-react'

export default function NovaAbordagem() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!user) return

    setIsSubmitting(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      user_id: user.id,
      nomes_abordados: formData.get('nomes_abordados') as string,
      dados_abordados: formData.get('dados_abordados') as string,
      tempo_medio_abordagem: parseInt(formData.get('tempo_medio_abordagem') as string),
      mostrou_ia: formData.get('mostrou_ia') === 'sim',
      visao_geral: formData.get('visao_geral') as string
    }

    const { error } = await supabase
      .from('abordagens')
      .insert([data])

    if (error) {
      toast({
        title: 'Erro ao salvar abordagem',
        description: error.message,
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Abordagem registrada com sucesso!',
        description: 'Os dados foram salvos no sistema'
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
            <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Nova Abordagem</h1>
              <p className="text-muted-foreground">Registre uma nova abordagem comercial</p>
            </div>
          </div>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground">Dados da Abordagem</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nomes_abordados">Nome(s) do(s) abordado(s) *</Label>
                  <Input
                    id="nomes_abordados"
                    name="nomes_abordados"
                    placeholder="João Silva, Maria Santos..."
                    required
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tempo_medio_abordagem">Tempo médio da abordagem (minutos) *</Label>
                  <Input
                    id="tempo_medio_abordagem"
                    name="tempo_medio_abordagem"
                    type="number"
                    min="1"
                    placeholder="Ex: 15"
                    required
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dados_abordados">Dados do(s) abordado(s) *</Label>
                <Textarea
                  id="dados_abordados"
                  name="dados_abordados"
                  placeholder="Informações relevantes sobre os prospects: contato, perfil, interesse..."
                  required
                  className="min-h-[100px] resize-none"
                />
              </div>

              <div className="space-y-3">
                <Label>Mostrou a IA funcionando? *</Label>
                <RadioGroup name="mostrou_ia" defaultValue="nao" className="flex gap-6">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="sim" id="ia-sim" />
                    <Label htmlFor="ia-sim" className="font-normal">Sim</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="nao" id="ia-nao" />
                    <Label htmlFor="ia-nao" className="font-normal">Não</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="visao_geral">Visão geral da abordagem *</Label>
                <Textarea
                  id="visao_geral"
                  name="visao_geral"
                  placeholder="Descreva como foi a abordagem, principais pontos discutidos, próximos passos..."
                  required
                  className="min-h-[120px] resize-none"
                />
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
                  disabled={isSubmitting}
                  className="flex-1 md:flex-none bg-gradient-primary hover:opacity-90"
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Abordagem'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}