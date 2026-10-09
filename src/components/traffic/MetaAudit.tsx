import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { arenaClient } from '@/lib/arena-api'
import { ROLE_LABELS, type UserRole } from '@/hooks/useRoles'
import type { MetaAuditEvent } from '@/lib/meta-leads'
import { errorMessage } from '@/lib/sales'

const actions: Record<string, string> = {
  'lead.received': 'Lead recebido', 'lead.approved': 'Lead aprovado', 'lead.rejected': 'Lead rejeitado',
  'lead.synced': 'Lead sincronizado com o CRM', 'lead.discarded': 'Lead descartado pelo SDR',
  'lead.completion_required': 'Cadastro pendente de complemento', 'lead.updated': 'Recebimento atualizado',
  'batch.received': 'Importação recebida', 'batch.approved': 'Importação aprovada',
  'batch.rejected': 'Importação rejeitada', 'batch.updated': 'Importação atualizada',
}
const entities = { lead: 'Lead', lead_batch: 'Planilha de leads', metrics_batch: 'Métricas' }

export function MetaAudit() {
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: ['meta-audit', user?.id, page], enabled: !!user, refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error, count } = await arenaClient.from('meta_audit_events').select('*', { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * 50, page * 50 + 49)
      if (error) throw error
      return { events: data as MetaAuditEvent[], count: count || 0 }
    },
  })
  return <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Auditoria de Tráfego</h2><p className="mt-1 text-sm text-muted-foreground">Recebimentos, aprovações, rejeições e sincronizações registrados com origem, responsável e horário. Registros disponíveis a partir da ativação deste fluxo.</p></div><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar</Button></div>
    {query.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error)}</p>}
    {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando auditoria…</p>}
    {query.data?.count === 0 && <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>}
    {query.data?.events.map(event => <article key={event.id} className="space-y-2 rounded-lg border border-border/60 p-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-medium">{actions[event.action] || event.action}</h3><time className="text-xs text-muted-foreground" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)</time></div>
      <p className="break-words text-xs text-muted-foreground">{event.origin === 'api' ? 'Meta API' : 'Planilha'} · {entities[event.entity_type]} · {event.summary.filename || event.entity_id}</p>
      <p className="break-words text-sm">{event.actor_name || event.actor_id || 'Integração automática'}{event.actor_roles.length > 0 && ' · ' + event.actor_roles.map(role => ROLE_LABELS[role as UserRole] || role).join(', ')}</p>
      {event.summary.rows !== undefined && <p className="text-xs text-muted-foreground">{event.summary.rows} linhas</p>}
      {(event.summary.note || event.summary.reason) && <p className="whitespace-pre-wrap break-words text-sm">Motivo: {event.summary.note || event.summary.reason}</p>}
      {event.summary.warning && <p className="break-words text-sm">Para completar: {event.summary.warning}</p>}
      {event.summary.result && <div className="space-y-2 text-sm"><p>{event.summary.result.crm} no CRM · {event.summary.result.queued} para completar · {event.summary.result.duplicates} duplicados · {event.summary.result.failed} com falha</p>{event.summary.result.issues?.length > 0 && <details><summary className="cursor-pointer">Conferir linhas com pendência</summary><ul className="mt-2 space-y-1">{event.summary.result.issues.map((issue, index) => <li key={index} className="break-words">Linha {issue.row}: {issue.reason}</li>)}</ul></details>}</div>}
      {event.summary.crm_lead_id && <p className="break-words text-xs text-muted-foreground">CRM: {event.summary.crm_lead_id}</p>}
    </article>)}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Página {page + 1} · {query.data?.count ?? '…'} eventos</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0 || query.isFetching} onClick={() => setPage(current => current - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={query.isFetching || !query.data || (page + 1) * 50 >= query.data.count} onClick={() => setPage(current => current + 1)}>Próxima</Button></div></div>
  </section>
}
