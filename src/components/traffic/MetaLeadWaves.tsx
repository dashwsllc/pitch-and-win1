import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, FileSpreadsheet, Layers3, RadioTower, RotateCcw, Send, Undo2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { useLiveClockSelector } from '@/hooks/useLiveClock'
import { arenaRpc } from '@/lib/arena-api'
import type { Json } from '@/integrations/supabase/types'
import { errorMessage } from '@/lib/sales'
import {
  decisionMessage, elapsedLabel, leadClock, leadDateTimeShort, leadDay, leadSyncView, leadUrgency, urgencyClass, waveOutcomeLabel,
  waveRangeLabel, waveStatusLabel, type WaveDecision, type WaveDetail, type WaveLead, type WaveList, type WaveRetry, type WaveStatus, type WaveSummary,
} from '@/lib/meta-waves'
import { FormAnswers } from './FormAnswers'
import { MetaEditButton } from './MetaEditDialog'

type Filter = WaveStatus | 'todas'
const PAGE = 10
const filters: { value: Filter; label: string }[] = [
  { value: 'pendente', label: 'Pendentes' }, { value: 'aprovada', label: 'Aprovadas' }, { value: 'rejeitada', label: 'Rejeitadas' }, { value: 'todas', label: 'Todas' },
]
const statusTone: Record<WaveStatus, string> = {
  pendente: 'border-ember/40 bg-ember/10 text-ember',
  aprovada: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  rejeitada: 'border-white/15 bg-white/[0.04] text-muted-foreground',
}
const accent: Record<WaveStatus, string> = { pendente: 'before:bg-gradient-ember', aprovada: 'before:bg-emerald-500/70', rejeitada: 'before:bg-white/20' }
const stale = (cause: unknown) => (cause as { code?: string })?.code === '40001'

