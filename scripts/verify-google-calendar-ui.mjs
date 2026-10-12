import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as zod from 'zod'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import {renderToStaticMarkup} from 'react-dom/server'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
async function load(path,imports={},globals={}) {
  const context=vm.createContext({URL,URLSearchParams,Map,Set,console,...globals,__imports:{zod,...imports}}),cache=new Map()
  function moduleFor(name){
    if(cache.has(name))return cache.get(name)
    const external=context.__imports[name]
    const source=external?Object.keys(external).map(k=>`export const ${k}=globalThis.__imports[${JSON.stringify(name)}][${JSON.stringify(k)}]`).join('\n'):
      ts.transpileModule(readFileSync(name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
    const m=external?new vm.SyntheticModule(Object.keys(external),function(){for(const k of Object.keys(external))this.setExport(k,external[k])},{context,identifier:name}):new vm.SourceTextModule(source,{context,identifier:name});cache.set(name,m);return m
  }
  const m=moduleFor(resolve(root,path));await m.link((s,p)=>moduleFor(context.__imports[s]?s:s.startsWith('@/')?resolve(root,'src',s.slice(2))+'.ts':resolve(dirname(p.identifier),s)))
  await m.evaluate();return m.namespace
}
const id='10000000-0000-4000-8000-000000000001',valid='/crm?tab=closer&lead='+id
const status={configured:true,connection:'connected',calendar:null,destinationLocked:false,activatedAt:null,lastRunAt:null,pendingCount:0,errorCount:0,backfillPending:false,errorCode:null}
const apiPath='src/lib/google-calendar-api.ts'
const db=(data)=>({'@/integrations/supabase/client':{supabase:{functions:{invoke:async()=>({data,error:null})}}}})
test('deeplink: only valid local CRM paths survive login and unavailable leads stay closed',async()=>{
  const p=await load('src/lib/crm-deeplink.ts')
  for(const unsafe of ['https://evil/crm','//evil/crm','/crm/../auth','/crm?lead=bad','/crm?lead='+id+'&lead='+id,'/crm%3Flead='+id,'/crm?tab=closer%26lead=bad'])assert.equal(p.safeCrmReturnPath(unsafe),null)
  assert.equal(p.safeCrmReturnPath(valid),valid)
  assert.equal(p.parseCrmLeadLink('?lead=bad'),null)
  assert.equal(p.resolveCrmLeadLink(id,[],true,false),'waiting')
  assert.equal(p.resolveCrmLeadLink(id,[],false,false),'unavailable')
  assert.equal(p.resolveCrmLeadLink(id,[],false,true),'load_error')
  assert.equal(p.resolveCrmLeadLink(id,[id],false,false),'open')
})
test('api: strict public contracts reject credentials and forbidden destinations',async()=>{
  const a=await load(apiPath,db(status));assert.equal((await a.manageCalendar({action:'status'})).connection,'connected')
  const bad=await load(apiPath,db({...status,accessToken:'SECRET'}));await assert.rejects(bad.manageCalendar({action:'status'}),/invalid_calendar_response/)
  const oauth=await load(apiPath,db({authorizationUrl:'https://evil.test/steal'}));await assert.rejects(oauth.manageCalendar({action:'start_oauth'}),/invalid_calendar_response/)
  const list=await load(apiPath,db({calendars:[{id:'shared',name:'agenda - closers',accessRole:'reader',timeZone:null}]}));await assert.rejects(list.manageCalendar({action:'list_calendars'}),/invalid_calendar_response/)
})
test('api: revision mismatch never shows synchronized; statuses are batched and isolated by user',async()=>{
  let batches=[]
  const rows=[{call_id:id,desired_revision:'9007199254740993',confirmed_revision:'9007199254740992',status:'synced',error_code:null,last_synced_at:null}]
  const a=await load(apiPath,{'@/integrations/supabase/client':{supabase:{from:()=>({select:()=>({in:async(_key,ids)=>{batches.push(ids);return{data:rows.filter(r=>ids.includes(r.call_id)),error:null}}})})}}})
  const ids=Array.from({length:205},(_,i)=>'10000000-0000-4000-8000-'+String(i+1).padStart(12,'0'))
  const statuses=await a.fetchCalendarStatuses(ids)
  assert.equal(statuses.size,1);assert.equal(a.effectiveCallStatus(statuses.get(id)),'pending');assert.deepEqual(batches.map(b=>b.length),[100,100,5])
  assert.notDeepEqual(Array.from(a.adminQueryKey('A')),Array.from(a.adminQueryKey('B')))
  assert.deepEqual(Array.from(a.callStatusesQueryKey('A',['b','a','b'])),['google-calendar','calls','A','a','b'])
})
test('hooks: closer session never requests admin data, mutations invalidate and logout removes its cache',async()=>{
  const effects=[],queries=[],invalidations=[],removed=[];let executive=false
  const client={invalidateQueries:async v=>invalidations.push(v),removeQueries:v=>removed.push(v)}
  const hooks=await load('src/hooks/useGoogleCalendar.tsx',{
    react:{useEffect:fn=>effects.push(fn()),useRef:v=>({current:v})},
    '@tanstack/react-query':{useQuery:o=>{queries.push(o);return{data:undefined,isLoading:false,error:null}},useQueryClient:()=>client,useMutation:o=>({...o,mutateAsync:o.mutationFn,isPending:false})},
    '@/hooks/useAuth':{useAuth:()=>({user:{id:'A'},loading:false,registrationStatus:'approved'})},
    '@/hooks/useRoles':{useRoles:()=>({capabilities:{executive,leads:true},loading:false})},...db(status),
  })
  const denied=hooks.useGoogleCalendarAdmin();assert.equal(queries[0].enabled,false)
  await assert.rejects(denied.mutateAsync({action:'disconnect'}),/calendar_admin_required/)
  executive=true;const allowed=hooks.useGoogleCalendarAdmin();assert.equal(queries.at(-1).enabled,true)
  await allowed.onSuccess(status,{action:'retry'});assert.ok(invalidations.length)
  for(const cleanup of effects)if(typeof cleanup==='function')cleanup()
  assert.ok(removed.some(o=>o.predicate({queryKey:['google-calendar','calls','A',id]})))
  assert.ok(removed.every(o=>!o.predicate({queryKey:['google-calendar','calls','B',id]})))
})
test('badge: absent, loading, failed and outdated status never claim synchronization',async()=>{
  const ui=await load('src/components/crm/CRMCalendarStatus.tsx',{
    react:React,'react/jsx-runtime':jsxRuntime,
    '@/hooks/useGoogleCalendar':{useGoogleCalendarStatuses:()=>({statuses:new Map(),loading:false,error:null})},
    '@/components/ui/badge':{Badge:({children,...props})=>React.createElement('span',props,children)},
    '@/hooks/useRoles':{useRoles:()=>({capabilities:{executive:false}})},
    'react-router-dom':{Link:({children,to})=>React.createElement('a',{href:to},children)},...db(status),
  })
  assert.equal(ui.calendarStatusLabel(undefined,false,null),'Agenda não ativada')
  assert.equal(ui.calendarStatusLabel(undefined,true,null),'Consultando agenda…')
  assert.equal(ui.calendarStatusLabel(undefined,false,new Error()),'Status da agenda indisponível')
  const stale={status:'synced',desiredRevision:'2',confirmedRevision:'1',errorCode:null}
  assert.equal(ui.calendarStatusLabel(stale,false,null),'Agenda: pendente')
  assert.equal(ui.calendarStatusLabel({...stale,confirmedRevision:'2'},false,null),'Agenda: sincronizada')
  assert.match(renderToStaticMarkup(React.createElement(ui.CRMCalendarStatus,{callId:id})),/Agenda não ativada/)
})

test('Agenda refresh requests real sync and refreshes both data caches even when the provider fails',async()=>{
  for(const failure of [false,true]){
    const invalidations=[],requests=[]
    const h=await load('src/hooks/useGoogleCalendar.tsx',{
      react:{useEffect:fn=>fn(),useRef:v=>({current:v})},
      '@tanstack/react-query':{useQueryClient:()=>({removeQueries:()=>{},invalidateQueries:async o=>invalidations.push(o)}),useMutation:o=>({mutateAsync:o.mutationFn}),useQuery:()=>({})},
      '@/hooks/useAuth':{useAuth:()=>({user:{id:'A'},loading:false,registrationStatus:'approved'})},
      '@/hooks/useRoles':{useRoles:()=>({capabilities:{closer:true,leads:true,executive:false},loading:false})},
      '@/integrations/supabase/client':{supabase:{functions:{invoke:async(_fn,{body})=>{requests.push(body);return failure?{data:null,error:Error('offline')}:{data:{processed:1,pending:false},error:null}}}}},
    })
    const refresh=h.useGoogleCalendarRefresh()
    if(failure)await assert.rejects(refresh.mutateAsync());else assert.equal((await refresh.mutateAsync()).processed,1)
    assert.equal(requests[0].action,'sync');assert.equal(invalidations.length,1)
    assert.equal(invalidations[0].predicate({queryKey:['crm','activities','A']}),true)
    assert.equal(invalidations[0].predicate({queryKey:['google-calendar','calls','A']}),true)
    assert.equal(invalidations[0].predicate({queryKey:['google-calendar','calls','B']}),false)
  }
})
test('settings: duplicate calendar names require explicit selection of the canonical ID',async()=>{
  const cells=[],requests=[];let index=0
  const choices=[{id:'one@group.calendar.google.com',name:'agenda - closers',accessRole:'owner',timeZone:null},{id:'two@group.calendar.google.com',name:'agenda - closers',accessRole:'writer',timeZone:null}]
  const passthrough=({children,...p})=>React.createElement('div',p,children)
  const ui=await load('src/components/settings/GoogleCalendarIntegration.tsx',{
    react:{useCallback:fn=>fn,useEffect:()=>{},useState:initial=>{const k=index++;if(!(k in cells))cells[k]=initial;return[cells[k],v=>cells[k]=typeof v==='function'?v(cells[k]):v]}},'react/jsx-runtime':jsxRuntime,
    'react-router-dom':{useSearchParams:()=>[new URLSearchParams(),()=>{}]},
    '@/hooks/useGoogleCalendar':{useGoogleCalendarAdmin:()=>({allowed:true,sessionKey:'A:0',isCurrent:()=>true,status,query:{isLoading:false,error:null},isPending:false,mutateAsync:async r=>{requests.push(r);return r.action==='list_calendars'?{calendars:choices}:status}})},
    '@/components/ui/card':{Card:passthrough,CardContent:passthrough,CardHeader:passthrough,CardTitle:passthrough},
    '@/components/ui/button':{Button:passthrough},'@/components/ui/label':{Label:passthrough},
  })
  const render=()=>{index=0;return ui.GoogleCalendarIntegration()}
  const elements=root=>{const found=[];const walk=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(walk);return}if(v.props){found.push(v);walk(v.props.children)}};walk(root);return found}
  let nodes=elements(render());await nodes.find(n=>n.props.children==='Escolher agenda').props.onClick()
  await new Promise(resolve=>setImmediate(resolve));nodes=elements(render())
  assert.equal(nodes.find(n=>n.type==='select').props.value,'')
  assert.equal(nodes.find(n=>n.props.children==='Ativar nesta agenda').props.disabled,true)
  nodes.find(n=>n.type==='select').props.onChange({target:{value:choices[1].id}})
  nodes=elements(render());assert.equal(nodes.find(n=>n.props.children==='Ativar nesta agenda').props.disabled,false)
  await nodes.find(n=>n.props.children==='Ativar nesta agenda').props.onClick();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(requests.at(-1).calendarId,choices[1].id)
})
test('settings: delayed OAuth and calendar results are discarded on logout, user switch, permission loss and unmount',async()=>{
  const walk=root=>{const found=[];const visit=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v))return v.forEach(visit);if(v.props){found.push(v);visit(v.props.children)}};visit(root);return found}
  const flush=()=>new Promise(r=>setImmediate(r))
  for(const action of ['start_oauth','list_calendars'])for(const transition of ['logout','switch','permission','unmount']){
    let cursor=0,userId='A',executive=true,settle;const cells=[],effects=[],invalidations=[],redirects=[]
    const fakeReact={
      useCallback:fn=>fn,
      useRef:initial=>{const i=cursor++;return cells[i]??(cells[i]={current:initial})},
      useState:initial=>{const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],v=>cells[i]=typeof v==='function'?v(cells[i]):v]},
      useEffect:(fn,deps)=>{const i=cursor++,old=effects[i];if(!old||deps.some((v,k)=>v!==old.deps[k])){old?.cleanup?.();effects[i]={deps,cleanup:fn()}}},
    }
    const connected={...status,connection:action==='start_oauth'?'not_connected':'connected'}
    const client={removeQueries:()=>{},invalidateQueries:async v=>invalidations.push(v)}
    const hooks=await load('src/hooks/useGoogleCalendar.tsx',{
      react:fakeReact,'@tanstack/react-query':{useQuery:()=>({data:connected,isLoading:false,error:null}),useQueryClient:()=>client,
        useMutation:o=>({isPending:false,mutateAsync:async r=>{const result=await o.mutationFn(r);await o.onSuccess?.(result,r);return result}})},
      '@/hooks/useAuth':{useAuth:()=>({user:userId?{id:userId}:null,loading:false,registrationStatus:'approved'})},
      '@/hooks/useRoles':{useRoles:()=>({capabilities:{executive,leads:true},loading:false})},
      '@/integrations/supabase/client':{supabase:{functions:{invoke:async()=>({data:await new Promise(r=>settle=r),error:null})}}},
    })
    const passthrough=({children,...p})=>React.createElement('div',p,children),params=new URLSearchParams()
    const ui=await load('src/components/settings/GoogleCalendarIntegration.tsx',{
      react:fakeReact,'react/jsx-runtime':jsxRuntime,'react-router-dom':{useSearchParams:()=>[params,()=>{}]},
      '@/hooks/useGoogleCalendar':hooks,'@/components/ui/card':{Card:passthrough,CardContent:passthrough,CardHeader:passthrough,CardTitle:passthrough},
      '@/components/ui/button':{Button:passthrough},'@/components/ui/label':{Label:passthrough},
    },{window:{location:{assign:url=>redirects.push(url)}}})
    const render=()=>{cursor=0;return ui.GoogleCalendarIntegration()}
    let nodes=walk(render());nodes.find(n=>n.props.children===(action==='start_oauth'?'Conectar Google':'Escolher agenda')).props.onClick()
    await flush();assert.ok(settle)
    if(transition==='logout')userId='';if(transition==='switch')userId='B';if(transition==='permission')executive=false
    if(transition==='unmount'){for(const effect of effects)effect?.cleanup?.()}else render()
    settle(action==='start_oauth'?{authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=old'}:{calendars:[{id:'old@group.calendar.google.com',name:'Agenda do usuário A',accessRole:'owner',timeZone:null}]})
    await flush();await flush()
    assert.deepEqual(redirects,[],`${transition}: stale OAuth redirected the new session`)
    assert.equal(invalidations.length,0,`${transition}: stale request invalidated the new session`)
    if(transition!=='unmount')assert.equal(walk(render()).some(n=>n.type==='select'),false,`${transition}: old calendar list leaked`)
  }
})

