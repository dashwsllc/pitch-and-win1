import {z} from 'zod'
import {supabase} from '@/integrations/supabase/client'
import type {AdminStatus,CallSyncStatus,ManageRequest,ManageResultByAction,SyncStatus} from '../../supabase/functions/_shared/google-calendar-contract'
export type {AdminStatus,CallSyncStatus,CalendarChoice,SyncStatus} from '../../supabase/functions/_shared/google-calendar-contract'
const date=z.string().datetime({offset:true}).nullable()
const syncStatus=z.enum(['disabled','awaiting_connection','pending','syncing','synced','removal_pending','removed','error'])
const revision=z.string().regex(/^\d+$/)
const choice=z.object({id:z.string().min(1),name:z.string(),accessRole:z.enum(['writer','owner']),timeZone:z.string().nullable()}).strict()
const admin=z.object({configured:z.boolean(),connection:z.enum(['not_connected','connected','reconnect_required','permission_denied','disconnected']),calendar:choice.nullable(),destinationLocked:z.boolean(),activatedAt:date,lastRunAt:date,pendingCount:z.number().int().nonnegative(),errorCount:z.number().int().nonnegative(),backfillPending:z.boolean(),errorCode:z.string().nullable(),meetAccess:z.object({state:z.enum(['unknown','open','scope_missing','api_disabled','not_permitted','error']),checkedAt:date}).strict().optional()}).strict()
const authorization=z.object({authorizationUrl:z.string().url().refine(value=>{
  const u=new URL(value);return u.origin==='https://accounts.google.com'&&u.pathname==='/o/oauth2/v2/auth'&&!u.username&&!u.password
})}).strict()
const resultSchemas={status:admin,activate:admin,disconnect:admin,retry:admin,start_oauth:authorization,list_calendars:z.object({calendars:z.array(choice)}).strict(),sync:z.object({processed:z.number().int().nonnegative(),pending:z.boolean()}).strict()}
export async function manageCalendar<A extends ManageRequest['action']>(request:Extract<ManageRequest,{action:A}>):Promise<ManageResultByAction[A]> {
  const {data,error}=await supabase.functions.invoke('google-calendar-manage',{body:request})
  if(error)throw new Error('calendar_request_failed')
  const parsed=resultSchemas[request.action].safeParse(data)
  if(!parsed.success)throw new Error('invalid_calendar_response')
  return parsed.data as ManageResultByAction[A]
}
export const adminQueryKey=(userId:string)=>['google-calendar','admin',userId] as const
export const callStatusesQueryKey=(userId:string,callIds:string[])=>['google-calendar','calls',userId,...[...new Set(callIds)].sort()] as const
export function effectiveCallStatus(row:CallSyncStatus):SyncStatus {
  if(['synced','removed'].includes(row.status)&&row.desiredRevision!==row.confirmedRevision)return row.status==='removed'?'removal_pending':'pending'
  return row.status
}
const rowSchema=z.object({call_id:z.string().uuid(),desired_revision:revision,confirmed_revision:revision.nullable(),status:syncStatus,error_code:z.string().nullable(),last_synced_at:date,meeting_url:z.string().regex(/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/).nullable().optional()}).strict()
export async function fetchCalendarStatuses(callIds:string[]):Promise<Map<string,CallSyncStatus>> {
  const ids=[...new Set(callIds)].sort(),statuses=new Map<string,CallSyncStatus>()
  for(let index=0;index<ids.length;index+=100){
    const {data,error}=await supabase.from('crm_google_calendar_status').select('call_id,desired_revision,confirmed_revision,status,error_code,last_synced_at,meeting_url').in('call_id',ids.slice(index,index+100))
    if(error)throw new Error('calendar_status_unavailable')
    const parsed=z.array(rowSchema).safeParse(data)
    if(!parsed.success)throw new Error('invalid_calendar_response')
    for(const r of parsed.data)statuses.set(r.call_id,{callId:r.call_id,desiredRevision:r.desired_revision,confirmedRevision:r.confirmed_revision,status:r.status,errorCode:r.error_code,lastSyncedAt:r.last_synced_at,meetingUrl:r.meeting_url??null})
  }
  return statuses
}