function Chip({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>
}

/** Tempo desde que o lead caiu, com a cor da urgência. Atualiza sozinho a cada 30 segundos. */
function Elapsed({ at, live }: { at: string; live: boolean }) {
  const view = useLiveClockSelector(now => `${leadUrgency(at, now.getTime())}|${elapsedLabel(at, now.getTime())}`, live ? 30_000 : 0)
  const [urgency, label] = view.split('|') as [keyof typeof urgencyClass, string]
  return label ? <Chip className={live ? urgencyClass[urgency] : 'border-white/10 text-muted-foreground'}>{label}</Chip> : null
}

export function MetaLeadWaves({ active, canReview, onReviewed }: { active: boolean; canReview: boolean; onReviewed: () => Promise<unknown> }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [filter, setFilter] = useState<Filter>('pendente')
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const list = useQuery({
    queryKey: ['meta-waves', user?.id, filter, offset], enabled: active && !!user, refetchInterval: active ? 20_000 : false,
    queryFn: () => arenaRpc<WaveList>('meta_wave_list', { p_status: filter === 'todas' ? null : filter, p_limit: PAGE, p_offset: offset }),
  })
  // A leva mais recente abre sozinha: é onde estão os leads que acabaram de cair.
  const data = list.data
  const waveRows = Array.isArray(data?.waves) ? data.waves : []
  const newestId = waveRows[0]?.id ?? null
  useEffect(() => { if (!touched && filter === 'pendente' && offset === 0 && newestId) setOpenId(newestId) }, [newestId, touched, filter, offset])
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['meta-waves'] }), client.invalidateQueries({ queryKey: ['meta-wave-leads'] }), client.invalidateQueries({ queryKey: ['meta-wave-badge'] })])
    try { await onReviewed() } catch { toast.warning('Decisão registrada. Atualize a página para conferir.') }
  }
  const rebuild = async () => {
    setRebuilding(true)
    try { await arenaRpc('meta_wave_rebuild', {}); toast.success('Levas pendentes reorganizadas pela data e hora dos leads') }
    catch (cause) { toast.error(errorMessage(cause)) }
    finally { setRebuilding(false); await refresh() }
  }
  return <section aria-labelledby="meta-waves-title" className="surface-panel space-y-5 rounded-2xl p-5 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h2 id="meta-waves-title" className="flex items-center gap-2 text-lg font-medium"><Layers3 className="h-5 w-5 text-ember" />Levas de leads</h2>
        <p className="mt-1 text-sm text-muted-foreground">Formulários da Meta e planilhas importadas, em levas de 20. A leva mais recente aparece primeiro e, dentro dela, o lead mais novo no topo, com a data e o horário exatos em que caiu. Ao aprovar, cada lead vai para o CRM do SDR com nome, WhatsApp, as respostas e o horário.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="status" aria-live="polite">
        <div className="surface-inset-glow rounded-xl px-4 py-2 text-center"><p className="text-2xl font-light tabular-nums">{data ? data.pending_leads : '…'}</p><p className="text-[11px] uppercase tracking-wide text-muted-foreground">leads aguardando</p></div>
        <div className="surface-inset-glow rounded-xl px-4 py-2 text-center"><p className="text-2xl font-light tabular-nums">{data ? data.pending_waves : '…'}</p><p className="text-[11px] uppercase tracking-wide text-muted-foreground">levas pendentes</p></div>
        {!!data?.failed_leads && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-center"><p className="text-2xl font-light tabular-nums text-rose-300">{data.failed_leads}</p><p className="text-[11px] uppercase tracking-wide text-rose-300/80">com falha no CRM</p></div>}
      </div>
    </header>
    {data?.newest_pending_lead_at && <p className="text-sm">Lead mais recente aguardando: <strong className="tabular-nums">{leadDateTimeShort(data.newest_pending_lead_at)}</strong> <Elapsed at={data.newest_pending_lead_at} live /></p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Filtrar levas" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
        {filters.map(item => <button key={item.value} role="tab" aria-selected={filter === item.value} onClick={() => { setFilter(item.value); setOffset(0); setOpenId(null); setTouched(item.value !== 'pendente') }}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${filter === item.value ? 'bg-white/[0.08] text-white' : 'text-muted-foreground hover:text-white'}`}>{item.label}</button>)}
      </div>
      <Button size="sm" variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>Atualizar</Button>
    </div>
    {data?.needs_rebuild && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <span>Chegaram leads fora da ordem (por exemplo, de uma planilha antiga). A reorganização automática roda a cada busca; se preferir, reorganize agora.</span>
      {canReview && <Button size="sm" variant="outline" disabled={rebuilding} onClick={() => void rebuild()}>{rebuilding ? 'Reorganizando…' : 'Reorganizar por horário'}</Button>}
    </div>}
    {list.isError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{errorMessage(list.error)}</p><Button size="sm" variant="outline" onClick={() => void list.refetch()}>Tentar novamente</Button></div>}
    {list.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando levas…</p>}
    {data && !waveRows.length && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">
      {filter === 'pendente' ? <><CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-400" />Nenhum lead aguardando aprovação. Leads novos aparecem aqui em segundos pela Meta (ou em até 5 minutos pela busca automática).</> : 'Nenhuma leva neste filtro.'}
    </div>}
    <div className="space-y-3">
      {waveRows.map((wave, index) => <WaveCard key={wave.id} wave={wave} newest={filter === 'pendente' && offset === 0 && index === 0} open={openId === wave.id} active={active}
        canReview={canReview} refresh={refresh} onToggle={() => { setTouched(true); setOpenId(openId === wave.id ? null : wave.id) }} />)}
    </div>
    {!!data && data.count > PAGE && <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{data.count} levas · página {Math.floor(offset / PAGE) + 1} de {Math.ceil(data.count / PAGE)}</span>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset === 0 || list.isFetching} onClick={() => { setOffset(Math.max(0, offset - PAGE)); setTouched(true) }}>Mais recentes</Button>
        <Button size="sm" variant="outline" disabled={offset + PAGE >= data.count || list.isFetching} onClick={() => { setOffset(offset + PAGE); setTouched(true) }}>Mais antigas</Button></div></div>}
  </section>
}

function WaveCard({ wave, newest, open, active, canReview, refresh, onToggle }: {
  wave: WaveSummary; newest: boolean; open: boolean; active: boolean; canReview: boolean; refresh: () => Promise<void>; onToggle: () => void
}) {
  return <article aria-label={`Leva ${wave.number}`} className={`relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015] before:absolute before:inset-y-0 before:left-0 before:w-1 ${accent[wave.status]}`}>
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Fechar' : 'Abrir'} leva ${wave.number}`}
      className="flex w-full flex-wrap items-center justify-between gap-3 p-4 pl-5 text-left transition-colors hover:bg-white/[0.02]">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-light">Leva #{wave.number}</h3>
          <Chip className={statusTone[wave.status]}>{waveStatusLabel[wave.status]}</Chip>
          {newest && <Chip className="border-ember/50 bg-gradient-ember text-white">Mais recente</Chip>}
          {wave.is_open && <Chip className="border-sky-500/40 bg-sky-500/10 text-sky-300"><RadioTower className="h-3 w-3" />Recebendo leads</Chip>}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5 tabular-nums text-ash"><Clock3 className="h-3.5 w-3.5" />{waveRangeLabel(wave)}</span>
          <span>{wave.lead_count} {wave.lead_count === 1 ? 'lead' : 'leads'} · {waveOutcomeLabel(wave)}</span></p>
        {wave.status !== 'pendente' && wave.reviewed_at && <p className="text-xs text-muted-foreground">{waveStatusLabel[wave.status]} em {leadDateTimeShort(wave.reviewed_at)}{wave.reviewed_by_name ? ` por ${wave.reviewed_by_name}` : ''}{wave.review_note ? ` · ${wave.review_note}` : ''}</p>}
      </div>
      <div className="flex items-center gap-3">
        {wave.status === 'pendente' && wave.last_lead_at && <Elapsed at={wave.last_lead_at} live />}
        {wave.failed > 0 && <Chip className="border-rose-500/40 bg-rose-500/10 text-rose-300"><AlertTriangle className="h-3 w-3" />{wave.failed} com falha</Chip>}
        <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
    </button>
    {open && <WavePanel wave={wave} active={active} canReview={canReview} refresh={refresh} />}
  </article>
}

function WavePanel({ wave, active, canReview, refresh }: { wave: WaveSummary; active: boolean; canReview: boolean; refresh: () => Promise<void> }) {
  const { user } = useAuth()
  const detail = useQuery({ queryKey: ['meta-wave-leads', user?.id, wave.id], enabled: active && !!user, refetchInterval: active ? 20_000 : false,
    queryFn: () => arenaRpc<WaveDetail>('meta_wave_leads', { p_wave: wave.id }) })
  const [excluded, setExcluded] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const leads = Array.isArray(detail.data?.leads) ? detail.data.leads : []
  const pending = leads.filter(lead => lead.approval_status === 'pendente')
  const toSend = pending.filter(lead => !excluded[lead.id])
  const reviewable = canReview && wave.status === 'pendente'
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try { await work() }
    catch (cause) {
      toast.error(stale(cause) ? 'A leva mudou enquanto você conferia (chegou ou saiu um lead). Recarregamos: confira e decida de novo.' : errorMessage(cause))
    } finally {
      // Qualquer resultado exige nova confirmação: a leva recarregada pode ter mudado.
      setBusy(false); setConfirming(false)
      await refresh().catch(() => undefined)
      await detail.refetch().catch(() => undefined)
    }
  }
  const decide = (action: 'aprovar' | 'rejeitar') => run(async () => {
    const result = await arenaRpc<WaveDecision>('meta_wave_decide', {
      p_wave: wave.id, p_action: action, p_lead_ids: pending.map(lead => lead.id),
      p_excluded: (action === 'aprovar' ? Object.entries(excluded).map(([id, reason]) => ({ id, reason })) : []) as unknown as Json,
      p_note: action === 'rejeitar' ? note.trim() : '',
    })
    toast.success(decisionMessage(result, action))
    if (action === 'aprovar' && result.failed) toast.warning(`${result.failed} ${result.failed === 1 ? 'lead não foi' : 'leads não foram'} ao CRM. Corrija os dados e use "Tentar de novo" na leva.`)
    setExcluded({}); setConfirming(false); setRejecting(false); setNote('')
  })
  const retry = (lead?: WaveLead) => run(async () => {
    const result = await arenaRpc<WaveRetry>('meta_wave_retry', { p_wave: wave.id, p_lead: lead?.id ?? null })
    if (!result.retried) toast.info('Nenhum lead com falha para reenviar.')
    else if (result.recovered === result.retried) toast.success(`${result.recovered} ${result.recovered === 1 ? 'lead enviado' : 'leads enviados'} ao CRM.`)
    else toast.warning(`${result.recovered} de ${result.retried} enviados. Confira o motivo nos que ainda falham.`)
  })
  const reopen = (lead?: WaveLead) => run(async () => {
    const result = await arenaRpc<{ reopened: number }>('meta_wave_reopen', lead ? { p_wave: null, p_lead: lead.id } : { p_wave: wave.id, p_lead: null })
    toast.success(`${result.reopened} ${result.reopened === 1 ? 'lead voltou' : 'leads voltaram'} para aprovação, na posição do horário em que caíram.`)
  })
  return <div className="space-y-3 border-t border-white/[0.06] p-4 pl-5">
    {detail.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando os leads da leva…</p>}
    {detail.isError && <div role="alert" className="text-sm text-destructive"><p>{errorMessage(detail.error)}</p><Button size="sm" variant="outline" onClick={() => void detail.refetch()}>Tentar novamente</Button></div>}
    {wave.status === 'aprovada' && wave.failed > 0 && canReview && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm">
      <span><AlertTriangle className="mr-1 inline h-4 w-4" />{wave.failed} {wave.failed === 1 ? 'lead aprovado ainda não está' : 'leads aprovados ainda não estão'} no CRM. Corrija o dado indicado (botão Editar) e reenvie.</span>
      <Button size="sm" disabled={busy} onClick={() => void retry()}><RotateCcw className="h-4 w-4" />Tentar de novo ({wave.failed})</Button>
    </div>}
    {wave.status === 'rejeitada' && canReview && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
      <span>Os leads desta leva estão guardados. Reabrir devolve todos para aprovação, na posição do horário em que caíram.</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void reopen()}><Undo2 className="h-4 w-4" />Reabrir leva</Button>
    </div>}
    <ol className="space-y-2" aria-label={`Leads da leva ${wave.number}, do mais recente para o mais antigo`}>
      {leads.map(lead => <li key={lead.id}><LeadCard lead={lead} canReview={canReview} reviewable={reviewable} busy={busy} excludedReason={excluded[lead.id]}
        onExclude={reason => setExcluded(current => ({ ...current, [lead.id]: reason }))}
        onInclude={() => setExcluded(current => { const next = { ...current }; delete next[lead.id]; return next })}
        onRetry={() => void retry(lead)} onReopen={() => void reopen(lead)} refresh={async () => { await detail.refetch(); await refresh() }} /></li>)}
    </ol>
    {reviewable && pending.length > 0 && <div className="sticky bottom-3 z-10 space-y-3 rounded-xl border border-white/[0.08] bg-[#120d1d]/95 p-4 shadow-[0_-12px_32px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm"><strong>{toSend.length}</strong> {toSend.length === 1 ? 'lead será enviado' : 'leads serão enviados'} ao CRM{Object.keys(excluded).length ? <> · <span className="text-muted-foreground">{Object.keys(excluded).length} tirados da leva (ficam guardados)</span></> : null}</p>
        <div className="flex flex-wrap gap-2">
          {!confirming ? <Button className="bg-gradient-ember text-white hover:opacity-90" disabled={busy || !toSend.length} onClick={() => { setConfirming(true); setRejecting(false) }}><Send className="h-4 w-4" />Aprovar leva #{wave.number}</Button>
            : <><Button className="bg-gradient-ember text-white hover:opacity-90" disabled={busy || !toSend.length} onClick={() => void decide('aprovar')}>{busy ? 'Enviando…' : `Confirmar envio de ${toSend.length} ${toSend.length === 1 ? 'lead' : 'leads'} ao CRM`}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</Button></>}
          {!rejecting && <Button variant="outline" disabled={busy} onClick={() => { setRejecting(true); setConfirming(false) }}><XCircle className="h-4 w-4" />Rejeitar leva</Button>}
        </div>
      </div>
      {rejecting && <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label={`Motivo da rejeição da leva ${wave.number}`} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Motivo obrigatório (os leads ficam guardados e podem ser reabertos)" />
        <Button variant="destructive" disabled={busy || note.trim().length < 3} onClick={() => void decide('rejeitar')}>Confirmar rejeição</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(false); setNote('') }}>Cancelar</Button>
      </div>}
    </div>}
  </div>
}

