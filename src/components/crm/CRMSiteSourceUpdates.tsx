import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { arenaClient } from '@/lib/arena-api'
import { leadDateTime } from '@/lib/meta-waves'
import { Button } from '@/components/ui/button'

export const siteEventListColumns = 'event_id,source_lead_id,source_revision,received_at,status,error_code,meta_form_lead_id'
interface SiteEvent { event_id: string; source_revision: number; received_at: string; status: string; error_code: string | null; event?: Record<string, unknown> }
const labels: Record<string, string> = { pending_review: 'Captura para revisão', context_only: 'Atualização da origem', superseded: 'Versão anterior recebida depois', quarantined: 'Evento preservado para conferência' }
export function SiteEventContent({ event }: { event: SiteEvent }) {
  const raw = event.event ?? {}
  return <div className="space-y-2 text-xs">
    <p>{labels[event.status] ?? event.status} · versão {event.source_revision}</p>
    <dl className="space-y-1">
      <div><dt>Recebido no sistema · Brasília</dt><dd>{leadDateTime(event.received_at)}</dd></div>
      <div><dt>Geração original</dt><dd>{leadDateTime(typeof raw.generated_at === 'string' ? raw.generated_at : null)}</dd></div>
      <div><dt>Atualizado na origem</dt><dd>{leadDateTime(typeof raw.source_updated_at === 'string' ? raw.source_updated_at : null)}</dd></div>
    </dl>
    <p className="text-muted-foreground">Este registro preserva o contexto da origem. O cadastro corrigido pelo SDR e a captura aprovada permanecem separados.</p>
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background/50 p-2">{JSON.stringify(raw, null, 2)}</pre>
  </div>
}
export function SiteEventDetail({ id }: { id: string }) {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['crm', 'site-event', user?.id, id], enabled: !!user, staleTime: Infinity, retry: 1,
    queryFn: async () => {
      const { data, error } = await arenaClient.from('site_import_events').select('*').eq('event_id', id).single()
      if (error) throw error
      return data as unknown as SiteEvent
    } })
  if (query.isError) return <div role="alert">Não foi possível carregar o evento completo. <Button size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></div>
  if (!query.data) return <p role="status">Carregando contexto integral…</p>
  return <SiteEventContent event={query.data} />
}
function EventHistory({ formLeadId }: { formLeadId: string }) {
  const { user } = useAuth()
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const query = useQuery({ queryKey: ['crm', 'site-source-updates', user?.id, formLeadId, offset], enabled: !!user,
    staleTime: 5_000, refetchInterval: 20_000, retry: 1, queryFn: async () => {
      const { data, error, count } = await arenaClient.from('site_import_events').select(siteEventListColumns, { count: 'exact' })
        .eq('meta_form_lead_id', formLeadId).order('received_at', { ascending: false }).order('event_id', { ascending: false }).range(offset, offset + 19)
      if (error) throw error
      return { rows: data as unknown as SiteEvent[], count: count ?? 0 }
    } })
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Eventos completos, mais recentes primeiro. Horários de Brasília com segundos.</p>
    {query.isError ? <div role="alert">Histórico indisponível. <Button size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></div>
      : !query.data ? <p role="status">Conferindo eventos…</p> : !query.data.count ? <p className="text-xs">Nenhum evento automático vinculado a esta identidade.</p>
        : query.data.rows.map(event => <div key={event.event_id} className="rounded border p-3">
          <button className="text-left text-xs" aria-expanded={openId === event.event_id} onClick={() => setOpenId(openId === event.event_id ? null : event.event_id)}>
            Versão {event.source_revision} · {leadDateTime(event.received_at)} · {labels[event.status] ?? event.status}
          </button>
          {event.error_code && <p role="alert" className="text-xs text-amber-300">Conferência necessária: {event.error_code}</p>}
          {openId === event.event_id && <SiteEventDetail id={event.event_id} />}
        </div>)}
    {!!query.data?.count && <div className="flex items-center gap-3 text-xs">
      <Button size="sm" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 20)); setOpenId(null) }}>Anteriores</Button>
      <span>{offset + 1}–{Math.min(offset + 20, query.data.count)} de {query.data.count}</span>
      <Button size="sm" disabled={offset + 20 >= query.data.count} onClick={() => { setOffset(offset + 20); setOpenId(null) }}>Próximos</Button>
    </div>}
  </div>
}
export function CRMSiteSourceUpdates({ formLeadId }: { formLeadId: string }) {
  const [expanded, setExpanded] = useState(false)
  return <section aria-label="Atualizações do site" className="rounded-lg border border-primary/20 p-3">
    <button className="text-sm font-semibold" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Atualizações e contexto completo do site</button>
    {expanded && <EventHistory key={formLeadId} formLeadId={formLeadId} />}
  </section>
}
