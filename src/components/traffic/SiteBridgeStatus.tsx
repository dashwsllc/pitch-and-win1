import { pollEvery, POLL } from '@/lib/polling'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { SiteEventDetail, siteEventListColumns } from '@/components/crm/CRMSiteSourceUpdates'
import { leadDateTime } from '@/lib/meta-waves'
import { Button } from '@/components/ui/button'
interface BridgeHealth { last_heartbeat: string | null; last_received_at: string | null; pending_count: number | null; quarantined_count: number; oldest_pending_at: string | null }
export function siteBridgeFresh(at: string | null, now = Date.now()) { return !!at && Number.isFinite(Date.parse(at)) && now - Date.parse(at) <= 120000 && Date.parse(at) <= now + 300000 }
export function SiteBridgeHealth({ data, now = Date.now() }: { data: BridgeHealth; now?: number }) {
  const fresh = siteBridgeFresh(data.last_heartbeat, now)
  return <div className="space-y-2 text-xs">
    <p className={fresh ? 'text-emerald-300' : 'text-amber-300'} role="status">{!data.last_heartbeat ? 'Recebimento automático do site não confirmado. Sem sinal de saúde.' : fresh ? 'Sinal recente do servidor do site' : 'Sinal do servidor do site desatualizado; confira as pendências'}</p>
    <p>Sinal em {leadDateTime(data.last_heartbeat)} · última entrega {leadDateTime(data.last_received_at)}</p>
    <p>{data.pending_count === null ? 'Fila na origem desconhecida' : `${data.pending_count} eventos pendentes na origem`}
      {data.oldest_pending_at ? ` · pendência mais antiga ${leadDateTime(data.oldest_pending_at)}` : ''}</p>
    {!!data.quarantined_count && <p role="alert" className="text-amber-300">{data.quarantined_count} eventos exigem conferência ou recuperação. Os registros permanecem preservados.</p>}
    <p className="text-muted-foreground">Eventos e contatos do site são distintos de visitas e métricas de campanha. A fila só termina após confirmação durável.</p>
  </div>
}
export function SiteBridgeStatus({ active }: { active: boolean }) {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['site-bridge', user?.id], enabled: active && !!user, refetchInterval: active ? pollEvery(POLL.bridge) : false, retry: 1,
    queryFn: () => arenaRpc<BridgeHealth>('site_bridge_operation', {}) })
  return <section aria-label="Integração do site" className="space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">Site / conversão direta</h3>
    {query.isError ? <div role="alert" className="text-sm text-destructive">Estado da integração indisponível. <Button size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></div>
      : query.data ? <SiteBridgeHealth data={query.data} /> : <p role="status" className="text-xs">Conferindo fila do site…</p>}
    {!!query.data?.quarantined_count && <QuarantinedSiteEvents active={active} />}
  </section>
}

function QuarantinedSiteEvents({ active }: { active: boolean }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const [eventId, setEventId] = useState<string | null>(null)
  const query = useQuery({ queryKey: ['site-bridge', 'quarantined', user?.id, offset], enabled: active && open && !!user, refetchInterval: active && open ? pollEvery(POLL.bridge) : false,
    queryFn: async () => {
      const { data, error, count } = await arenaClient.from('site_import_events').select(siteEventListColumns, { count: 'exact' })
        .eq('status', 'quarantined').order('received_at', { ascending: false }).order('event_id', { ascending: false }).range(offset, offset + 19)
      if (error) throw error
      return { rows: data, count: count ?? 0 }
    } })
  return <div className="space-y-2">
    <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>Conferir eventos preservados</Button>
    {open && <>
      {query.isError ? <p role="alert">Não foi possível consultar. <Button size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></p>
        : !query.data ? <p role="status">Carregando…</p> : query.data.rows.map(event => <div key={event.event_id} className="space-y-2 rounded border p-2 text-xs">
          <button onClick={() => setEventId(eventId === event.event_id ? null : event.event_id)}>{leadDateTime(event.received_at)} · {event.error_code} · {event.source_lead_id}</button>
          {eventId === event.event_id && <SiteEventDetail id={event.event_id} />}
        </div>)}
      <p className="text-xs text-muted-foreground">Falhas de transporte permanecem na fila do site e são tentadas novamente. Eventos de formato desconhecido exigem correção na origem, preservando o original.</p>
      {!!query.data?.count && <div className="flex gap-2"><Button size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Anteriores</Button><Button size="sm" disabled={offset + 20 >= query.data.count} onClick={() => setOffset(offset + 20)}>Próximos</Button></div>}
    </>}
  </div>
}
