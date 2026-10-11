export function captureDatabase({accounts=[{account_id:'123'}],failPrepare=false}={}) {
 const calls=[],runs=new Map(),imported=[],finishes=[]
 let lease=0
 const admin={calls,runs,imported,finishes,
  from(table){
   const filters={};let updating=false
   const chain={select(){return chain},eq(key,value){filters[key]=value;return chain},in(){return chain},not(){return chain},order(){return chain},limit(){return chain},update(){updating=true;return chain},
    then(resolve,reject){return Promise.resolve({data:updating?null:table==='meta_ad_accounts'?accounts:[...runs.values()].filter(r=>['running','partial'].includes(r.status)),error:null}).then(resolve,reject)}}
   return chain
  },
  async rpc(name,args){
   calls.push({name,args})
   if(name==='meta_sync_run_start')return {data:'error-run-'+calls.length,error:null}
   if(name==='meta_sync_run_finish'){finishes.push(args);return {data:null,error:null}}
   if(name==='meta_capture_open'){
    const existing=[...runs.values()].find(r=>r.account_id===args.p_account_id&&r.level===args.p_level&&['running','partial'].includes(r.status))
    if(existing)return {data:existing.id,error:null}
    const id='run-'+runs.size
    runs.set(id,{id,status:'running',account_id:args.p_account_id,level:args.p_level,window_start:args.p_start,window_end:args.p_end,request_params:args.p_params,account_metadata:args.p_metadata,page_count:0,rows_synced:0,next_request:{path:'/act_'+args.p_account_id+'/insights',params:args.p_params}})
    return {data:id,error:null}
   }
   const run=runs.get(args.p_id)
   if(name==='meta_capture_claim'){run.claim_token='lease-'+(++lease);return {data:structuredClone(run),error:null}}
   if(name==='meta_capture_append'){imported.push(...args.p_rows);run.rows_synced+=args.p_rows.length;run.page_count++;run.next_request=args.p_next;return {data:{page_count:run.page_count,next_request:args.p_next},error:null}}
   if(name==='meta_capture_prepare'){
    if(failPrepare)return {data:null,error:{message:'finish unavailable'}}
    run.status='success';finishes.push({p_status:'success',p_id:run.id});return {data:'review-'+run.id,error:null}
   }
   if(name==='meta_capture_release'||name==='meta_capture_abort'){run.status=name.endsWith('abort')?'error':'partial';finishes.push({p_status:run.status,p_id:run.id});return {data:null,error:null}}
   throw new Error('Unexpected RPC '+name)
  }}
 return admin
}
