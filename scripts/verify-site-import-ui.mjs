import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createComponentLoader} from './helpers/meta-component-harness.mjs'
const load=createComponentLoader({'@/hooks/useAuth':{useAuth:()=>({user:{id:'synthetic'}})},'@/lib/arena-api':{}})
test('site history separates source versions from SDR data and escapes the complete payload',()=>{
 const {SiteEventContent,siteEventListColumns}=load('src/components/crm/CRMSiteSourceUpdates.tsx')
 const text='Valuable context '.repeat(1000)+'<script>never execute</script>'
 const html=renderToStaticMarkup(React.createElement(SiteEventContent,{event:{source_revision:3,status:'context_only',received_at:'2026-10-13T14:32:15Z',event:{generated_at:'2026-09-10T13:04:05Z',source_updated_at:'2026-10-13T14:30:12Z',payload:{profile:{notes:text}}}}}))
 assert.match(html,/13\/10\/2026.*11:32:15/);assert.match(html,/10\/09\/2026.*10:04:05/);assert.match(html,/11:30:12/)
 assert.match(html,/&lt;script&gt;never execute&lt;\/script&gt;/);assert.equal((html.match(/Valuable context /g)??[]).length,1000)
 assert(!siteEventListColumns.split(',').includes('event'),'list eagerly downloads complete payload')
 assert.match(html,/cadastro.*SDR|SDR.*cadastro/)
})
test('bridge health never describes an old heartbeat or missing health as synchronized',()=>{
 const {SiteBridgeHealth,siteBridgeFresh}=load('src/components/traffic/SiteBridgeStatus.tsx')
 const now=Date.parse('2026-10-13T15:00:00Z')
 const old={last_heartbeat:'2026-10-13T14:57:59Z',last_received_at:'2026-10-13T14:59:59Z',pending_count:7,quarantined_count:2,oldest_pending_at:'2026-10-13T14:20:15Z'}
 assert.equal(siteBridgeFresh(old.last_heartbeat,now),false)
 assert.equal(siteBridgeFresh('2026-10-13T14:59:00Z',now),true)
 const html=renderToStaticMarkup(React.createElement(SiteBridgeHealth,{data:old,now}))
 assert.match(html,/desatualizado/);assert.match(html,/7/);assert.match(html,/2/);assert.match(html,/12:00:00|11:57:59/);assert.doesNotMatch(html,/Fila sincronizada/)
 const absent=renderToStaticMarkup(React.createElement(SiteBridgeHealth,{data:{last_heartbeat:null,pending_count:null,quarantined_count:0},now}))
 assert.match(absent,/não confirmado|Sem sinal/)
})
