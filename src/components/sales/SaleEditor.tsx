import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useProducts } from '@/hooks/useProducts'
import { useRoles } from '@/hooks/useRoles'
import { useSaleAssignees } from '@/hooks/useSaleAssignees'
import { useToast } from '@/hooks/use-toast'
import type { ManagedSale } from '@/hooks/useManagedSales'
import { supabase } from '@/integrations/supabase/client'
import { errorMessage } from '@/lib/sales'
import { refreshSalesData } from '@/lib/sync'
import { lerValorEmReais, valorParaCampo } from '@/lib/valor-reais'

export function SaleEditor({ sale, onClose }: { sale: ManagedSale; onClose: () => void }) {
  const catalog = useProducts()
  const { isSuperAdmin } = useRoles()
  const assigneeDirectory = useSaleAssignees(isSuperAdmin)
  const client = useQueryClient()
  const { toast } = useToast()
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [assignmentReason, setAssignmentReason] = useState('')
  const [form, setForm] = useState({
    user_id: sale.user_id,
    product_id: sale.product_id ?? '', ticket_id: sale.ticket_id ?? '', valor_venda: valorParaCampo(sale.valor_venda),
    nome_comprador: sale.nome_comprador, email_comprador: sale.email_comprador,
    whatsapp_comprador: sale.whatsapp_comprador, consideracoes_gerais: sale.consideracoes_gerais ?? '',
  })
  const products = (catalog.data ?? []).filter(p => p.active)
  const sellerChanged = form.user_id !== sale.user_id
  const catalogChanged = form.product_id !== (sale.product_id ?? '') || form.ticket_id !== (sale.ticket_id ?? '')
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    const total = lerValorEmReais(form.valor_venda)
    if (total === null || total > 100000000) { setFailure('Informe um valor positivo em reais, de até 100.000.000,00.'); return }
    if (sellerChanged && assignmentReason.trim().length < 5) { setFailure('Informe o motivo da troca de responsável.'); return }
    submitting.current = true
    setBusy(true)
    setFailure('')
    try {
      const { error } = await supabase.rpc('manage_sale', {
        p_sale_id: sale.id, p_action: 'edit', p_expected_updated_at: sale.updated_at,
        p_data: { ...form, product_id: form.product_id || null, ticket_id: form.ticket_id || null, valor_venda: total,
          nome_comprador: form.nome_comprador.trim(), email_comprador: form.email_comprador.trim(), whatsapp_comprador: form.whatsapp_comprador.trim() },
        p_reason: sellerChanged ? assignmentReason.trim() : '',
      })
      if (error) throw error
      await refreshSalesData(client)
      toast({ title: 'Venda atualizada', description: 'Os dados da Dashboard foram atualizados.' })
      onClose()
    } catch (error) { setFailure(errorMessage(error)); void catalog.refetch() }
    finally { submitting.current = false; setBusy(false) }
  }
  const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" data-lenis-prevent>
      <DialogHeader><DialogTitle>Editar venda</DialogTitle><DialogDescription>{sale.nome_comprador} · {sale.nome_produto}</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          {isSuperAdmin && <div className="space-y-2">
            <Label htmlFor="edit-sale-assignee">Quem realizou a venda</Label>
            <select id="edit-sale-assignee" className={selectClass} value={form.user_id} disabled={assigneeDirectory.loading || !!assigneeDirectory.error} onChange={event => setForm({ ...form, user_id: event.target.value })}>
              {!assigneeDirectory.assignees.some(person => person.user_id === form.user_id) && <option value={form.user_id}>Responsável atual (conta indisponível)</option>}
              {assigneeDirectory.assignees.map(person => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">A troca atualiza comissão, saldo, ranking, metas e indicadores do responsável anterior e do novo.</p>
            {assigneeDirectory.error && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os responsáveis disponíveis.</p>}
          </div>}
          {isSuperAdmin && sellerChanged && <div className="space-y-2">
            <Label htmlFor="edit-sale-assignment-reason">Motivo da troca de responsável</Label>
            <Textarea id="edit-sale-assignment-reason" required minLength={5} maxLength={2000} value={assignmentReason} onChange={event => setAssignmentReason(event.target.value)} placeholder="Ex.: venda registrada no usuário incorreto" />
          </div>}
          <div className="space-y-2"><Label htmlFor="edit-sale-product">Produto</Label>
            <select id="edit-sale-product" className={selectClass} value={form.product_id} disabled={catalog.isPending || catalog.isError} onChange={e => setForm({ ...form, product_id: e.target.value, ticket_id: '' })}>
              <option value="">Sem produto do catálogo</option>
              {form.product_id && !products.some(p => p.id === form.product_id) && <option value={form.product_id}>{sale.nome_produto} (registro atual)</option>}
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {catalog.isError && <p role="alert" className="text-sm text-destructive">Catálogo indisponível. Você pode atualizar os dados do comprador e tentar novamente para alterar o produto.</p>}
          <div className="space-y-2"><Label htmlFor="edit-sale-value">Ticket (R$) *</Label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">R$</span>
              <Input id="edit-sale-value" inputMode="decimal" required className="pl-10" value={form.valor_venda} onChange={e => setForm({ ...form, valor_venda: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2"><Label htmlFor="edit-sale-buyer">Nome do comprador</Label><Input id="edit-sale-buyer" required minLength={2} maxLength={160} value={form.nome_comprador} onChange={e => setForm({ ...form, nome_comprador: e.target.value })} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="edit-sale-email">E-mail do comprador (opcional)</Label><Input id="edit-sale-email" type="email" maxLength={254} value={form.email_comprador} onChange={e => setForm({ ...form, email_comprador: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="edit-sale-phone">WhatsApp do comprador</Label><Input id="edit-sale-phone" type="tel" required minLength={8} maxLength={32} value={form.whatsapp_comprador} onChange={e => setForm({ ...form, whatsapp_comprador: e.target.value })} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="edit-sale-notes">Observações</Label><Textarea id="edit-sale-notes" maxLength={10000} value={form.consideracoes_gerais} onChange={e => setForm({ ...form, consideracoes_gerais: e.target.value })} /></div>
          {failure && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{failure}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={(catalogChanged && (catalog.isPending || catalog.isError)) || (sellerChanged && assignmentReason.trim().length < 5)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar alterações</Button></DialogFooter>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>
}