function LeadCard({ lead, canReview, reviewable, busy, excludedReason, onExclude, onInclude, onRetry, onReopen, refresh }: {
  lead: WaveLead; canReview: boolean; reviewable: boolean; busy: boolean; excludedReason?: string
  onExclude: (reason: string) => void; onInclude: () => void; onRetry: () => void; onReopen: () => void; refresh: () => Promise<unknown>
}) {
  const [excluding, setExcluding] = useState(false)
  const [reason, setReason] = useState('')
  const sync = leadSyncView(lead)
  const pending = lead.approval_status === 'pendente'
  const name = lead.full_name || 'Nome não informado'
  const syncTone = sync.key === 'enviado' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : sync.key === 'falhou' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
    : sync.key === 'rejeitado' ? 'border-white/15 text-muted-foreground' : 'border-ember/40 bg-ember/10 text-ember'
  return <article aria-label={`${name}, caiu em ${leadDay(lead.created_time)} às ${leadClock(lead.created_time)}`}
    className={`grid gap-4 rounded-xl border p-4 transition-opacity sm:grid-cols-[9.5rem_minmax(0,1fr)_auto] ${excludedReason ? 'border-dashed border-white/10 opacity-60' : 'border-white/[0.06] bg-white/[0.02]'}`}>
    <div className="space-y-1">
      <time dateTime={lead.created_time} className="block text-2xl font-light leading-none tabular-nums tracking-tight text-white">{leadClock(lead.created_time)}</time>
      <p className="text-xs tabular-nums text-muted-foreground">{leadDay(lead.created_time)}</p>
      <Elapsed at={lead.created_time} live={pending} />
      {!lead.time_known && <p className="text-[11px] text-amber-300" title={lead.import_warning || undefined}>Horário aproximado (planilha)</p>}
    </div>
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2"><h4 className="font-medium">{name}</h4><Chip className={syncTone}>{sync.key === 'enviado' && <CheckCircle2 className="h-3 w-3" />}{sync.label}</Chip>
        <Chip className="border-white/10 text-muted-foreground">{lead.source === 'planilha' ? <><FileSpreadsheet className="h-3 w-3" />Planilha{lead.batch_filename ? ` · ${lead.batch_filename}` : ''}</> : <><RadioTower className="h-3 w-3" />Formulário Meta</>}</Chip></div>
      <p className="break-words text-sm tabular-nums">{lead.phone || 'Sem WhatsApp'}{lead.email ? ` · ${lead.email}` : ''}</p>
      <p className="break-words text-xs text-muted-foreground">{lead.campaign_name || lead.campaign_id || 'Campanha não informada'}{lead.form_name ? ` · ${lead.form_name}` : ''}</p>
      {sync.detail && <p className={`break-words text-xs ${sync.key === 'falhou' ? 'text-rose-300' : 'text-muted-foreground'}`}>{sync.key === 'rejeitado' ? 'Motivo: ' : ''}{sync.detail}</p>}
      {excludedReason && <p className="text-xs text-amber-300">Será tirado da leva: {excludedReason}</p>}
      {lead.import_warning && sync.key !== 'falhou' && <p className="break-words text-xs text-muted-foreground">{lead.import_warning}</p>}
      <details className="pt-1"><summary className="cursor-pointer text-sm text-ash">Respostas do formulário</summary><FormAnswers fields={lead.field_data} />
        <p className="mt-2 break-words text-[11px] text-muted-foreground">ID {lead.meta_lead_id}{lead.received_at ? ` · recebido em ${leadDateTimeShort(lead.received_at)}` : ''}</p></details>
      {excluding && <div className="flex flex-col gap-2 pt-1 sm:flex-row"><Input aria-label={`Motivo para tirar ${name} da leva`} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Motivo (ex.: lead de teste, número inválido)" />
        <Button size="sm" disabled={reason.trim().length < 3} onClick={() => { onExclude(reason.trim()); setExcluding(false); setReason('') }}>Confirmar</Button>
        <Button size="sm" variant="ghost" onClick={() => { setExcluding(false); setReason('') }}>Cancelar</Button></div>}
    </div>
    {canReview && <div className="flex flex-row flex-wrap items-start gap-2 sm:flex-col sm:items-stretch">
      {(pending || sync.key === 'falhou') && <MetaEditButton target={{ kind: 'leads', id: lead.id, title: name }} disabled={busy} onSaved={refresh} />}
      {reviewable && pending && !excludedReason && !excluding && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setExcluding(true)}>Tirar da leva</Button>}
      {reviewable && excludedReason && <Button size="sm" variant="ghost" disabled={busy} onClick={onInclude}>Manter na leva</Button>}
      {sync.key === 'falhou' && <Button size="sm" disabled={busy} onClick={onRetry}><RotateCcw className="h-4 w-4" />Tentar de novo</Button>}
      {sync.key === 'rejeitado' && !lead.crm_lead_id && <Button size="sm" variant="outline" disabled={busy} onClick={onReopen}><Undo2 className="h-4 w-4" />Reabrir lead</Button>}
    </div>}
  </article>
}
