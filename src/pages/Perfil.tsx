import { useState, useEffect } from "react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/hooks/useAuth"
import { useProfile } from "@/hooks/useProfile"
import { supabase } from "@/integrations/supabase/client"
import { toast } from "sonner"
import { User, Mail, Camera, Lock, Save, Clock } from "lucide-react"

export default function Perfil() {
  const { user } = useAuth()
  const { profile, loading, updateProfile, uploadAvatar } = useProfile()
  const [displayName, setDisplayName] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [uploading, setUploading] = useState(false)
  const [updating, setUpdating] = useState(false)

  // Atualizar displayName quando o profile carregar
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name)
    }
  }, [profile])

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validar tipo de arquivo
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem')
      return
    }

    // Validar tamanho (máximo 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2MB')
      return
    }

    try {
      setUploading(true)
      await uploadAvatar(file)
    } catch (error) {
      console.error('Erro no upload:', error)
    } finally {
      setUploading(false)
    }
  }

  const handleUpdateProfile = async () => {
    if (!displayName.trim()) {
      toast.error('Nome de exibição é obrigatório')
      return
    }

    try {
      setUpdating(true)
      await updateProfile({ display_name: displayName.trim() })
    } catch (error) {
      console.error('Erro ao atualizar perfil:', error)
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdatePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Todos os campos de senha são obrigatórios')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem')
      return
    }

    if (newPassword.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres')
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      toast.success('Senha atualizada com sucesso!')
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (error: any) {
      console.error('Erro ao atualizar senha:', error)
      toast.error(error.message || 'Erro ao atualizar senha')
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <User className="w-8 h-8 text-primary" />
            Meu Perfil
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie suas informações pessoais e configurações de conta
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Foto do Perfil */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Foto do Perfil
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <Avatar className="w-32 h-32 mx-auto">
                <AvatarImage src={profile?.avatar_url || ""} alt="Avatar" />
                <AvatarFallback className="text-2xl">
                  {profile?.display_name?.[0] || user?.email?.[0] || "U"}
                </AvatarFallback>
              </Avatar>
              
              <div>
                <Label htmlFor="avatar-upload" className="cursor-pointer">
                  <Button 
                    variant="outline" 
                    disabled={uploading}
                    asChild
                  >
                    <span>
                      {uploading ? "Enviando..." : "Alterar Foto"}
                    </span>
                  </Button>
                </Label>
                <Input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              
              <p className="text-xs text-muted-foreground">
                Formatos aceitos: JPG, PNG. Máximo 2MB.
              </p>
            </CardContent>
          </Card>

          {/* Informações Básicas */}
          <Card className="border-border/50 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <User className="w-5 h-5" />
                Informações Básicas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={user?.email || ""}
                    disabled
                    className="bg-muted/50"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  O email não pode ser alterado
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="display-name">Nome de Exibição</Label>
                <Input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Como você quer ser chamado"
                />
              </div>

              <Button 
                onClick={handleUpdateProfile}
                disabled={updating || !displayName.trim()}
                className="w-full"
              >
                <Save className="w-4 h-4 mr-2" />
                {updating ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Alterar Senha */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Alterar Senha
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="current-password">Senha Atual</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Digite sua senha atual"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">Nova Senha</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Digite a nova senha"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar Senha</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirme a nova senha"
                />
              </div>
            </div>

            <Separator className="my-4" />

            <Button 
              onClick={handleUpdatePassword}
              disabled={!currentPassword || !newPassword || !confirmPassword}
              variant="outline"
            >
              <Lock className="w-4 h-4 mr-2" />
              Atualizar Senha
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}