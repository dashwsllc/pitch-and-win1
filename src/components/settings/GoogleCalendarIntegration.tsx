import {useCallback,useEffect,useState} from 'react'
import {useSearchParams} from 'react-router-dom'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Label} from '@/components/ui/label'
import {useGoogleCalendarAdmin} from '@/hooks/useGoogleCalendar'
import type {CalendarChoice} from '@/lib/google-calendar-api'
import {meetAccessView} from '@/lib/google-calendar-meet'
import type {ManageRequest} from '../../../supabase/functions/_shared/google-calendar-contract'
const connectionLabels={not_connected:'Não conectado',connected:'Google conectado',reconnect_required:'Reconecte o Google',permission_denied:'Revise o acesso à agenda',disconnected:'Desconectado'}
const emptySessionState=(sessionKey:string)=>({sessionKey,calendars:[] as CalendarChoice[],selected:'',error:'',notice:''})
export function GoogleCalendarIntegration(){
  const admin=useGoogleCalendarAdmin(),[params,setParams]=useSearchParams()
  const {isCurrent,sessionKey}=admin
  const empty=emptySessionState(admin.sessionKey)
  const [state,setState]=useState(empty)
  const {calendars,selected,error,notice}=state.sessionKey===admin.sessionKey?state:empty
  const update=useCallback((patch:Partial<ReturnType<typeof emptySessionState>>)=>{
    if(isCurrent())setState(previous=>({...((previous.sessionKey===sessionKey)?previous:emptySessionState(sessionKey)),...patch}))
  },[isCurrent,sessionKey])
  const status=admin.status
  useEffect(()=>{
    const callback=params.get('google_calendar')
    if(!callback)return
    update({notice:callback==='connected'?'Conta Google conectada. Confira a agenda selecionada.':callback==='denied'?'A autorização do Google foi recusada. Você pode tentar novamente.':'Não foi possível conectar. Tente novamente.'})
    const next=new URLSearchParams(params);next.delete('google_calendar');setParams(next,{replace:true})
  },[params,setParams,update])
  const act=async(request:ManageRequest)=>{
    update({error:''})
    try{
      const result=await admin.mutateAsync(request)
      if(!admin.isCurrent())return
      if('authorizationUrl'in result)window.location.assign(result.authorizationUrl)
      if('calendars'in result)update({calendars:result.calendars,selected:'',notice:result.calendars.length?'':'Nenhuma agenda com permissão de edição foi encontrada.'})
      if(request.action==='activate')update({selected:'',calendars:[],notice:'Sincronização ativada. As calls elegíveis serão enviadas automaticamente.'})
      if(request.action==='disconnect')update({calendars:[],selected:'',notice:'Sincronização pausada. Os eventos existentes foram preservados.'})
      if(request.action==='retry')update({notice:'Pendências liberadas para nova tentativa automática.'})
    }catch{update({error:'Não foi possível concluir. Confira a conexão e tente novamente.'})}
  }
  if(!admin.allowed)return null
  const busy=admin.isPending,connected=status?.connection==='connected',active=connected&&!!status.activatedAt
  return <Card id="google-calendar" className="border-border/50">
    <CardHeader><CardTitle>Google Agenda · Closers</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Agenda compartilhada da empresa: <strong>agenda - closers</strong>, da conta <strong>admvoxenai@gmail.com</strong>.</p>
      {admin.query.isLoading?<p role="status">Consultando conexão…</p>:admin.query.error?<div role="alert"><p>Não foi possível consultar a integração.</p><Button variant="outline" onClick={()=>void admin.query.refetch()}>Tentar novamente</Button></div>:status&&<>
        <p role="status" className="font-medium">{connectionLabels[status.connection]}{active?' · Sincronização ativa':connected?' · Aguardando ativação':''}</p>
        {status.calendar&&<div className="rounded border p-3 text-sm"><p>{status.calendar.name}</p><p className="break-all text-xs text-muted-foreground">{status.calendar.id}</p></div>}
        <p className="text-xs text-muted-foreground">As calls do Closer usam o horário e a duração definidos no CRM, com fuso de São Paulo. Alterações e cancelamentos são enviados automaticamente.</p>
        {status.configured?<div className="flex flex-wrap gap-2">
          {!connected&&<Button disabled={busy} onClick={()=>void act({action:'start_oauth'})}>{status.connection==='not_connected'?'Conectar Google':'Reconectar Google'}</Button>}
          {connected&&!status.destinationLocked&&<Button variant="outline" disabled={busy} onClick={()=>void act({action:'list_calendars'})}>Escolher agenda</Button>}
          {connected&&status.destinationLocked&&!status.activatedAt&&status.calendar&&<Button disabled={busy} onClick={()=>void act({action:'activate',calendarId:status.calendar!.id})}>Retomar sincronização</Button>}
          {connected&&status.activatedAt&&<Button variant="outline" disabled={busy} onClick={()=>void act({action:'retry'})}>Tentar pendências novamente</Button>}
          {status.connection!=='not_connected'&&status.connection!=='disconnected'&&<Button variant="outline" disabled={busy} onClick={()=>void act({action:'disconnect'})}>Desconectar e pausar</Button>}
        </div>:<p role="status" className="text-sm">A configuração Google precisa ser instalada no servidor antes de conectar.</p>}
        {calendars.length>0&&!status.destinationLocked&&<div className="space-y-2">
          <Label htmlFor="closer-calendar">Agenda de destino</Label>
          <select id="closer-calendar" className="flex w-full rounded-md border border-input bg-background p-2 text-sm" value={selected} disabled={busy} onChange={event=>update({selected:event.target.value})}>
            <option value="">Selecione a agenda compartilhada</option>
            {calendars.map(calendar=><option key={calendar.id} value={calendar.id}>{calendar.name} — {calendar.id}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Confira o nome e o ID. Após a ativação, esta agenda será o destino fixo das calls.</p>
          <Button disabled={busy||!selected} onClick={()=>void act({action:'activate',calendarId:selected})}>Ativar nesta agenda</Button>
        </div>}
        {status.destinationLocked&&<p className="text-xs text-muted-foreground">O destino está fixado para preservar a identidade dos eventos.</p>}
        {status.activatedAt&&<div className="text-sm"><p>{status.pendingCount} pendência(s) · {status.errorCount} erro(s)</p>{status.backfillPending&&<p>Preparando calls existentes para sincronização…</p>}<p className="text-xs text-muted-foreground">Última execução: {status.lastRunAt?new Date(status.lastRunAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Aguardando primeira execução'}</p></div>}
        {active&&status.meetAccess&&(()=>{
          const meet=meetAccessView(status.meetAccess.state)
          return <div className="space-y-1 rounded border p-3 text-sm" role={meet.tone==='problem'?'alert':'status'}>
            <p className={meet.tone==='ok'?'font-medium text-emerald-600':'font-medium'}>Acesso aberto do Meet: {meet.label}</p>
            <p className="text-xs text-muted-foreground">{meet.detail}</p>
            {meet.reconnect&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void act({action:'start_oauth'})}>Reconectar Google</Button>}
          </div>
        })()}
        <p className="text-xs text-muted-foreground">Ao desconectar, a sincronização pausa e os eventos existentes permanecem na agenda. Compartilhe o acesso dos closers nas configurações do Google Agenda.</p>
      </>}
      {notice&&<p role="status" className="text-sm">{notice}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>
}
