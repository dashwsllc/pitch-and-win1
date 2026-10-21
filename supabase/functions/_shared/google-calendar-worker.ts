import type { GoogleEvent, ManagedEvent } from './google-calendar-contract.ts'
import { GoogleCalendarClient, GoogleError } from './google-calendar-client.ts'
import { CalendarStore, CalendarStoreError, type Job, type Snapshot } from './google-calendar-store.ts'
import { projectCall, ownsEvent, eventMatches, managedEventHash, googleMeetingUrl, withMeeting } from './google-calendar-projection.ts'

export type WorkerDeps = { store: CalendarStore; client: GoogleCalendarClient; now: () => number; random: () => number; deadlineAt?: number;
  // E-mail Google do closer para convidá-lo. null = sem convite; erro = tenta de novo (não apaga um convite por falha momentânea).
  closerEmail?: (userId: string) => Promise<string | null> }
class LeaseLost extends Error {}
class Changed extends Error {}
class BudgetSpent extends Error {}
class Blocked extends Error { constructor(public code: string) { super(code) } }
function requireMeeting(event:GoogleEvent):void {
  if(googleMeetingUrl(event))return
  const conference=event.conferenceData as {createRequest?:{status?:{statusCode?:string}}}|undefined
  if(conference?.createRequest?.status?.statusCode==='failure')throw new Blocked('meet_failed')
  throw new GoogleError(0,'meet_pending',5000,true)
}
export function nextRetryAt(attempt: number, now: number, random: number, retryAfterMs: number | null): string {
  const base = Math.min(21_600_000,30_000 * 2 ** Math.min(20,Math.max(0,attempt-1)))
  const delay = Math.min(21_600_000,base * (1 + Math.max(0,Math.min(1,random)) * 0.25))
  return new Date(now + Math.max(delay,retryAfterMs ?? 0)).toISOString()
}
function ownership(snapshot: Snapshot): ManagedEvent {
  // Removal still verifies ownership when the source call/lead has been deleted.
  return {summary:'',description:'',start:{dateTime:'',timeZone:''},end:{dateTime:'',timeZone:''},
    extendedProperties:{private:{project_id:snapshot.projectId,call_id:snapshot.binding.callId,binding_id:snapshot.binding.id}}}
}
function checkedOwner(event: GoogleEvent, snapshot: Snapshot): void {
  if (!ownsEvent(event,ownership(snapshot))) throw new Blocked('ownership_mismatch')
}
export async function deliverJob(job: Job, deps: WorkerDeps): Promise<void> {
  const {store,client,now,random}=deps
  const deadline = deps.deadlineAt ?? now()+45_000
  let revision = job.binding.revision, connectionRevision: string | null = null
  let preconditions=0
  async function fresh(): Promise<Snapshot> {
    const snapshot=await store.snapshot(job.binding.id,job.leaseToken)
    if (!snapshot) throw new LeaseLost()
    revision=snapshot.binding.revision;connectionRevision=snapshot.connectionRevision
    return snapshot
  }
  function guard(snapshot: Snapshot): () => Promise<void> {
    return async()=>{
      if (now()+10_000>deadline) throw new BudgetSpent()
      if (!await store.renew(job.binding.id,job.leaseToken,60)) throw new LeaseLost()
      const current=await fresh()
      if(current.binding.revision!==snapshot.binding.revision || current.binding.eventId!==snapshot.binding.eventId) throw new Changed()
      // Snapshot also checks the connection is enabled and this lease remains ours.
    }
  }
  async function ack(snapshot: Snapshot, hash: string | null, etag: string | null, removed: boolean,meetingUrl:string|null=null) {
    await store.ack(snapshot.binding.id,job.leaseToken,snapshot.binding.revision,hash,etag,removed,meetingUrl)
  }
  async function rotate(snapshot: Snapshot) {
    await guard(snapshot)()
    if(!await store.rotateEventId(snapshot.binding.id,job.leaseToken,snapshot.binding.revision,snapshot.binding.eventId)) throw new Changed()
  }
  try {
    for(let round=0;round<6;round++) {
      if(now()+20_000>deadline) throw new BudgetSpent()
      const snapshot=await fresh(), assignee=snapshot.call?.assignedTo
      const desired=projectCall({...snapshot,closerEmail:assignee&&deps.closerEmail?await deps.closerEmail(assignee):null}), binding=snapshot.binding
      if(desired.kind==='blocked') throw new Blocked(desired.code)
      try {
        let actual: GoogleEvent | null
        try { actual=await client.getEvent(binding.calendarId,binding.eventId) }
        catch(error) {
          if(!(error instanceof GoogleError) || error.code!=='event_deleted') throw error
          await guard(snapshot)()
          if(desired.kind==='remove'){await ack(snapshot,null,null,true);return}
          await rotate(snapshot);continue
        }
        if(desired.kind==='remove') {
          if(actual && actual.status!=='cancelled') {
            checkedOwner(actual,snapshot)
            await client.deleteEvent(binding.calendarId,binding.eventId,actual.etag ?? '',guard(snapshot))
          } else if(actual) {
            const props=actual.extendedProperties?.private
            if(props && Object.keys(props).length) checkedOwner(actual,snapshot)
            await client.getCalendar(binding.calendarId)
            await guard(snapshot)()
          } else { await guard(snapshot)() }
          await ack(snapshot,null,null,true);return
        }
        if(!actual) {
          const created=await client.insertEvent(binding.calendarId,binding.eventId,desired.event,guard(snapshot))
          checkedOwner(created,snapshot)
          if(!eventMatches(created,desired.event)) throw new Blocked('invalid_event_response')
          // Google generates conferences asynchronously. Never confirm a missing Meet.
          if(desired.kind==='upsert')requireMeeting(created)
          if(googleMeetingUrl(created))continue
          await ack(snapshot,await managedEventHash(desired.event),created.etag ?? null,false);return
        }
        if(actual.status==='cancelled') {
          // Google guarantees only the ID on deleted tombstones. Fields that are
          // present must match; live events always require all ownership fields.
          const props=actual.extendedProperties?.private
          if(props && Object.keys(props).length) checkedOwner(actual,snapshot)
          await client.getCalendar(binding.calendarId)
          if(!actual.etag) { await rotate(snapshot);continue }
          try {
            const restored=await client.patchEvent(binding.calendarId,binding.eventId,desired.event,actual.etag,actual,guard(snapshot))
            checkedOwner(restored,snapshot)
            if(!eventMatches(restored,desired.event)) throw new Blocked('invalid_event_response')
            if(desired.kind==='upsert')requireMeeting(restored)
            if(googleMeetingUrl(restored))continue
            await ack(snapshot,await managedEventHash(desired.event),restored.etag ?? null,false);return
          } catch(error) {
            if(error instanceof GoogleError && error.code==='event_deleted') {
              await client.getCalendar(binding.calendarId);await rotate(snapshot);continue
            }
            throw error
          }
        }
        checkedOwner(actual,snapshot)
        const meetingUrl=googleMeetingUrl(actual)
        desired.event=withMeeting(desired.event,meetingUrl)
        const conference=actual.conferenceData as {createRequest?:{status?:{statusCode?:string}}}|undefined
        if(desired.kind==='upsert'&&!meetingUrl&&conference?.createRequest?.status?.statusCode==='pending')throw new GoogleError(0,'meet_pending',5000,true)
        if(eventMatches(actual,desired.event)&&(desired.kind==='completed'||meetingUrl)) {
          await guard(snapshot)()
          await ack(snapshot,await managedEventHash(desired.event),actual.etag ?? null,false,meetingUrl);return
        }
        const updated=await client.patchEvent(binding.calendarId,binding.eventId,desired.event,actual.etag ?? '',actual,guard(snapshot))
        checkedOwner(updated,snapshot)
        if(!eventMatches(updated,desired.event)) throw new Blocked('invalid_event_response')
        const updatedMeet=googleMeetingUrl(updated)
        if(desired.kind==='upsert')requireMeeting(updated)
        if(updatedMeet!==meetingUrl)continue
        await ack(snapshot,await managedEventHash(desired.event),updated.etag ?? null,false,updatedMeet);return
      } catch(error) {
        if(error instanceof Changed) continue
        if(error instanceof GoogleError && error.code==='precondition_failed' && preconditions++<2) continue
        if(error instanceof GoogleError && error.code==='conflict') {
          // An ambiguous insert response may have committed. Read the persisted ID;
          // never rotate an ID on 409, timeout or an unknown response.
          const found=await client.getEvent(binding.calendarId,binding.eventId)
          if(found) { if(found.status!=='cancelled')checkedOwner(found,snapshot);continue }
          throw new GoogleError(409,'conflict',null,true)
        }
        throw error
      }
    }
    throw new GoogleError(412,'precondition_failed',null,true)
  } catch(error) {
    if(error instanceof LeaseLost) return
    let code='storage_unavailable',retryAt: string | null=nextRetryAt(job.attempt,now(),random(),null)
    if(error instanceof Blocked) {code=error.code;retryAt=null}
    else if(error instanceof BudgetSpent || error instanceof Changed) {code='pending';retryAt=new Date(now()).toISOString()}
    else if(error instanceof GoogleError) {
      code=error.code
      if(['calendar_access','reconnect_required'].includes(code)) {
        const failedRevision=error.credentialRevision??connectionRevision
        if(failedRevision) await store.setConnectionError(failedRevision,code==='calendar_access'?'permission_denied':'reconnect_required')
        retryAt=null
      } else if(error.retryable || ['precondition_failed','conflict','event_deleted'].includes(code)) retryAt=nextRetryAt(job.attempt,now(),random(),error.retryAfterMs)
      else retryAt=null
    } else if(error instanceof CalendarStoreError && error.code==='conflict') code='pending'
    await store.fail(job.binding.id,job.leaseToken,revision,code,retryAt)
  }
}
export async function runCalendarSync(mode: 'deliver'|'reconcile', deps: WorkerDeps): Promise<{processed:number;pending:boolean}> {
  const started=deps.now(), deadlineAt=started+45_000
  let processed=0,pending=false
  const backfill=await deps.store.scanPage('backfill',500);pending ||= !backfill.done
  if(mode==='reconcile') {const page=await deps.store.scanPage('reconcile',500);pending ||= !page.done}
  while(processed<20 && deps.now()+20_000<deadlineAt) {
    const [job]=await deps.store.claim(1,60)
    if(!job) break
    await deliverJob(job,{...deps,deadlineAt});processed++
  }
  pending ||= processed===20 || deps.now()+20_000>=deadlineAt
  pending ||= await deps.store.hasPending()
  await deps.store.recordRun(new Date(started).toISOString())
  return {processed,pending}
}
