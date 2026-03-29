import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Crown, Shield, AlertTriangle, Users, Loader2 } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

interface UserWithRole {
  user_id: string
  display_name: string | null
  role: string
  crm_access: boolean
  granted_by: string | null
  granted_at: string | null
  commission_rate: number
}

export function CRMPermissionsReport() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [users, setUsers] = useState<UserWithRole[]>([])
  const [profiles, setProfiles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [showAnomalyOnly, setShowAnomalyOnly] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('*')
        .order('created_at', { ascending: true })

      if (rolesError) throw rolesError

      const { data: profilesData } = await supabase
        .from('profiles')
        .select('user_id, display_name')

      const profileMap: Record<string, string> = {}
      profilesData?.forEach(p => {
        if (p.display_name) profileMap[p.user_id] = p.display_name
      })
      setProfiles(profileMap)
      setUsers((rolesData || []) as UserWithRole[])
    } catch (err: any) {
      console.error('Error fetching roles:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const revokeCRMAccess = async (userId: string, userName: string) => {
    setRevoking(userId)
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ crm_access: false } as any)
        .eq('user_id', userId)

      if (error) throw error
      toast({ title: 'Acesso revogado', description: `${userName} não tem mais acesso ao CRM.` })
      fetchData()
    } catch (err: any) {
      toast({ title: 'Erro ao revogar', description: err.message, variant: 'destructive' })
    } finally {
      setRevoking(null)
    }
  }

  const executives = users.filter(u => u.role === 'executive')
  const crmUsers = users.filter(u => u.crm_access && u.role !== 'executive')
  const anomalies = crmUsers.filter(u => !u.granted_by)

  const displayUsers = showAnomalyOnly ? crmUsers.filter(u => !u.granted_by) : crmUsers

  const getName = (userId: string) => profiles[userId] || `Usuário ${userId.slice(0, 8)}...`
  const formatDate = (dt: string | null) => {
    if (!dt) return '—'
    return new Date(dt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Alerta de anomalia */}
      {anomalies.length > 0 && (
        <div className="p-4 bg-red-500/5 border border-red-500/30 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-400">
              ⚠️ Alerta de segurança: {anomalies.length} usuário(s) com acesso ao CRM sem registro de autorização
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Isso pode indicar manipulação direta no banco de dados. Verifique e revogue se necessário.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-red-500/50 text-red-400 hover:bg-red-500/10 flex-shrink-0"
            onClick={() => setShowAnomalyOnly(!showAnomalyOnly)}
          >
            {showAnomalyOnly ? 'Ver todos' : 'Revisar agora'}
          </Button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Painel Esquerdo - Executives */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-500" />
                Executives
              </span>
              <Badge className="bg-yellow-500/20 text-yellow-500">{executives.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {executives.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum executive cadastrado</p>
            ) : (
              executives.map(u => (
                <div key={u.user_id} className="flex items-center gap-3 p-3 rounded-lg border border-yellow-500/10 bg-yellow-500/5">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-yellow-500/20 text-yellow-600 text-xs font-bold">
                      {(profiles[u.user_id] || 'EX').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm">{getName(u.user_id)}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.user_id.slice(0, 12)}...</p>
                  </div>
                  <Badge className="bg-yellow-500/20 text-yellow-500 text-xs flex-shrink-0">
                    <Crown className="w-3 h-3 mr-1" />Executive
                  </Badge>
                </div>
              ))
            )}
            <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
              Estes usuários têm controle total sobre o CRM, aprovações e permissões.
            </p>
          </CardContent>
        </Card>

        {/* Painel Direito - Acesso CRM */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Acesso ao CRM concedido
              </span>
              <Badge variant="secondary">{crmUsers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {displayUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {showAnomalyOnly ? 'Nenhuma anomalia encontrada' : 'Nenhum usuário com acesso ao CRM'}
              </p>
            ) : (
              displayUsers.map(u => (
                <div key={u.user_id} className={`p-3 rounded-lg border ${!u.granted_by ? 'border-red-500/30 bg-red-500/5' : 'border-border/50'}`}>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                        {(profiles[u.user_id] || 'US').slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground text-sm">{getName(u.user_id)}</p>
                        {!u.granted_by && (
                          <Badge className="bg-red-500/20 text-red-400 text-xs">Sem registro</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {u.granted_by
                          ? `Autorizado por ${getName(u.granted_by)} em ${formatDate(u.granted_at)}`
                          : '⚠️ Sem registro de autorização'
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Comissão: <span className="text-primary font-medium">{u.commission_rate}%</span>
                      </p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/30 hover:bg-destructive/10 flex-shrink-0"
                          disabled={revoking === u.user_id}
                        >
                          {revoking === u.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Revogar'}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revogar acesso ao CRM?</AlertDialogTitle>
                          <AlertDialogDescription>
                            <strong>{getName(u.user_id)}</strong> perderá acesso ao CRM imediatamente e não poderá mais ver ou editar leads.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => revokeCRMAccess(u.user_id, getName(u.user_id))}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Revogar Acesso
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 px-4 text-center">
            <p className="text-3xl font-bold text-foreground">{executives.length}</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <Crown className="w-3 h-3 text-yellow-500" /> Executives
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3 px-4 text-center">
            <p className="text-3xl font-bold text-primary">{crmUsers.length}</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3 text-primary" /> Com acesso CRM
            </p>
          </CardContent>
        </Card>
        <Card className={`border-border/50 ${anomalies.length > 0 ? 'border-red-500/30 bg-red-500/5' : ''}`}>
          <CardContent className="pt-4 pb-3 px-4 text-center">
            <p className={`text-3xl font-bold ${anomalies.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {anomalies.length}
            </p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <AlertTriangle className={`w-3 h-3 ${anomalies.length > 0 ? 'text-red-400' : 'text-green-400'}`} />
              {anomalies.length > 0 ? 'Anomalias' : 'Anomalias (ok)'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
