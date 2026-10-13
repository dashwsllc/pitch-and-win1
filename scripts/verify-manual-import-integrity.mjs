import assert from 'node:assert/strict'
import test from 'node:test'
import {buildLeadImportRows,defaultLeadCsvMapping} from '../src/lib/meta-lead-import.ts'
import {parseSpreadsheetFile} from '../src/lib/spreadsheet.ts'
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

test('real CSV and XLSX file boundaries preserve untrimmed original cell values',async()=>{
 const raw='  contexto\ncom espaços  ',headers=['Nome','WhatsApp',' Contexto original ','Vazio']
 const csv='Nome,WhatsApp, Contexto original ,Vazio\nPessoa,11999990000,"'+raw+'",'
 const XLSX=await import('xlsx')
 const workbook=XLSX.utils.book_new()
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([headers,['Pessoa','11999990000',raw,'']]),'Dados')
 const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'})
 for(const file of [new File([csv],'origem.csv'),new File([bytes],'origem.xlsx')]){
  const parsed=await parseSpreadsheetFile(file,{preserveCells:true})
  const [lead]=await buildLeadImportRows(parsed.values,parsed.headers,defaultLeadCsvMapping(parsed.headers),file.name)
  assert.deepEqual(lead.raw_cells[2],{header:headers[2],value:raw})
  assert.equal(lead.raw_cells[3].value,'')
 }
})

test('missing, invalid and date-only generations retain distinct precision',async()=>{
 const headers=['Nome','WhatsApp','Created time']
 const rows=await buildLeadImportRows(['','invalid','13/10/2026'].map(date=>['Pessoa','11999990000',date]),headers,defaultLeadCsvMapping(headers))
 assert.deepEqual(rows.map(row=>[row.source_has_date,row.time_known]),[[false,false],[false,false],[true,false]])
})
