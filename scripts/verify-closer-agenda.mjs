import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import {renderToStaticMarkup} from 'react-dom/server'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
async function load(file,imports={}) {
  const context=vm.createContext({URL,URLSearchParams,console,__imports:imports}),cache=new Map()
  const pathFor=p=>[p,p+'.ts',p+'.tsx'].find(existsSync)??p
  function moduleFor(name){
    if(cache.has(name))return cache.get(name)
    const external=imports[name]
    const m=external?new vm.SyntheticModule(Object.keys(external),function(){for(const k of Object.keys(external))this.setExport(k,external[k])},{context,identifier:name}):new vm.SourceTextModule(ts.transpileModule(readFileSync(name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,{context,identifier:name})
    cache.set(name,m);return m
  }
  const m=moduleFor(resolve(root,file));await m.link((s,p)=>moduleFor(imports[s]?s:pathFor(s.startsWith('@/')?resolve(root,'src',s.slice(2)):resolve(dirname(p.identifier),s))))
  await m.evaluate();return m.namespace
}
const icons=Object.fromEntries(['Home','Monitor','Megaphone','DollarSign','Trophy','Users','User','Settings','Shield','Wallet','Target','ShoppingBag','ListChecks','CalendarDays','ExternalLink','RefreshCw','Clock','ArrowRight','CalendarClock'].map(name=>[name,()=>React.createElement('svg',{'aria-hidden':true})]))
const lead={id:'10000000-0000-4000-8000-000000000001',name:'Responsável fictício',athlete_name:'Atleta fictício',pipeline_stage:'repassado_closer'}
const call=(id,patch={})=>({id,lead_id:lead.id,assigned_to:'closer-1',call_type:'fechamento_closer',scheduled_at:'2026-10-13T14:00:00-03:00',is_completed:false,cancelled_at:null,outcome:null,...patch})

test('navigation: Agenda follows the existing Closer permission, including delegated access and suspension',async()=>{
  const caps=await load('src/lib/crm-capabilities.ts'),nav=await load('src/lib/navigation.ts',{'lucide-react':icons})
  for(const [roles,delegated,active,want] of [[['closer'],false,true,true],[['executive'],false,true,true],[['super_admin'],false,true,true],[['sdr'],false,true,false],[['sdr'],true,true,true],[['seller'],false,true,false],[['bdr'],false,true,false],[['traffic_manager'],false,true,false],[['closer'],false,false,false]]){
    const capabilities=caps.crmCapabilities(roles,false,active,delegated)
    const items=nav.itensDoMenu({roles,capabilities,isExecutive:capabilities.executive,isSuperAdmin:capabilities.admin})
    assert.equal(items.some(i=>i.url==='/agenda'),want,roles.join(',')+' delegated='+delegated+' active='+active)
  }
})

test('route: /agenda waits for roles, fails closed on errors and denies users without Closer permission',async()=>{
  const state={allowed:false,loading:false,error:null,suspended:false}
  const Navigate=()=>null
  const route=await load('src/components/ProtectedRoute.tsx',{
    react:{useEffect:()=>{},useState:v=>[v,()=>{}]},'react/jsx-runtime':jsx,
    'react-router-dom':{Navigate,useLocation:()=>({pathname:'/agenda',search:''})},
    '@/hooks/useAuth':{useAuth:()=>({user:{id:'closer-1'},loading:false,signOut:async()=>{}})},
    '@/hooks/useProfile':{useProfile:()=>({profile:{suspended:state.suspended},loading:false,error:null,refetch:async()=>{}})},
    '@/hooks/useRoles':{useRoles:()=>({capabilities:{closer:state.allowed},roles:[],isExecutive:false,isSuperAdmin:false,loading:state.loading,error:state.error,refetch:async()=>{}})},
  })
  const protectedChild=React.createElement('div',{'data-private':true})
  const render=()=>route.ProtectedRoute({closerOnly:true,children:protectedChild})
  assert.equal(render().props.to,'/')
  state.allowed=true;state.loading=true;assert.notEqual(render().props.children,protectedChild)
  state.loading=false;state.error=new Error('roles unavailable');assert.notEqual(render().props.children,protectedChild)
  state.error=null;assert.equal(render().props.children,protectedChild)
  state.suspended=true;assert.equal(render().props.to,'/auth?suspended=true')
})

test('calls: only assigned pending Closer calls with accessible leads enter the agenda, in time order',async()=>{
  const p=await load('src/lib/closer-agenda.ts')
  const rows=[call('late'),call('earlier',{scheduled_at:'2026-10-13T13:00:00-03:00'}),call('sdr',{call_type:'qualificacao'}),call('note',{call_type:null}),call('cancelled',{cancelled_at:'2026-10-12T12:00:00Z'}),call('done',{is_completed:true,outcome:'followup'}),call('no-owner',{assigned_to:null}),call('inaccessible',{lead_id:'hidden'}),call('bad-time',{scheduled_at:'not-a-date'}),call('no-time',{scheduled_at:null})]
  assert.deepEqual(Array.from(p.selectCloserAgendaCalls(rows,[lead],{view:'scheduled',dateKey:''}),r=>r.id),['earlier','late'])
  assert.equal(p.selectCloserAgendaCalls(rows,[{...lead,pipeline_stage:'em_qualificacao'}],{view:'scheduled',dateKey:''}).length,0)
})

test('dates: day filtering uses Brasilia across midnight and invalid dates do not match',async()=>{
  const p=await load('src/lib/closer-agenda.ts')
  const rows=[call('previous-day',{scheduled_at:'2026-10-13T01:00:00Z'}),call('next-day',{scheduled_at:'2026-10-13T04:00:00Z'})]
  assert.deepEqual(Array.from(p.selectCloserAgendaCalls(rows,[lead],{view:'scheduled',dateKey:'2026-10-12'}),r=>r.id),['previous-day'])
  assert.deepEqual(Array.from(p.selectCloserAgendaCalls(rows,[lead],{view:'scheduled',dateKey:'2026-10-13'}),r=>r.id),['next-day'])
  assert.equal(p.selectCloserAgendaCalls(rows,[lead],{view:'scheduled',dateKey:'2026-02-31'}).length,0)
})

test('history: completed, cancelled and returned calls are visible without appearing as appointments',async()=>{
  const p=await load('src/lib/closer-agenda.ts')
  const rows=[call('booked'),call('done',{is_completed:true,outcome:'followup'}),call('cancelled',{is_completed:true,cancelled_at:'2026-10-12T12:00:00Z'}),call('returned',{is_completed:true,outcome:'devolvido_sdr'})]
  assert.deepEqual(Array.from(p.selectCloserAgendaCalls(rows,[lead],{view:'history',dateKey:''}),r=>r.id).sort(),['cancelled','done','returned'])
})

test('page: closers see calls, CRM links and Google Calendar without admin controls; query errors hide stale rows',async()=>{
  const state={error:null,loading:false,executive:false}
  const passthrough=({children})=>React.createElement('div',null,children)
  const ui=await load('src/pages/Agenda.tsx',{
    react:React,'react/jsx-runtime':jsx,'lucide-react':icons,
    'react-router-dom':{Link:({children,to})=>React.createElement('a',{href:to},children)},
    '@tanstack/react-query':{useQueryClient:()=>({invalidateQueries:async()=>{}})},
    '@/hooks/useRoles':{useRoles:()=>({capabilities:{closer:true,executive:state.executive}})},
    '@/hooks/useGoogleCalendar':{useGoogleCalendarRefresh:()=>({mutate:()=>{},isPending:false,isError:false,isSuccess:false})},
    '@/hooks/useCRM':{useCRMLeads:()=>({leads:[lead],loading:state.loading,error:state.error,refetch:async()=>{}}),useCRMActivities:()=>({activities:[call('call-1'),call('qualification',{call_type:'qualificacao'})],loading:false,error:null,fetchActivities:async()=>{}}),useCRMAssignees:()=>({data:[{user_id:'closer-1',display_name:'Closer fictício',role:'closer'}],isPending:false,isError:false,refetch:async()=>{}}),useCRMRealtime:()=>({realtimeUnavailable:false})},
    '@/components/layout/DashboardLayout':{DashboardLayout:passthrough},
    '@/components/ui/card':{Card:passthrough,CardContent:passthrough,CardHeader:passthrough,CardTitle:passthrough},
    '@/components/ui/button':{Button:({children,asChild,variant,size,...props})=>asChild?React.cloneElement(children,props):React.createElement('button',props,children)},
    '@/components/ui/input':{Input:props=>React.createElement('input',props)},
    '@/components/ui/label':{Label:props=>React.createElement('label',props)},
    '@/components/ui/badge':{Badge:passthrough},
    '@/components/crm/CRMCalendarStatus':{CalendarStatusesProvider:passthrough,CRMCalendarStatus:()=>React.createElement('span',null,'Agenda: pendente')},
    '@/components/settings/GoogleCalendarIntegration':{GoogleCalendarIntegration:()=>{if(!state.executive)throw Error('Admin controls rendered for a Closer');return React.createElement('div',null,'Gerenciar integração')}},
  })
  const render=()=>renderToStaticMarkup(React.createElement(ui.default))
  const html=render();assert.match(html,/Atleta fictício/);assert.match(html,/Closer fictício/)
  assert.match(html,/href="\/crm\?tab=closer&amp;lead=10000000-0000-4000-8000-000000000001"/)
  assert.match(html,/href="https:\/\/calendar\.google\.com\/calendar\/r"/)
  assert.doesNotMatch(html,/Gerenciar integração/)
  for(const [temperature,label] of [['frio','Frio'],['morno','Morno'],['quente','Quente'],[null,'Não informada']]){
    lead.temperature=temperature
    assert.match(render(),new RegExp(`Temperatura do lead: ${label}`))
  }
  state.error=new Error('CRM unavailable');assert.doesNotMatch(render(),/Atleta fictício/)
  state.error=null;state.loading=true;assert.doesNotMatch(render(),/Atleta fictício/)
  state.loading=false;state.executive=true;assert.match(render(),/Gerenciar integração/)
})

test('OAuth compatibility: callbacks and saved settings links forward to Agenda with their result intact',async()=>{
  const location={pathname:'/configuracoes',search:'?google_calendar=connected',hash:''}
  const passthrough=({children})=>React.createElement('div',null,children)
  const ui=await load('src/pages/Configuracoes.tsx',{
    react:React,'react/jsx-runtime':jsx,'lucide-react':{...icons,Palette:icons.CalendarDays,Bell:icons.CalendarDays,LogOut:icons.CalendarDays,Sun:icons.CalendarDays,Moon:icons.CalendarDays},
    'react-router-dom':{useLocation:()=>location,Navigate:({to})=>React.createElement('a',{href:to},'Redirect')},
    '@/components/layout/DashboardLayout':{DashboardLayout:passthrough},
    '@/components/ui/card':{Card:passthrough,CardContent:passthrough,CardHeader:passthrough,CardTitle:passthrough},
    '@/components/ui/button':{Button:passthrough},'@/components/ui/label':{Label:passthrough},
    '@/components/ui/select':Object.fromEntries(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue'].map(k=>[k,passthrough])),
    '@/components/ui/switch':{Switch:passthrough},'@/components/ui/separator':{Separator:passthrough},
    '@/contexts/ThemeContext':{useTheme:()=>({theme:'dark',setTheme:()=>{}})},
    '@/hooks/useAuth':{useAuth:()=>({signOut:async()=>{}})},sonner:{toast:{success:()=>{},error:()=>{}}},
    '@/lib/notification-preferences':{readProactiveNotificationsPreference:()=>true,writeProactiveNotificationsPreference:()=>{}},
  })
  const render=()=>renderToStaticMarkup(React.createElement(ui.default))
  assert.match(render(),/href="\/agenda\?google_calendar=connected#google-calendar"/)
  location.search='';location.hash='#google-calendar';assert.match(render(),/href="\/agenda#google-calendar"/)
  location.hash='';assert.doesNotMatch(render(),/Google Agenda|Redirect/)
})
