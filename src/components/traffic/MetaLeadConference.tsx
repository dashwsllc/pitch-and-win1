import { pollEvery, POLL } from '@/lib/polling'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { arenaRpc } from '@/lib/arena-api'
import { errorMessage } from '@/lib/sales'
import { conferenceGap, summarizeConference, type ConferenceRow } from '@/lib/meta-lead-conference'

const day = (value: string) => value.split('-').reverse().join('/')

/** Conferência por dia e campanha: o que a Meta informa × os leads que chegaram × os que já estão no CRM. */
export function MetaLeadConference({ active, start, end, campaignId, onOpenWaves }: { active: boolean; start: string; end: string; campaignId: string | null; onOpenWaves: () => void }) {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['meta-lead-conference', user?.id, start, end], enabled: active && !!user, refetchInterval: active ? pollEvery(POLL.conference) : false,
    queryFn: () => arenaRpc<ConferenceRow[]>('meta_traffic_conference', { p_start: start, p_end: end }) })
  const rows = (Array.isArray(query.data) ? query.data : []).filter(row => !campaignId || row.campaign_id === campaignId)
  const summary = summarizeConference(rows)
  return <section aria-labelledby="lead-conference-title" className="surface-panel space-y-4 rounded-2xl p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="lead-conference-title" className="flex items-center gap-2 font-medium"><ScanSearch className="h-4 w-4 text-ember" />Conferência de leads · Meta × recebidos × CRM</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Cada linha compara, no dia (horário de Brasília) e na campanha, os leads que a Meta informa com os leads que chegaram ao painel e os que já estão no CRM. Hoje e ontem a Meta ainda pode ajustar os números; uma diferença que some na captura seguinte é normal.</p></div>
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar</Button>
    </div>
    {query.isError && <div role="alert" className="text-sm text-destructive"><p>{errorMessage(query.error)}</p></div>}
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">Conferindo leads…</p>}
    {query.data && (rows.length ? <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[['Leads informados pela Meta', summary.meta], ['Leads recebidos', summary.received], ['Aguardando aprovação', summary.pending], ['No CRM', summary.inCrm], ['Com falha no CRM', summary.failed]].map(([label, value]) =>
          <div key={label} className="surface-inset-glow rounded-xl p-3"><p className="text-xl font-light tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>)}
      </div>
      {summary.missing > 0 ? <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <span>A Meta informa {summary.missing} {summary.missing === 1 ? 'lead que ainda não chegou' : 'leads que ainda não chegaram'} em {summary.daysMissing} {summary.daysMissing === 1 ? 'dia' : 'dias'}. A busca automática recupera leads dos últimos dias a cada 5 minutos; se a diferença continuar, confira a aba Conexão ou importe a planilha exportada da Meta (leads já recebidos não duplicam).</span></p>
        : <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />Todos os leads informados pela Meta no período chegaram ao painel.</p>}
      {summary.pending > 0 && <Button size="sm" className="bg-gradient-ember text-white hover:opacity-90" onClick={onOpenWaves}>Aprovar {summary.pending} {summary.pending === 1 ? 'lead' : 'leads'} nas levas</Button>}
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead><tr>{['Dia', 'Campanha', 'Meta informa', 'Recebidos', 'Diferença', 'Aguardando', 'Aprovados', 'No CRM', 'Falhas'].map(label => <th key={label} className="px-3 py-2 text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => { const gap = conferenceGap(row); return <tr key={`${row.stat_day}:${row.campaign_id}`} className="border-t border-white/[0.06]">
          <td className="px-3 py-2 tabular-nums">{day(row.stat_day)}</td><td className="px-3 py-2">{row.campaign_name || row.campaign_id || 'Sem campanha'}</td>
          <td className="px-3 py-2 tabular-nums">{row.meta_leads}</td><td className="px-3 py-2 tabular-nums">{row.received}</td>
          <td className={`px-3 py-2 tabular-nums ${gap > 0 ? 'text-amber-300' : gap < 0 ? 'text-sky-300' : 'text-emerald-300'}`}>{gap > 0 ? `faltam ${gap}` : gap < 0 ? `${-gap} a mais` : 'confere'}</td>
          {[row.pending, row.approved, row.in_crm, row.failed].map((value, index) => <td key={index} className={`px-3 py-2 tabular-nums ${index === 3 && value > 0 ? 'text-rose-300' : ''}`}>{value}</td>)}
        </tr> })}</tbody></table></div>
      <p className="text-[11px] text-muted-foreground">“A mais” acontece quando a Meta atribui o lead a outro dia ou campanha, ou quando chega lead importado por planilha. “Faltam” indica lead informado pela Meta que ainda não está no painel.</p>
    </> : <p className="text-sm text-muted-foreground">Nenhum lead informado pela Meta nem recebido no período.</p>)}
  </section>
}
