import {useEffect, useState} from 'react'
import {Link} from 'react-router-dom'
import {useQueryClient} from '@tanstack/react-query'
import {CalendarDays, Clock, ExternalLink, RefreshCw, ArrowRight} from 'lucide-react'
import {DashboardLayout} from '@/components/layout/DashboardLayout'
import {Card, CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Badge} from '@/components/ui/badge'
import {useRoles} from '@/hooks/useRoles'
import {useCRMActivities, useCRMAssignees, useCRMLeads, useCRMRealtime} from '@/hooks/useCRM'
import {CalendarStatusesProvider, CRMCalendarStatus} from '@/components/crm/CRMCalendarStatus'
import {GoogleCalendarIntegration} from '@/components/settings/GoogleCalendarIntegration'
import {agendaCallLabel, selectCloserAgendaCalls, type AgendaView} from '@/lib/closer-agenda'
import {BRASILIA_TIME_ZONE, brasiliaDateKey} from '@/lib/brasilia-time'
import {useGoogleCalendarRefresh} from '@/hooks/useGoogleCalendar'
import {callDurationMinutes,callEndIso} from '@/lib/crm-call-duration'

const displayTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRASILIA_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short',
})

export default function Agenda() {
  const {capabilities} = useRoles()
  const leads = useCRMLeads(), calls = useCRMActivities(null, true), assignees = useCRMAssignees()
  const {realtimeUnavailable} = useCRMRealtime()
  const client = useQueryClient()
  const synchronization=useGoogleCalendarRefresh()
  const [view, setView] = useState<AgendaView>('scheduled')
  const [dateKey, setDateKey] = useState('')
  useEffect(() => {
    // Deletion notifications can be omitted by RLS even on a subscribed channel.
    const timer = window.setInterval(() => void client.invalidateQueries({queryKey: ['crm']}), realtimeUnavailable?15_000:30_000)
    return () => window.clearInterval(timer)
  }, [client, realtimeUnavailable])

  const loading = leads.loading || calls.loading || assignees.isPending
  const failed = !!leads.error || !!calls.error || assignees.isError
  const visible = loading || failed ? [] : selectCloserAgendaCalls(calls.activities, leads.leads, {view, dateKey})
  const leadById = new Map(leads.leads.map(lead => [lead.id, lead]))
  const names = new Map((assignees.data ?? []).map(person => [person.user_id, person.display_name]))
  const refresh = () => synchronization.mutate()

  return <DashboardLayout>
    <div className="relative space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-foreground"><CalendarDays className="h-8 w-8 text-primary" />Agenda dos closers</h1>
          <p className="mt-2 text-sm text-muted-foreground">Calls de fechamento do CRM. Horários de Brasília · duração definida no agendamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} disabled={synchronization.isPending} aria-busy={synchronization.isPending}><RefreshCw className={`mr-2 h-4 w-4 ${synchronization.isPending?'animate-spin':''}`} />{synchronization.isPending?'Sincronizando…':'Atualizar'}</Button>
          <Button asChild><a href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Abrir Google Agenda</a></Button>
        </div>
      </header>
      {synchronization.isError&&<p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">Não foi possível concluir a atualização. Confira o status da agenda e tente novamente.</p>}
      {synchronization.isSuccess&&<p role="status" className="text-sm text-muted-foreground">{synchronization.data.pending?'Atualização solicitada. Há calls com sincronização pendente; confira os status abaixo.':'Atualização concluída. Calls e status da agenda foram recarregados.'}</p>}

      <Card className="border-border/50">
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex gap-2" aria-label="Calls da agenda">
              <Button variant={view === 'scheduled' ? 'default' : 'outline'} aria-pressed={view === 'scheduled'} onClick={() => setView('scheduled')}>Agendadas</Button>
              <Button variant={view === 'history' ? 'default' : 'outline'} aria-pressed={view === 'history'} onClick={() => setView('history')}>Histórico</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label htmlFor="agenda-date">Data da call</Label><Input id="agenda-date" type="date" value={dateKey} onChange={event => setDateKey(event.target.value)} className="w-44" /></div>
              <Button variant="outline" onClick={() => setDateKey(brasiliaDateKey())}>Hoje</Button>
              <Button variant="ghost" onClick={() => setDateKey('')}>Todas as datas</Button>
            </div>
          </div>

          {loading ? <p role="status" className="py-8 text-center text-muted-foreground">Carregando calls…</p> : failed ? <div role="alert" className="space-y-3 py-8 text-center"><p>Não foi possível carregar as calls.</p><Button variant="outline" onClick={refresh}>Tentar novamente</Button></div> : <CalendarStatusesProvider callIds={visible.map(call => call.id)}>
            <p className="text-sm text-muted-foreground">{visible.length} {visible.length === 1 ? 'call' : 'calls'} {view === 'scheduled' ? 'agendadas' : 'no histórico'}{dateKey ? ' na data selecionada' : ''}.</p>
            {!visible.length ? <div className="space-y-2 rounded-lg border border-dashed py-10 text-center"><CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" /><p className="font-medium">Nenhuma call {view === 'scheduled' ? 'agendada' : 'no histórico'} para este filtro.</p><p className="px-4 text-sm text-muted-foreground">As calls encaminhadas para Closer aparecem aqui automaticamente.</p></div> : <ul className="space-y-3" aria-label="Lista de calls dos closers">
              {visible.map(call => {
                const lead = leadById.get(call.lead_id)!
                const endsAt=callEndIso(call)
                return <li key={call.id} className="flex min-h-40 flex-wrap items-center justify-between gap-4 rounded-xl border border-border/60 bg-background/40 p-5">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2"><p className="break-words font-semibold">{lead.athlete_name || lead.name || 'Lead'}</p><Badge variant="outline">{agendaCallLabel(call)}</Badge></div>
                    {lead.athlete_name && lead.name && <p className="text-sm text-muted-foreground">Responsável pelo atleta: {lead.name}</p>}
                    <p className="flex flex-wrap items-center gap-2 text-sm"><Clock className="h-4 w-4 shrink-0 text-primary" /><time dateTime={call.scheduled_at!}>{displayTime.format(new Date(call.scheduled_at!))}</time>{endsAt&&<><span>até</span><time dateTime={endsAt}>{displayTime.format(new Date(endsAt))}</time></>}<span>({callDurationMinutes(call)} min)</span></p>
                    <p className="text-sm text-muted-foreground">Closer: {names.get(call.assigned_to ?? '') || 'Responsável indisponível'}</p>
                    {(call.description||lead.qualification_summary)&&<p className="max-w-3xl whitespace-pre-wrap break-words text-sm text-muted-foreground"><span className="font-medium text-foreground">Contexto da call: </span>{(call.description||lead.qualification_summary||'').slice(0,1200)}</p>}
                    <CRMCalendarStatus callId={call.id} />
                  </div>
                  <Button asChild variant="outline" size="sm"><Link to={`/crm?tab=closer&lead=${encodeURIComponent(lead.id)}`}>Ver call no CRM<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                </li>
              })}
            </ul>}
          </CalendarStatusesProvider>}
        </CardContent>
      </Card>

      {capabilities.executive && <section aria-label="Administração da agenda"><GoogleCalendarIntegration /></section>}
    </div>
  </DashboardLayout>
}
