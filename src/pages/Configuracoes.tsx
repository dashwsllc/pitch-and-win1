import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/contexts/ThemeContext"
import { useAuth } from "@/hooks/useAuth"
import { toast } from "sonner"
import { Settings, Palette, Bell, Shield, LogOut, Monitor, Sun, Moon } from "lucide-react"
import { useState } from "react"

export default function Configuracoes() {
  const { theme, setTheme } = useTheme()
  const { signOut } = useAuth()
  const [notifications, setNotifications] = useState(true)
  const [emailNotifications, setEmailNotifications] = useState(true)

  const handleSignOut = async () => {
    try {
      await signOut()
      toast.success('Logout realizado com sucesso!')
    } catch (error) {
      toast.error('Erro ao fazer logout')
    }
  }

  const getThemeIcon = (themeValue: string) => {
    switch (themeValue) {
      case 'light':
        return <Sun className="w-4 h-4" />
      case 'dark':
        return <Moon className="w-4 h-4" />
      default:
        return <Monitor className="w-4 h-4" />
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary" />
            Configurações
          </h1>
          <p className="text-muted-foreground mt-1">
            Personalize sua experiência e gerencie suas preferências
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Aparência */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Aparência
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="theme-select">Tema</Label>
                <Select value={theme} onValueChange={setTheme}>
                  <SelectTrigger id="theme-select">
                    <SelectValue>
                      <div className="flex items-center gap-2">
                        {getThemeIcon(theme)}
                        <span className="capitalize">
                          {theme === 'system' ? 'Sistema' : theme === 'light' ? 'Claro' : 'Escuro'}
                        </span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">
                      <div className="flex items-center gap-2">
                        <Sun className="w-4 h-4" />
                        Claro
                      </div>
                    </SelectItem>
                    <SelectItem value="dark">
                      <div className="flex items-center gap-2">
                        <Moon className="w-4 h-4" />
                        Escuro
                      </div>
                    </SelectItem>
                    <SelectItem value="system">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4" />
                        Sistema
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Escolha como você quer que a interface apareça
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Notificações */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notificações
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notificações Push</Label>
                  <p className="text-xs text-muted-foreground">
                    Receba notificações em tempo real
                  </p>
                </div>
                <Switch
                  checked={notifications}
                  onCheckedChange={setNotifications}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notificações por Email</Label>
                  <p className="text-xs text-muted-foreground">
                    Receba resumos por email
                  </p>
                </div>
                <Switch
                  checked={emailNotifications}
                  onCheckedChange={setEmailNotifications}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Privacidade e Segurança */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Privacidade e Segurança
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Dados da Conta</h4>
                <p className="text-sm text-muted-foreground">
                  Seus dados são criptografados e protegidos. Apenas você tem acesso às suas informações de vendas e abordagens.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">Backup Automático</h4>
                <p className="text-sm text-muted-foreground">
                  Seus dados são automaticamente salvos e sincronizados em tempo real.
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-foreground">Sessão Ativa</h4>
                <p className="text-sm text-muted-foreground">
                  Sair da sua conta em todos os dispositivos
                </p>
              </div>
              <Button 
                variant="destructive" 
                onClick={handleSignOut}
                className="gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sair da Conta
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sobre o Sistema */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground">Sobre o Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <h4 className="font-semibold text-foreground">Versão</h4>
                <p className="text-sm text-muted-foreground">v1.0.0</p>
              </div>
              
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <h4 className="font-semibold text-foreground">Última Atualização</h4>
                <p className="text-sm text-muted-foreground">Setembro 2025</p>
              </div>
              
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <h4 className="font-semibold text-foreground">Suporte</h4>
                <p className="text-sm text-muted-foreground">24/7 Online</p>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-border/50 text-center">
              <p className="text-sm text-muted-foreground">
                Created and developed by <span className="font-medium text-foreground">Sinclair</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}