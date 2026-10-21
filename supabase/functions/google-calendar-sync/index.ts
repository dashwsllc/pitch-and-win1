import { calendarRuntime, requireCalendarCron } from '../_shared/google-calendar-auth.ts'
import { GoogleCalendarClient } from '../_shared/google-calendar-client.ts'
import { getCredential } from '../_shared/google-calendar-store.ts'
import { runCalendarSync } from '../_shared/google-calendar-worker.ts'
import { jsonResponse, readJsonBody, RequestError } from '../_shared/http.ts'
export async function handleCalendarSync(req: Request): Promise<Response> {
  if(req.method!=='POST') return jsonResponse(req,{error:'method_not_allowed'},405)
  try {
    await requireCalendarCron(req)
    const body=await readJsonBody<{mode?:unknown}>(req)
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>k!=='mode') || !['deliver','reconcile'].includes(String(body.mode))) throw new RequestError(400,'invalid_request')
    const {db,store}=calendarRuntime(),client=new GoogleCalendarClient({deadlineAt:Date.now()+45_000,tokenProvider:force=>getCredential(store,force)})
    const closerEmail=async(userId:string)=>{
      const {data,error}=await db.auth.admin.getUserById(userId)
      if(error){ if(error.status===404)return null; throw error }
      return data.user?.email??null
    }
    return jsonResponse(req,await runCalendarSync(body.mode as 'deliver'|'reconcile',{store,client,now:Date.now,random:Math.random,closerEmail}))
  } catch(error) { return jsonResponse(req,{error:error instanceof RequestError?error.message:'sync_unavailable'},error instanceof RequestError?error.status:503) }
}
Deno.serve(handleCalendarSync)