import { useState, useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BarChart3, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { Turnstile, captchaRequired } from '@/components/security/Turnstile'
import { displayNameSchema, emailSchema, firstIssue, loginPasswordSchema, publicAuthError, strongPasswordSchema } from '@/lib/auth-security'

export default function Auth() {
  const { user, signIn, signUp, loading } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [signInCaptcha, setSignInCaptcha] = useState<string>()
  const [signUpCaptcha, setSignUpCaptcha] = useState<string>()

  // Force dark mode on auth page
  useEffect(() => {
    const root = document.documentElement
    const hadLight = root.classList.contains('light')
    root.classList.remove('light')
    root.classList.add('dark')
    return () => {
      if (hadLight) {
        root.classList.remove('dark')
        root.classList.add('light')
      }
    }
  }, [])

  useEffect(() => {
    if (searchParams.get('suspended') === 'true') {
      toast({
        title: 'Acesso Suspenso',
        description: 'Sua conta foi suspensa pelo administrador.',
        variant: 'destructive'
      })
      navigate('/auth', { replace: true })
    }
  }, [searchParams, navigate, toast])

  // Redirect if already authenticated
  if (user && !loading) {
    return <Navigate to="/" replace />
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const parsedEmail = emailSchema.safeParse(formData.get('email'))
    const parsedPassword = loginPasswordSchema.safeParse(formData.get('password'))
    if (!parsedEmail.success || !parsedPassword.success || (captchaRequired && !signInCaptcha)) {
      toast({
        title: 'Confira os dados',
        description: !parsedEmail.success ? firstIssue(parsedEmail.error) : !parsedPassword.success ? firstIssue(parsedPassword.error) : 'Conclua a verificação anti-bot.',
        variant: 'destructive',
      })
      return
    }
    setIsLoading(true)

    const { error } = await signIn(parsedEmail.data, parsedPassword.data, signInCaptcha)

    if (error) {
      toast({
        title: 'Erro no login',
        description: publicAuthError(error),
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Login realizado com sucesso!',
        description: 'Bem-vindo ao WS LTDA'
      })
    }

    setIsLoading(false)
  }

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const parsedEmail = emailSchema.safeParse(formData.get('email'))
    const parsedPassword = strongPasswordSchema.safeParse(formData.get('password'))
    const parsedName = displayNameSchema.safeParse(formData.get('name'))
    const invalid = !parsedEmail.success ? parsedEmail.error : !parsedPassword.success ? parsedPassword.error : !parsedName.success ? parsedName.error : null
    if (invalid || (captchaRequired && !signUpCaptcha)) {
      toast({ title: 'Confira os dados', description: invalid ? firstIssue(invalid) : 'Conclua a verificação anti-bot.', variant: 'destructive' })
      return
    }
    setIsLoading(true)

    const { error, session } = await signUp(parsedEmail.data, parsedPassword.data, parsedName.data, signUpCaptcha)

    if (error) {
      toast({
        title: 'Erro no cadastro',
        description: publicAuthError(error),
        variant: 'destructive'
      })
    } else if (!session) {
      toast({
        title: 'Conta criada, mas o login não foi concluído',
        description: 'Entre com o email e a senha cadastrados para continuar.',
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Conta criada e autenticada!',
        description: 'Bem-vindo ao WS LTDA'
      })
      navigate('/', { replace: true })
    }

    setIsLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
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
            Sistema de gerenciamento comercial
          </p>
        </div>

        {/* Auth Forms */}
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-foreground">
              Acesse sua conta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Cadastrar</TabsTrigger>
              </TabsList>

              {/* Sign In Form */}
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      name="email"
                      type="email"
                      placeholder="seu@email.com"
                      required
                      maxLength={254}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Senha</Label>
                    <div className="relative">
                      <Input
                        id="signin-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        required
                        maxLength={128}
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
                  <Turnstile onToken={setSignInCaptcha} />
                  <Button
                    type="submit"
                    className="w-full bg-gradient-primary hover:opacity-90"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Entrando...' : 'Entrar'}
                  </Button>
                  
                  <div className="text-center">
                    <Button 
                      type="button"
                      variant="link" 
                      onClick={() => navigate('/reset-password')}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Esqueci a senha
                    </Button>
                  </div>
                </form>
              </TabsContent>

              {/* Sign Up Form */}
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Nome completo</Label>
                    <Input
                      id="signup-name"
                      name="name"
                      type="text"
                      placeholder="Seu nome completo"
                      required
                      minLength={2}
                      maxLength={120}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      name="email"
                      type="email"
                      placeholder="seu@email.com"
                      required
                      maxLength={254}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-cargo">Cargo</Label>
                    <Select name="cargo" defaultValue="seller" required>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seller">Seller</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Senha</Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        required
                        minLength={12}
                        maxLength={128}
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
                  <Turnstile onToken={setSignUpCaptcha} />
                  <Button
                    type="submit"
                    className="w-full bg-gradient-primary hover:opacity-90"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Criando conta...' : 'Criar conta'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Ao continuar, você concorda com nossos Termos de Uso
        </p>
      </div>
    </div>
  )
}
