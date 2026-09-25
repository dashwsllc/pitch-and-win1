import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, Search, Users } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CRMContactFields } from '@/components/crm/CRMContactFields'
import { useAuth } from '@/hooks/useAuth'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { contactPayload, validateContact } from '@/lib/crm'
import { metaAnswers, metaContactDefaults, type MetaFormLead } from '@/lib/meta-leads'
import { fetchAllPages } from '@/lib/supabase-pages'
import { errorMessage } from '@/lib/sales'

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
const emptyLeads: MetaFormLead[] = []
function dateTime(value: string) { return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) }

function ImportDialog({ lead, onClose, onImported }: { lead: MetaFormLead; onClose: () => void; onImported: () => Promise<unknown> }) {
  const [contact, setContact] = useState(() => metaContactDefaults(lead))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const queryClient = useQueryClient()
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const invalid = validateContact(contact) || (!contact.email.trim() || !contact.athlete_birth_date || !contact.athlete_position
      ? 'Preencha e-mail, nascimento e posição antes de importar no CRM.' : null)
    if (invalid) { setFailure(invalid); return }
    setBusy(true); setFailure('')
    try {
      await arenaRpc<string>('meta_promote_form_lead', { p_id: lead.id, p_contact: contactPayload(contact) })
      await Promise.all([onImported(), queryClient.invalidateQueries({ queryKey: ['crm'] })])
      toast.success('Lead importado para o CRM')
      onClose()
    } catch (cause) { setFailure(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[730px]" data-lenis-prevent><DialogHeader><DialogTitle>Importar um lead para o CRM</DialogTitle><DialogDescription>Confira os dados recebidos do formulário e complete os campos exigidos pelo CRM. A transferência é individual e atômica.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><CRMContactFields value={contact} onChange={setContact} prefix="meta-lead" requireComplete />
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? 'Importando…' : 'Confirmar no CRM'}</Button></DialogFooter>
    </form></DialogContent></Dialog>
}

export default function Leads() {
  const { user } = useAuth()
  const [status, setStatus] = useState('novo')
  const [campaign, setCampaign] = useState('')
  const [form, setForm] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MetaFormLead | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [ignoreId, setIgnoreId] = useState<string | null>(null)
  const [ignoreReason, setIgnoreReason] = useState('')
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: ['meta-form-leads', user?.id], enabled: !!user,
    refetchInterval: 30_000,
    queryFn: () => fetchAllPages<MetaFormLead>((from, to) => arenaClient.from('meta_form_leads')
      .select('*').order('created_time', { ascending: false }).order('id').range(from, to)),
  })
  const all = query.data || emptyLeads
  const campaigns = useMemo(() => [...new Map(all.filter(row => row.campaign_id).map(row => [row.campaign_id, row.campaign_name || row.campaign_id])).entries()], [all])
  const forms = useMemo(() => [...new Map(all.filter(row => row.form_id && (!campaign || row.campaign_id === campaign)).map(row => [row.form_id, row.form_name || row.form_id])).entries()], [all, campaign])
  const visible = all.filter(row => {
    if (status !== 'todos' && row.status !== status) return false
    if (campaign && row.campaign_id !== campaign) return false
    if (form && row.form_id !== form) return false
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return !term || [row.full_name, row.phone, row.email, row.campaign_name, row.meta_lead_id].some(value => value.toLocaleLowerCase('pt-BR').includes(term))
  })
  const ignore = async () => {
    if (!ignoreId || ignoreReason.trim().length < 3) return
    setBusy(true)
    try {
      await arenaRpc('meta_ignore_form_lead', { p_id: ignoreId, p_reason: ignoreReason.trim() })
      await query.refetch()
      setIgnoreId(null); setIgnoreReason('')
      toast.success('Lead marcado como ignorado')
    } catch (cause) { toast.error(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <DashboardLayout><div className="mx-auto max-w-7xl space-y-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-3 text-3xl font-light"><Users className="h-7 w-7 text-ember" />Leads</h1><p className="mt-2 text-sm text-muted-foreground">Fila de formulários da Meta para triagem individual pelo SDR. As respostas originais permanecem disponíveis aqui após a importação para o CRM.</p></div><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={'mr-2 h-4 w-4 ' + (query.isFetching ? 'animate-spin' : '')} />Atualizar</Button></header>
    <div className="grid gap-3 sm:grid-cols-3">{[['Novos', all.filter(row => row.status === 'novo').length], ['No CRM', all.filter(row => row.status === 'importado').length], ['Ignorados', all.filter(row => row.status === 'ignorado').length]].map(([label, count]) => <div key={label} className="surface-panel rounded-xl p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>)}</div>
    <section className="surface-panel grid gap-3 rounded-2xl p-5 sm:grid-cols-2 lg:grid-cols-4"><div><Label htmlFor="lead-status">Situação</Label><select id="lead-status" className={selectClass} value={status} onChange={event => setStatus(event.target.value)}><option value="novo">Novos</option><option value="importado">No CRM</option><option value="ignorado">Ignorados</option><option value="todos">Todos</option></select></div><div><Label htmlFor="lead-campaign">Campanha</Label><select id="lead-campaign" className={selectClass} value={campaign} onChange={event => { setCampaign(event.target.value); setForm('') }}><option value="">Todas</option>{campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div><Label htmlFor="lead-form">Formulário</Label><select id="lead-form" className={selectClass} value={form} onChange={event => setForm(event.target.value)}><option value="">Todos</option>{forms.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div><Label htmlFor="lead-search">Buscar</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="lead-search" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome, telefone, e-mail ou ID" /></div></div></section>
    {query.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error)}</p>}
    {query.isLoading ? <p className="py-10 text-center text-muted-foreground">Carregando leads…</p> : !visible.length ? <section className="surface-panel rounded-2xl p-10 text-center"><p className="font-medium">Nenhum lead neste filtro</p><p className="mt-2 text-sm text-muted-foreground">Os formulários enviados pela Meta aparecerão aqui quando a integração estiver conectada e autorizada.</p></section> : <div className="space-y-3">{visible.map(row => <article key={row.id} className="surface-panel rounded-2xl p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium">{row.full_name || 'Nome não informado'}</h2><p className="mt-1 text-xs text-muted-foreground">{dateTime(row.created_time)} · {row.campaign_name || row.campaign_id || 'Campanha não informada'} · {row.form_name || row.form_id}</p><p className="mt-2 text-sm">{row.phone || 'Sem telefone'} · {row.email || 'Sem e-mail'}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? 'Ocultar respostas' : 'Ver respostas'}</Button>{row.status === 'novo' && <Button size="sm" onClick={() => setSelected(row)}>Importar no CRM</Button>}{row.status === 'importado' && <Link className="rounded-md border px-3 py-2 text-xs" to="/crm?tab=leads">Ver CRM</Link>}{row.status === 'ignorado' && <span className="text-xs text-muted-foreground">Ignorado: {row.ignored_reason}</span>}</div></div>
      {expanded === row.id && <div className="mt-4 border-t border-border/60 pt-4"><h3 className="text-sm font-medium">Respostas do formulário</h3><dl className="mt-2 grid gap-3 sm:grid-cols-2">{metaAnswers(row.field_data).map((answer, index) => <div key={index} className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{answer.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{answer.value || '—'}</dd></div>)}</dl>{Array.isArray(row.custom_disclaimer_responses) && row.custom_disclaimer_responses.length > 0 && <div className="mt-3"><h3 className="text-sm font-medium">Respostas de consentimento</h3><pre className="mt-2 overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs">{JSON.stringify(row.custom_disclaimer_responses, null, 2)}</pre></div>}<p className="mt-3 text-xs text-muted-foreground">Meta lead ID: {row.meta_lead_id} · Formulário: {row.form_id} · Anúncio: {row.ad_id || '—'}</p>{row.status === 'novo' && <div className="mt-4 max-w-lg space-y-2"><Button size="sm" variant="ghost" onClick={() => { setIgnoreId(row.id); setIgnoreReason('') }}>Ignorar este lead</Button>{ignoreId === row.id && <div className="flex gap-2"><Input aria-label="Motivo para ignorar" maxLength={500} value={ignoreReason} onChange={event => setIgnoreReason(event.target.value)} placeholder="Motivo obrigatório" /><Button size="sm" disabled={busy || ignoreReason.trim().length < 3} onClick={() => void ignore()}>Confirmar</Button></div>}</div>}</div>}
    </article>)}</div>}
    {selected && <ImportDialog key={selected.id} lead={selected} onClose={() => setSelected(null)} onImported={() => query.refetch()} />}
  </div></DashboardLayout>
}
