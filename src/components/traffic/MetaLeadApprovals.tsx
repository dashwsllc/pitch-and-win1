import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { metaAnswers, type MetaFormLead } from '@/lib/meta-leads'
import type { LeadImportResult } from '@/lib/meta-lead-import'
import { errorMessage } from '@/lib/sales'

export function FormAnswers({ fields }: { fields: unknown }) {
  const answers = metaAnswers(fields)
  return answers.length ? <dl className="mt-3 grid gap-3 sm:grid-cols-2">{answers.map((answer, index) =>
    <div key={index} className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{answer.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{answer.value || '—'}</dd></div>,
  )}</dl> : <p className="mt-3 text-sm text-muted-foreground">Nenhuma resposta adicional.</p>
}

export function MetaLeadApprovals({ canReview, onReviewed }: { canReview: boolean; onReviewed: () => Promise<unknown> }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const query = useQuery({
    queryKey: ['meta-lead-approvals', user?.id], enabled: !!user, refetchInterval: 30_000,
    queryFn: async () => {
      const { data, count, error } = await arenaClient.from('meta_form_leads').select('*', { count: 'exact' })
        .eq('approval_status', 'pendente').eq('status', 'novo').is('lead_import_batch_id', null)
        .order('received_at').order('id').limit(50)
      if (error) throw error
      return { leads: data as MetaFormLead[], count: count || 0 }
    },
  })
  const review = async (lead: MetaFormLead, action: 'aprovar' | 'rejeitar') => {
    if (action === 'rejeitar' && reason.trim().length < 3) return
    setBusy(lead.id)
    try {
      const result = await arenaRpc<LeadImportResult>('meta_review_form_lead', {
        p_id: lead.id, p_action: action, p_expected_updated_at: lead.updated_at,
        p_note: action === 'rejeitar' ? reason.trim() : '',
      })
      setRejecting(null); setReason('')
      toast.success(action === 'rejeitar' ? 'Lead rejeitado em Tráfego' : result.crm
        ? 'Lead aprovado e enviado à fila do CRM' : 'Lead aprovado. Disponível em Leads para o SDR completar o cadastro.')
      try { await onReviewed() } catch { toast.warning('Decisão registrada. Atualize a página para conferir a fila.') }
    } catch (cause) { toast.error(errorMessage(cause)); await query.refetch() }
    finally { setBusy(null) }
  }
  return <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Leads automáticos · {query.data?.count ?? '…'} pendentes</h2><p className="mt-1 text-sm text-muted-foreground">Confira as respostas antes de aprovar. Cadastros completos seguem para a fila compartilhada do CRM; os demais ficam em Leads para o SDR completar.</p></div><Button size="sm" variant="outline" disabled={query.isFetching || busy !== null} onClick={() => void query.refetch()}>Atualizar</Button></div>
    {query.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error)}</p>}
    {query.isLoading ? <p role="status" className="text-sm text-muted-foreground">Carregando leads…</p> : query.data?.count === 0 && <p className="text-sm text-muted-foreground">Nenhum lead automático aguardando aprovação.</p>}
    {query.data && query.data.count > 50 && <p className="text-xs text-muted-foreground">Mostrando os 50 mais antigos. A fila carrega os próximos após cada decisão.</p>}
    {query.data?.leads.map(lead => <article key={lead.id} className="rounded-xl border border-border/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{lead.full_name || 'Nome não informado'}</h3><p className="mt-1 break-words text-sm">{lead.phone || 'Sem telefone'} · {lead.email || 'Sem e-mail'}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(lead.created_time).toLocaleString('pt-BR')} · {lead.campaign_name || lead.campaign_id || 'Sem campanha'} · {lead.form_name || lead.form_id}</p></div>{canReview && <div className="flex gap-2"><Button size="sm" disabled={busy !== null} onClick={() => void review(lead, 'aprovar')}>{busy === lead.id ? 'Registrando…' : 'Aprovar lead'}</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { setRejecting(lead.id); setReason('') }}>Rejeitar</Button></div>}</div>
      <details className="mt-3"><summary className="cursor-pointer text-sm">Conferir respostas e origem</summary><FormAnswers fields={lead.field_data} />{Array.isArray(lead.custom_disclaimer_responses) && lead.custom_disclaimer_responses.length > 0 && <><h4 className="mt-3 text-sm font-medium">Consentimentos do formulário</h4><pre className="mt-2 overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs">{JSON.stringify(lead.custom_disclaimer_responses, null, 2)}</pre></>}<p className="mt-3 break-words text-xs text-muted-foreground">ID Meta: {lead.meta_lead_id} · Página: {lead.page_id} · Anúncio: {lead.ad_id || '—'}</p></details>
      {rejecting === lead.id && <div className="mt-3 space-y-2"><Input aria-label="Motivo da rejeição do lead" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Motivo obrigatório" /><div className="flex gap-2"><Button size="sm" variant="destructive" disabled={busy !== null || reason.trim().length < 3} onClick={() => void review(lead, 'rejeitar')}>Confirmar rejeição</Button><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRejecting(null)}>Cancelar</Button></div></div>}
    </article>)}
  </section>
}
