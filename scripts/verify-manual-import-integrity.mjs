import assert from 'node:assert/strict'
import test from 'node:test'
import {buildLeadImportRows,defaultLeadCsvMapping} from '../src/lib/meta-lead-import.ts'
test('manual site origins are retained and cannot collide with a different Meta form identifier',async()=>{
 const headers=['Lead ID','Nome','WhatsApp','Created time','Contexto'],rows=[['1001','Pessoa valiosa','11999990000','13/10/2026 11:32:15','Texto completo']]
 const mapping=defaultLeadCsvMapping(headers)
 const [form]=await buildLeadImportRows(rows,headers,mapping,'form.csv','form')
 const [site]=await buildLeadImportRows(rows,headers,mapping,'site.csv','website')
 assert.equal(form.entry_channel,'form')
 assert.equal(site.entry_channel,'website')
 assert.equal(form.meta_lead_id,'1001')
 assert.equal(site.meta_lead_id,'site:zyron:1001')
 assert.equal(site.created_time,'2026-10-13T14:32:15.000Z')
})
test('manual source retains original spacing, empty columns and unmapped context for CRM consultation',async()=>{
 const headers=['Nome','WhatsApp','Contexto','Coluna vazia']
 const raw=['Pessoa','11999990000','  contexto \n com espaços  ','']
 const [lead]=await buildLeadImportRows([raw],headers,defaultLeadCsvMapping(headers),'arquivo.csv','form')
 assert.deepEqual(lead.raw_cells,[{header:'Nome',value:'Pessoa'},{header:'WhatsApp',value:'11999990000'},
  {header:'Contexto',value:'  contexto \n com espaços  '},{header:'Coluna vazia',value:''}])
})
