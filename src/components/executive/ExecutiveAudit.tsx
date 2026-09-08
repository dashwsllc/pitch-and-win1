import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, History, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { exactDate } from '@/lib/sales'

const labels: Record<string,string> = { 'sale.approve': 'Venda aprovada', 'sale.reject': 'Venda rejeitada', 'sale.delete': 'Venda excluída', 'sale.cancel': 'Solicitação cancelada', 'account.update': 'Conta alterada', 'permissions.update': 'Permissões alteradas', 'withdrawal.reject': 'Saque regularizado' }

export function ExecutiveAudit() {
  const { user } = useAuth()
  const [page,setPage] = useState(0)
  const query = useQuery({
    queryKey: ['executive-audit',user?.id,page],
    queryFn: async () => {
      const { data,error,count } = await supabase.from('executive_audit_events')
        .select('id, action, target_label, actor_name, reason, before_data, after_data, created_at',{count:'exact'}).order('created_at',{ascending:false}).range(page*15,page*15+14)
      if (error) throw error
      return { items:data,total:count ?? 0 }
    },
    enabled: !!user,
    refetchInterval: 30_000,
  })
  return <section className="surface-panel overflow-hidden rounded-2xl"><div className="flex items-center justify-between gap-3 border-b border-white/[0.06] p-6"><div><h2 className="flex items-center gap-2 text-lg font-medium text-white"><History className="h-5 w-5 text-electric" />Histórico administrativo</h2><p className="mt-1 text-xs text-muted-foreground">Quem alterou, quando e por quê. Registros preservados após exclusões.</p></div><Button variant="ghost" size="icon" aria-label="Atualizar auditoria" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /></Button></div><div className="space-y-3 p-4 sm:p-6">
    {query.isError && <p role="alert" className="text-sm text-destructive">Não foi possível consultar a auditoria. Tente atualizar.</p>}
    {query.isPending ? [1,2,3].map(n => <div key={n} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />) : query.data?.items.map(event => <article key={event.id} className="rounded-xl bg-white/[0.025] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"><div className="flex flex-wrap items-center justify-between gap-2"><Badge className={`border-0 text-[10px] ${event.action==='sale.delete' ? 'bg-rose-400/10 text-rose-300' : 'bg-electric-violet/10 text-violet-300'}`}>{labels[event.action] || event.action}</Badge><time title={event.created_at} dateTime={event.created_at} className="text-[10px] tabular-nums text-muted-foreground">{exactDate(event.created_at)} · Brasília</time></div><p className="mt-3 text-sm text-ash">{event.target_label}</p><p className="mt-1 text-xs text-muted-foreground">Por {event.actor_name}</p><p className="mt-3 border-t border-white/[0.05] pt-3 text-xs text-ash">{event.reason}</p><details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Ver dados registrados</summary><div className="mt-2 grid gap-2 sm:grid-cols-2"><div><p className="mb-1 font-medium">Antes</p><pre className="max-h-48 overflow-auto rounded bg-black/20 p-2 text-[10px]" data-lenis-prevent>{JSON.stringify(event.before_data,null,2)}</pre></div><div><p className="mb-1 font-medium">Depois</p><pre className="max-h-48 overflow-auto rounded bg-black/20 p-2 text-[10px]" data-lenis-prevent>{event.after_data ? JSON.stringify(event.after_data,null,2) : 'Venda excluída'}</pre></div></div></details></article>)}
    {query.data?.total===0 && <p className="py-8 text-center text-sm text-muted-foreground">As novas decisões e alterações aparecerão aqui.</p>}
    {query.data && query.data.total>0 && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{query.data.total} registros · página {page+1}</span><div className="flex gap-1"><Button size="icon" variant="ghost" disabled={page===0} onClick={() => setPage(p => p-1)} aria-label="Auditoria anterior"><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={(page+1)*15>=query.data.total} onClick={() => setPage(p => p+1)} aria-label="Próxima auditoria"><ChevronRight className="h-4 w-4" /></Button></div></div>}
  </div></section>
}
