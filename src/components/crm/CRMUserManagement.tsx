import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Users, Shield, Loader2 } from 'lucide-react'
import { useAllUsers } from '@/hooks/useRoles'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

export function CRMUserManagement() {
  const { users, loading, refetch } = useAllUsers()
  const { user } = useAuth()
  const { toast } = useToast()
  const [updatingUser, setUpdatingUser] = useState<string | null>(null)

  const toggleCRMAccess = async (userId: string, userName: string, grantAccess: boolean) => {
    setUpdatingUser(userId)
    try {
      const updateData: any = { crm_access: grantAccess }
      if (grantAccess) {
        updateData.granted_by = user?.id
        updateData.granted_at = new Date().toISOString()
      }

      const { error } = await supabase
        .from('user_roles')
        .update(updateData)
        .eq('user_id', userId)

      if (error) throw error

      toast({
        title: grantAccess ? 'Acesso concedido!' : 'Acesso revogado!',
        description: `${userName} ${grantAccess ? 'agora tem' : 'não tem mais'} acesso ao CRM.`
      })
      refetch()
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setUpdatingUser(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted rounded animate-pulse" />)}
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
          Gerenciar Acesso ao CRM ({users.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {users.map(u => {
            const role = u.user_roles?.[0]?.role || 'seller'
            const hasCRM = u.user_roles?.[0]?.crm_access || false
            const name = u.display_name || u.user_id

            return (
              <div key={u.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-gradient-primary text-white text-xs">
                      {name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-foreground text-sm">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs">{role}</Badge>
                      {hasCRM && <Badge className="bg-green-500/20 text-green-400 text-xs">CRM</Badge>}
                    </div>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant={hasCRM ? 'outline' : 'default'}
                      disabled={updatingUser === u.id}
                      className={hasCRM ? '' : 'bg-gradient-primary hover:opacity-90'}
                    >
                      {updatingUser === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : hasCRM ? 'Revogar' : 'Conceder'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{hasCRM ? 'Revogar acesso?' : 'Conceder acesso?'}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {hasCRM
                          ? `${name} perderá acesso ao CRM imediatamente.`
                          : `${name} terá acesso para visualizar e gerenciar leads no CRM.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => toggleCRMAccess(u.user_id, name, !hasCRM)}
                        className={hasCRM ? 'bg-destructive' : 'bg-gradient-primary'}
                      >
                        {hasCRM ? 'Revogar' : 'Conceder'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
