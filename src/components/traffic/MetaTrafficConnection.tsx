import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { supabase } from '@/integrations/supabase/client'
import { fetchAllPages } from '@/lib/supabase-pages'
import { normalizeMetaAccountId } from '../../../shared/meta-identity'
import { trafficRunSummary, trafficOperationError, type MetaAdAccount, type MetaSyncRun, type TrafficOperation } from '@/lib/meta-connection'
import { refreshDashboardMutation } from '@/lib/sync'
import { errorMessage } from '@/lib/sales'

const runStatusLabel: Record<MetaSyncRun['status'], string> = { success: 'Concluída', error: 'Erro', running: 'Em andamento', partial: 'Captura parcial' }
export function useTrafficOperation(active: boolean) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['meta-traffic-operation', user?.id], enabled: active && !!user, queryFn: () => arenaRpc<TrafficOperation>('meta_traffic_operation', {}) })
}
export function TrafficOperationStatus({ runs, accountId, pending, published }: { runs: MetaSyncRun[]; accountId: string | null; pending: number; published?: { window_start: string; window_end: string } }) {
  const summary = trafficRunSummary(runs, accountId)
  return <div className="space-y-1 text-xs text-muted-foreground"><p>Última tentativa: {summary.lastAttempt ? runStatusLabel[summary.lastAttempt.status] : 'Sem captura registrada'}</p>
    <p>Última captura completa: {summary.lastComplete ? `${summary.lastComplete.window_start} a ${summary.lastComplete.window_end} · ${summary.lastComplete.rows_synced} linhas` : 'Ainda não confirmada'}</p>
    <p>Janela publicada: {published ? `${published.window_start} a ${published.window_end}` : 'Sem revisão API aprovada'}</p>
    <p>{pending} revisões pendentes · capturar não publica dados automaticamente.</p>
    {summary.error && <p role="alert" className="text-sm text-destructive">{summary.error}</p>}
  </div>
}
export function TrafficOperationIndicator({ active }: { active: boolean }) {
  const query = useTrafficOperation(active)
  if (query.isError) return <p role="alert" className="text-sm text-destructive">Não foi possível conferir a cobertura da sincronização. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></p>
  if (!query.data) return <p className="text-xs text-muted-foreground">Conferindo estado da sincronização…</p>
  const partial = query.data.runs.some(run => run.kind === 'insights' && ['partial', 'running'].includes(run.status))
  const pending = Object.values(query.data.pending).flatMap(Object.values).reduce((sum, count) => sum + count, 0)
  return <p className="text-xs text-muted-foreground">{partial ? 'Há capturas em andamento ou parciais. ' : ''}{pending} revisões API aguardam aprovação. Consulte Conexão para conferir capturas, erros e janelas publicadas.</p>
}

