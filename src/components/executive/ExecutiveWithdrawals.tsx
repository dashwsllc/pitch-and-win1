import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Wallet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { supabase } from '@/integrations/supabase/client'
import { useAllUsers } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { money, exactDate, errorMessage } from '@/lib/sales'

export function ExecutiveWithdrawals() {
  const { user } = useAuth()
  const { users } = useAllUsers()
  const { toast } = useToast()
  const client = useQueryClient()
  const [selected,setSelected] = useState<string | null>(null)
  const [reason,setReason] = useState('')
  const [saving,setSaving] = useState(false)
  const [page,setPage] = useState(0)
  const query = useQuery({ queryKey:['executive-withdrawals',user?.id,page], enabled:!!user, refetchInterval:30_000,
    queryFn:async () => {
      const { data,error,count } = await supabase.from('saques').select('*',{count:'exact'}).in('status',['pendente','processando','aprovado']).order('created_at',{ascending:true}).range(page*15,page*15+14)
      if (error) throw error
      return { items:data,total:count ?? 0 }
    },
  })
  const regularize = async () => {
    if (!selected || saving) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('executive_cancel_withdrawal',{p_id:selected,p_reason:reason})
      if (error) throw error
      setSelected(null); setReason('')
      toast({title:'Saque rejeitado e reserva liberada',description:'O motivo foi registrado para o vendedor e na auditoria.'})
      void client.invalidateQueries({queryKey:['executive-withdrawals']})
      void client.invalidateQueries({queryKey:['executive-audit']})
      window.dispatchEvent(new Event('dashboard-data-changed'))
    } catch (error) { toast({title:'Não foi possível regularizar',description:errorMessage(error),variant:'destructive'}) }
    finally { setSaving(false) }
  }
  return <section className="surface-panel rounded-2xl p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-medium text-white"><Wallet className="h-5 w-5 text-electric" />Saques em revisão</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Confira valores reservados antes de excluir vendas. Uma solicitação incorreta pode ser rejeitada com motivo, liberando a reserva. Pagamentos já realizados permanecem preservados.</p>
    {query.isError && <p role="alert" className="mt-4 text-sm text-destructive">Não foi possível consultar saques. {errorMessage(query.error)}</p>}
    <div className="mt-5 space-y-2">{query.isPending ? <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" /> : query.data?.items.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.025] p-4"><div><p className="text-sm text-ash">{users.find(u => u.user_id===item.user_id)?.display_name || 'Vendedor'}</p><p className="mt-1 text-xs text-muted-foreground">{exactDate(item.created_at)} · Brasília · {item.status}</p><p className="mt-1 text-xs text-muted-foreground">Titular: {item.nome_titular || 'Não informado'}</p></div><div className="flex flex-wrap items-center gap-4"><p className="text-lg font-medium tabular-nums text-white">{money(item.valor_aprovado ?? item.valor_solicitado)}</p><Button variant="outline" size="sm" onClick={() => { setReason(''); setSelected(item.id) }}>Rejeitar solicitação</Button></div></article>)}
    {query.data?.total===0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum saque aguardando regularização.</p>}
    {query.data && query.data.total>15 && <div className="flex items-center justify-between pt-3 text-xs"><Button variant="ghost" size="sm" disabled={page===0} onClick={() => setPage(p => p-1)}>Anterior</Button><span>Página {page+1}</span><Button variant="ghost" size="sm" disabled={(page+1)*15>=query.data.total} onClick={() => setPage(p => p+1)}>Próxima</Button></div>}</div>
    <Dialog open={!!selected} onOpenChange={open => { if(!open && !saving) setSelected(null) }}><DialogContent><DialogHeader><DialogTitle>Rejeitar solicitação de saque?</DialogTitle><DialogDescription>A reserva será liberada. O vendedor poderá consultar o motivo. Nenhuma transferência bancária é executada por esta ação.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="withdrawal-reason">Motivo obrigatório</Label><Textarea id="withdrawal-reason" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></div><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setSelected(null)}>Cancelar</Button><Button variant="destructive" disabled={saving || reason.trim().length<5} onClick={regularize}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Rejeitar e liberar reserva</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
