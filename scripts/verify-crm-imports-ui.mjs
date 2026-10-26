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
 assert.doesNotMatch(html,/<pre|imported_by|reviewed_by/)
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

test('import period filter keeps leads received on the picked Brasília day or range, newest-day logic included',()=>{
 const today='2026-10-26',lead=(id,iso)=>({id,lead_source:'meta_ads_form',import_channel:'form',import_method:'automatic',lead_received_at:iso})
 const items=[
  lead('hoje-manha','2026-10-26T13:00:00Z'),
  lead('hoje-noite-utc','2026-10-27T02:30:00Z'), // 26/10 23:30 em Brasília, ainda é hoje
  lead('ontem','2026-10-25T15:00:00Z'),
  lead('semana','2026-10-20T15:00:00Z'),
  {id:'sem-recebimento',lead_source:'meta_ads_form',import_channel:'form',import_method:'manual',created_at:'2026-10-26T16:00:00Z'},
  {id:'sem-data',lead_source:'meta_ads_form',import_channel:'form',import_method:'manual'},
 ]
 const ids=selection=>{
  const range=imports.resolveImportPeriod({period:'all',date:'',start:'',end:'',...selection},today)
  return items.filter(x=>imports.matchesImportPeriod(x,range)).map(x=>x.id)
 }
 assert.deepEqual(ids({}),items.map(x=>x.id),'sem filtro mostra tudo, até o que não tem data')
 assert.deepEqual(ids({period:'today'}),['hoje-manha','hoje-noite-utc','sem-recebimento'])
 assert.deepEqual(ids({period:'yesterday'}),['ontem'])
 assert.deepEqual(ids({period:'date',date:'2026-10-20'}),['semana'])
 assert.deepEqual(ids({period:'range',start:'2026-10-20',end:'2026-10-25'}),['ontem','semana'])
 assert.deepEqual(ids({period:'range',start:'2026-10-25',end:'2026-10-25'}),['ontem'],'intervalo de um dia é inclusivo')
})
test('import period filter explains an unusable pick and does not hide anything meanwhile',()=>{
 const today='2026-10-26',lead={id:'a',import_channel:'form',lead_received_at:'2026-10-01T15:00:00Z'}
 for(const [selection,message] of [
  [{period:'date',date:''},/data válida/],
  [{period:'date',date:'2026-02-31'},/data válida/],
  [{period:'range',start:'2026-10-01',end:''},/data inicial e a data final/],
  [{period:'range',start:'2026-10-10',end:'2026-10-01'},/anterior ou igual/],
 ]){
  const range=imports.resolveImportPeriod({period:'all',date:'',start:'',end:'',...selection},today)
  assert.match(range.invalid,message)
  assert.equal(imports.matchesImportPeriod(lead,range),true)
 }
})
test('import period survives the URL round trip and ignores unknown values',()=>{
 const read=values=>key=>values[key]??null
 assert.deepEqual(imports.parseImportPeriod(read({periodo:'intervalo',de:'2026-10-01',ate:'2026-10-05'})),{period:'range',date:'',start:'2026-10-01',end:'2026-10-05'})
 assert.equal(imports.parseImportPeriod(read({periodo:'hoje'})).period,'today')
 assert.equal(imports.parseImportPeriod(read({periodo:'lixo'})).period,'all')
 for(const p of ['today','yesterday','date','range']) assert.equal(imports.parseImportPeriod(read({periodo:imports.importPeriodUrlValue(p)})).period,p)
 assert.equal(imports.importPeriodUrlValue('all'),null)
})

test('imports section renders the period filter with Hoje/Ontem counts and the inputs of the chosen mode',()=>{
 const {CRMImportsSection}=load('src/components/crm/CRMImportsSection.tsx')
 const today='2026-10-26',leads=[
  {id:'a',import_channel:'form',import_method:'automatic',lead_received_at:'2026-10-26T13:00:00Z'},
  {id:'b',import_channel:'form',import_method:'automatic',lead_received_at:'2026-10-26T14:00:00Z'},
  {id:'c',import_channel:'form',import_method:'manual',lead_received_at:'2026-10-25T14:00:00Z'},
 ]
 const render=(selection)=>{
  const period={period:'all',date:'',start:'',end:'',...selection}
  return renderToStaticMarkup(React.createElement(CRMImportsSection,{leads,section:'all',method:'all',period,range:imports.resolveImportPeriod(period,today),today,onSection(){},onMethod(){},onPeriod(){}}))
 }
 const all=render({})
 for(const label of ['Todas as datas','Hoje','Ontem','Data específica','Período']) assert.match(all,new RegExp(label))
 assert.match(all,/Hoje<span[^>]*>\(2\)/)
 assert.match(all,/Ontem<span[^>]*>\(1\)/)
 assert.doesNotMatch(all,/type="date"/)
 assert.match(render({period:'date',date:'2026-10-25'}),/type="date"[^>]*value="2026-10-25"/)
 assert.equal((render({period:'range',start:'2026-10-20',end:'2026-10-26'}).match(/type="date"/g)||[]).length,2)
 assert.match(render({period:'today'}),/Todas · 2/,'a contagem de Todas segue o período')
 assert.match(render({period:'range',start:'2026-10-26',end:'2026-10-20'}),/role="alert"[^>]*>A data inicial deve ser anterior/)
})
