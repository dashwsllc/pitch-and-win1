import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { 
  Key, 
  UserCheck, 
  Clock, 
  CheckCircle, 
  XCircle,
  Loader2,
  Plus
} from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { useAllUsers } from '@/hooks/useRoles'

interface PasswordRequest {
  id: string
  user_id: string
  email: string
  status: string
  requested_at: string
  processed_at?: string
}

export function ExecutivePasswordRequests() {
  const [requests, setRequests] = useState<PasswordRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [showManualReset, setShowManualReset] = useState(false)
  const [selectedUser, setSelectedUser] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  
  const { users } = useAllUsers()
  const { toast } = useToast()

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('*')
        .order('requested_at', { ascending: false })

      if (error) {
        console.error('Error fetching password requests:', error)
        return
      }

      setRequests(data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  const processRequest = async (requestId: string, status: 'approved' | 'rejected') => {
    setProcessing(requestId)
    
    try {
      const { error } = await supabase
        .from('password_reset_requests')
        .update({
          status,
          processed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (error) {
        throw error
      }

      toast({
        title: status === 'approved' ? 'Solicitação aprovada!' : 'Solicitação rejeitada!',
        description: status === 'approved' 
          ? 'O usuário será notificado da aprovação.'
          : 'O usuário será notificado da rejeição.'
      })

      fetchRequests()
    } catch (error) {
      console.error('Error processing request:', error)
      toast({
        title: 'Erro',
        description: 'Não foi possível processar a solicitação. Tente novamente.',
        variant: 'destructive'
      })
    } finally {
      setProcessing(null)
    }
  }

  const resetUserPassword = async () => {
    if (!selectedUser || !newPassword) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Selecione um usuário e defina uma nova senha.',
        variant: 'destructive'
      })
      return
    }

    setResetting(true)

    try {
      // Chamar edge function para redefinir senha
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: {
          user_id: selectedUser,
          new_password: newPassword
        }
      })

      if (error) {
        throw error
      }

      toast({
        title: 'Senha redefinida!',
        description: 'A senha do usuário foi alterada com sucesso.'
      })

      setShowManualReset(false)
      setSelectedUser('')
      setNewPassword('')
    } catch (error) {
      console.error('Error resetting password:', error)
      toast({
        title: 'Erro ao redefinir senha',
        description: 'Não foi possível redefinir a senha. Tente novamente.',
        variant: 'destructive'
      })
    } finally {
      setResetting(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            Pendente
          </Badge>
        )
      case 'approved':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <CheckCircle className="w-3 h-3 mr-1" />
            Aprovada
          </Badge>
        )
      case 'rejected':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            <XCircle className="w-3 h-3 mr-1" />
            Rejeitada
          </Badge>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Solicitações de Redefinição de Senha
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Redefinição de Senhas
          </div>
          <Dialog open={showManualReset} onOpenChange={setShowManualReset}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-gradient-primary hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" />
                Redefinir Manualmente
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Redefinir Senha Manualmente</DialogTitle>
                <DialogDescription>
                  Selecione um usuário e defina uma nova senha para ele.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="user-select">Usuário</Label>
                  <Select value={selectedUser} onValueChange={setSelectedUser}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um usuário" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.user_id}>
                          {user.display_name || user.user_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova Senha</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Digite a nova senha"
                    minLength={6}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowManualReset(false)}>
                  Cancelar
                </Button>
                <Button 
                  onClick={resetUserPassword}
                  disabled={resetting || !selectedUser || !newPassword}
                  className="bg-gradient-primary hover:opacity-90"
                >
                  {resetting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Redefinir Senha
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma solicitação de redefinição de senha encontrada.
            </div>
          ) : (
            requests.map((request) => (
              <div key={request.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium text-foreground">{request.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Solicitado em {new Date(request.requested_at).toLocaleString('pt-BR')}
                  </p>
                  {request.processed_at && (
                    <p className="text-xs text-muted-foreground">
                      Processado em {new Date(request.processed_at).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {getStatusBadge(request.status)}
                  
                  {request.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            size="sm" 
                            variant="outline"
                            disabled={processing === request.id}
                          >
                            Rejeitar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Rejeitar solicitação?</AlertDialogTitle>
                            <AlertDialogDescription>
                              A solicitação de redefinição de senha de {request.email} será rejeitada.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => processRequest(request.id, 'rejected')}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Rejeitar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button 
                            size="sm"
                            className="bg-gradient-primary hover:opacity-90"
                            disabled={processing === request.id}
                          >
                            {processing === request.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              'Aprovar'
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Aprovar solicitação?</AlertDialogTitle>
                            <AlertDialogDescription>
                              A solicitação de redefinição de senha de {request.email} será aprovada.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => processRequest(request.id, 'approved')}
                              className="bg-gradient-primary hover:opacity-90"
                            >
                              Aprovar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}