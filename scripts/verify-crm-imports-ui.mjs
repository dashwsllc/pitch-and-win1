import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createComponentLoader} from './helpers/meta-component-harness.mjs'
const load=createComponentLoader({'@/hooks/useCRM':{},'@/hooks/useAuth':{useAuth:()=>({user:{id:'qa'}})},
 '@/integrations/supabase/client':{supabase:{from(){throw Error('a complete supplied snapshot must not request another source')}}}})
const imports=existsSync('src/lib/crm-imports.ts')?load('src/lib/crm-imports.ts'):{}
const rows=[
 {id:'form-auto',lead_source:'meta_ads_form',import_channel:'form',import_method:'automatic',lead_received_at:'2026-10-13T12:00:00Z',lead_generated_at:'2026-10-13T11:00:00Z'},
 {id:'site-manual',lead_source:'meta_ads_form',import_channel:'website',import_method:'manual',lead_received_at:'2026-10-13T12:30:00Z',lead_generated_at:'2026-10-07T11:00:00Z'},
 {id:'form-manual',lead_source:'meta_ads_form',import_channel:'form',import_method:'manual',lead_received_at:'2026-10-13T12:30:00Z',lead_generated_at:'2026-10-12T11:00:00Z'},
 {id:'prospecção',lead_source:'instagram',created_at:'2026-10-13T14:00:00Z'},
]
test('SDR import sections distinguish channel from import method without hiding either manual or automatic',()=>{
 assert.equal(typeof imports.matchesCRMImport,'function','import channel/method filtering is missing')
 assert.deepEqual(rows.filter(x=>imports.matchesCRMImport(x,'form','all')).map(x=>x.id),['form-auto','form-manual'])
 assert.deepEqual(rows.filter(x=>imports.matchesCRMImport(x,'website','all')).map(x=>x.id),['site-manual'])
 assert.deepEqual(rows.filter(x=>imports.matchesCRMImport(x,'all','manual')).map(x=>x.id),['site-manual','form-manual'])
 assert.deepEqual(rows.filter(x=>imports.matchesCRMImport(x,'all','all')).map(x=>x.id),['form-auto','site-manual','form-manual'])
})
test('receipt time wins over an older generation and remains deterministically sorted',()=>{
 assert.equal(typeof imports.compareCRMImportRecency,'function','receipt priority comparator is missing')
 assert.deepEqual(rows.slice(0,3).sort(imports.compareCRMImportRecency).map(x=>x.id),['form-manual','site-manual','form-auto'])
})
test('CRM imported arrival shows seconds and full date while preserving generation separately',()=>{
 const {CRMLeadArrival}=load('src/components/crm/CRMLeadArrival.tsx')
 const html=renderToStaticMarkup(React.createElement(CRMLeadArrival,{lead:{...rows[1],lead_received_at:'2026-10-13T14:32:15Z',approach_stage:'nao_abordado'}}))
 assert.match(html,/13\/10\/2026.*11:32:15/)
 assert.doesNotMatch(html,/Caiu em 07\/10/)
})
test('CRM source details preserve long answers, complete consent data and original attribution as text',()=>{
 assert(existsSync('src/components/crm/CRMImportDetails.tsx'),'complete CRM source details are missing')
 const {CRMImportDetails}=load('src/components/crm/CRMImportDetails.tsx')
 const original='Informação valiosa '.repeat(150)+'<script>não executar</script>'
 const html=renderToStaticMarkup(React.createElement(CRMImportDetails,{lead:{...rows[1],import_snapshot:{
  field_data:[{name:'Contexto',values:[original]}],custom_disclaimer_responses:[{title:'Autorização',accepted:true}],
  source_snapshot:{utm_campaign:'Campanha site'},import_contact:{time_known:true},batch_filename:'site.csv',
  created_time:rows[1].lead_generated_at,first_received_at:rows[1].lead_received_at}}}))
 assert.match(html,/Site \/ conversão direta/)
 assert.match(html,/Manual/)
 assert.match(html,/Informação valiosa /)
 assert.match(html,/&lt;script&gt;não executar&lt;\/script&gt;/)
 assert.match(html,/Autorização/)
 assert.match(html,/Campanha site/)
 assert.match(html,/site.csv/)
 assert.match(html,/07\/10\/2026.*08:00:00/)
})

test('generation display never presents absent dates or synthetic noon as a real submission',()=>{
 const {CRMImportDetails}=load('src/components/crm/CRMImportDetails.tsx')
 for(const [hasDate,expected] of [[false,'Data e horário não informados na origem'],[true,'13/10/2026 · horário não informado na origem']]){
  const html=renderToStaticMarkup(React.createElement(CRMImportDetails,{lead:{...rows[1],import_snapshot:{
   created_time:'2026-10-13T15:00:00Z',import_contact:{source_has_date:hasDate,time_known:false}}}}))
  assert.match(html,new RegExp(expected))
  assert.doesNotMatch(html,/13\/10\/2026 12:00:00/)
 }
})
