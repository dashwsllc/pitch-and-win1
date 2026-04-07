import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BarChart3, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

export default function Auth() {
  const { user, signIn, signUp, loading } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Redirect if already authenticated
  if (user && !loading) {
    return <Navigate to="/" replace />
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const { error } = await signIn(email, password)

    if (error) {
      toast({
        title: 'Erro no login',
        description: error.message,
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
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const displayName = formData.get('name') as string

    const { error } = await signUp(email, password, displayName)

    if (error) {
      toast({
        title: 'Erro no cadastro',
        description: error.message,
        variant: 'destructive'
      })
    } else {
      toast({
        title: 'Conta criada com sucesso!',
        description: 'Verifique seu email para confirmar a conta'
      })
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
    <div className="dark min-h-screen bg-gradient-to-br from-[hsl(240,10%,3.9%)] via-[hsl(240,10%,3.9%)] to-[hsl(240,4.8%,15.9%)]/20 flex flex-col items-center justify-center p-4 text-[hsl(0,0%,98%)]">
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