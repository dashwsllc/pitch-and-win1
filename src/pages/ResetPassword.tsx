import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BarChart3, Eye, EyeOff, Lock } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { Turnstile, captchaRequired } from '@/components/security/Turnstile'
import { emailSchema, firstIssue, publicAuthError, strongPasswordSchema } from '@/lib/auth-security'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [requestSent, setRequestSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const isResetMode = searchParams.has('access_token') || searchParams.has('code') || searchParams.get('type') === 'recovery'

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailResult = emailSchema.safeParse(formData.get('email'))

    if (!emailResult.success) {
      toast({ title: 'Confira o e-mail', description: firstIssue(emailResult.error), variant: 'destructive' })
      setIsLoading(false)
      return
    }
    if (captchaRequired && !captchaToken) {
      toast({ title: 'Verificação necessária', description: 'Conclua a verificação anti-bot.', variant: 'destructive' })
      setIsLoading(false)
      return
    }

    try {
      // Send password reset email via Supabase Auth
      const { error } = await supabase.auth.resetPasswordForEmail(emailResult.data, {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken: captchaToken ?? undefined,
      })

      if (error) {
        console.error('Error sending reset email:', error)
      }

      // Always show success to prevent email enumeration
      setRequestSent(true)
    } catch (error) {
      console.error('Error in handleForgotPassword:', error)
      setRequestSent(true)
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const passwordResult = strongPasswordSchema.safeParse(formData.get('password'))
    const confirmPassword = formData.get('confirmPassword') as string

    if (!passwordResult.success) {
      toast({ title: 'Senha fraca', description: firstIssue(passwordResult.error), variant: 'destructive' })
      setIsLoading(false)
      return
    }
    if (passwordResult.data !== confirmPassword) {
      toast({
        title: 'Senhas não coincidem',
        description: 'Por favor, confirme sua senha corretamente',
        variant: 'destructive'
      })
      setIsLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({ password: passwordResult.data })

      if (error) {
        toast({
          title: 'Erro ao redefinir senha',
          description: publicAuthError(error),
          variant: 'destructive'
        })
      } else {
        toast({
          title: 'Senha redefinida com sucesso!',
          description: 'Você será redirecionado para o login'
        })
        setTimeout(() => navigate('/auth'), 2000)
      }
    } catch (error: unknown) {
      toast({
        title: 'Erro inesperado',
        description: publicAuthError(error),
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
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
                  <p className="text-foreground">Se o email estiver cadastrado, você receberá um link de recuperação.</p>
                  <p className="text-muted-foreground">Verifique sua caixa de entrada e spam.</p>
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
                  <Turnstile onToken={setCaptchaToken} />
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