export function MetaTrafficConnection({ active, onProposeChange }: { active: boolean; onProposeChange: () => void }) {
  const { isExecutive } = useRoles()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [busy, setBusy] = useState(false)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const accountsQuery = useQuery({ queryKey: ['meta-ad-accounts', user?.id], enabled: active && !!user, queryFn: () =>
    fetchAllPages<MetaAdAccount>((from, to) => arenaClient.from('meta_ad_accounts').select('id,account_id,account_name,currency,timezone,status,connected_by,connected_at,paused_by,paused_at,paused_reason,updated_at').order('connected_at', { ascending: false }).range(from, to)) })
  const operation = useTrafficOperation(active)
  const accounts = accountsQuery.data || []
  const runs = operation.data?.runs || []
  const runningInsights = runs.some(run => run.kind === 'insights' && run.status === 'running')
  const reconciliation = runs.filter(run => run.kind === 'leads_reconciliation').sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
  const refresh = () => refreshDashboardMutation(queryClient)
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); if (!accountId.trim() || !accountName.trim()) return
    setBusy(true)
    try {
      await arenaRpc('meta_connect_ad_account', { p_account_id: normalizeMetaAccountId(accountId), p_account_name: accountName.trim() })
      setAccountId(''); setAccountName(''); await refresh()
      toast.success('Conta Meta conectada')
    } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) }
  }
  const disconnect = async () => {
    if (!disconnectId || reason.trim().length < 3) return
    setBusy(true)
    try {
      await arenaRpc('meta_disconnect_ad_account', { p_account_id: disconnectId, p_reason: reason.trim() })
      setDisconnectId(null); setReason(''); await refresh()
      toast.success('Conta Meta desconectada')
    } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) }
  }
  const syncNow = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('meta-insights-sync', { body: {} })
      if (error) {
        const context = (error as { context?: unknown }).context
        if (context instanceof Response) {
          const failure = await context.json().catch(() => null)
          const reason = failure?.error || failure?.results?.find((item: { error?: string }) => item.error)?.error
          if (reason) throw new Error(reason)
        }
        throw error
      }
      if (data?.ok === false) throw new Error('A sincronização falhou. Consulte o diagnóstico abaixo.')
      if (data?.partial) toast.info('Captura parcial salva. A retomada automática continuará; somente capturas completas geram revisões.')
      else if (data?.results?.every((item: { state?: string }) => item.state === 'skipped')) {
        toast.info(data.results.length ? 'Uma sincronização já está em andamento.' : 'Nenhuma conta ativa para sincronizar.')
      } else {
        toast.success('Métricas recebidas para aprovação em Tráfego')
      }
    } catch (cause) { toast.error(trafficOperationError(errorMessage(cause))) } finally {
      await refresh().catch(() => toast.warning('Atualize para conferir o estado da captura.'))
      setBusy(false)
    }
  }
  return <div className="space-y-5">
    <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-medium">Contas conectadas</h2><p className="mt-1 text-sm text-muted-foreground">Sincronização automática de métricas via API oficial da Meta, a cada 30 minutos, mais uma varredura diária mais profunda.</p></div>
        <Button size="sm" disabled={busy || runningInsights} onClick={() => void syncNow()}>{runningInsights ? 'Sincronizando…' : 'Sincronizar agora'}</Button></div>
      {operation.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o estado da sincronização. <Button variant="outline" size="sm" onClick={() => void operation.refetch()}>Tentar novamente</Button></p>}
      {accountsQuery.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(accountsQuery.error)}</p>}
      {!accountsQuery.isLoading && !accountsQuery.isError && !accounts.length && <p className="text-sm text-muted-foreground">Nenhuma conta Meta conectada ainda.</p>}
      {accounts.map(item => <div key={item.id} className="rounded-lg border border-border/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{item.account_name || item.account_id} <span className="text-xs text-muted-foreground">({item.account_id})</span></p>
          <p className="text-xs text-muted-foreground">{item.status === 'active' ? 'Ativa' : 'Pausada'} · conectada em {new Date(item.connected_at).toLocaleDateString('pt-BR')}</p></div>
          {isExecutive && item.status === 'active' && <Button size="sm" variant="outline" onClick={() => { setDisconnectId(item.account_id); setReason('') }}>Desconectar</Button>}</div>
        {(['campaign', 'adset', 'ad'] as const).map(level => <div key={level} className="mt-3 border-t pt-3"><p className="font-medium text-sm">{level === 'campaign' ? 'Campanhas' : level === 'adset' ? 'Conjuntos' : 'Anúncios'}</p><TrafficOperationStatus runs={runs.filter(run => run.level === level)} accountId={item.account_id} pending={operation.data?.pending[item.account_id]?.[level] || 0} published={operation.data?.published.find(review => review.account_id === item.account_id && review.level === level)} /></div>)}
        {disconnectId === item.account_id && <div className="mt-3 flex gap-2"><Input aria-label="Motivo da desconexão" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Motivo obrigatório" /><Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void disconnect()}>Confirmar</Button><Button size="sm" variant="ghost" onClick={() => setDisconnectId(null)}>Cancelar</Button></div>}
      </div>)}
      <div className="border-t border-border/60 pt-3"><p className="text-xs text-muted-foreground">Reconciliação de leads: {reconciliation ? runStatusLabel[reconciliation.status] : 'Nenhuma execução registrada'}</p>{reconciliation?.error_message && <p role="alert" className="text-sm text-destructive">{trafficOperationError(reconciliation.error_message)}</p>}<p className="text-xs text-muted-foreground">Reconciliação de leads de formulário roda a cada hora, recuperando entregas de webhook perdidas.</p></div>
    </section>
    {isExecutive ? <form onSubmit={connect} className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
      <div><h2 className="text-lg font-medium">Conectar conta</h2><p className="text-sm text-muted-foreground">Requer o token de sistema já configurado no servidor (ver documentação de configuração). Aqui você só informa qual conta sincronizar.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="meta-account-id">ID da conta (act_...)</Label><Input id="meta-account-id" required value={accountId} onChange={event => setAccountId(event.target.value)} /></div>
        <div><Label htmlFor="meta-account-name">Nome da conta</Label><Input id="meta-account-name" required value={accountName} onChange={event => setAccountName(event.target.value)} /></div></div>
      <Button disabled={busy}>Conectar</Button>
    </form> : <section className="surface-panel space-y-3 rounded-2xl p-5 sm:p-6"><h2 className="font-medium">Conectar/desconectar contas</h2><p className="text-sm text-muted-foreground">Somente Executive e Super Admin podem conectar ou desconectar contas Meta. Encontrou algo que precisa mudar?</p><Button size="sm" variant="outline" onClick={onProposeChange}>Propor alteração</Button></section>}
  </div>
}

