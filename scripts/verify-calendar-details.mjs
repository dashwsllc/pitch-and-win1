import assert from 'node:assert/strict'
import test from 'node:test'
import {loadModule,input,workerFixture} from './verify-google-calendar-sync.mjs'

test('projection includes the current CRM lead classification without inventing a missing one',async()=>{
  const {exports:p}=await loadModule('supabase/functions/_shared/google-calendar-projection.ts')
  for(const [temperature,label] of [['frio','Frio'],['morno','Morno'],['quente','Quente'],[null,'Não informada'],['invalid','Não informada']]){
    const x=input();x.lead.temperature=temperature
    assert.match(p.projectCall(x).event.description,new RegExp(`Temperatura do lead: ${label}`))
  }
})

test('CRM edits update one event and preserve its Meet; leaving Closer or deleting removes the event',async()=>{
  const f=await workerFixture();f.edit(x=>{x.lead.temperature='frio'});await f.deliver()
  const id=f.x.binding.eventId,meet=f.events.get(id).hangoutLink
  f.edit(x=>{x.lead.temperature='quente';x.call.context='Contexto editado';x.call.durationMinutes=45;x.call.scheduledAt='2026-10-14T17:00:00Z';x.closerName='Outro closer'})
  await f.deliver()
  const e=f.events.get(id)
  assert.equal(f.events.size,1);assert.equal(e.hangoutLink,meet);assert.match(e.description,/Temperatura do lead: Quente/)
  assert.match(e.description,/Contexto editado/);assert.match(e.summary,/Outro closer/)
  assert.equal(e.start.dateTime,'2026-10-14T17:00:00.000Z');assert.equal(e.end.dateTime,'2026-10-14T17:45:00.000Z')
  for(const remove of [x=>{x.lead.pipelineStage='em_qualificacao'},x=>{x.call=null},x=>{x.lead=null}]){
    const r=await workerFixture();await r.deliver();r.edit(remove);await r.deliver()
    assert.equal(r.events.size,0);assert.equal(r.removed,true)
  }
})

test('projection uses CRM duration and lead context without treating notes as Google HTML',async()=>{
  const {exports:p}=await loadModule('supabase/functions/_shared/google-calendar-projection.ts')
  const x=input();x.call.durationMinutes=75;x.call.context='Pauta da call'
  x.lead.athleteName='Atleta QA';x.lead.qualificationSummary='Objetivo QA'
  x.contexts=[{type:'whatsapp_summary',content:'Interesse <script>malicioso</script> & dúvidas'}]
  const e=p.projectCall(x).event
  assert.equal(e.end.dateTime,'2026-10-12T04:05:00.000Z')
  assert.match(e.description,/Pauta da call/);assert.match(e.description,/Objetivo QA/)
  assert.match(e.description,/Interesse &lt;script&gt;/);assert.doesNotMatch(e.description,/<script>/)
  assert.match(e.summary,/Atleta QA/)
  x.call.durationMinutes=0;assert.equal(p.projectCall(x).kind,'blocked')
})

test('new events request one Google Meet; existing Meet is preserved on edits',async()=>{
  const {exports:{GoogleCalendarClient}}=await loadModule('supabase/functions/_shared/google-calendar-client.ts')
  const requests=[]
  const c=new GoogleCalendarClient({tokenProvider:async()=>({accessToken:'QA',revision:'1'}),fetchImpl:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({id:'event',etag:'v1'}),{status:200})
  }})
  const {exports:p}=await loadModule('supabase/functions/_shared/google-calendar-projection.ts'),e=p.projectCall(input()).event
  await c.insertEvent('qa','event',e)
  assert.match(requests[0].url,/conferenceDataVersion=1/)
  assert.equal(requests[0].body.conferenceData.createRequest.conferenceSolutionKey.type,'hangoutsMeet')
  assert.equal(requests[0].body.conferenceData.createRequest.requestId,'event')
  await c.patchEvent('qa','event',e,'v1',{id:'event',etag:'v1',hangoutLink:'https://meet.google.com/abc-defg-hij'})
  assert.equal(requests[1].body.conferenceData,undefined)
})

test('manual refresh is an authenticated action with no admin metadata in its response',async()=>{
  const rpcCalls=[]
  const db={auth:{getUser:async()=>({data:{user:{id:'closer'}},error:null})},rpc:async(name,args)=>{
    rpcCalls.push({name,args})
    if(name==='google_calendar_request_refresh')return {data:false,error:null}
    return {data:null,error:{code:'42501'}}
  }}
  const env={SUPABASE_URL:'https://qa.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'QA',GOOGLE_CALENDAR_DASHBOARD_ORIGIN:'https://www.wsltda.com'}
  const {handler}=await loadModule('supabase/functions/google-calendar-manage/index.ts',{admin:db,env})
  const r=await handler(new Request('https://qa',{method:'POST',headers:{Origin:'https://www.wsltda.com',Authorization:'Bearer QA','Content-Type':'application/json'},body:JSON.stringify({action:'sync'})}))
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{processed:0,pending:true})
  assert.equal(rpcCalls[0].name,'google_calendar_request_refresh')
  assert.equal(rpcCalls[0].args.p_actor,'closer')
})

test('pending Meet cannot be acknowledged and repeated delivery preserves identity and the generated conference',async()=>{
  const f=await workerFixture();await f.deliver();const id=f.x.binding.eventId, e=f.events.get(id)
  f.edit(x=>{x.call.durationMinutes=90;x.call.context='Novo contexto QA'})
  delete e.hangoutLink;e.conferenceData={createRequest:{requestId:id,status:{statusCode:'pending'}}}
  const before=f.writes.length;await f.deliver()
  assert.equal(f.synced,false);assert.equal(f.errors.at(-1).code,'meet_pending');assert.equal(f.writes.length,before)
  e.hangoutLink='https://meet.google.com/abc-defg-hij';e.conferenceData={entryPoints:[{entryPointType:'video',uri:e.hangoutLink}]}
  await f.deliver();assert.equal(f.synced,true);assert.equal(f.events.size,1);assert.equal(f.x.binding.eventId,id)
  assert.equal(f.events.get(id).end.dateTime,'2026-10-12T04:20:00.000Z')
  assert.match(f.events.get(id).description,/Novo contexto QA/);assert.match(f.events.get(id).description,/Meet: https:\/\/meet.google.com/)
})

test('failed conference creation gets a fresh Google request identity on explicit retry',async()=>{
  const {exports:{GoogleCalendarClient}}=await loadModule('supabase/functions/_shared/google-calendar-client.ts')
  let body
  const c=new GoogleCalendarClient({tokenProvider:async()=>({accessToken:'QA',revision:'1'}),fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({id:'event',etag:'v1'}),{status:200})}})
  const {exports:p}=await loadModule('supabase/functions/_shared/google-calendar-projection.ts')
  await c.patchEvent('qa','event',p.projectCall(input()).event,'v1',{id:'event',etag:'v1',conferenceData:{createRequest:{requestId:'event-1',status:{statusCode:'failure'}}}})
  assert.notEqual(body.conferenceData.createRequest.requestId,'event-1')
})
