import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BarChart3, Eye, EyeOff, Lock } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  const isResetMode = searchParams.has('access_token')

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string

    try {
      // Create password reset request in database
      const { error } = await supabase
        .from('password_reset_requests')
        .insert([
          {
            user_id: user?.id || '00000000-0000-0000-0000-000000000000',
            email: email
          }
        ])

      if (error) {
        console.error('Error creating password reset request:', error)
      }

      setRequestSent(true)
    } catch (error) {
      console.error('Error in handleForgotPassword:', error)
      setRequestSent(true) // Still show success to user
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (password !== confirmPassword) {
      toast({
        title: 'Senhas não coincidem',
        description: 'Por favor, confirme sua senha corretamente',
        variant: 'destructive'
      })
      setIsLoading(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      toast({
        title: 'Erro ao redefinir senha',
        description: error.message,
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Senha redefinida com sucesso!',
        description: 'Você será redirecionado para o login'
      })
      setTimeout(() => navigate('/auth'), 2000)
    }

    setIsLoading(false)
  }

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
            {isResetMode ? 'Redefinir sua senha' : 'Recuperar acesso à conta'}
          </p>
        </div>

        {/* Reset Form */}
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-foreground flex items-center justify-center gap-2">
              <Lock className="w-5 h-5" />
              {isResetMode ? 'Nova Senha' : 'Esqueceu a Senha?'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isResetMode ? (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nova Senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar Nova Senha</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                
                <Button
                  type="submit"
                  className="w-full bg-gradient-primary hover:opacity-90"
                  disabled={isLoading}
                >
                  {isLoading ? 'Redefinindo...' : 'Redefinir Senha'}
                </Button>
              </form>
            ) : (
              requestSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-foreground">Sua solicitação foi enviada aos administradores.</p>
                  <p className="text-muted-foreground">Aguarde autorização. Você receberá o acesso em breve.</p>
                  <Button className="w-full bg-gradient-primary hover:opacity-90" onClick={() => navigate('/auth')}>
                    Voltar ao Login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="seu@email.com"
                      required
                      className="w-full"
                    />
                  </div>
                  
                  <Button
                    type="submit"
                    className="w-full bg-gradient-primary hover:opacity-90"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Enviando...' : 'Enviar Link de Recuperação'}
                  </Button>
                </form>
              )
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-6">
          <Button 
            variant="link" 
            onClick={() => navigate('/auth')}
            className="text-muted-foreground hover:text-foreground"
          >
            Voltar ao Login
          </Button>
        </div>
      </div>
    </div>
  )
}