import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Clock3, Eye, Loader2, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSalesBoard } from '@/hooks/useSalesBoard'
import { useRoles } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'
import { errorMessage, exactDate, money, saleStatus, type TeamSale } from '@/lib/sales'

export function SalesBoard({ compact = false, management = false }: { compact?: boolean; management?: boolean }) {
  const [status, setStatus] = useState('pendente')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<{ sale: TeamSale; action: 'approve' | 'reject' | 'delete' | 'view' } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const { isExecutive } = useRoles()
  const { user } = useAuth()
  const canManage = management && isExecutive
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const pageSize = compact ? 5 : 12
  const query = useSalesBoard(status, debouncedSearch, page, pageSize)
  const summary = query.data?.summary

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (query.data && page > 0 && query.data.items.length === 0) setPage(p => Math.max(0, p - 1))
  }, [query.data, page])

  const choose = (sale: TeamSale, action: NonNullable<typeof selected>['action']) => { setReason(''); setSelected({ sale, action }) }
  const submit = async () => {
    if (!selected || selected.action === 'view' || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('executive_review_sale', {
        p_sale_id: selected.sale.id, p_action: selected.action, p_reason: reason.trim(), p_expected_status: selected.sale.approval_status,
      })
      if (error) throw error
      toast({ title: selected.action === 'approve' ? 'Venda aprovada e sincronizada' : selected.action === 'delete' ? 'Venda excluída. Registro preservado na auditoria.' : 'Venda rejeitada' })
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['sales-board'] })
      void queryClient.invalidateQueries({ queryKey: ['team-ranking'] })
      void queryClient.invalidateQueries({ queryKey: ['executive-audit'] })
      window.dispatchEvent(new Event('dashboard-data-changed'))
    } catch (error) { toast({ title: 'Ação não concluída', description: errorMessage(error), variant: 'destructive' }) }
    finally { setBusy(false) }
  }

  return (
    <section className="surface-panel overflow-hidden rounded-2xl" aria-label="Vendas do time">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] p-5 sm:px-6">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-electric"><ShieldCheck className="h-3.5 w-3.5" /> Operação transparente</div>
          <h2 className="text-lg font-medium tracking-tight text-white">{canManage ? 'Central de vendas' : 'Vendas do time'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{canManage ? 'Confira, aprove e acompanhe cada decisão.' : 'Da solicitação à aprovação. Acompanhe a evolução de todos.'}</p>
        </div>
        <div className="flex items-center gap-2">
          {compact && <Button asChild variant="ghost" size="sm"><Link to="/vendas-time">Ver todas <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}
          <Button variant="ghost" size="icon" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Atualizar vendas"><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>
      {!compact && <div className="grid gap-px border-b border-white/[0.06] bg-white/[0.05] sm:grid-cols-3">
        {[
          { label: 'Aguardando decisão', value: summary ? money(summary.pending_value) : '—', detail: `${summary?.pending ?? '—'} vendas pendentes`, color: 'text-amber-300' },
          { label: 'Receita aprovada', value: summary ? money(summary.approved_value) : '—', detail: `${summary?.approved ?? '—'} vendas confirmadas`, color: 'text-emerald-300' },
          { label: 'Atenção à fila', value: summary ? `${summary.overdue}` : '—', detail: 'Pendências há mais de 24 horas', color: 'text-ash' },
        ].map(metric => <div key={metric.label} className="bg-[#15101e] px-6 py-4"><p className="text-[11px] text-muted-foreground">{metric.label}</p><p className={`my-1.5 text-2xl font-light tabular-nums ${metric.color}`}>{metric.value}</p><p className="text-[11px] text-muted-foreground">{metric.detail}</p></div>)}
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6">
        <div className="flex gap-1 rounded-xl bg-black/20 p-1" role="tablist" aria-label="Status da venda">
          {(['pendente','aprovada',...(canManage ? ['rejeitada'] : [])] as const).map(key => <button key={key} role="tab" aria-selected={status===key} onClick={() => { setStatus(key); setPage(0) }} className={`rounded-lg px-3 py-2 text-xs transition-colors ${status===key ? 'bg-white/[0.08] text-white shadow-sm' : 'text-muted-foreground hover:text-white'}`}>
            {key==='pendente' ? 'Pendentes' : key==='aprovada' ? 'Aprovadas' : 'Rejeitadas'} <span className="ml-1.5 opacity-60">{summary?.[key==='pendente' ? 'pending' : key==='aprovada' ? 'approved' : 'rejected'] ?? '—'}</span>
          </button>)}
        </div>
        {!compact && <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar vendedor ou produto" className="h-9 border-white/[0.08] bg-white/[0.025] pl-9 text-xs" placeholder="Buscar vendedor ou produto" value={search} onChange={e => setSearch(e.target.value)} /></div>}
      </div>
      {query.isError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Falha ao atualizar vendas. {errorMessage(query.error)}{query.data ? ' Os dados abaixo são da última consulta bem-sucedida.' : ''}</p>}
      <div className="px-4 pb-4 sm:px-6">
        {query.isLoading ? <div className="space-y-2">{[1,2,3].map(x => <div key={x} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />)}</div>
          : query.data?.items.length === 0 ? <div className="py-10 text-center"><ShieldCheck className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" /><p className="text-sm text-ash">{status==='pendente' ? 'Nenhuma venda aguardando aprovação' : 'Nenhuma venda neste filtro'}</p><p className="mt-1 text-xs text-muted-foreground">As solicitações e decisões aparecem automaticamente aqui.</p></div>
          : <div className="space-y-2">{query.data?.items.map(sale => <article key={sale.id} className="group rounded-xl bg-white/[0.025] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] transition-colors hover:bg-white/[0.04]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-electric-violet/15 text-xs font-medium text-violet-200">{sale.seller_name.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
                <div className="min-w-0"><p className="text-sm font-medium text-ash">{sale.seller_name}{sale.user_id===user?.id && <span className="ml-2 text-[10px] text-ember">VOCÊ</span>}</p><p className="mt-1 break-words text-xs text-muted-foreground">{sale.nome_produto}{sale.ticket_name && <span className="mt-1 block">{sale.ticket_name}</span>}</p></div>
              </div>
              <div className="ml-auto text-right"><p className="text-lg font-medium tabular-nums text-white">{money(sale.valor_venda)}</p><Badge className={`mt-1 border text-[10px] ${saleStatus[sale.approval_status].color}`}>{sale.approval_status==='pendente' ? <Clock3 className="mr-1 h-3 w-3" /> : sale.approval_status==='aprovada' ? <Check className="mr-1 h-3 w-3" /> : <X className="mr-1 h-3 w-3" />}{saleStatus[sale.approval_status].label}</Badge></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3">
              <div className="text-[10px] text-muted-foreground"><time dateTime={sale.created_at} title={sale.created_at}>Solicitada em {exactDate(sale.created_at)} · Brasília</time>{sale.reviewed_at && <p className="mt-1">Revisada em <time dateTime={sale.reviewed_at} title={sale.reviewed_at}>{exactDate(sale.reviewed_at)}</time></p>}</div>
              {canManage && <div className="flex flex-wrap gap-1.5">
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => choose(sale,'view')}><Eye className="mr-1 h-3.5 w-3.5" />Detalhes</Button>
                {sale.approval_status==='pendente' && <><Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-rose-300" onClick={() => choose(sale,'reject')}>Rejeitar</Button><Button size="sm" className="h-8 bg-emerald-500/15 px-3 text-xs text-emerald-300 hover:bg-emerald-500/25" onClick={() => choose(sale,'approve')}><Check className="mr-1 h-3.5 w-3.5" />Aprovar</Button></>}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-300" onClick={() => choose(sale,'delete')} aria-label={`Excluir venda de ${sale.seller_name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>}
            </div>
          </article>)}</div>}
        {query.data && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><p>{query.data.total} resultados · consulta {exactDate(query.data.fetched_at)} · Brasília</p><div className="flex items-center gap-2"><Button variant="ghost" size="icon" className="h-8 w-8" disabled={page===0 || query.isFetching} onClick={() => setPage(p => p-1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button><span>{page+1} / {Math.max(1,Math.ceil(query.data.total/pageSize))}</span><Button variant="ghost" size="icon" className="h-8 w-8" disabled={(page+1)*pageSize>=query.data.total || query.isFetching} onClick={() => setPage(p => p+1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button></div></div>}
      </div>
      <Dialog open={!!selected} onOpenChange={open => { if (!open && !busy) setSelected(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-lenis-prevent>
          <DialogHeader><DialogTitle>{selected?.action==='delete' ? 'Excluir esta venda?' : selected?.action==='approve' ? 'Confirmar aprovação' : selected?.action==='reject' ? 'Rejeitar solicitação' : 'Detalhes da venda'}</DialogTitle><DialogDescription>{selected?.sale.seller_name} · {selected?.sale.nome_produto}{selected?.sale.ticket_name ? ` / ${selected.sale.ticket_name}` : null} · {money(selected?.sale.valor_venda ?? 0)}</DialogDescription></DialogHeader>
          {selected && <div className="space-y-4"><div className="rounded-xl bg-muted/30 p-4 text-sm"><p className="font-medium">{selected.sale.nome_comprador}</p><p className="mt-1 break-all text-muted-foreground">{selected.sale.email_comprador}</p><p className="text-muted-foreground">{selected.sale.whatsapp_comprador}</p><p className="mt-3 text-xs text-muted-foreground">{selected.sale.approval_status==='pendente' ? 'A comissão será calculada com a taxa vigente ao aprovar.' : `Comissão registrada: ${money(selected.sale.commission_amount ?? 0)}`}</p>{selected.sale.reviewer_name && selected.sale.reviewed_at && <p className="mt-1 text-xs text-muted-foreground">Revisado por {selected.sale.reviewer_name} · {exactDate(selected.sale.reviewed_at)}</p>}{selected.sale.rejection_reason && <p className="mt-2 text-xs text-rose-300">{selected.sale.rejection_reason}</p>}{selected.sale.consideracoes_gerais && <p className="mt-2 text-xs text-muted-foreground">{selected.sale.consideracoes_gerais}</p>}</div>
            {selected.action==='delete' && <p className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs leading-relaxed text-rose-200">A venda sairá das métricas, metas e ranking. A comissão será retirada do saldo. O histórico completo ficará na auditoria. Se houver comissão comprometida com saque, a exclusão será bloqueada até a regularização.</p>}
            {selected.action!=='view' && <div className="space-y-2"><Label htmlFor="decision-reason">{selected.action==='approve' ? 'Observação da conferência (opcional)' : 'Motivo obrigatório'}</Label><Textarea id="decision-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} rows={3} placeholder="Registre o contexto desta decisão" /></div>}
          </div>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>{selected?.action==='view' ? 'Fechar' : 'Cancelar'}</Button>{selected?.action!=='view' && <Button disabled={busy || (selected?.action!=='approve' && reason.trim().length<5)} variant={selected?.action==='delete' ? 'destructive' : 'default'} onClick={submit}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{selected?.action==='delete' ? 'Excluir e registrar na auditoria' : selected?.action==='approve' ? 'Aprovar venda' : 'Confirmar rejeição'}</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
