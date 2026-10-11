import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { arenaClient } from '@/lib/arena-api'
import type { MetaFormLead } from '@/lib/meta-leads'
import type { MetaDailyRow } from '@/lib/meta-traffic'
import { errorMessage } from '@/lib/sales'
import { FormAnswers } from './MetaLeadApprovals'
import { MetaEditButton } from './MetaEditDialog'
import { MetaPendingImports } from './MetaPendingImports'

function Pagination({ page, count, busy, change }: { page: number; count: number; busy: boolean; change: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Página {page + 1} · {count} registros</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!page || busy} onClick={() => change(page - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={busy || (page + 1) * 50 >= count} onClick={() => change(page + 1)}>Próxima</Button></div></div>
}
export function MetaTrafficData({ canEdit, onSaved }: { canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const { user } = useAuth()
  const [leadPage, setLeadPage] = useState(0)
  const [metricPage, setMetricPage] = useState(0)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<'todos' | 'pendente' | 'aprovado' | 'rejeitado'>('todos')
  const [date, setDate] = useState('')
  const leads = useQuery({ queryKey: ['meta-edit-leads', user?.id, leadPage, name, status], enabled: !!user, refetchInterval: 30_000,
    queryFn: async () => {
      let request = arenaClient.from('meta_form_leads').select('*', { count: 'exact' })
      if (name.trim()) request = request.ilike('full_name', `%${name.trim()}%`)
      if (status !== 'todos') request = request.eq('approval_status', status)
      const { data, count, error } = await request.order('created_time', { ascending: false }).order('id').range(leadPage * 50, leadPage * 50 + 49)
      if (error) throw error
      return { rows: data as MetaFormLead[], count: count || 0 }
    } })
  const metrics = useQuery({ queryKey: ['meta-edit-metrics', user?.id, metricPage, date], enabled: !!user, refetchInterval: 30_000,
    queryFn: async () => {
      let request = arenaClient.from('meta_traffic_daily').select('*', { count: 'exact' })
      if (date) request = request.eq('date', date)
      const { data, count, error } = await request.order('date', { ascending: false }).order('id').range(metricPage * 50, metricPage * 50 + 49)
      if (error) throw error
      return { rows: data as MetaDailyRow[], count: count || 0 }
    } })
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Edite leads de qualquer situação e métricas publicadas. Toda correção exige motivo e fica na Auditoria. Cadastros vinculados são atualizados no CRM dos SDRs.</p>
    <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-medium">Leads · pendentes, aprovados e rejeitados</h2>
      <div className="flex flex-wrap gap-3"><Input className="max-w-xs" aria-label="Buscar lead pelo nome" placeholder="Buscar pelo nome" value={name} onChange={event => { setName(event.target.value); setLeadPage(0) }} /><select aria-label="Situação do lead" className="h-10 rounded-md border bg-background px-3 text-sm" value={status} onChange={event => { setStatus(event.target.value as 'todos' | 'pendente' | 'aprovado' | 'rejeitado'); setLeadPage(0) }}><option value="todos">Todas as situações</option><option value="pendente">Pendente</option><option value="aprovado">Aprovado</option><option value="rejeitado">Rejeitado</option></select></div>
      {leads.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(leads.error)}</p>}
      {leads.isLoading && <p role="status">Carregando leads…</p>}
      {leads.data?.count === 0 && <p className="text-sm text-muted-foreground">Nenhum lead encontrado.</p>}
      {leads.data?.rows.map(lead => <article key={lead.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{lead.full_name || 'Nome não informado'}</h3><p className="text-sm">{lead.phone || 'Sem telefone'} · {lead.email || 'Sem e-mail'}</p><p className="mt-1 text-xs text-muted-foreground">{lead.approval_status} · {lead.crm_lead_id ? 'Vinculado ao CRM' : 'Sem vínculo CRM'} · {lead.campaign_name || lead.campaign_id || 'Sem campanha'}</p></div>{canEdit && <MetaEditButton target={{ kind: 'leads', id: lead.id, title: lead.full_name || 'Lead' }} onSaved={onSaved} />}</div><details className="mt-3"><summary className="cursor-pointer text-sm">Respostas e origem</summary><FormAnswers fields={lead.field_data} /><p className="mt-3 break-words text-xs text-muted-foreground">ID Meta: {lead.meta_lead_id} · {new Date(lead.created_time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)</p></details></article>)}
      <Pagination page={leadPage} count={leads.data?.count || 0} busy={leads.isFetching} change={setLeadPage} />
    </section>
    <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-medium">Métricas publicadas · todas as contas e níveis</h2><Input type="date" className="max-w-xs" aria-label="Filtrar métricas por data" value={date} onChange={event => { setDate(event.target.value); setMetricPage(0) }} />
      {metrics.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(metrics.error)}</p>}
      {metrics.isLoading && <p role="status">Carregando métricas…</p>}
      {metrics.data?.count === 0 && <p className="text-sm text-muted-foreground">Nenhuma métrica publicada encontrada.</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Data / conta</th><th className="p-2">Campanha / nível</th><th className="p-2">Gasto</th><th className="p-2">Leads</th><th className="p-2">Compras</th><th className="p-2"><span className="sr-only">Ações</span></th></tr></thead><tbody>{metrics.data?.rows.map(row => <tr key={row.id} className="border-b"><td className="p-2">{row.date}<p className="text-xs text-muted-foreground">{row.account_name || row.account_id}</p></td><td className="p-2">{row.campaign_name}<p className="text-xs text-muted-foreground">{row.level} · {row.ad_name || row.adset_name || row.campaign_id}</p></td><td className="p-2">{Number(row.spend).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td className="p-2">{row.leads}</td><td className="p-2">{row.purchases}</td><td className="p-2">{canEdit && <MetaEditButton target={{ kind: 'metrics', id: row.id, title: row.campaign_name, updatedAt: row.updated_at, values: { ...row } }} onSaved={onSaved} />}</td></tr>)}</tbody></table></div>
      <Pagination page={metricPage} count={metrics.data?.count || 0} busy={metrics.isFetching} change={setMetricPage} />
    </section>
  </div>
}

export function MetaImportEdits({ active, canEdit, onSaved }: { active: boolean; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  return <MetaPendingImports active={active} canReview={canEdit} onReviewed={onSaved} history />
}
