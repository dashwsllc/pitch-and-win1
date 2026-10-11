import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { MetaLeadApprovals } from '@/components/traffic/MetaLeadApprovals'
import { MetaAudit } from '@/components/traffic/MetaAudit'
import { MetaTrafficData, MetaImportEdits } from '@/components/traffic/MetaTrafficData'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { fetchAllPages } from '@/lib/supabase-pages'
import { supabase } from '@/integrations/supabase/client'
import { useBrasiliaToday } from '@/hooks/useGoals'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { aggregateMeta, buildImportRows, csvFields, defaultCsvMapping, type CsvMapping, type MetaDailyRow, type MetaLevel } from '@/lib/meta-traffic'
import { buildLeadImportRows, defaultLeadCsvMapping, leadCsvFields, summarizeLeadImport, type LeadCsvMapping, type LeadImportRow, type LeadImportResult, type LeadImportResponse } from '@/lib/meta-lead-import'
import { parseSpreadsheetFile } from '@/lib/spreadsheet'
import { lastRunFor, type MetaAdAccount, type MetaSyncRun } from '@/lib/meta-connection'
import { errorMessage, money } from '@/lib/sales'
import { MetaTrafficPerformance } from '@/components/traffic/MetaTrafficPerformance'
import { buildTrafficView, validTrafficDate, type QueryState, type TrafficScope } from '@/lib/meta-traffic-view'
import type { TrafficCohortResult } from '../../shared/meta-contract'
import { refreshDashboardMutation } from '@/lib/sync'
import { MetaPendingImports } from '@/components/traffic/MetaPendingImports'
import { createLatestFileLoader, fetchTrafficReviewList } from '@/lib/meta-traffic-queries'

