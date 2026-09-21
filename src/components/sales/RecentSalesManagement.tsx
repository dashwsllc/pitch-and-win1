import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Loader2, Pencil, RefreshCw, Search, ShoppingBag, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useManagedSales, type ManagedSale } from '@/hooks/useManagedSales'
import { useRoles } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'
import { errorMessage, exactDate, money, saleStatus } from '@/lib/sales'
import { refreshSalesData } from '@/lib/sync'
import { brasiliaLocalInputToIso, isoToBrasiliaLocalInput } from '@/lib/brasilia-time'
import { SaleEditor } from './SaleEditor'

export function RecentSalesManagement({ mineOnly = false }: { mineOnly?: boolean }) {
  const query = useManagedSales(mineOnly)
  const { isExecutive, capabilities, hasRole } = useRoles()
  const { user } = useAuth()
  const client = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<ManagedSale | null>(null)
  const [deleting, setDeleting] = useState<ManagedSale | null>(null)
  const [rescheduling, setRescheduling] = useState<ManagedSale | null>(null)
  const [rescheduledAt, setRescheduledAt] = useState('')
  const [rescheduleReason, setRescheduleReason] = useState('')
  const [rescheduleFailure, setRescheduleFailure] = useState('')
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const filtered = useMemo(() => (query.data ?? []).filter(sale =>
    (status === 'all' || sale.approval_status === status) &&
    `${sale.nome_comprador} ${sale.nome_produto} ${sale.ticket_name ?? ''}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))
  ), [query.data, search, status])
  const lastPage = Math.max(0, Math.ceil(filtered.length / 10) - 1)
  useEffect(() => { setPage(current => Math.min(current, lastPage)) }, [lastPage])
  const remove = async () => {
    if (!deleting || submitting.current) return
    submitting.current = true
    setBusy(true)
    setFailure('')
    try {
      const { error } = await supabase.rpc('manage_sale', {
        p_sale_id: deleting.id, p_action: 'delete', p_expected_updated_at: deleting.updated_at, p_reason: reason.trim(),
      })
      if (error) throw error
      await refreshSalesData(client)
      setDeleting(null)
      toast({ title: 'Venda excluída', description: 'Totais, indicadores e demais dados da Dashboard foram atualizados.' })
    } catch (error) { setFailure(errorMessage(error)) }
    finally { submitting.current = false; setBusy(false) }
  }
  const reschedule = async () => {
    if (!rescheduling || submitting.current) return
    const createdAt = brasiliaLocalInputToIso(rescheduledAt)
    if (!createdAt) { setRescheduleFailure('Informe uma data e um horário válidos.'); return }
    submitting.current = true
    setBusy(true)
    setRescheduleFailure('')
    try {
      const { error } = await supabase.rpc('super_admin_reschedule_sale', {
        p_sale_id: rescheduling.id,
        p_created_at: createdAt,
        p_reason: rescheduleReason.trim(),
        p_expected_created_at: rescheduling.created_at,
        p_expected_status: rescheduling.approval_status,
      })
      if (error) throw error
      await refreshSalesData(client)
      setRescheduling(null)
      toast({ title: 'Data da compra remarcada', description: 'Indicadores, metas e ranking foram sincronizados.' })
    } catch (error) { setRescheduleFailure(errorMessage(error)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <section id="vendas-registradas" aria-label="Gerenciamento das últimas vendas" className="surface-panel scroll-mt-20 overflow-hidden rounded-2xl">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-5">
      <div><h2 className="flex items-center gap-2 text-lg font-medium"><ShoppingBag className="h-5 w-5 text-primary" />Últimas vendas</h2><p className="mt-1 text-xs text-muted-foreground">{mineOnly || !isExecutive ? 'Suas vendas mais recentes.' : 'As vendas mais recentes da operação.'} Edições e correções atualizam a Dashboard.</p></div>
      <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />Atualizar vendas</Button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar últimas vendas">
        {[['all','Todas'],['aprovada','Aprovadas'],['pendente','Pendentes']].map(([value,label]) => <Button key={value} role="tab" aria-selected={status === value} variant={status === value ? 'secondary' : 'ghost'} size="sm" onClick={() => { setStatus(value); setPage(0) }}>{label}</Button>)}
      </div>
      <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar venda por comprador ou produto" placeholder="Buscar comprador ou produto" className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></div>
    </div>
    {!isExecutive && <p className="px-5 pb-3 text-xs text-muted-foreground">Você pode editar e excluir suas vendas pendentes. Vendas aprovadas são gerenciadas pela administração.</p>}
    {query.isError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Não foi possível atualizar as vendas. {errorMessage(query.error)}</p>}
    <div className="space-y-3 px-4 pb-5 sm:px-5">
      {query.isPending ? <p role="status" className="py-8 text-center text-muted-foreground">Carregando vendas...</p> : filtered.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda encontrada.</p> : filtered.slice(page * 10, page * 10 + 10).map(sale => {
        const canManage = isExecutive || (capabilities.sales && sale.user_id === user?.id && sale.approval_status === 'pendente')
        return <article key={sale.id} className="rounded-xl border border-border/50 bg-muted/20 p-4" aria-label={`Venda de ${sale.nome_comprador}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><p className="break-words font-medium">{sale.nome_comprador}</p><p className="mt-1 break-words text-sm text-muted-foreground">{sale.nome_produto}{sale.ticket_name ? ` · ${sale.ticket_name}` : ''}</p></div>
            <div className="ml-auto text-right"><p className="text-lg font-semibold tabular-nums">{money(sale.valor_venda)}</p><Badge className={`mt-1 ${saleStatus[sale.approval_status as keyof typeof saleStatus].color}`}>{sale.approval_status === 'aprovada' ? 'Aprovada' : 'Pendente'}</Badge></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><time dateTime={sale.created_at}>{exactDate(sale.created_at)} · Brasília</time>{hasRole('super_admin') && <Button size="sm" variant="outline" className="h-8 gap-1.5 border-amber-400/30 bg-amber-400/[0.07] px-2.5 text-xs text-amber-100 hover:bg-amber-400/[0.12]" aria-label={`Corrigir data da compra de ${sale.nome_comprador}`} title="Corrigir data e horário da compra" onClick={() => { setRescheduling(sale); setRescheduledAt(isoToBrasiliaLocalInput(sale.created_at, true)); setRescheduleReason(''); setRescheduleFailure('') }}><CalendarClock className="h-4 w-4" />Corrigir data</Button>}</div>
            {canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(sale)} aria-label={`Editar venda de ${sale.nome_comprador}`}><Pencil className="mr-1.5 h-3.5 w-3.5" />Editar</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => { setDeleting(sale); setReason(''); setFailure('') }} aria-label={`Excluir venda de ${sale.nome_comprador}`}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Excluir</Button></div>}
          </div>
        </article>
      })}
      <div className="flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground"><span>{filtered.length} vendas</span><div className="flex items-center gap-2"><Button size="icon" variant="ghost" disabled={!page} onClick={() => setPage(p => p - 1)} aria-label="Página anterior de vendas"><ChevronLeft className="h-4 w-4" /></Button><span>{page + 1} / {lastPage + 1}</span><Button size="icon" variant="ghost" disabled={page >= lastPage} onClick={() => setPage(p => p + 1)} aria-label="Próxima página de vendas"><ChevronRight className="h-4 w-4" /></Button></div></div>
    </div>
    {editing && <SaleEditor key={editing.id} sale={editing} onClose={() => setEditing(null)} />}
    <Dialog open={!!rescheduling} onOpenChange={open => { if (!open && !busy) setRescheduling(null) }}>
      <DialogContent data-lenis-prevent><DialogHeader><DialogTitle>Remarcar data da compra</DialogTitle><DialogDescription>{rescheduling?.nome_comprador} · {rescheduling?.nome_produto} · {money(rescheduling?.valor_venda ?? 0)}</DialogDescription></DialogHeader>
        <p className="text-xs text-muted-foreground">Registro atual: {exactDate(rescheduling?.created_at)} · Brasília. A data de aprovação não será alterada.</p>
        <div className="space-y-2"><Label htmlFor="recent-sale-created-at">Nova data e horário da compra (Brasília)</Label><Input id="recent-sale-created-at" type="datetime-local" step="1" max={isoToBrasiliaLocalInput(new Date().toISOString(), true)} value={rescheduledAt} onChange={event => setRescheduledAt(event.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><Label htmlFor="recent-sale-reschedule-reason">Motivo da correção (obrigatório)</Label><Textarea id="recent-sale-reschedule-reason" minLength={5} maxLength={2000} value={rescheduleReason} onChange={event => setRescheduleReason(event.target.value)} disabled={busy} placeholder="Ex.: venda registrada no dia incorreto" /></div>
        {rescheduleFailure && <p role="alert" className="text-sm text-destructive">{rescheduleFailure}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRescheduling(null)}>Cancelar</Button><Button disabled={busy || rescheduleReason.trim().length < 5 || !brasiliaLocalInputToIso(rescheduledAt) || Date.parse(brasiliaLocalInputToIso(rescheduledAt)!) > Date.now()} onClick={reschedule}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Remarcar e sincronizar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!deleting} onOpenChange={open => { if (!open && !busy) setDeleting(null) }}>
      <DialogContent data-lenis-prevent><DialogHeader><DialogTitle>Excluir venda?</DialogTitle><DialogDescription>{deleting?.nome_comprador} · {deleting?.nome_produto} · {money(deleting?.valor_venda ?? 0)}</DialogDescription></DialogHeader>
        <p className="text-sm text-muted-foreground">A venda será removida dos totais, indicadores, metas comerciais e gráficos. Esta ação não pode ser desfeita.</p>
        {isExecutive && <div className="space-y-2"><Label htmlFor="delete-sale-reason">Motivo da exclusão</Label><Textarea id="delete-sale-reason" minLength={5} maxLength={2000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></div>}
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={busy || (isExecutive && reason.trim().length < 5)} onClick={remove}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Excluir venda</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
