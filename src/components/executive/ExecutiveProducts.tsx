import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Package, Pencil, Plus, RefreshCw, Search, Ticket } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useProducts } from '@/hooks/useProducts'
import { useRoles } from '@/hooks/useRoles'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'
import { catalogError, parseTicketPrice, type Product, type ProductTicket } from '@/lib/products'
import { money } from '@/lib/sales'

type Editor = { kind: 'product'; product?: Product } | { kind: 'ticket'; product: Product; ticket?: ProductTicket }

export function ExecutiveProducts() {
  const catalog = useProducts()
  const { isExecutive } = useRoles()
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const products = catalog.data ?? []
  const filtered = products.filter(product =>
    `${product.name} ${product.description ?? ''} ${product.product_tickets.map(ticket => ticket.name).join(' ')}`
      .toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))

  if (!isExecutive) return null

  return <section className="surface-panel rounded-2xl">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] p-4 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium"><Package className="h-5 w-5 text-electric" />Produtos e tickets</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Crie produtos e defina os valores que os sellers podem vender. As alterações ficam disponíveis automaticamente.</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="icon" aria-label="Atualizar catálogo" disabled={catalog.isFetching} onClick={() => catalog.refetch()}>
          <RefreshCw className={`h-4 w-4 ${catalog.isFetching ? 'animate-spin' : ''}`} />
        </Button>
        <Button onClick={() => setEditor({ kind: 'product' })}><Plus className="mr-2 h-4 w-4" />Novo produto</Button>
      </div>
    </div>
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Buscar produtos ou tickets" placeholder="Buscar produtos ou tickets" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">{products.filter(product => product.active).length} produtos ativos · {products.length} no catálogo</p>
      </div>
      {catalog.isError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Não foi possível atualizar o catálogo. {catalogError(catalog.error)} Use o botão Atualizar catálogo para tentar novamente.</p>}
      {catalog.isPending ? <p role="status" className="py-8 text-center text-muted-foreground">Carregando catálogo...</p>
        : !catalog.isError && filtered.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p>{search ? 'Nenhum produto encontrado.' : 'Crie o primeiro produto com um ticket para começar a vender.'}</p>
        </div> : filtered.map(product => <article key={product.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words font-medium">{product.name}</h3>
                <Badge variant={product.active ? 'secondary' : 'outline'}>{product.active ? 'Ativo' : 'Inativo'}</Badge>
              </div>
              {product.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{product.description}</p>}
              {!product.active && <p className="mt-2 text-xs text-amber-300">Produto indisponível para novas vendas, incluindo todos os seus tickets.</p>}
              {product.active && !product.product_tickets.some(ticket => ticket.active) && <p className="mt-2 text-xs text-amber-300">Adicione ou ative um ticket para liberar este produto aos sellers.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditor({ kind: 'product', product })} aria-label={`Editar produto ${product.name}`}><Pencil className="mr-2 h-3.5 w-3.5" />Editar produto</Button>
              <Button variant="outline" size="sm" onClick={() => setEditor({ kind: 'ticket', product })} aria-label={`Novo ticket para ${product.name}`}><Plus className="mr-2 h-3.5 w-3.5" />Novo ticket</Button>
            </div>
          </div>
          <div className="divide-y divide-white/[0.05] border-t border-white/[0.06]">
            {[...product.product_tickets].sort((a, b) => Number(b.active) - Number(a.active) || a.price - b.price || a.name.localeCompare(b.name)).map(ticket =>
              <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
                  <Ticket className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="break-words text-sm">{ticket.name}</span>
                  {!ticket.active && <Badge variant="outline">Inativo</Badge>}
                </div>
                <div className="flex items-center gap-3"><span className="text-sm font-semibold tabular-nums">{money(ticket.price)}</span>
                  <Button variant="ghost" size="icon" aria-label={`Editar ticket ${ticket.name} de ${product.name}`} onClick={() => setEditor({ kind: 'ticket', product, ticket })}><Pencil className="h-4 w-4" /></Button>
                </div>
              </div>)}
            {product.product_tickets.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum ticket cadastrado.</p>}
          </div>
        </article>)}
      <p className="text-xs text-muted-foreground">Alterações de preço e disponibilidade valem para novas vendas. Vendas registradas mantêm os valores originais. Toda alteração fica na auditoria.</p>
    </div>
    {editor && <CatalogEditor editor={editor} onClose={() => setEditor(null)} />}
  </section>
}

function CatalogEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const isProduct = editor.kind === 'product'
  const product = editor.product
  const ticket = editor.kind === 'ticket' ? editor.ticket : undefined
  const creatingProduct = isProduct && !product
  const [name, setName] = useState(isProduct ? product?.name ?? '' : ticket?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [active, setActive] = useState(isProduct ? product?.active ?? true : ticket?.active ?? true)
  const [ticketName, setTicketName] = useState('Padrão')
  const [price, setPrice] = useState(ticket ? ticket.price.toFixed(2).replace('.', ',') : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy.current) return
    const amount = parseTicketPrice(price)
    if (name.trim().length < (isProduct ? 2 : 1)) {
      setError(isProduct ? 'Informe um nome com pelo menos 2 caracteres.' : 'Informe o nome do ticket.')
      return
    }
    if ((!isProduct || creatingProduct) && (amount === null || (creatingProduct && !ticketName.trim()))) {
      setError('Informe o nome do ticket e um preço entre R$ 0,01 e R$ 100.000.000,00, com até duas casas decimais.')
      return
    }
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const result = creatingProduct
        ? await supabase.rpc('executive_create_product', { p_name: name.trim(), p_description: description.trim(), p_active: active, p_ticket_name: ticketName.trim(), p_ticket_price: amount! })
        : isProduct
          ? await supabase.rpc('executive_save_product', { p_product_id: product!.id, p_name: name.trim(), p_description: description.trim(), p_active: active, p_expected_updated_at: product!.updated_at })
          : await supabase.rpc('executive_save_product_ticket', { p_ticket_id: ticket?.id ?? null, p_product_id: product!.id, p_name: name.trim(), p_price: amount!, p_active: active, p_expected_updated_at: ticket?.updated_at ?? null })
      if (result.error) throw result.error
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['executive-audit'] })
      toast({ title: creatingProduct ? 'Produto e ticket criados!' : isProduct ? 'Produto atualizado!' : 'Ticket salvo!', description: 'O catálogo dos sellers será atualizado automaticamente.' })
      onClose()
    } catch (err) {
      setError(catalogError(err))
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy.current) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-lenis-prevent>
      <DialogHeader>
        <DialogTitle>{isProduct ? product ? 'Editar produto' : 'Novo produto' : ticket ? 'Editar ticket' : 'Novo ticket'}</DialogTitle>
        <DialogDescription>{isProduct ? 'Defina o produto e sua disponibilidade para os sellers.' : `Defina o nome e o valor do ticket de ${product!.name}.`}</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="catalog-name">{isProduct ? 'Nome do produto' : 'Nome do ticket'} *</Label>
            <Input id="catalog-name" value={name} onChange={event => setName(event.target.value)} maxLength={isProduct ? 160 : 120} required autoFocus placeholder={isProduct ? 'Ex.: Mentoria avançada' : 'Ex.: Completo'} />
          </div>
          {isProduct && <div className="space-y-2"><Label htmlFor="catalog-description">Descrição</Label><Textarea id="catalog-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} placeholder="Detalhes que ajudam os sellers a identificar o produto" /></div>}
          {creatingProduct && <div className="space-y-2"><Label htmlFor="catalog-ticket-name">Nome do primeiro ticket *</Label><Input id="catalog-ticket-name" value={ticketName} onChange={event => setTicketName(event.target.value)} maxLength={120} required /></div>}
          {(!isProduct || creatingProduct) && <div className="space-y-2"><Label htmlFor="catalog-price">Preço do ticket (R$) *</Label><Input id="catalog-price" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} maxLength={20} placeholder="Ex.: 1.497,00" required /><p className="text-xs text-muted-foreground">Este será o valor da venda e a base para calcular a comissão.</p></div>}
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><Label htmlFor="catalog-active">{isProduct ? 'Produto ativo' : 'Ticket ativo'}</Label><p className="mt-1 text-xs text-muted-foreground">{isProduct ? 'Desative para suspender novas vendas deste produto.' : 'Disponível para novas vendas quando o produto também estiver ativo.'}</p></div><Switch id="catalog-active" checked={active} onCheckedChange={setActive} /></div>
          {!creatingProduct && <p className="text-xs text-muted-foreground">As vendas já registradas mantêm seu produto, ticket e valor original.</p>}
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Salvando...' : creatingProduct ? 'Criar produto e ticket' : 'Salvar alterações'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
