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
import { errorMessage, money } from '@/lib/sales'
import { refreshSalesData } from '@/lib/sync'

export function SaleEditor({ sale, onClose }: { sale: ManagedSale; onClose: () => void }) {
  const catalog = useProducts()
  const { isExecutive, isSuperAdmin } = useRoles()
  const assigneeDirectory = useSaleAssignees(isSuperAdmin)
  const client = useQueryClient()
  const { toast } = useToast()
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [assignmentReason, setAssignmentReason] = useState('')
  const [form, setForm] = useState({
    user_id: sale.user_id,
    product_id: sale.product_id ?? '', ticket_id: sale.ticket_id ?? '', valor_venda: String(sale.valor_venda),
    nome_comprador: sale.nome_comprador, email_comprador: sale.email_comprador,
    whatsapp_comprador: sale.whatsapp_comprador, consideracoes_gerais: sale.consideracoes_gerais ?? '',
  })
  const products = (catalog.data ?? []).filter(p => p.active && p.product_tickets.some(t => t.active))
  const tickets = products.find(p => p.id === form.product_id)?.product_tickets.filter(t => t.active) ?? []
  const sellerChanged = form.user_id !== sale.user_id
  const financialChanged = form.product_id !== (sale.product_id ?? '') || form.ticket_id !== (sale.ticket_id ?? '') || Number(form.valor_venda) !== Number(sale.valor_venda)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    if (financialChanged && (!form.product_id || !form.ticket_id)) { setFailure('Selecione o produto e o ticket.'); return }
    if (sellerChanged && assignmentReason.trim().length < 5) { setFailure('Informe o motivo da troca de responsável.'); return }
    submitting.current = true
    setBusy(true)
    setFailure('')
    try {
      const { error } = await supabase.rpc('manage_sale', {
        p_sale_id: sale.id, p_action: 'edit', p_expected_updated_at: sale.updated_at,
        p_data: { ...form, product_id: form.product_id || null, ticket_id: form.ticket_id || null, valor_venda: Number(form.valor_venda) },
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="edit-sale-product">Produto</Label>
              <select id="edit-sale-product" className={selectClass} value={form.product_id} disabled={catalog.isPending || catalog.isError} onChange={e => setForm({ ...form, product_id: e.target.value, ticket_id: '' })}>
                {!products.some(p => p.id === form.product_id) && <option value={form.product_id}>{sale.nome_produto} (registro atual)</option>}
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label htmlFor="edit-sale-ticket">Ticket</Label>
              <select id="edit-sale-ticket" className={selectClass} value={form.ticket_id} disabled={catalog.isPending || catalog.isError || !form.product_id} onChange={e => { const ticket = tickets.find(t => t.id === e.target.value); setForm({ ...form, ticket_id: e.target.value, valor_venda: ticket ? String(ticket.price) : form.valor_venda }) }}>
                <option value="">{sale.ticket_id ? 'Selecione o ticket' : 'Sem ticket no registro original'}</option>
                {form.ticket_id && !tickets.some(t => t.id === form.ticket_id) && <option value={form.ticket_id}>{sale.ticket_name || 'Ticket atual'} (registro atual)</option>}
                {tickets.map(t => <option key={t.id} value={t.id}>{t.name} — {money(t.price)}</option>)}
              </select>
            </div>
          </div>
          {catalog.isError && <p role="alert" className="text-sm text-destructive">Catálogo indisponível. Você pode atualizar os dados do comprador e tentar novamente para alterar o produto.</p>}
          <div className="space-y-2"><Label htmlFor="edit-sale-value">Valor da venda (R$)</Label><Input id="edit-sale-value" type="number" min="0.01" max="100000000" step="0.01" required readOnly={!isExecutive} value={form.valor_venda} onChange={e => setForm({ ...form, valor_venda: e.target.value })} />{!isExecutive && <p className="text-xs text-muted-foreground">O valor acompanha o ticket selecionado.</p>}</div>
          <div className="space-y-2"><Label htmlFor="edit-sale-buyer">Nome do comprador</Label><Input id="edit-sale-buyer" required minLength={2} maxLength={160} value={form.nome_comprador} onChange={e => setForm({ ...form, nome_comprador: e.target.value })} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="edit-sale-email">E-mail do comprador</Label><Input id="edit-sale-email" type="email" required maxLength={254} value={form.email_comprador} onChange={e => setForm({ ...form, email_comprador: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="edit-sale-phone">WhatsApp do comprador</Label><Input id="edit-sale-phone" type="tel" required minLength={5} maxLength={32} value={form.whatsapp_comprador} onChange={e => setForm({ ...form, whatsapp_comprador: e.target.value })} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="edit-sale-notes">Observações</Label><Textarea id="edit-sale-notes" maxLength={10000} value={form.consideracoes_gerais} onChange={e => setForm({ ...form, consideracoes_gerais: e.target.value })} /></div>
          {failure && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{failure}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={(financialChanged && (catalog.isPending || catalog.isError)) || (sellerChanged && assignmentReason.trim().length < 5)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar alterações</Button></DialogFooter>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>
}
