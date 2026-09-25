import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { fetchAllPages } from '@/lib/supabase-pages'
import { useBrasiliaToday } from '@/hooks/useGoals'
import { useAuth } from '@/hooks/useAuth'
import { aggregateMeta, buildImportRows, csvFields, defaultCsvMapping, parseCsv, type CsvMapping, type MetaDailyRow, type MetaLevel } from '@/lib/meta-traffic'
import { errorMessage, money } from '@/lib/sales'

type Suggestion = { id: string; author_name: string; subject: string; body: string; campaign_id: string | null; status: string; created_at: string; updated_at: string }
type Reply = { id: string; suggestion_id: string; author_name: string; body: string; created_at: string }
type Batch = { id: string; filename: string; row_count: number; created_at: string }
const emptyRows: MetaDailyRow[] = []
const statuses: Record<string, string> = { nova: 'Nova', em_analise: 'Em análise', planejada: 'Planejada', aplicada: 'Aplicada', descartada: 'Descartada' }
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
function shiftDate(date: string, days: number) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) }
function formatDate(value: string) { return value.slice(0, 10).split('-').reverse().join('/') }
function format(value: number | null, kind: 'money' | 'count' | 'percent' | 'ratio') {
  if (value === null) return '—'
  if (kind === 'money') return money(value)
  if (kind === 'percent') return value.toFixed(2) + '%'
  if (kind === 'ratio') return value.toFixed(2) + 'x'
  return new Intl.NumberFormat('pt-BR').format(value)
}
function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function ImportPanel({ today, onImported }: { today: string; onImported: () => Promise<unknown> }) {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [values, setValues] = useState<string[][]>([])
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [level, setLevel] = useState<MetaLevel>('campaign')
  const [attribution, setAttribution] = useState('Conforme exportação Meta')
  const [brlConfirmed, setBrlConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState('')
  const preview = useMemo(() => {
    if (!mapping || !values.length) return null
    try { return buildImportRows(values, headers, mapping, level, today, attribution) }
    catch (cause) { return errorMessage(cause) }
  }, [values, headers, mapping, level, today, attribution])
  const load = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('Arquivo acima de 2 MB. Divida a exportação em partes menores.')
      const parsed = parseCsv(await file.text())
      setFileName(file.name); setHeaders(parsed.headers); setValues(parsed.values)
      setMapping(defaultCsvMapping(parsed.headers)); setFileError('')
    } catch (cause) { setFileError(errorMessage(cause)); setValues([]); setMapping(null) }
  }
  const submit = async () => {
    if (!Array.isArray(preview) || !preview.length) return
    setBusy(true)
    try {
      await arenaRpc('meta_import_daily', { p_filename: fileName, p_rows: preview })
      await onImported()
      toast.success(preview.length + ' linhas da Meta importadas.')
      setValues([]); setMapping(null); setFileName(''); setBrlConfirmed(false)
    } catch (cause) { toast.error(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <section className="surface-panel space-y-5 rounded-2xl p-5 sm:p-6">
    <div><h2 className="text-lg font-medium">Importar relatório da Meta</h2><p className="mt-1 text-sm text-muted-foreground">Exporte dados diários do Gerenciador de Anúncios em CSV, com moeda BRL. Inclua IDs, gasto e, quando disponíveis, leads e compras.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="meta-file">Arquivo CSV</Label><Input key={fileName || 'empty'} id="meta-file" type="file" accept=".csv,text/csv" onChange={event => void load(event.target.files?.[0])} /></div>
      <div><Label htmlFor="meta-level">Nível da exportação</Label><select id="meta-level" className={selectClass} value={level} onChange={event => setLevel(event.target.value as MetaLevel)}><option value="campaign">Campanha</option><option value="adset">Conjunto de anúncios</option><option value="ad">Anúncio</option></select></div>
      <div className="sm:col-span-2"><Label htmlFor="meta-attribution">Janela de atribuição da exportação</Label><Input id="meta-attribution" maxLength={120} value={attribution} onChange={event => setAttribution(event.target.value)} /></div>
    </div>
    {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
    {mapping && <><div><h3 className="font-medium">Conferir colunas · {fileName}</h3><p className="text-xs text-muted-foreground">Campos opcionais sem coluna serão tratados como zero.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{csvFields.map(field => <div key={field.key}><Label htmlFor={'map-' + field.key}>{field.label}{field.required ? ' *' : ''}</Label><select id={'map-' + field.key} className={selectClass} value={mapping[field.key]} onChange={event => setMapping({ ...mapping, [field.key]: event.target.value })}><option value="">Sem coluna</option>{headers.map((header, index) => <option key={index} value={header}>{header}</option>)}</select></div>)}</div>
      {typeof preview === 'string' ? <p role="alert" className="text-sm text-destructive">{preview}</p> : preview && <p className="rounded-lg border border-border/60 p-4 text-sm"><strong>{preview.length} linhas prontas.</strong> A importação atualiza dados com os mesmos IDs e datas. Confirme que leads e compras usam a mesma atribuição.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={brlConfirmed} onChange={event => setBrlConfirmed(event.target.checked)} /> Confirmo que o valor gasto e o valor de compras estão em BRL.</label>
      <Button disabled={busy || !brlConfirmed || !Array.isArray(preview) || !preview.length} onClick={() => void submit()}>{busy ? 'Importando…' : 'Confirmar importação'}</Button>
    </>}
  </section>
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
  const today = useBrasiliaToday()
  const [period, setPeriod] = useState('30')
  const [customStart, setCustomStart] = useState(shiftDate(today, -29))
  const [customEnd, setCustomEnd] = useState(today)
  const [level, setLevel] = useState<MetaLevel>('campaign')
  const [account, setAccount] = useState('')
  const [campaign, setCampaign] = useState('')
  const start = period === 'custom' ? customStart : period === 'month' ? today.slice(0, 7) + '-01' : shiftDate(today, 1 - Number(period))
  const end = period === 'custom' ? customEnd : today
  const validRange = start <= end && end <= today && start.length === 10 && end.length === 10
  const query = useQuery({ queryKey: ['meta-traffic', user?.id, start, end, level], enabled: !!user && validRange, queryFn: () => fetchAllPages<MetaDailyRow>((from, to) => arenaClient.from('meta_traffic_daily').select('*').gte('date', start).lte('date', end).eq('level', level).order('date').order('id').range(from, to)) })
  const batchQuery = useQuery({ queryKey: ['meta-imports', user?.id], enabled: !!user, queryFn: () => fetchAllPages<Batch>((from, to) => arenaClient.from('meta_import_batches').select('*').order('created_at', { ascending: false }).range(from, to)) })
  const allRows = query.data || emptyRows
  const accounts = useMemo(() => [...new Map(allRows.map(row => [row.account_id, { id: row.account_id, name: row.account_name || row.account_id }])).values()], [allRows])
  const accountRows = account ? allRows.filter(row => row.account_id === account) : allRows
  const campaigns = useMemo(() => [...new Map(accountRows.map(row => [row.campaign_id, { id: row.campaign_id, name: row.campaign_name }])).values()], [accountRows])
  const rows = campaign ? accountRows.filter(row => row.campaign_id === campaign) : accountRows
  const total = aggregateMeta(rows)
  const daily = useMemo(() => [...new Set(rows.map(row => row.date))].sort().map(date => ({ date: formatDate(date), ...aggregateMeta(rows.filter(row => row.date === date)) })), [rows])
  const byCampaign = useMemo(() => campaigns.map(item => ({ ...item, ...aggregateMeta(accountRows.filter(row => row.campaign_id === item.id)) })).sort((a, b) => b.spend - a.spend), [campaigns, accountRows])
  const cplMedian = median(byCampaign.flatMap(item => item.cpl === null ? [] : [item.cpl]))
  const cpaMedian = median(byCampaign.flatMap(item => item.cpa === null ? [] : [item.cpa]))
  const attributionWindows = [...new Set(rows.map(row => row.attribution_window))]
  const imported = async () => { await Promise.all([query.refetch(), batchQuery.refetch()]) }
  return <DashboardLayout><div className="mx-auto max-w-7xl space-y-6"><header><h1 className="text-3xl font-light">Tráfego</h1><p className="mt-2 text-sm text-muted-foreground">Desempenho da Meta Ads para decisões de investimento, aquisição e otimização.</p></header>
    <Tabs defaultValue="performance" className="space-y-5"><TabsList className="h-auto flex-wrap"><TabsTrigger value="performance">Desempenho</TabsTrigger><TabsTrigger value="import">Importar Meta</TabsTrigger><TabsTrigger value="suggestions">Sugestões</TabsTrigger></TabsList>
      <TabsContent value="performance" className="space-y-5"><section className="surface-panel grid gap-4 rounded-2xl p-5 sm:grid-cols-2 lg:grid-cols-4"><div><Label htmlFor="traffic-period">Período</Label><select id="traffic-period" className={selectClass} value={period} onChange={event => setPeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="month">Mês atual</option><option value="custom">Personalizado</option></select></div><div><Label htmlFor="traffic-level">Nível</Label><select id="traffic-level" className={selectClass} value={level} onChange={event => { setLevel(event.target.value as MetaLevel); setAccount(''); setCampaign('') }}><option value="campaign">Campanhas</option><option value="adset">Conjuntos</option><option value="ad">Anúncios</option></select></div><div><Label htmlFor="traffic-account">Conta Meta</Label><select id="traffic-account" className={selectClass} value={account} onChange={event => { setAccount(event.target.value); setCampaign('') }}><option value="">Todas as contas</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div><Label htmlFor="traffic-campaign">Campanha</Label><select id="traffic-campaign" className={selectClass} value={campaign} onChange={event => setCampaign(event.target.value)}><option value="">Todas as campanhas</option>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{period === 'custom' && <><div><Label htmlFor="traffic-start">De</Label><Input id="traffic-start" type="date" value={customStart} max={today} onChange={event => setCustomStart(event.target.value)} /></div><div><Label htmlFor="traffic-end">Até</Label><Input id="traffic-end" type="date" value={customEnd} max={today} onChange={event => setCustomEnd(event.target.value)} /></div></>}</section>
        {!validRange && <p role="alert" className="text-sm text-destructive">Escolha um período válido até hoje.</p>}{query.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error)}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([
          ['Investimento', format(total.spend, 'money')], ['Leads Meta', format(total.leads, 'count')], ['CPL · custo por lead', format(total.cpl, 'money')], ['Compras Meta', format(total.purchases, 'count')], ['CPA · custo por compra', format(total.cpa, 'money')],
          ['Valor de compras', format(total.purchaseValue, 'money')], ['ROAS', format(total.roas, 'ratio')], ['CPM', format(total.cpm, 'money')], ['CPC link', format(total.cpc, 'money')], ['CTR link', format(total.ctr, 'percent')],
        ] as [string, string][]).map(([label, value]) => <article className="surface-panel rounded-xl p-4" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{query.isLoading ? '…' : value}</p></article>)}</div>
        <p className="text-xs text-muted-foreground">CPL = investimento ÷ leads. CPA = investimento ÷ compras reportadas pela Meta. ROAS = valor de compras ÷ investimento. Os números seguem a janela de atribuição da exportação e não equivalem a vendas confirmadas no CRM. “—” indica denominador zero. Cada nível é analisado separadamente para evitar contagem dupla.</p>
        {!!rows.length && <section className="surface-panel space-y-3 rounded-2xl p-5"><h2 className="font-medium">Referência das próprias campanhas</h2><p className="text-sm text-muted-foreground">Medianas no período e conta selecionados: CPL {format(cplMedian, 'money')} · CPA {format(cpaMedian, 'money')}. Use como comparação interna; campanha, público e objetivo influenciam o resultado.</p><p className="text-xs text-muted-foreground">Atribuição: {attributionWindows.join(' · ')}</p>{attributionWindows.length > 1 && <p className="text-sm text-amber-400">Há janelas de atribuição diferentes neste recorte. Compare campanhas com cautela.</p>}</section>}
        <section className="surface-panel rounded-2xl p-5"><h2 className="mb-4 font-medium">Investimento e resultados por dia</h2>{daily.length ? <div className="h-72" role="img" aria-label="Gráfico diário de investimento, leads e compras"><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis yAxisId="brl" tick={{ fontSize: 11 }} tickFormatter={value => `R$ ${value}`} /><YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number, name: string) => name === 'Investimento' ? money(value) : value} /><Legend /><Area yAxisId="brl" type="monotone" dataKey="spend" name="Investimento" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.18} /><Area yAxisId="count" type="monotone" dataKey="leads" name="Leads" stroke="#22c55e" fill="#22c55e" fillOpacity={0.08} /><Area yAxisId="count" type="monotone" dataKey="purchases" name="Compras" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} /></AreaChart></ResponsiveContainer></div> : <p className="py-10 text-center text-sm text-muted-foreground">Nenhum dado da Meta neste filtro. Importe um CSV para começar.</p>}</section>
        <section className="surface-panel overflow-hidden rounded-2xl"><div className="p-5"><h2 className="font-medium">Campanhas</h2><p className="text-xs text-muted-foreground">Ordenadas por investimento no período.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-y border-border/60 text-xs text-muted-foreground"><tr>{['Campanha', 'Gasto', 'Leads', 'CPL', 'Compras', 'CPA', 'ROAS', 'CTR'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{byCampaign.map(item => <tr className="border-b border-border/40" key={item.id}><td className="px-4 py-3">{item.name}</td><td className="px-4 py-3">{format(item.spend, 'money')}</td><td className="px-4 py-3">{item.leads}</td><td className="px-4 py-3">{format(item.cpl, 'money')}</td><td className="px-4 py-3">{item.purchases}</td><td className="px-4 py-3">{format(item.cpa, 'money')}</td><td className="px-4 py-3">{format(item.roas, 'ratio')}</td><td className="px-4 py-3">{format(item.ctr, 'percent')}</td></tr>)}</tbody></table></div>{!byCampaign.length && <p className="p-5 text-sm text-muted-foreground">Sem campanhas para exibir.</p>}</section>
      </TabsContent>
      <TabsContent value="import" className="space-y-5"><ImportPanel today={today} onImported={imported} /><section className="surface-panel rounded-2xl p-5"><h2 className="font-medium">Importações recentes</h2>{batchQuery.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(batchQuery.error)}</p>}{batchQuery.data?.slice(0, 10).map(item => <p key={item.id} className="border-b border-border/40 py-3 text-sm">{item.filename} · {item.row_count} linhas · {new Date(item.created_at).toLocaleString('pt-BR')}</p>)}{!batchQuery.isLoading && !batchQuery.data?.length && <p className="mt-3 text-sm text-muted-foreground">Nenhuma importação registrada.</p>}</section></TabsContent>
      <TabsContent value="suggestions"><Suggestions campaigns={campaigns} /></TabsContent>
    </Tabs></div></DashboardLayout>
}
