import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BarChart3, CheckCircle } from 'lucide-react'

export default function EmailConfirmation() {
  const navigate = useNavigate()

  useEffect(() => {
    // Adicionar um timeout para não deixar o usuário esperando muito tempo
    const timer = setTimeout(() => {
      // Se não redirecionou automaticamente, mostrar botão
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/20 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-primary flex items-center justify-center">
              <BarChart3 className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">WS LTDA</h1>
          <p className="text-muted-foreground">
            Sistema de gerenciamento comercial
          </p>
        </div>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="pb-4 text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-16 h-16 text-success" />
            </div>
            <CardTitle className="text-center text-foreground text-xl">
              Conta Autenticada!
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Sua conta foi verificada com sucesso. Agora você pode fazer login e começar a usar o sistema.
            </p>
            
            <Button
              onClick={() => navigate('/auth')}
              className="w-full bg-gradient-primary hover:opacity-90"
            >
              Ir para Login
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}