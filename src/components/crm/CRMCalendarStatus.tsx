import {createContext,useContext} from 'react'
import type {ReactNode} from 'react'
import {Link} from 'react-router-dom'
import {Badge} from '@/components/ui/badge'
import {useGoogleCalendarStatuses} from '@/hooks/useGoogleCalendar'
import {useRoles} from '@/hooks/useRoles'
import {effectiveCallStatus} from '@/lib/google-calendar-api'
import type {CallSyncStatus,SyncStatus} from '@/lib/google-calendar-api'
const labels:Record<SyncStatus,string>={disabled:'Agenda não ativada',awaiting_connection:'Agenda: aguardando conexão',pending:'Agenda: pendente',syncing:'Agenda: sincronizando',synced:'Agenda: sincronizada',removal_pending:'Agenda: remoção pendente',removed:'Agenda: removida',error:'Agenda: erro de sincronização'}
const CalendarContext=createContext<ReturnType<typeof useGoogleCalendarStatuses>>({statuses:new Map(),loading:false,error:null})
export function CalendarStatusesProvider({callIds,children}:{callIds:string[];children:ReactNode}){
  const state=useGoogleCalendarStatuses(callIds)
  return <CalendarContext.Provider value={state}>{children}</CalendarContext.Provider>
}
export function calendarStatusLabel(row:CallSyncStatus|undefined,loading:boolean,error:unknown):string{
  if(error)return 'Status da agenda indisponível'
  if(loading)return 'Consultando agenda…'
  if(row?.errorCode==='meet_pending')return 'Agenda: preparando Google Meet'
  return labels[row?effectiveCallStatus(row):'disabled']
}
export function CRMCalendarStatus({callId}:{callId:string}){
  const {statuses,loading,error}=useContext(CalendarContext),{capabilities}=useRoles()
  const row=statuses.get(callId),state=row?effectiveCallStatus(row):'disabled'
  const failed=!!error||state==='error'&&row?.errorCode!=='meet_pending'||state==='awaiting_connection'
  const action=row?.errorCode==='reconnect_required'?'Reconectar Google':['permission_denied','calendar_access'].includes(row?.errorCode??'')?'Revisar acesso à agenda':'Tentar novamente'
  return <span className="inline-flex flex-wrap items-center gap-1" role="status">
    <Badge variant="outline" className={`h-5 px-2 text-[10px] ${state==='synced'&&!loading&&!error?'text-emerald-600':failed?'text-amber-600':'text-muted-foreground'}`}>{calendarStatusLabel(row,loading,error)}</Badge>
    {failed&&(capabilities.executive?<Link to="/agenda#google-calendar" className="text-[10px] underline">{action}</Link>:<span className="text-[10px] text-muted-foreground">Solicite a revisão ao administrador.</span>)}
    {/* O botão de entrar na reunião não vem mais do Google: é o link que o Closer cola na /agenda, só no horário da call (CRMCallMeetButton). */}
  </span>
}
