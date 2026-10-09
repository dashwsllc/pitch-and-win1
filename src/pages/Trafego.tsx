import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { fetchAllPages } from '@/lib/supabase-pages'
import { supabase } from '@/integrations/supabase/client'
import { useBrasiliaToday } from '@/hooks/useGoals'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { aggregateMeta, buildImportRows, cost, csvFields, defaultCsvMapping, summarizeObjectives, type CsvMapping, type ImportRow, type MetaDailyRow, type MetaLevel, type PromotableObjective } from '@/lib/meta-traffic'
import { buildLeadImportRows, defaultLeadCsvMapping, leadCsvFields, summarizeLeadImport, type LeadCsvMapping, type LeadImportRow, type LeadImportResult, type LeadImportResponse } from '@/lib/meta-lead-import'
import { parseSpreadsheetFile } from '@/lib/spreadsheet'
import { lastRunFor, type MetaAdAccount, type MetaSyncRun } from '@/lib/meta-connection'
import { errorMessage, money } from '@/lib/sales'
import { refreshDashboardMutation } from '@/lib/sync'

type Suggestion = { id: string; author_name: string; subject: string; body: string; campaign_id: string | null; status: string; created_at: string; updated_at: string }
type Reply = { id: string; suggestion_id: string; author_name: string; body: string; created_at: string }
type ReviewStatus = 'pendente' | 'aprovado' | 'rejeitado'
type Batch = { id: string; filename: string; row_count: number; created_at: string; status: ReviewStatus; updated_at: string; review_note: string | null; result?: LeadImportResult | null }
type MetricsBatch = Batch & { rows: ImportRow[] }
type LeadBatch = Batch & { rows: LeadImportRow[]; result: LeadImportResult | null }
const reviewStatusLabel: Record<ReviewStatus, string> = { pendente: 'Pendente', aprovado: 'Aprovado', rejeitado: 'Rejeitado' }
const emptyRows: MetaDailyRow[] = []
const statuses: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', planejada: 'Planejada', aplicada: 'Aplicada', descartada: 'Descartada' }
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
function shiftDate(date: string, days: number) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) }
function formatDate(value: string) { return value.slice(0, 10).split('-').reverse().join('/') }
const countFormatter = new Intl.NumberFormat('pt-BR')
function format(value: number | null, kind: 'money' | 'count' | 'percent' | 'ratio') {
  if (value === null) return '—'
  if (kind === 'money') return money(value)
  if (kind === 'percent') return value.toFixed(2) + '%'
  if (kind === 'ratio') return value.toFixed(2) + 'x'
  return countFormatter.format(value)
}
function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const essentialMetricsByCategory: Record<PromotableObjective, string[]> = {
  leads: ['spend', 'leads', 'cpl', 'ctr'],
  vendas: ['spend', 'purchases', 'cpa', 'roas'],
  mensagens: ['spend', 'messagesStarted', 'costPerMessage', 'ctr'],
  reconhecimento: ['spend', 'impressions', 'cpm', 'ctr'],
}
function toCsvValue(value: string | number) {
  const text = String(value)
  return /[";\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const content = '﻿' + [headers, ...rows].map(row => row.map(toCsvValue).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  URL.revokeObjectURL(url)
}

function ImportPanel({ today, onSubmitted }: { today: string; onSubmitted: () => Promise<unknown> }) {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [values, setValues] = useState<string[][]>([])
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [level, setLevel] = useState<MetaLevel>('campaign')
  const [attribution, setAttribution] = useState('Conforme exportação Meta')
  const [brlConfirmed, setBrlConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const preview = useMemo(() => {
    if (!mapping || !values.length) return null
    try { return buildImportRows(values, headers, mapping, level, today, attribution) }
    catch (cause) { return errorMessage(cause) }
  }, [values, headers, mapping, level, today, attribution])
  const previewTotals = Array.isArray(preview) ? aggregateMeta(preview) : null
  const load = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('Arquivo acima de 2 MB. Divida a exportação em partes menores.')
      const parsed = await parseSpreadsheetFile(file)
      setFileName(file.name); setHeaders(parsed.headers); setValues(parsed.values)
      setMapping(defaultCsvMapping(parsed.headers)); setFileError('')
    } catch (cause) { setFileError(errorMessage(cause)); setValues([]); setMapping(null) }
  }
  const submit = async () => {
    if (!Array.isArray(preview) || !preview.length) return
    setBusy(true)
    try {
      await arenaRpc('meta_import_daily', { p_filename: fileName, p_rows: preview })
      await onSubmitted()
      toast.success(preview.length + ' linhas enviadas para aprovação do gestor.')
      setValues([]); setMapping(null); setFileName(''); setBrlConfirmed(false)
    } catch (cause) { toast.error(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <section className="surface-panel space-y-5 rounded-2xl p-5 sm:p-6">
    <div><h2 className="text-lg font-medium">Importar métricas (desempenho)</h2><p className="mt-1 text-sm text-muted-foreground">Exporte dados diários do Gerenciador de Anúncios da Meta em CSV, com moeda BRL. Inclua IDs, gasto e as colunas de resultados disponíveis: leads, compras, impressões, cliques no link, conversas por mensagem iniciadas e objetivo da campanha (opcional, usado para destacar as métricas mais relevantes no topo da tela). Fica pendente até o gestor aprovar.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="meta-file">Arquivo (CSV, XLS ou XLSX)</Label>
        <label
          htmlFor="meta-file"
          onDragOver={event => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={event => { event.preventDefault(); setDragOver(false); void load(event.dataTransfer.files?.[0]) }}
          className={`mt-1 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50 hover:bg-muted/30'}`}
        >
          {fileName ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
          <span className="text-sm font-medium">{fileName || 'Clique para selecionar ou arraste o arquivo aqui'}</span>
          <span className="text-xs text-muted-foreground">Exportação diária do Gerenciador de Anúncios da Meta · moeda BRL · CSV, XLS ou XLSX</span>
          <Input key={fileName || 'empty'} id="meta-file" type="file" accept=".csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={event => void load(event.target.files?.[0])} />
        </label>
      </div>
      <div><Label htmlFor="meta-level">Nível da exportação</Label><select id="meta-level" className={selectClass} value={level} onChange={event => setLevel(event.target.value as MetaLevel)}><option value="campaign">Campanha</option><option value="adset">Conjunto de anúncios</option><option value="ad">Anúncio</option></select></div>
      <div className="sm:col-span-2"><Label htmlFor="meta-attribution">Janela de atribuição da exportação</Label><Input id="meta-attribution" maxLength={120} value={attribution} onChange={event => setAttribution(event.target.value)} /></div>
    </div>
    {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
    {mapping && <><div><h3 className="font-medium">Conferir colunas · {fileName}</h3><p className="text-xs text-muted-foreground">Campos opcionais sem coluna serão tratados como zero.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{csvFields.map(field => <div key={field.key}><Label htmlFor={'map-' + field.key}>{field.label}{field.required ? ' *' : ''}</Label><select id={'map-' + field.key} className={selectClass} value={mapping[field.key]} onChange={event => setMapping({ ...mapping, [field.key]: event.target.value })}><option value="">Sem coluna</option>{headers.map((header, index) => <option key={index} value={header}>{header}</option>)}</select></div>)}</div>
      {typeof preview === 'string' ? <p role="alert" className="text-sm text-destructive">{preview}</p> : preview && previewTotals && <div className="rounded-lg border border-border/60 p-4 text-sm"><strong>{preview.length} linhas prontas.</strong> A importação atualiza dados com os mesmos IDs e datas.<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"><span>Gasto: {money(previewTotals.spend)}</span><span>Leads: {previewTotals.leads}</span><span>Compras: {previewTotals.purchases}</span><span>Cliques no link: {previewTotals.linkClicks}</span><span>Conversas iniciadas: {previewTotals.messagesStarted}</span></div><p className="mt-2 text-xs text-muted-foreground">Revise o mapeamento e a janela de atribuição antes de confirmar. Em registros novos, colunas não exportadas ficam em zero; na reimportação, métricas omitidas são preservadas.</p></div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={brlConfirmed} onChange={event => setBrlConfirmed(event.target.checked)} /> Confirmo que o valor gasto e o valor de compras estão em BRL.</label>
      <Button disabled={busy || !brlConfirmed || !Array.isArray(preview) || !preview.length} onClick={() => void submit()}>{busy ? 'Enviando…' : 'Enviar para aprovação'}</Button>
    </>}
  </section>
}

function LeadResult({ result }: { result: LeadImportResult }) {
  return <div className="space-y-3 text-sm" role="status">
    <div className="flex flex-wrap gap-x-4 gap-y-1"><span>{result.crm} no CRM</span><span>{result.queued} para completar</span><span>{result.duplicates} duplicados, já recebidos</span><span className={result.failed ? 'text-destructive' : undefined}>{result.failed} falhas</span></div>
    <div className="flex flex-wrap gap-4"><Link className="underline underline-offset-4" to="/crm?tab=leads">Abrir esteira do CRM</Link><Link className="underline underline-offset-4" to="/leads">Completar leads recebidos</Link></div>
    {!!result.issues.length && <details><summary className="cursor-pointer">Ver linhas que precisam de atenção ({result.issues.length})</summary><ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">{result.issues.map((issue, index) => <li key={index} className="break-words">Linha {issue.row} · {issue.kind === 'failed' ? 'Não importada' : 'Guardada para completar'}: {issue.reason}</li>)}</ul></details>}
  </div>
}

function notifyLeadResult(result: LeadImportResult) {
  const message = `${result.crm} no CRM · ${result.queued} para completar · ${result.duplicates} duplicados · ${result.failed} falhas`
  if (result.failed) toast.warning(message)
  else toast.success(message)
}

function LeadImportPanel({ isExecutive, onSubmitted }: { isExecutive: boolean; onSubmitted: () => Promise<unknown> }) {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [values, setValues] = useState<string[][]>([])
  const [mapping, setMapping] = useState<LeadCsvMapping | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [outcome, setOutcome] = useState<LeadImportResponse | null>(null)
  const loadVersion = useRef(0)
  const [previewState, setPreviewState] = useState<{ mapping: LeadCsvMapping; values: string[][]; data: LeadImportRow[] | string } | null>(null)
  useEffect(() => {
    if (!mapping || !values.length) return
    let cancelled = false
    void buildLeadImportRows(values, headers, mapping).then(
      data => { if (!cancelled) setPreviewState({ mapping, values, data }) },
      cause => { if (!cancelled) setPreviewState({ mapping, values, data: errorMessage(cause) }) },
    )
    return () => { cancelled = true }
  }, [values, headers, mapping])
  const preview = previewState?.mapping === mapping && previewState?.values === values ? previewState.data : null
  const summary = Array.isArray(preview) ? summarizeLeadImport(preview) : null
  const load = async (file?: File) => {
    if (!file || busy) return
    const version = ++loadVersion.current
    setMapping(null); setValues([]); setFileError('')
    try {
      if (file.size > 2_000_000) throw new Error('Arquivo acima de 2 MB. Divida a exportação em partes menores.')
      const parsed = await parseSpreadsheetFile(file)
      if (version !== loadVersion.current) return
      setFileName(file.name); setHeaders(parsed.headers); setValues(parsed.values)
      setMapping(defaultLeadCsvMapping(parsed.headers)); setFileError('')
    } catch (cause) { if (version === loadVersion.current) { setFileError(errorMessage(cause)); setFileName('') } }
  }
  const submit = async () => {
    if (!Array.isArray(preview) || !preview.length) return
    setBusy(true)
    try {
      const response = await arenaRpc<LeadImportResponse>('meta_import_leads', { p_filename: fileName, p_rows: preview })
      setOutcome(response)
      setValues([]); setMapping(null); setFileName('')
      if (response.result) notifyLeadResult(response.result)
      else toast.success(response.rows + ' linhas enviadas para aprovação do gestor.')
      try { await onSubmitted() } catch { toast.warning('Importação registrada. Atualize a página para conferir os dados.') }
    } catch (cause) { toast.error(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <section className="surface-panel space-y-5 rounded-2xl p-5 sm:p-6">
    <div><h2 className="text-lg font-medium">Importar leads (planilha)</h2><p className="mt-1 text-sm text-muted-foreground">Importe os leads exportados dos formulários da Meta. Todas as respostas são preservadas. Leads completos seguem para a esteira do CRM; os demais ficam em Recebidos para completar. {isExecutive ? 'Sua importação é publicada imediatamente.' : 'Sua importação aguarda aprovação de um Executive ou Super Admin.'}</p></div>
    {outcome && <div className="space-y-3 rounded-lg border border-border/60 p-4"><h3 className="font-medium">{outcome.status === 'pendente' ? 'Enviado para aprovação' : 'Importação processada'}</h3>{outcome.result ? <LeadResult result={outcome.result} /> : <p className="text-sm text-muted-foreground">{outcome.rows} linhas guardadas. O CRM e a fila serão atualizados após a aprovação.</p>}</div>}
    <div>
      <Label htmlFor="lead-file">Arquivo (CSV, XLS ou XLSX)</Label>
      <label
        htmlFor="lead-file"
        onDragOver={event => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={event => { event.preventDefault(); setDragOver(false); void load(event.dataTransfer.files?.[0]) }}
        className={`mt-1 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50 hover:bg-muted/30'}`}
      >
        {fileName ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
        <span className="text-sm font-medium">{fileName || 'Clique para selecionar ou arraste o arquivo aqui'}</span>
        <span className="text-xs text-muted-foreground">Planilha de leads/formulário · CSV, XLS ou XLSX</span>
        <Input key={fileName || 'empty'} id="lead-file" type="file" disabled={busy} accept=".csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={event => void load(event.target.files?.[0])} />
      </label>
    </div>
    {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
    {mapping && <><div><h3 className="font-medium">Conferir colunas · {fileName}</h3><p className="text-xs text-muted-foreground">Campos sem coluna ficam vazios. Posições fora das opções do CRM e dados incompletos ficam guardados para revisão. Sem data válida, usamos a data de recebimento e mantemos a resposta original.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{leadCsvFields.map(field => <div key={field.key}><Label htmlFor={'lead-map-' + field.key}>{field.label}{field.required ? ' *' : ''}</Label><select id={'lead-map-' + field.key} disabled={busy} className={selectClass} value={mapping[field.key]} onChange={event => setMapping({ ...mapping, [field.key]: event.target.value })}><option value="">Sem coluna</option>{headers.map((header, index) => <option key={index} value={header}>{header}</option>)}</select></div>)}</div>
      {!preview && <p className="text-sm text-muted-foreground" role="status">Preparando prévia…</p>}
      {typeof preview === 'string' ? <p role="alert" className="text-sm text-destructive">{preview}</p> : summary && <div className="space-y-3 rounded-lg border border-border/60 p-4 text-sm"><strong>{summary.total} linhas para envio.</strong><p className="text-muted-foreground">Prévia: {summary.complete} prontos para o CRM · {summary.manual} para completar · {summary.duplicates} duplicados no arquivo. Leads já recebidos também serão ignorados, sem criar cópias.</p><div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left text-muted-foreground">Primeiras 10 linhas · confira os dados antes de enviar</caption><thead><tr>{['Linha', 'Responsável', 'WhatsApp', 'Atleta', 'Destino previsto'].map(label => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{Array.isArray(preview) && preview.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-border/40"><td className="px-2 py-2">{row.source_row}</td><td className="px-2 py-2">{row.full_name || '—'}</td><td className="px-2 py-2">{row.phone || '—'}</td><td className="px-2 py-2">{row.athlete_name || '—'}</td><td className="px-2 py-2">{row.complete ? 'CRM' : 'Completar'}{row.warnings?.length ? ' · revisar data' : ''}</td></tr>)}</tbody></table></div></div>}
      <Button disabled={busy || !Array.isArray(preview) || !preview.length} onClick={() => void submit()}>{busy ? 'Importando…' : isExecutive ? 'Importar e sincronizar' : 'Enviar para aprovação'}</Button>
    </>}
  </section>
}

function PendingImports({ metricsBatches, leadBatches, isExecutive, onReviewed }: {
  metricsBatches: MetricsBatch[]; leadBatches: LeadBatch[]; isExecutive: boolean; onReviewed: () => Promise<unknown>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const pendingMetrics = metricsBatches.filter(batch => batch.status === 'pendente')
  const pendingLeads = leadBatches.filter(batch => batch.status === 'pendente')
  const pendingTotal = pendingMetrics.length + pendingLeads.length
  const reviewOne = (kind: 'metrics' | 'leads', batch: Batch, action: 'aprovar' | 'rejeitar', note: string) => {
    const args = { p_batch_id: batch.id, p_action: action, p_expected_updated_at: batch.updated_at, p_note: note }
    return kind === 'metrics' ? arenaRpc<Batch>('meta_review_traffic_import', args) : arenaRpc<LeadBatch>('meta_review_lead_import', args)
  }
  const review = async (kind: 'metrics' | 'leads', batch: Batch, action: 'aprovar' | 'rejeitar') => {
    if (action === 'rejeitar' && reason.trim().length < 3) return
    setBusy(batch.id)
    try {
      const reviewedBatch = await reviewOne(kind, batch, action, reason.trim())
      setRejecting(null); setReason('')
      if ('result' in reviewedBatch && reviewedBatch.result) notifyLeadResult(reviewedBatch.result)
      else toast.success(action === 'aprovar' ? 'Importação aprovada' : 'Importação rejeitada')
      try { await onReviewed() } catch { toast.warning('Revisão registrada. Atualize a página para conferir os dados.') }
    } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(null) }
  }
  const approveAll = async () => {
    const targets = [
      ...pendingMetrics.map(batch => ({ kind: 'metrics' as const, batch })),
      ...pendingLeads.map(batch => ({ kind: 'leads' as const, batch })),
    ]
    if (!targets.length) return
    setBulkBusy(true)
    let approved = 0
    const failures: string[] = []
    for (const { kind, batch } of targets) {
      try {
        const reviewedBatch = await reviewOne(kind, batch, 'aprovar', '')
        if ('result' in reviewedBatch && reviewedBatch.result?.failed) failures.push(`${batch.filename}: ${reviewedBatch.result.failed} linha(s) não importada(s); confira o histórico`)
        approved++
      }
      catch (cause) { failures.push(`${batch.filename}: ${errorMessage(cause)}`) }
    }
    try { await onReviewed() } catch { toast.warning('Revisões registradas. Atualize a página para conferir os dados.') }
    finally { setBulkBusy(false) }
    if (failures.length) toast.error(`${approved} aprovada(s), ${failures.length} falhou/falharam: ${failures.join(' · ')}`)
    else toast.success(`${approved} ${approved === 1 ? 'importação aprovada' : 'importações aprovadas'}`)
  }
  const actions = (kind: 'metrics' | 'leads', batch: Batch) => isExecutive && <div className="flex flex-wrap gap-2">
    <Button size="sm" disabled={busy === batch.id || bulkBusy} onClick={() => void review(kind, batch, 'aprovar')}>Aprovar</Button>
    <Button size="sm" variant="outline" disabled={busy === batch.id || bulkBusy} onClick={() => { setRejecting(batch.id); setReason('') }}>Rejeitar</Button>
  </div>
  const rejectForm = (kind: 'metrics' | 'leads', batch: Batch) => rejecting === batch.id && <div className="mt-3 flex flex-wrap gap-2">
    <Input aria-label="Motivo da rejeição" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Motivo obrigatório" />
    <Button size="sm" variant="destructive" disabled={busy === batch.id || reason.trim().length < 3} onClick={() => void review(kind, batch, 'rejeitar')}>Confirmar rejeição</Button>
    <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancelar</Button>
  </div>
  return <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-medium">Pendentes de aprovação</h2><p className="mt-1 text-sm text-muted-foreground">{isExecutive ? 'Aprovar métricas publica os números em Desempenho; aprovar leads sincroniza com o CRM.' : 'Aguardando aprovação do Executive.'}</p></div>
      {isExecutive && pendingTotal > 0 && <Button size="sm" variant="outline" disabled={busy !== null || bulkBusy} onClick={() => void approveAll()}>{bulkBusy ? 'Aprovando…' : `Aprovar todas (${pendingTotal})`}</Button>}
    </div>
    {!pendingMetrics.length && !pendingLeads.length && <p className="text-sm text-muted-foreground">Nenhuma importação aguardando aprovação.</p>}
    {pendingMetrics.map(batch => {
      const preview = aggregateMeta(batch.rows)
      const objective = summarizeObjectives(batch.rows)
      return <article key={batch.id} className="rounded-lg border border-border/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-medium">Métricas · {batch.filename}</p><p className="text-xs text-muted-foreground">{batch.row_count} linhas · enviado em {new Date(batch.created_at).toLocaleString('pt-BR')}</p></div>
          {actions('metrics', batch)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span>Gasto: {money(preview.spend)}</span><span>Leads: {preview.leads}</span><span>Compras: {preview.purchases}</span>{objective.dominant && <span>Objetivo dominante: {objective.dominant}</span>}{objective.mixed && <span>Objetivos mistos</span>}</div>
        {rejectForm('metrics', batch)}
      </article>
    })}
    {pendingLeads.map(batch => {
      const summary = summarizeLeadImport(batch.rows)
      return <article key={batch.id} className="rounded-lg border border-border/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-medium">Leads · {batch.filename}</p><p className="text-xs text-muted-foreground">{batch.row_count} linhas · enviado em {new Date(batch.created_at).toLocaleString('pt-BR')}</p></div>
          {actions('leads', batch)}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{summary.total} linhas · {summary.complete} prontos para o CRM · {summary.manual} para completar · {summary.duplicates} duplicados no arquivo</p>
        {rejectForm('leads', batch)}
      </article>
    })}
  </section>
}

const runStatusLabel: Record<MetaSyncRun['status'], string> = { success: 'Sucesso', error: 'Erro', running: 'Em andamento' }
function RunStatus({ run, emptyLabel }: { run: MetaSyncRun | null; emptyLabel: string }) {
  if (!run) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  return <p className="text-xs text-muted-foreground">{runStatusLabel[run.status]} · {new Date(run.started_at).toLocaleString('pt-BR')}
    {run.status === 'success' && ` · ${run.rows_synced} linhas`}{run.status === 'error' && run.error_message && ` · ${run.error_message}`}</p>
}

function ConnectionPanel({ onProposeChange }: { onProposeChange: () => void }) {
  const { isExecutive } = useRoles()
  const [accountId, setAccountId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [busy, setBusy] = useState(false)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const accountsQuery = useQuery({ queryKey: ['meta-ad-accounts'], queryFn: () =>
    fetchAllPages<MetaAdAccount>((from, to) => arenaClient.from('meta_ad_accounts').select('*').order('connected_at', { ascending: false }).range(from, to)) })
  const runsQuery = useQuery({ queryKey: ['meta-sync-runs'], refetchInterval: 30_000, queryFn: () =>
    fetchAllPages<MetaSyncRun>((from, to) => arenaClient.from('meta_sync_runs').select('*').order('started_at', { ascending: false }).limit(60).range(from, to)) })
  const accounts = accountsQuery.data || []
  const runs = runsQuery.data || []
  const runningInsights = runs.some(run => run.kind === 'insights' && run.status === 'running')
  const reconciliation = lastRunFor(runs, 'leads_reconciliation')
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); if (!accountId.trim() || !accountName.trim()) return
    setBusy(true)
    try {
      await arenaRpc('meta_connect_ad_account', { p_account_id: accountId.trim(), p_account_name: accountName.trim() })
      setAccountId(''); setAccountName(''); await accountsQuery.refetch()
      toast.success('Conta Meta conectada')
    } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) }
  }
  const disconnect = async () => {
    if (!disconnectId || reason.trim().length < 3) return
    setBusy(true)
    try {
      await arenaRpc('meta_disconnect_ad_account', { p_account_id: disconnectId, p_reason: reason.trim() })
      setDisconnectId(null); setReason(''); await accountsQuery.refetch()
      toast.success('Conta Meta desconectada')
    } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) }
  }
  const syncNow = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('meta-insights-sync', { body: {} })
      if (error) {
        const context = (error as { context?: unknown }).context
        if (context instanceof Response) {
          const failure = await context.json().catch(() => null)
          const reason = failure?.error || failure?.results?.find((item: { error?: string }) => item.error)?.error
          if (reason) throw new Error(reason)
        }
        throw error
      }
      if (data?.ok === false) throw new Error('A sincronização falhou. Consulte o diagnóstico abaixo.')
      if (data?.results?.every((item: { skipped?: boolean }) => item.skipped)) {
        toast.info(data.results.length ? 'Uma sincronização já está em andamento.' : 'Nenhuma conta ativa para sincronizar.')
      } else {
        toast.success('Métricas sincronizadas')
      }
    } catch (cause) { toast.error(errorMessage(cause)) } finally {
      await runsQuery.refetch()
      setBusy(false)
    }
  }
  return <div className="space-y-5">
    <section className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-medium">Contas conectadas</h2><p className="mt-1 text-sm text-muted-foreground">Sincronização automática de métricas via API oficial da Meta, a cada 30 minutos, mais uma varredura diária mais profunda.</p></div>
        <Button size="sm" disabled={busy || runningInsights} onClick={() => void syncNow()}>{runningInsights ? 'Sincronizando…' : 'Sincronizar agora'}</Button></div>
      {accountsQuery.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(accountsQuery.error)}</p>}
      {!accountsQuery.isLoading && !accounts.length && <p className="text-sm text-muted-foreground">Nenhuma conta Meta conectada ainda.</p>}
      {accounts.map(item => <div key={item.id} className="rounded-lg border border-border/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{item.account_name || item.account_id} <span className="text-xs text-muted-foreground">({item.account_id})</span></p>
          <p className="text-xs text-muted-foreground">{item.status === 'active' ? 'Ativa' : 'Pausada'} · conectada em {new Date(item.connected_at).toLocaleDateString('pt-BR')}</p></div>
          {isExecutive && item.status === 'active' && <Button size="sm" variant="outline" onClick={() => { setDisconnectId(item.account_id); setReason('') }}>Desconectar</Button>}</div>
        <RunStatus run={lastRunFor(runs, 'insights', item.account_id)} emptyLabel="Nenhuma sincronização de métricas registrada ainda." />
        {disconnectId === item.account_id && <div className="mt-3 flex gap-2"><Input aria-label="Motivo da desconexão" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Motivo obrigatório" /><Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void disconnect()}>Confirmar</Button><Button size="sm" variant="ghost" onClick={() => setDisconnectId(null)}>Cancelar</Button></div>}
      </div>)}
      <div className="border-t border-border/60 pt-3"><RunStatus run={reconciliation} emptyLabel="Nenhuma reconciliação de leads registrada ainda." /><p className="text-xs text-muted-foreground">Reconciliação de leads de formulário roda a cada hora, recuperando entregas de webhook perdidas.</p></div>
    </section>
    {isExecutive ? <form onSubmit={connect} className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6">
      <div><h2 className="text-lg font-medium">Conectar conta</h2><p className="text-sm text-muted-foreground">Requer o token de sistema já configurado no servidor (ver documentação de configuração). Aqui você só informa qual conta sincronizar.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="meta-account-id">ID da conta (act_...)</Label><Input id="meta-account-id" required value={accountId} onChange={event => setAccountId(event.target.value)} /></div>
        <div><Label htmlFor="meta-account-name">Nome da conta</Label><Input id="meta-account-name" required value={accountName} onChange={event => setAccountName(event.target.value)} /></div></div>
      <Button disabled={busy}>Conectar</Button>
    </form> : <section className="surface-panel space-y-3 rounded-2xl p-5 sm:p-6"><h2 className="font-medium">Conectar/desconectar contas</h2><p className="text-sm text-muted-foreground">Somente Executive e Super Admin podem conectar ou desconectar contas Meta. Encontrou algo que precisa mudar?</p><Button size="sm" variant="outline" onClick={onProposeChange}>Propor alteração</Button></section>}
  </div>
}

function Suggestions({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const { user } = useAuth()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [campaign, setCampaign] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: ['traffic-suggestions', user?.id], enabled: !!user, queryFn: async () => {
    const [suggestions, replies] = await Promise.all([
      fetchAllPages((from, to) => arenaClient.from('traffic_suggestions').select('*').order('updated_at', { ascending: false }).range(from, to)),
      fetchAllPages((from, to) => arenaClient.from('traffic_suggestion_replies').select('*').order('created_at').range(from, to)),
    ])
    return { suggestions: suggestions as Suggestion[], replies: replies as Reply[] }
  } })
  const create = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try {
    await arenaRpc('traffic_create_suggestion', { p_subject: subject, p_body: body, p_campaign_id: campaign || null })
    setSubject(''); setBody(''); setCampaign(''); await query.refetch(); toast.success('Sugestão enviada')
  } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) } }
  const respond = async (id: string) => { setBusy(true); try {
    await arenaRpc('traffic_reply_suggestion', { p_id: id, p_body: reply[id] })
    setReply(current => ({ ...current, [id]: '' })); await query.refetch(); toast.success('Resposta enviada')
  } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) } }
  const changeStatus = async (id: string, status: string) => { setBusy(true); try {
    await arenaRpc('traffic_set_suggestion_status', { p_id: id, p_status: status })
    await query.refetch(); toast.success('Status atualizado')
  } catch (cause) { toast.error(errorMessage(cause)) } finally { setBusy(false) } }
  return <div className="space-y-5"><form onSubmit={create} className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6"><div><h2 className="text-lg font-medium">Nova sugestão</h2><p className="text-sm text-muted-foreground">Conversa privada entre gestor de tráfego, Executive e Super Admin.</p></div><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="suggestion-subject">Assunto</Label><Input id="suggestion-subject" required minLength={3} maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} /></div><div><Label htmlFor="suggestion-campaign">Campanha relacionada</Label><select id="suggestion-campaign" className={selectClass} value={campaign} onChange={event => setCampaign(event.target.value)}><option value="">Geral</option>{campaigns.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div></div><div><Label htmlFor="suggestion-body">Sugestão</Label><textarea id="suggestion-body" required minLength={3} maxLength={5000} rows={4} className="w-full rounded-md border border-input bg-background p-3 text-sm" value={body} onChange={event => setBody(event.target.value)} /></div><Button disabled={busy}>Enviar sugestão</Button></form>
    {query.isError && <p role="alert" className="text-destructive">{errorMessage(query.error)}</p>}
    {query.data?.suggestions.map(item => <article key={item.id} className="surface-panel space-y-4 rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{item.subject}</h3><p className="text-xs text-muted-foreground">{item.author_name} · {new Date(item.created_at).toLocaleString('pt-BR')}</p></div><select aria-label={'Status de ' + item.subject} className={selectClass + ' w-auto'} disabled={busy} value={item.status} onChange={event => void changeStatus(item.id, event.target.value)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><p className="whitespace-pre-wrap text-sm">{item.body}</p>{item.campaign_id && <p className="text-xs text-muted-foreground">Campanha: {campaigns.find(c => c.id === item.campaign_id)?.name || item.campaign_id}</p>}
      <div className="space-y-2 border-t border-border/60 pt-4">{query.data.replies.filter(message => message.suggestion_id === item.id).map(message => <div key={message.id} className="rounded-lg bg-muted/40 p-3 text-sm"><p className="text-xs text-muted-foreground">{message.author_name} · {new Date(message.created_at).toLocaleString('pt-BR')}</p><p className="mt-1 whitespace-pre-wrap">{message.body}</p></div>)}<form onSubmit={event => { event.preventDefault(); void respond(item.id) }} className="flex flex-col gap-2 sm:flex-row"><Input aria-label={'Responder a ' + item.subject} minLength={2} maxLength={5000} required value={reply[item.id] || ''} onChange={event => setReply(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Escreva uma resposta" /><Button disabled={busy || !reply[item.id]?.trim()} variant="outline">Responder</Button></form></div></article>)}
    {!query.isLoading && !query.data?.suggestions.length && <p className="py-8 text-center text-sm text-muted-foreground">Ainda não há sugestões.</p>}
  </div>
}

export default function Trafego() {
  const { user } = useAuth()
  const { isExecutive } = useRoles()
  const queryClient = useQueryClient()
  const today = useBrasiliaToday()
  const [tab, setTab] = useState('performance')
  const [period, setPeriod] = useState('30')
  const [customStart, setCustomStart] = useState(shiftDate(today, -29))
  const [customEnd, setCustomEnd] = useState(today)
  const [level, setLevel] = useState<MetaLevel>('campaign')
  const [account, setAccount] = useState('')
  const [campaign, setCampaign] = useState('')
  const [origin, setOrigin] = useState('')
  const start = period === 'custom' ? customStart
    : period === 'today' ? today
    : period === 'yesterday' ? shiftDate(today, -1)
    : period === 'month' ? today.slice(0, 7) + '-01'
    : shiftDate(today, 1 - Number(period))
  const end = period === 'custom' ? customEnd : period === 'yesterday' ? shiftDate(today, -1) : today
  const validRange = start <= end && end <= today && start.length === 10 && end.length === 10
  const query = useQuery({ queryKey: ['meta-traffic', user?.id, start, end, level], enabled: !!user && validRange, queryFn: () => fetchAllPages<MetaDailyRow>((from, to) => arenaClient.from('meta_traffic_daily').select('*').gte('date', start).lte('date', end).eq('level', level).order('date').order('id').range(from, to)) })
  const batchQuery = useQuery({ queryKey: ['meta-imports', user?.id], enabled: !!user, queryFn: () => fetchAllPages<MetricsBatch>((from, to) => arenaClient.from('meta_import_batches').select('*').order('created_at', { ascending: false }).range(from, to)) })
  const leadBatchQuery = useQuery({ queryKey: ['meta-lead-imports', user?.id], enabled: !!user, queryFn: () => fetchAllPages<LeadBatch>((from, to) => arenaClient.from('meta_lead_import_batches').select('*').order('created_at', { ascending: false }).range(from, to)) })
  const allRows = query.data || emptyRows
  const accounts = useMemo(() => [...new Map(allRows.map(row => [row.account_id, { id: row.account_id, name: row.account_name || row.account_id }])).values()], [allRows])
  const accountRows = account ? allRows.filter(row => row.account_id === account) : allRows
  const campaigns = useMemo(() => [...new Map(accountRows.map(row => [row.campaign_id, { id: row.campaign_id, name: row.campaign_name }])).values()], [accountRows])
  const originRows = origin ? accountRows.filter(row => row.source === origin) : accountRows
  const rows = originRows.filter(row => !campaign || row.campaign_id === campaign)
  const total = aggregateMeta(rows)
  const objectiveSummary = useMemo(() => summarizeObjectives(rows), [rows])
  const [showAllMetrics, setShowAllMetrics] = useState(false)
  const daily = useMemo(() => [...new Set(rows.map(row => row.date))].sort().map(date => ({ date: formatDate(date), ...aggregateMeta(rows.filter(row => row.date === date)) })), [rows])
  const byCampaign = useMemo(() => campaigns.map(item => ({ ...item, ...aggregateMeta(originRows.filter(row => row.campaign_id === item.id)) })).sort((a, b) => b.spend - a.spend), [campaigns, originRows])
  const cplMedian = median(byCampaign.flatMap(item => item.cpl === null ? [] : [item.cpl]))
  const cpaMedian = median(byCampaign.flatMap(item => item.cpa === null ? [] : [item.cpa]))
  const attributionWindows = [...new Set(rows.map(row => row.attribution_window))]
  const reconciliationQuery = useQuery({ queryKey: ['meta-lead-reconciliation', user?.id, start, end], enabled: !!user && validRange && level === 'campaign',
    queryFn: () => arenaRpc<{ campaign_id: string; campaign_name: string; form_leads_count: number }[]>('meta_traffic_lead_reconciliation', { p_start: start, p_end: end }) })
  const attributionQuery = useQuery({ queryKey: ['meta-crm-attribution', user?.id, start, end], enabled: !!user && validRange && level === 'campaign',
    queryFn: () => arenaRpc<{ campaign_id: string; campaign_name: string; confirmed_sales: number; confirmed_revenue: number }[]>('meta_crm_attribution_daily', { p_start: start, p_end: end }) })
  const attributionRows = (attributionQuery.data || []).filter(row => campaigns.some(item => item.id === row.campaign_id) && (!campaign || row.campaign_id === campaign))
  const confirmedSales = attributionRows.reduce((sum, row) => sum + row.confirmed_sales, 0)
  const confirmedRevenue = attributionRows.reduce((sum, row) => sum + row.confirmed_revenue, 0)
  const cpaReal = cost(total.spend, confirmedSales)
  const roasReal = cost(confirmedRevenue, total.spend)
  const reconciliationRows = (reconciliationQuery.data || []).filter(row => campaigns.some(item => item.id === row.campaign_id))
  const reviewed = async () => {
    await refreshDashboardMutation(queryClient)
  }
  return <DashboardLayout><div className="mx-auto max-w-7xl space-y-6"><header><h1 className="text-3xl font-light">Tráfego</h1><p className="mt-2 text-sm text-muted-foreground">Desempenho da Meta Ads para decisões de investimento, aquisição e otimização.</p></header>
    <Tabs value={tab} onValueChange={setTab} className="space-y-5"><TabsList className="h-auto flex-wrap"><TabsTrigger value="performance">Desempenho</TabsTrigger><TabsTrigger value="import" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Importar</TabsTrigger><TabsTrigger value="connection">Conexão</TabsTrigger><TabsTrigger value="suggestions">Sugestões</TabsTrigger></TabsList>
      <TabsContent value="performance" className="space-y-5"><section className="surface-panel grid gap-4 rounded-2xl p-5 sm:grid-cols-2 lg:grid-cols-4"><div><Label htmlFor="traffic-period">Período</Label><select id="traffic-period" className={selectClass} value={period} onChange={event => setPeriod(event.target.value)}><option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="month">Mês atual</option><option value="custom">Personalizado</option></select></div><div><Label htmlFor="traffic-level">Nível</Label><select id="traffic-level" className={selectClass} value={level} onChange={event => { setLevel(event.target.value as MetaLevel); setAccount(''); setCampaign('') }}><option value="campaign">Campanhas</option><option value="adset">Conjuntos</option><option value="ad">Anúncios</option></select></div><div><Label htmlFor="traffic-account">Conta Meta</Label><select id="traffic-account" className={selectClass} value={account} onChange={event => { setAccount(event.target.value); setCampaign('') }}><option value="">Todas as contas</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div><Label htmlFor="traffic-campaign">Campanha</Label><select id="traffic-campaign" className={selectClass} value={campaign} onChange={event => setCampaign(event.target.value)}><option value="">Todas as campanhas</option>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div><Label htmlFor="traffic-origin">Origem</Label><select id="traffic-origin" className={selectClass} value={origin} onChange={event => setOrigin(event.target.value)}><option value="">Todas</option><option value="csv">CSV</option><option value="api">API</option></select></div>{period === 'custom' && <><div><Label htmlFor="traffic-start">De</Label><Input id="traffic-start" type="date" value={customStart} max={today} onChange={event => setCustomStart(event.target.value)} /></div><div><Label htmlFor="traffic-end">Até</Label><Input id="traffic-end" type="date" value={customEnd} max={today} onChange={event => setCustomEnd(event.target.value)} /></div></>}</section>
        {!validRange && <p role="alert" className="text-sm text-destructive">Escolha um período válido até hoje.</p>}{query.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error)}</p>}
        {(() => {
          const metricCards: [string, string, string][] = [
            ['cpl', 'CPL · custo por lead', format(total.cpl, 'money')],
            ['cpa', 'CPA · custo por aquisição', format(total.cpa, 'money')],
            ['ctr', 'CTR · cliques no link', format(total.ctr, 'percent')],
            ['costPerMessage', 'Custo por mensagem iniciada', format(total.costPerMessage, 'money')],
            ['spend', 'Valor gasto', format(total.spend, 'money')],
            ['leads', 'Leads Meta', format(total.leads, 'count')],
            ['purchases', 'Aquisições Meta (compras)', format(total.purchases, 'count')],
            ['messagesStarted', 'Conversas iniciadas', format(total.messagesStarted, 'count')],
            ['linkClicks', 'Cliques no link', format(total.linkClicks, 'count')],
            ['cpc', 'CPC · custo por clique no link', format(total.cpc, 'money')],
            ['impressions', 'Impressões', format(total.impressions, 'count')],
            ['roas', 'ROAS', format(total.roas, 'ratio')],
            ['cpm', 'CPM · custo por mil impressões', format(total.cpm, 'money')],
          ]
          const essentialKeys = objectiveSummary.dominant ? essentialMetricsByCategory[objectiveSummary.dominant] : null
          const essentialCards = essentialKeys ? essentialKeys.map(key => metricCards.find(([cardKey]) => cardKey === key)!) : metricCards
          const card = ([key, label, value]: [string, string, string]) => <article className="surface-panel rounded-xl p-4" key={key}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{query.isLoading ? '…' : value}</p></article>
          return <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{essentialCards.map(card)}</div>
            {essentialKeys && <Collapsible open={showAllMetrics} onOpenChange={setShowAllMetrics}>
              <CollapsibleTrigger asChild><Button variant="outline" size="sm">{showAllMetrics ? 'Ocultar todas as métricas' : 'Ver todas as métricas'}</Button></CollapsibleTrigger>
              <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metricCards.map(card)}</CollapsibleContent>
            </Collapsible>}
            {objectiveSummary.mixed && <p className="text-sm text-amber-400">Este recorte mistura campanhas com objetivos diferentes (ex.: leads e vendas). Mostrando todas as métricas para evitar leitura enviesada.</p>}
          </>
        })()}
        <p className="text-xs text-muted-foreground">CPL = gasto ÷ leads. CPA = gasto ÷ compras reportadas pela Meta. CTR = cliques no link ÷ impressões × 100; custo por clique é o CPC, exibido separadamente. Custo por mensagem iniciada = gasto ÷ conversas iniciadas. CPM = gasto ÷ impressões × 1000. Os resultados seguem a atribuição da exportação e não equivalem a vendas confirmadas no CRM. “—” indica denominador zero. Cada nível é analisado separadamente para evitar contagem dupla.</p>
        {level === 'campaign' && <section className="surface-panel grid gap-3 rounded-2xl p-5 sm:grid-cols-2"><article><p className="text-xs text-muted-foreground">CPA real (CRM) · vendas aprovadas</p><p className="mt-2 text-xl font-semibold">{attributionQuery.isLoading ? '…' : format(cpaReal, 'money')}</p></article><article><p className="text-xs text-muted-foreground">ROAS real (CRM) · vendas aprovadas</p><p className="mt-2 text-xl font-semibold">{attributionQuery.isLoading ? '…' : format(roasReal, 'ratio')}</p></article><p className="text-xs text-muted-foreground sm:col-span-2">Baseado em vendas aprovadas no CRM vinculadas a leads de formulário Meta gerados no período (coorte pela data de geração do lead, não pela data do relatório). Cancelamentos e estornos saem do cálculo automaticamente. Diferente do CPA/ROAS acima, que seguem a atribuição declarada pela própria Meta.</p></section>}
        {!!rows.length && <section className="surface-panel space-y-3 rounded-2xl p-5"><h2 className="font-medium">Referência das próprias campanhas</h2><p className="text-sm text-muted-foreground">Medianas no período e conta selecionados: CPL {format(cplMedian, 'money')} · CPA {format(cpaMedian, 'money')}. Use como comparação interna; campanha, público e objetivo influenciam o resultado.</p><p className="text-xs text-muted-foreground">Atribuição: {attributionWindows.join(' · ')}</p>{attributionWindows.length > 1 && <p className="text-sm text-amber-400">Há janelas de atribuição diferentes neste recorte. Compare campanhas com cautela.</p>}</section>}
        <section className="surface-panel rounded-2xl p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Investimento e resultados por dia</h2>{!!daily.length && <Button variant="outline" size="sm" onClick={() => downloadCsv('trafego_diario_' + start + '_a_' + end + '.csv', ['Data', 'Investimento', 'Leads', 'Compras', 'Conversas iniciadas'], daily.map(item => [item.date, item.spend.toFixed(2), item.leads, item.purchases, item.messagesStarted]))}>Exportar CSV</Button>}</div>{daily.length ? <div className="h-72" role="img" aria-label="Gráfico diário de investimento, leads e compras"><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis yAxisId="brl" tick={{ fontSize: 11 }} tickFormatter={value => `R$ ${value}`} /><YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number, name: string) => name === 'Investimento' ? money(value) : value} /><Legend /><Area yAxisId="brl" type="monotone" dataKey="spend" name="Investimento" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.18} /><Area yAxisId="count" type="monotone" dataKey="leads" name="Leads" stroke="#22c55e" fill="#22c55e" fillOpacity={0.08} /><Area yAxisId="count" type="monotone" dataKey="purchases" name="Compras" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} /></AreaChart></ResponsiveContainer></div> : <p className="py-10 text-center text-sm text-muted-foreground">Nenhum dado da Meta neste filtro. Importe um CSV para começar.</p>}</section>
        <section className="surface-panel overflow-hidden rounded-2xl"><div className="flex flex-wrap items-center justify-between gap-2 p-5"><div><h2 className="font-medium">Campanhas</h2><p className="text-xs text-muted-foreground">Ordenadas por investimento no período.</p></div>{!!byCampaign.length && <Button variant="outline" size="sm" onClick={() => downloadCsv('campanhas_trafego_' + start + '_a_' + end + '.csv', ['Campanha', 'Gasto', 'Leads', 'CPL', 'Aquisicoes', 'CPA', 'CTR link (%)', 'CPC link', 'Conversas', 'Custo por mensagem'], byCampaign.map(item => [item.name, item.spend.toFixed(2), item.leads, item.cpl ?? '', item.purchases, item.cpa ?? '', item.ctr ?? '', item.cpc ?? '', item.messagesStarted, item.costPerMessage ?? '']))}>Exportar CSV</Button>}</div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-y border-border/60 text-xs text-muted-foreground"><tr>{['Campanha', 'Gasto', 'Leads', 'CPL', 'Aquisições', 'CPA', 'CTR link', 'CPC link', 'Conversas', 'Custo por mensagem'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{byCampaign.map(item => <tr className="border-b border-border/40" key={item.id}><td className="px-4 py-3">{item.name}</td><td className="px-4 py-3">{format(item.spend, 'money')}</td><td className="px-4 py-3">{item.leads}</td><td className="px-4 py-3">{format(item.cpl, 'money')}</td><td className="px-4 py-3">{item.purchases}</td><td className="px-4 py-3">{format(item.cpa, 'money')}</td><td className="px-4 py-3">{format(item.ctr, 'percent')}</td><td className="px-4 py-3">{format(item.cpc, 'money')}</td><td className="px-4 py-3">{item.messagesStarted}</td><td className="px-4 py-3">{format(item.costPerMessage, 'money')}</td></tr>)}</tbody></table></div>{!byCampaign.length && <p className="p-5 text-sm text-muted-foreground">Sem campanhas para exibir.</p>}</section>
        {level === 'campaign' && !!byCampaign.length && <section className="surface-panel space-y-3 rounded-2xl p-5"><h2 className="font-medium">Leads: CSV agregado vs. fila de formulários</h2><p className="text-xs text-muted-foreground">Divergência é esperada: o CSV é o relatório agregado da Meta (pode incluir tipos de ação que contam como "lead" além do formulário); a fila individual só recebe formulários (Lead Ads) e pode ter atraso de sincronização.</p><table className="w-full text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1">Campanha</th><th className="py-1">Leads (CSV)</th><th className="py-1">Leads (fila)</th></tr></thead><tbody>{byCampaign.map(item => <tr key={item.id} className="border-t border-border/40"><td className="py-1">{item.name}</td><td className="py-1">{item.leads}</td><td className="py-1">{reconciliationRows.find(row => row.campaign_id === item.id)?.form_leads_count ?? 0}</td></tr>)}</tbody></table></section>}
      </TabsContent>
      <TabsContent value="import" className="space-y-5">
        <ImportPanel today={today} onSubmitted={() => batchQuery.refetch()} />
        <LeadImportPanel isExecutive={isExecutive} onSubmitted={reviewed} />
        <PendingImports metricsBatches={batchQuery.data || []} leadBatches={leadBatchQuery.data || []} isExecutive={isExecutive} onReviewed={reviewed} />
        <section className="surface-panel rounded-2xl p-5"><h2 className="font-medium">Importações recentes</h2>
          {(batchQuery.isError || leadBatchQuery.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(batchQuery.error || leadBatchQuery.error)}</p>}
          {[...(batchQuery.data || []).map(item => ({ ...item, kind: 'Métricas', result: null })), ...(leadBatchQuery.data || []).map(item => ({ ...item, kind: 'Leads' }))]
            .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15)
            .map(item => <article key={item.kind + item.id} className="space-y-3 border-b border-border/40 py-3 text-sm"><p>{item.kind} · {item.filename} · {item.row_count} linhas · {new Date(item.created_at).toLocaleString('pt-BR')} · <span className={item.status === 'rejeitado' ? 'text-destructive' : item.status === 'aprovado' ? 'text-emerald-500' : 'text-amber-500'}>{reviewStatusLabel[item.status]}</span>{item.status === 'rejeitado' && item.review_note && <span className="text-muted-foreground"> · {item.review_note}</span>}</p>{item.result && <LeadResult result={item.result} />}</article>)}
          {!batchQuery.isLoading && !leadBatchQuery.isLoading && !batchQuery.data?.length && !leadBatchQuery.data?.length && <p className="mt-3 text-sm text-muted-foreground">Nenhuma importação registrada.</p>}
        </section>
      </TabsContent>
      <TabsContent value="connection"><ConnectionPanel onProposeChange={() => setTab('suggestions')} /></TabsContent>
      <TabsContent value="suggestions"><Suggestions campaigns={campaigns} /></TabsContent>
    </Tabs></div></DashboardLayout>
}
