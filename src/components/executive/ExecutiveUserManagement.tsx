import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select'
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
  Users, 
  Shield, 
  UserCheck, 
  Crown,
  Loader2
} from 'lucide-react'
import { useAllUsers } from '@/hooks/useRoles'
import { supabase } from '@/integrations/supabase/client'
import { useToast } from '@/hooks/use-toast'

export function ExecutiveUserManagement() {
  const { users, loading, refetch } = useAllUsers()
  const { toast } = useToast()
  const [updatingUser, setUpdatingUser] = useState<string | null>(null)

  const getInitials = (email: string) => {
    return email.substring(0, 2).toUpperCase()
  }

  const getRoleBadge = (role: string) => {
    if (role === 'executive') {
      return (
        <Badge className="bg-gradient-primary text-white">
          <Crown className="w-3 h-3 mr-1" />
          Executive
        </Badge>
      )
    }
    return (
      <Badge variant="secondary">
        <UserCheck className="w-3 h-3 mr-1" />
        Seller
      </Badge>
    )
  }

  const promoteToExecutive = async (userId: string, userEmail: string) => {
    setUpdatingUser(userId)
    
    try {
      // Verificar se já tem o role executive
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userId)
        .eq('role', 'executive')
        .single()

      if (existingRole) {
        toast({
          title: 'Usuário já é Executive',
          description: 'Este usuário já possui permissões de executive.',
          variant: 'destructive'
        })
        return
      }

      // Inserir novo role de executive
      const { error } = await supabase
        .from('user_roles')
        .insert([
          {
            user_id: userId,
            role: 'executive'
          }
        ])

      if (error) {
        throw error
      }

      toast({
        title: 'Usuário promovido!',
        description: `${userEmail} agora possui permissões de Executive.`
      })

      refetch()
    } catch (error) {
      console.error('Error promoting user:', error)
      toast({
        title: 'Erro ao promover usuário',
        description: 'Não foi possível promover o usuário. Tente novamente.',
        variant: 'destructive'
      })
    } finally {
      setUpdatingUser(null)
    }
  }

  const demoteFromExecutive = async (userId: string, userEmail: string) => {
    setUpdatingUser(userId)
    
    try {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'executive')

      if (error) {
        throw error
      }

      toast({
        title: 'Permissões removidas!',
        description: `${userEmail} não possui mais permissões de Executive.`
      })

      refetch()
    } catch (error) {
      console.error('Error demoting user:', error)
      toast({
        title: 'Erro ao remover permissões',
        description: 'Não foi possível remover as permissões. Tente novamente.',
        variant: 'destructive'
      })
    } finally {
      setUpdatingUser(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Gerenciar Usuários
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Gerenciar Usuários ({users.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {users.map((user) => {
            const role = user.user_roles?.[0]?.role || 'seller'
            const isExecutive = role === 'executive'
            
            return (
              <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <Avatar>
                    <AvatarFallback className="bg-gradient-primary text-white">
                      {getInitials(user.display_name || user.user_id)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div>
                    <p className="font-medium text-foreground">
                      {user.display_name || 'Usuário'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      ID: {user.user_id?.substring(0, 8)}...
                    </p>
                  </div>
                  
                  {getRoleBadge(role)}
                </div>

                <div className="flex items-center gap-2">
                  {isExecutive ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          disabled={updatingUser === user.id}
                        >
                          {updatingUser === user.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Remover Executive'
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover permissões de Executive?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação removerá as permissões de Executive do usuário {user.display_name || user.user_id}. 
                            Ele perderá acesso ao dashboard executivo e suas funcionalidades.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => demoteFromExecutive(user.id, user.display_name || user.user_id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remover Permissões
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          size="sm"
                          className="bg-gradient-primary hover:opacity-90"
                          disabled={updatingUser === user.id}
                        >
                          {updatingUser === user.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Shield className="w-4 h-4 mr-2" />
                              Promover a Executive
                            </>
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Promover a Executive?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação dará permissões de Executive para {user.display_name || user.user_id}. 
                            Ele terá acesso ao dashboard executivo e poderá gerenciar outros usuários.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => promoteToExecutive(user.id, user.display_name || user.user_id)}
                            className="bg-gradient-primary hover:opacity-90"
                          >
                            Promover a Executive
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            )
          })}

          {users.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum usuário encontrado.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}