test('protected route: logged-out CRM link is preserved, unsafe path and suspension are not',async()=>{
  let location={pathname:'/crm',search:'?tab=closer&lead='+id},suspended=false
  const route=await load('src/components/ProtectedRoute.tsx',{
    react:{useEffect:()=>{},useState:v=>[v,()=>{}]},'react/jsx-runtime':jsxRuntime,
    'react-router-dom':{Navigate:()=>null,useLocation:()=>location},
    '@/hooks/useAuth':{useAuth:()=>({user:null,loading:false,signOut:async()=>{}})},
    '@/hooks/useProfile':{useProfile:()=>({profile:{suspended},loading:false,error:null})},
    '@/hooks/useRoles':{useRoles:()=>({capabilities:{},roles:[],loading:false,error:null})},
    '@/lib/arena':{canAccessArena:()=>false,canAccessTraffic:()=>false},
  })
  assert.equal(route.ProtectedRoute({children:null}).props.state.from,valid)
  location={pathname:'//evil/crm',search:'?lead='+id};assert.equal(route.ProtectedRoute({children:null}).props.state,undefined)
  location={pathname:'/crm',search:'?lead='+id};suspended=true
  const result=route.ProtectedRoute({children:null});assert.equal(result.props.to,'/auth?suspended=true');assert.equal(result.props.state,undefined)
})
