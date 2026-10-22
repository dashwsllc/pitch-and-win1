import { useMemo, useState } from 'react'
import { Send, SquareX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { PIPELINE_STAGES, type CRMLead } from '@/hooks/useCRM'
import { useCRMVoxenActions, useCRMVoxenStates } from '@/hooks/useCRMVoxen'
import { errorMessage } from '@/lib/sales'
import { canStopVoxen, describeSend, describeStop, selectableIn, VOXEN_FILTERS, VOXEN_TONE_CLASS, voxenFilterOf, voxenStatusText, voxenViewOf, type VoxenFilter, type VoxenRowData } from '@/lib/voxen-send'

const leadTitle = (lead: CRMLead) => lead.athlete_name?.trim() || lead.name

/** Tela da seção VOXEN do CRM: escolher leads (um a um ou vários) e enviar. Sem janela de confirmação. */
export function VoxenSectionView({ rows, filter, search, selected, ready, supported, busy, progress, notice, loading, failure, onFilter, onSearch, onToggle, onToggleAll, onClear, onSend, onStop, onRead, onRetry }: {
  rows: VoxenRowData<CRMLead>[]; filter: VoxenFilter; search: string; selected: ReadonlySet<string>; ready: boolean; supported: boolean; busy: boolean
  progress: { done: number; total: number } | null; notice?: string | null; loading: boolean; failure: unknown
  onFilter: (value: VoxenFilter) => void; onSearch: (value: string) => void; onToggle: (leadId: string) => void; onToggleAll: (leadIds: string[]) => void
  onClear: () => void; onSend: (leadIds: string[]) => void; onStop: (leadIds: string[]) => void; onRead: (leadId: string) => void; onRetry: () => void
}) {
  const counts = Object.fromEntries(VOXEN_FILTERS.map(item => [item.value, rows.filter(row => row.filter === item.value).length])) as Record<VoxenFilter, number>
  const term = search.trim().toLocaleLowerCase()
  const visible = rows.filter(row => row.filter === filter && (!term || `${row.lead.name} ${row.lead.athlete_name ?? ''}`.toLocaleLowerCase().includes(term)))
  const selectable = visible.filter(row => selectableIn(filter, row, ready)).map(row => row.lead.id)
  const chosen = selectable.filter(id => selected.has(id))
  const sending = filter === 'available' || filter === 'stopped'
  const stopping = filter === 'sent' || filter === 'problem'
  const allChosen = selectable.length > 0 && chosen.length === selectable.length
  return <section aria-label="Enviar leads para a VOXEN" className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
    <div>
      <h2 className="font-semibold">Enviar leads para a VOXEN</h2>
      <p className="mt-1 text-xs text-muted-foreground">Leads que ainda não se cadastraram na VOXEN. Quem você enviar fica em sincronia: cada mudança neste CRM (dados do atleta, observações, notas, respostas do formulário) segue sozinha. Quem já se cadastrou lá sincroniza automaticamente.</p>
    </div>
    {!supported && !loading && <p role="status" className="text-xs text-muted-foreground">O envio para a VOXEN ainda não está disponível neste ambiente.</p>}
    {supported && !ready && !loading && <p role="status" className="rounded-md border border-amber-300/40 p-2 text-xs text-amber-300">Aguardando a Zyron liberar o recebimento de leads sem cadastro. Os botões de envio ficam desativados até lá.</p>}
    {failure ? <div role="alert" className="space-y-2 text-sm text-destructive">Não foi possível carregar: {errorMessage(failure)} <Button size="sm" variant="outline" onClick={onRetry}>Tentar novamente</Button></div> : null}
    {loading && <p role="status" className="text-xs">Carregando…</p>}
    {supported && !loading && !failure && <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situação dos leads">
        {VOXEN_FILTERS.map(item => <Button key={item.value} size="sm" variant={filter === item.value ? 'default' : 'outline'} aria-pressed={filter === item.value} onClick={() => onFilter(item.value)}>{item.label} · {counts[item.value]}</Button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Buscar lead" placeholder="Buscar responsável ou atleta" className="h-9 max-w-xs text-sm" value={search} onChange={event => onSearch(event.target.value)} />
        {(sending || stopping) && <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox aria-label={`Selecionar todos (${selectable.length})`} checked={allChosen} disabled={!selectable.length || busy} onCheckedChange={() => onToggleAll(selectable)} />
          Selecionar todos ({selectable.length})
        </label>}
        {chosen.length > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>Limpar seleção</Button>}
        {sending && <Button size="sm" disabled={!chosen.length || !ready || busy} onClick={() => onSend(chosen)}><Send className="mr-1.5 h-3.5 w-3.5" />Enviar para a VOXEN ({chosen.length})</Button>}
        {stopping && <Button size="sm" variant="outline" disabled={!chosen.length || busy} onClick={() => onStop(chosen)}><SquareX className="mr-1.5 h-3.5 w-3.5" />Parar de sincronizar ({chosen.length})</Button>}
      </div>
      {progress && <p role="status" className="text-xs">{`Enviando ${progress.done} de ${progress.total}…`}</p>}
      {notice && <p role="status" className="text-xs text-amber-300">{notice}</p>}
      {visible.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Nenhum lead nesta situação{term ? ' para essa busca' : ''}.</p>
        : <ul className="space-y-1.5">
          {visible.map(row => {
            const text = voxenStatusText(row.view, row.at), canPick = selectableIn(filter, row, ready)
            return <li key={row.lead.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/80 p-2">
              <Checkbox aria-label={`Selecionar ${leadTitle(row.lead)}`} checked={selected.has(row.lead.id)} disabled={!canPick || busy} onCheckedChange={() => onToggle(row.lead.id)} />
              <div className="min-w-0 flex-1">
                <button type="button" className="max-w-full truncate text-left text-sm font-medium underline-offset-2 hover:underline" onClick={() => onRead(row.lead.id)}>{leadTitle(row.lead)}</button>
                <p className="truncate text-[11px] text-muted-foreground">{row.lead.athlete_name?.trim() ? `Responsável: ${row.lead.name} · ` : ''}{PIPELINE_STAGES.find(stage => stage.value === row.lead.pipeline_stage)?.label ?? row.lead.pipeline_stage}</p>
              </div>
              {!row.hasContext && row.view === 'available' && <Badge variant="outline" className="h-5 px-2 text-[10px]">Sem contexto</Badge>}
              <span className={`text-xs font-medium ${VOXEN_TONE_CLASS[text.tone]}`} title={text.detail ?? undefined}>{text.label}</span>
              {(row.view === 'available' || row.view === 'stopped') && <Button size="sm" variant="outline" disabled={!canPick || busy} onClick={() => onSend([row.lead.id])}>Enviar</Button>}
              {canStopVoxen(row.view) && <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => onStop([row.lead.id])}>Parar</Button>}
            </li>
          })}
        </ul>}
    </>}
  </section>
}

export function CRMVoxenSection({ leads, contextIds, loading, failure, onRetry, onRead }: {
  leads: CRMLead[]; contextIds: ReadonlySet<string>; loading: boolean; failure: unknown; onRetry: () => void; onRead: (leadId: string) => void
}) {
  const voxen = useCRMVoxenStates({ poll: true })
  const actions = useCRMVoxenActions()
  const { toast } = useToast()
  const [filter, setFilter] = useState<VoxenFilter>('available')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo<VoxenRowData<CRMLead>[]>(() => leads.map(lead => {
    const view = voxenViewOf(voxen.states, lead.id), hasContext = contextIds.has(lead.id)
    return { lead, view, at: voxen.states.get(lead.id)?.at ?? null, hasContext, filter: voxenFilterOf(view, hasContext) }
  }), [leads, contextIds, voxen.states])
  const forget = (ids: string[]) => setSelected(previous => new Set([...previous].filter(id => !ids.includes(id))))
  return <VoxenSectionView rows={rows} filter={filter} search={search} selected={selected} ready={voxen.ready} supported={voxen.supported} busy={actions.busy}
    progress={actions.progress} notice={actions.notice} loading={loading || voxen.loading} failure={failure ?? voxen.error} onRetry={() => { onRetry(); void voxen.refetch() }} onRead={onRead}
    onFilter={value => { setFilter(value); setSelected(new Set()) }} onSearch={setSearch}
    onToggle={id => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })}
    onToggleAll={ids => setSelected(previous => ids.every(id => previous.has(id)) ? new Set([...previous].filter(id => !ids.includes(id))) : new Set([...previous, ...ids]))}
    onClear={() => setSelected(new Set())}
    onSend={ids => { void actions.send(ids).then(outcome => { toast(describeSend(outcome)); forget(ids.slice(0, outcome.done)) }) }}
    onStop={ids => { void actions.stop(ids).then(outcome => { toast(describeStop(outcome)); forget(ids.slice(0, outcome.done)) }) }} />
}
