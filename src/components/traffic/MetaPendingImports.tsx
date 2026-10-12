import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { arenaRpc } from '@/lib/arena-api'
import { errorMessage } from '@/lib/sales'
import { metaEditFields } from '@/lib/meta-edit'
import { canApproveTrafficReview, decideTrafficReviews, fetchLegacyBatchRows, fetchTrafficReviewList, fetchTrafficReviewPart,
  trafficReviewOptions, trafficReviewPartKey, trafficReviewSeenKey, type TrafficReviewSummary, type TrafficReviewRow } from '@/lib/meta-traffic-queries'
import type { ImportRow } from '@/lib/meta-traffic'
import type { LeadImportRow } from '@/lib/meta-lead-import'
import { FormAnswers } from './FormAnswers'
import { MetaEditButton } from './MetaEditDialog'

export function TrafficReviewOverview({ summary: s }: { summary: TrafficReviewSummary }) {
  return <div><h3 className="break-words font-medium">{s.kind === 'metrics' ? 'Métricas' : 'Leads'} · {s.filename}</h3>
    <p className="text-sm text-muted-foreground">{s.row_count} linhas · {s.upsert_count} inclusões/atualizações · {s.remove_count} remoções · {s.conflict_count} conflitos</p>
    <p className="text-xs text-muted-foreground">{s.source.toUpperCase()} · {s.replaced_by_review_id ? 'Incorporado em revisão API' : s.kind === 'leads' && s.status === 'recebido' ? 'Recebida: os leads foram para as levas de aprovação' : s.status}{s.window_start && ` · ${s.window_start} a ${s.window_end}`} · {new Date(s.created_at).toLocaleString('pt-BR')}</p>
    {s.remove_count > 0 && <p className="mt-2 text-sm text-amber-600">A aprovação também remove {s.remove_count} registros publicados ausentes nesta captura. Confira as remoções nos detalhes.</p>}
  </div>
}
function PageControls({ offset, total, size, busy, change }: { offset: number; total: number; size: number; busy: boolean; change: (offset: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{total} registros · página {Math.floor(offset / size) + 1}</span><div className="flex gap-2">
    <Button size="sm" variant="outline" disabled={busy || offset === 0} onClick={() => change(Math.max(0, offset - size))}>Anterior</Button>
    <Button size="sm" variant="outline" disabled={busy || offset + size >= total} onClick={() => change(offset + size)}>Próxima</Button></div></div>
}
function MetricSnapshot({ label, value }: { label: string; value: object | null | undefined }) {
  const values = value as Record<string, unknown> | null
  return <div className="rounded-md bg-muted/30 p-3"><h4 className="font-medium">{label}</h4>{!values ? <p>Sem registro</p> : <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-2">{metaEditFields.metrics.filter(field => values[field.key] !== undefined).map(field => <div key={field.key} className="break-words"><dt className="inline text-muted-foreground">{field.label}: </dt><dd className="inline">{String(values[field.key] ?? '—')}</dd></div>)}</dl>}</div>
}
function ConflictActions({ summary, row, disabled, refresh }: { summary: TrafficReviewSummary; row: TrafficReviewRow; disabled: boolean; refresh: () => Promise<unknown> }) {
  const [action, setAction] = useState<'keep_published' | 'use_incoming' | 'use_edited' | 'remove'>('keep_published')
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const resolve = async () => {
    setBusy(true); setError('')
    try {
      await arenaRpc('meta_capture_review_resolve', { p_id: summary.id, p_version: summary.version!, p_row_no: row.row_no, p_action: action, p_payload: {}, p_reason: reason.trim() })
      toast.success('Conflito resolvido com auditoria')
      try { await refresh() } catch { toast.warning('Resolução registrada. Atualize para conferir.') }
    } catch (cause) { setError((cause as { code?: string })?.code === '40001' ? 'A revisão mudou. Recarregue antes de continuar.' : errorMessage(cause)); await refresh().catch(() => undefined) }
    finally { setBusy(false) }
  }
  return <div className="mt-3 space-y-3 rounded-lg border border-amber-500/50 p-3"><p className="font-medium">Conflito: escolha o valor que deve prevalecer</p>
    <MetricSnapshot label="Recebido da Meta" value={row.conflict_details?.incoming} />
    <select aria-label={`Resolução da linha ${row.row_no + 1}`} className="h-10 w-full rounded-md border bg-background px-3" value={action} disabled={busy || disabled} onChange={event => setAction(event.target.value as typeof action)}>
      <option value="keep_published" disabled={!row.before_snapshot}>Manter publicado</option><option value="use_incoming" disabled={!row.conflict_details?.incoming}>Usar recebido da Meta</option>
      <option value="use_edited">Usar valor editado</option><option value="remove" disabled={!row.before_snapshot}>Remover publicado</option></select>
    {action === 'use_edited' ? <MetaEditButton target={{ kind: 'metrics', id: summary.id, title: `Resolver linha ${row.row_no + 1}`, values: { ...row.payload }, captureVersion: summary.version!, captureRowNo: row.row_no, resolveConflict: true }} disabled={disabled || busy} onSaved={refresh} /> : <>
      <Textarea aria-label={`Motivo da resolução da linha ${row.row_no + 1}`} minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Motivo obrigatório da resolução" disabled={busy || disabled} />
      <Button size="sm" disabled={busy || disabled || reason.trim().length < 3 || (['keep_published', 'remove'].includes(action) && !row.before_snapshot) || (action === 'use_incoming' && !row.conflict_details?.incoming)} onClick={() => void resolve()}>{busy ? 'Salvando…' : 'Confirmar resolução'}</Button></>}
    {error && <p role="alert" className="text-destructive">{error}</p>}</div>
}
function ReviewCard({ summary: s, active, canReview, busy, history, refresh, decide, mark }: {
  summary: TrafficReviewSummary; active: boolean; canReview: boolean; busy: boolean; history: boolean;
  refresh: () => Promise<unknown>; decide: (reviews: TrafficReviewSummary[], action: 'aprovar' | 'rejeitar', note: string) => Promise<void>;
  mark: (key: string, eligible: boolean) => void;
}) {
  const { user } = useAuth(), [expanded, setExpanded] = useState(false), [offset, setOffset] = useState(0), [ack, setAck] = useState(false), [note, setNote] = useState('')
  const details = useQuery({ queryKey: trafficReviewPartKey(user?.id, s, offset), enabled: active && expanded && !!user, retry: false,
    queryFn: async () => s.format === 'capture-v1' ? fetchTrafficReviewPart({ id: s.id, version: s.version!, offset, limit: 500 })
      : { total: s.row_count, rows: (await fetchLegacyBatchRows(s.kind, s.id, s.updated_at)).slice(offset, offset + 500).map((payload, i) => ({ row_no: offset + i, payload, operation: 'upsert' as const, before_snapshot: null, edit_reason: null, conflict_details: null })) } })
  const mutable = canReview && !s.replaced_by_review_id && (s.format === 'legacy' || s.status === 'pendente')
  const eligible = canApproveTrafficReview(s, details.isSuccess && expanded, ack)
  const acknowledge = (checked: boolean) => { setAck(checked); mark(trafficReviewSeenKey(s), canApproveTrafficReview(s, details.isSuccess && expanded, checked)) }
  return <article className="space-y-3 rounded-lg border p-4"><TrafficReviewOverview summary={s} />
    <Button variant="outline" size="sm" onClick={() => { setExpanded(!expanded); if (expanded) { setAck(false); mark(trafficReviewSeenKey(s), false) } }}>{expanded ? 'Fechar detalhes' : 'Conferir detalhes'}</Button>
    {expanded && <div className="space-y-3">
      {details.isPending && <p role="status">Carregando esta revisão…</p>}
      {details.isError && <div role="alert" className="text-sm text-destructive"><p>{(details.error as { code?: string })?.code === '40001' ? 'A revisão mudou. Recarregue e confira a versão atual.' : errorMessage(details.error)}</p><Button variant="outline" size="sm" onClick={() => void refresh()}>Recarregar revisões</Button></div>}
      {details.data && <><div className="max-h-[32rem] space-y-3 overflow-auto">{details.data.rows.map(row => {
        const payload = row.payload as ImportRow & LeadImportRow
        return <div key={row.row_no} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">Linha {row.row_no + 1} · {row.operation === 'remove' ? 'Remoção proposta' : payload.full_name || payload.campaign_name || payload.campaign_id || 'Sem nome'}</p>
          {s.kind === 'metrics' ? <><MetricSnapshot label="Publicado antes" value={row.before_snapshot} /><MetricSnapshot label={row.operation === 'remove' ? 'Após aprovação: registro removido' : 'Após aprovação'} value={row.operation === 'remove' ? null : payload} /></>
            : <><p>{payload.phone || 'Sem telefone'} · {payload.email || 'Sem e-mail'} · Atleta: {payload.athlete_name || 'Não informado'}</p><FormAnswers fields={payload.field_data} /></>}
          {row.edit_reason && <p>Motivo: {row.edit_reason}</p>}
          {row.conflict_details && mutable ? <ConflictActions summary={s} row={row as TrafficReviewRow} disabled={busy} refresh={refresh} /> : mutable && row.operation === 'upsert' && <MetaEditButton disabled={busy} target={{ kind: s.kind, id: s.id, title: `Linha ${row.row_no + 1} · ${s.filename}`, values: { ...row.payload }, updatedAt: s.updated_at, historical: s.status === 'aprovado',
            ...(s.format === 'capture-v1' ? { captureVersion: s.version!, captureRowNo: row.row_no } : { batchId: s.id, rowIndex: row.row_no }) }} onSaved={refresh} />}
        </div>
      })}</div><PageControls offset={offset} total={details.data.total} size={500} busy={details.isFetching} change={next => { setOffset(next); acknowledge(false) }} /></>}
    </div>}
    {!history && canReview && s.status === 'pendente' && !s.replaced_by_review_id && <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} disabled={!details.isSuccess || !expanded || busy || s.conflict_count > 0} onChange={event => acknowledge(event.target.checked)} />Conferi o resumo, os dados e as remoções propostas desta versão.</label>
      <Textarea aria-label={`Observação da revisão ${s.filename}`} placeholder="Observação (obrigatória para rejeitar)" maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
      <div className="flex gap-2"><Button size="sm" disabled={busy || !eligible} onClick={() => void decide([s], 'aprovar', note)}>Aprovar revisão inteira</Button>
        <Button size="sm" variant="destructive" disabled={busy || note.trim().length < 3} onClick={() => void decide([s], 'rejeitar', note)}>Rejeitar</Button></div>
    </div>}
  </article>
}
export function MetaPendingImports({ active, canReview, onReviewed, history = false }: { active: boolean; canReview: boolean; onReviewed: () => Promise<unknown>; history?: boolean }) {
  const { user } = useAuth(), client = useQueryClient()
  const [offset, setOffset] = useState(0), [kind, setKind] = useState<'metrics' | 'leads' | null>(null), [seen, setSeen] = useState<Record<string, boolean>>({}), [busy, setBusy] = useState(false)
  const list = useQuery({ queryKey: ['meta-review-list', user?.id, history, kind, offset], ...trafficReviewOptions(active && !!user), queryFn: () => fetchTrafficReviewList({ kind, status: history ? null : 'pendente', offset, limit: 50 }) })
  const refresh = async () => { setSeen({}); await Promise.all([client.invalidateQueries({ queryKey: ['meta-review-list'] }), client.invalidateQueries({ queryKey: ['meta-review-detail'] }), onReviewed()]) }
  const decide = async (reviews: TrafficReviewSummary[], action: 'aprovar' | 'rejeitar', note: string) => {
    setBusy(true)
    try {
      const result = await decideTrafficReviews(reviews, action, note, refresh)
      if (result.recorded) toast.success(`${result.recorded} revisões ${action === 'aprovar' ? 'aprovadas' : 'rejeitadas'}`)
      for (const failure of result.failures) toast.error(failure.message)
      if (result.refreshFailed) toast.warning('Decisões registradas. Atualize a página para conferir os dados.')
    } finally { setBusy(false) }
  }
  const eligible = (list.data?.rows || []).filter(s => seen[trafficReviewSeenKey(s)] && canApproveTrafficReview(s, true, true))
  return <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-medium">{history ? 'Histórico de importações e revisões' : 'Importações e capturas pendentes'}</h2>
    <p className="text-sm text-muted-foreground">{history ? 'Lotes incorporados e revisões decididas são preservados. Edições de lotes aprovados corrigem o histórico; para alterar indicadores, edite o registro publicado.' : 'Confira cada revisão antes de aprovar. Uma decisão publica a revisão inteira, incluindo as remoções propostas.'}</p>
    <select aria-label="Tipo de importação" className="h-10 rounded-md border bg-background px-3 text-sm" value={kind || ''} onChange={event => { setKind(event.target.value as typeof kind || null); setOffset(0); setSeen({}) }}><option value="">Todos os tipos</option><option value="metrics">Métricas</option><option value="leads">Leads</option></select>
    {list.isError && <div role="alert"><p className="text-destructive">{errorMessage(list.error)}</p><Button variant="outline" onClick={() => void list.refetch()}>Tentar novamente</Button></div>}
    {list.isPending && <p role="status">Carregando revisões…</p>}
    {list.data?.count === 0 && <p className="text-sm text-muted-foreground">{history ? 'Nenhuma importação registrada.' : 'Nenhuma revisão pendente.'}</p>}
    {!history && canReview && !!list.data?.count && <Button className="h-auto whitespace-normal text-left" disabled={busy || !eligible.length} onClick={() => void decide(eligible, 'aprovar', '')}>Aprovar todas as conferidas nesta página ({eligible.length})</Button>}
    {list.data?.rows.map(s => <ReviewCard key={`${user?.id}:${trafficReviewSeenKey(s)}`} summary={s} active={active} history={history} canReview={canReview} busy={busy} refresh={refresh} decide={decide} mark={(key, value) => setSeen(current => ({ ...current, [key]: value }))} />)}
    <PageControls offset={offset} total={list.data?.count || 0} size={50} busy={list.isFetching || busy} change={next => { setOffset(next); setSeen({}) }} />
  </section>
}