type Suggestion = { id: string; author_name: string; subject: string; body: string; campaign_id: string | null; status: string; created_at: string; updated_at: string }
type Reply = { id: string; suggestion_id: string; author_name: string; body: string; created_at: string }
const emptyRows: MetaDailyRow[] = []
const statuses: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', planejada: 'Planejada', aplicada: 'Aplicada', descartada: 'Descartada' }
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
function shiftDate(date: string, days: number) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) }
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
  const fileLoader = useRef(createLatestFileLoader(async (file: File) => {
    if (file.size > 2_000_000) throw new Error('Arquivo acima de 2 MB. Divida a exportação em partes menores.')
    return parseSpreadsheetFile(file)
  }, (file, parsed) => {
    setFileName(file.name); setHeaders(parsed.headers); setValues(parsed.values)
    setMapping(defaultCsvMapping(parsed.headers)); setFileError('')
  }, cause => { setFileError(errorMessage(cause)); setValues([]); setMapping(null); setFileName('') }))
  const load = async (file?: File) => {
    if (!file || busy) return
    setMapping(null); setValues([]); setBrlConfirmed(false); setFileError('')
    await fileLoader.current(file)
  }
  const submit = async () => {
    if (!Array.isArray(preview) || !preview.length) return
    setBusy(true)
    try {
      await arenaRpc('meta_import_daily', { p_filename: fileName, p_rows: preview })
      try { await onSubmitted() } catch { toast.warning('Importação registrada. Atualize a página para conferir.') }
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
    {mapping && <><div><h3 className="font-medium">Conferir colunas · {fileName}</h3><p className="text-xs text-muted-foreground">Métricas sem coluna ficam indisponíveis para comparação e taxas.</p></div>
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

function LeadImportPanel({ onSubmitted }: { onSubmitted: () => Promise<unknown> }) {
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
    <div><h2 className="text-lg font-medium">Importar leads (planilha)</h2><p className="mt-1 text-sm text-muted-foreground">Importe os leads exportados dos formulários da Meta. Todas as respostas são preservadas. Toda importação aguarda aprovação manual em Tráfego por um Gestor de Tráfego, Executive ou Super Admin. Após a aprovação, leads completos seguem para a fila compartilhada do CRM e os demais ficam em Leads para o SDR completar.</p></div>
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
      <Button disabled={busy || !Array.isArray(preview) || !preview.length} onClick={() => void submit()}>{busy ? 'Enviando…' : 'Enviar para aprovação'}</Button>
    </>}
  </section>
}

const runStatusLabel: Record<MetaSyncRun['status'], string> = { success: 'Sucesso', error: 'Erro', running: 'Em andamento' }
function RunStatus({ run, emptyLabel }: { run: MetaSyncRun | null; emptyLabel: string }) {
  if (!run) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  return <p className="text-xs text-muted-foreground">{runStatusLabel[run.status]} · {new Date(run.started_at).toLocaleString('pt-BR')}
    {run.status === 'success' && ` · ${run.rows_synced} ${run.kind === 'insights' ? 'linhas capturadas para aprovação' : 'leads conferidos'}`}{run.status === 'error' && run.error_message && ` · ${run.error_message}`}</p>
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
        toast.success('Métricas recebidas para aprovação em Tráfego')
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
  const { isExecutive, hasRole } = useRoles()
  const canReview = isExecutive || hasRole('traffic_manager')
  const queryClient = useQueryClient()
  const today = useBrasiliaToday()
  const [tab, setTab] = useState('performance')
  const [period, setPeriod] = useState('30')
  const [customStart, setCustomStart] = useState(shiftDate(today, -29))
  const [customEnd, setCustomEnd] = useState(today)
  const [level, setLevel] = useState<MetaLevel>('campaign')
  const [account, setAccount] = useState('')
  const [campaign, setCampaign] = useState('')
  const [origin, setOrigin] = useState<MetaDailyRow['source'] | ''>('')
  const start = period === 'custom' ? customStart
    : period === 'today' ? today
    : period === 'yesterday' ? shiftDate(today, -1)
    : period === 'month' ? today.slice(0, 7) + '-01'
    : shiftDate(today, 1 - Number(period))
  const end = period === 'custom' ? customEnd : period === 'yesterday' ? shiftDate(today, -1) : today
  const validRange = validTrafficDate(start) && validTrafficDate(end) && start <= end && end <= today
  const query = useQuery({ queryKey: ['meta-traffic', user?.id, start, end, level], enabled: !!user && validRange, queryFn: () => fetchAllPages<MetaDailyRow>((from, to) => arenaClient.from('meta_traffic_daily').select('*').gte('date', start).lte('date', end).eq('level', level).order('date').order('id').range(from, to)) })
  const pendingCount = useQuery({ queryKey: ['meta-review-count', user?.id], enabled: !!user, refetchInterval: tab === 'approvals' ? 30_000 : false, queryFn: () => fetchTrafficReviewList({ status: 'pendente', limit: 1 }) })
  const allRows = query.data || emptyRows
  const accounts = useMemo(() => [...new Map(allRows.map(row => [row.account_id, { id: row.account_id, name: row.account_name || row.account_id }])).values()], [allRows])
  const accountRows = account ? allRows.filter(row => row.account_id === account) : allRows
  const campaigns = useMemo(() => [...new Map(accountRows.map(row => [row.campaign_id, { id: row.campaign_id, name: row.campaign_name }])).values()], [accountRows])
  const scope = useMemo<TrafficScope>(() => ({ start, end, level, accountId: account || null, campaignId: campaign || null, source: origin || null }), [start, end, level, account, campaign, origin])
  const viewResult = useMemo(() => {
    if (!validRange || !query.data || query.isError) return { view: null, error: null }
    try { return { view: buildTrafficView(query.data, scope), error: null } }
    catch (cause) { return { view: null, error: errorMessage(cause) } }
  }, [query.data, query.isError, scope, validRange])
  const queryState: QueryState<MetaDailyRow[]> = !validRange ? { state: 'error', message: 'Escolha um período válido até hoje.' }
    : query.isError || viewResult.error ? { state: 'error', message: viewResult.error || errorMessage(query.error) }
    : query.isPending ? { state: 'loading' } : { state: 'ready', data: allRows }
  const cohortQuery = useQuery({ queryKey: ['meta-traffic-cohort', user?.id, start, end, account, campaign, origin], enabled: !!user && validRange && level === 'campaign' && tab === 'performance',
    queryFn: () => arenaRpc<TrafficCohortResult>('meta_traffic_cohort', { p_start: start, p_end: end, p_account_id: account || null, p_campaign_id: campaign || null, p_source: origin || null }) })
  const cohortState: QueryState<TrafficCohortResult> | null = level !== 'campaign' ? null : cohortQuery.isError ? { state: 'error', message: errorMessage(cohortQuery.error) }
    : cohortQuery.data ? { state: 'ready', data: cohortQuery.data } : { state: 'loading' }
  const reviewed = async () => {
    await refreshDashboardMutation(queryClient)
  }
  return <DashboardLayout><div className="mx-auto max-w-7xl space-y-6"><header><h1 className="text-3xl font-light">Tráfego</h1><p className="mt-2 text-sm text-muted-foreground">Desempenho da Meta Ads para decisões de investimento, aquisição e otimização.</p></header>
    <Tabs value={tab} onValueChange={setTab} className="space-y-5"><TabsList className="h-auto flex-wrap"><TabsTrigger value="performance">Desempenho</TabsTrigger><TabsTrigger value="import" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Importar</TabsTrigger><TabsTrigger value="approvals">Aprovações{pendingCount.data?.count ? ` (${pendingCount.data.count})` : ''}</TabsTrigger><TabsTrigger value="data">Dados e edições</TabsTrigger><TabsTrigger value="audit">Auditoria</TabsTrigger><TabsTrigger value="connection">Conexão</TabsTrigger><TabsTrigger value="suggestions">Sugestões</TabsTrigger></TabsList>
      <TabsContent value="performance" className="space-y-5"><section className="surface-panel grid gap-4 rounded-2xl p-5 sm:grid-cols-2 lg:grid-cols-4"><div><Label htmlFor="traffic-period">Período</Label><select id="traffic-period" className={selectClass} value={period} onChange={event => setPeriod(event.target.value)}><option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="month">Mês atual</option><option value="custom">Personalizado</option></select></div><div><Label htmlFor="traffic-level">Nível</Label><select id="traffic-level" className={selectClass} value={level} onChange={event => { setLevel(event.target.value as MetaLevel); setAccount(''); setCampaign('') }}><option value="campaign">Campanhas</option><option value="adset">Conjuntos</option><option value="ad">Anúncios</option></select></div><div><Label htmlFor="traffic-account">Conta Meta</Label><select id="traffic-account" className={selectClass} value={account} onChange={event => { setAccount(event.target.value); setCampaign('') }}><option value="">Todas as contas</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div><Label htmlFor="traffic-campaign">Campanha</Label><select id="traffic-campaign" className={selectClass} value={campaign} onChange={event => setCampaign(event.target.value)}><option value="">Todas as campanhas</option>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div><Label htmlFor="traffic-origin">Origem</Label><select id="traffic-origin" className={selectClass} value={origin} onChange={event => setOrigin(event.target.value as MetaDailyRow['source'] | '')}><option value="">Todas</option><option value="csv">CSV</option><option value="api">API</option></select></div>{period === 'custom' && <><div><Label htmlFor="traffic-start">De</Label><Input id="traffic-start" type="date" value={customStart} max={today} onChange={event => setCustomStart(event.target.value)} /></div><div><Label htmlFor="traffic-end">Até</Label><Input id="traffic-end" type="date" value={customEnd} max={today} onChange={event => setCustomEnd(event.target.value)} /></div></>}</section>
        <MetaTrafficPerformance view={viewResult.view} queryState={queryState} cohortState={cohortState} onRetry={() => { void query.refetch(); if (level === 'campaign') void cohortQuery.refetch() }} />
      </TabsContent>
      <TabsContent value="import" className="space-y-5">
        <ImportPanel today={today} onSubmitted={reviewed} />
        <LeadImportPanel onSubmitted={reviewed} />

        <MetaPendingImports active={tab === 'import'} canReview={false} history onReviewed={reviewed} />
      </TabsContent>
      <TabsContent value="approvals" className="space-y-5"><p className="text-sm text-muted-foreground">A aprovação manual libera dados para Desempenho e leads para a equipe SDR. Gestor de Tráfego, Executive e Super Admin podem revisar.</p><MetaLeadApprovals canReview={canReview} onReviewed={reviewed} /><MetaPendingImports active={tab === 'approvals'} canReview={canReview} onReviewed={reviewed} /></TabsContent>
      <TabsContent value="data" className="space-y-5"><MetaTrafficData canEdit={canReview} onSaved={reviewed} /><MetaImportEdits active={tab === 'data'} canEdit={canReview} onSaved={reviewed} /></TabsContent>
      <TabsContent value="audit"><MetaAudit /></TabsContent>
      <TabsContent value="connection"><ConnectionPanel onProposeChange={() => setTab('suggestions')} /></TabsContent>
      <TabsContent value="suggestions"><Suggestions campaigns={campaigns} /></TabsContent>
    </Tabs></div></DashboardLayout>
}
