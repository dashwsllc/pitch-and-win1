const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function parseCrmLeadLink(search:string):{leadId:string}|null {
  const params=new URLSearchParams(search),ids=params.getAll('lead')
  return ids.length===1 && UUID.test(ids[0]) ? {leadId:ids[0].toLowerCase()} : null
}
export function safeCrmReturnPath(value:unknown):string|null {
  if(typeof value!=='string'||!/^\/crm\?/.test(value)||/[\r\n\\#]/.test(value))return null
  const url=new URL(value,'https://crm.invalid')
  if(url.origin!=='https://crm.invalid'||url.pathname!=='/crm'||!parseCrmLeadLink(url.search))return null
  if([...url.searchParams.keys()].some(k=>!['lead','tab'].includes(k))||url.searchParams.getAll('tab').length>1)return null
  if(url.searchParams.has('tab')&&!['leads','closer','sdr','results','followup'].includes(url.searchParams.get('tab')!))return null
  return value
}
export function resolveCrmLeadLink(leadId:string,visibleLeadIds:string[],loading:boolean,error:boolean):'waiting'|'open'|'unavailable'|'load_error' {
  if(loading)return 'waiting'
  if(error)return 'load_error'
  return UUID.test(leadId)&&visibleLeadIds.includes(leadId)?'open':'unavailable'
}