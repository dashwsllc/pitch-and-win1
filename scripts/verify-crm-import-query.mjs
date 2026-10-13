import assert from 'node:assert/strict'
import test from 'node:test'
import {createComponentLoader} from './helpers/meta-component-harness.mjs'
test('CRM lists import metadata without downloading every complete source snapshot',async()=>{
 const selected=[],queries=[]
 const client={from(table){assert.equal(table,'crm_leads');const q={select(columns){selected.push(columns);return q},order(){return q},async range(){return{data:[],error:null}}};return q}}
 const load=createComponentLoader({
  '@/integrations/supabase/client':{supabase:client},
  './useAuth':{useAuth:()=>({user:{id:'qa-user'}})},
  './useRoles':{useRoles:()=>({hasCRMAccess:true})},
  '@tanstack/react-query':{useQuery:options=>{queries.push(options);return{data:[],refetch:async()=>{}}},useQueryClient:()=>({invalidateQueries:async()=>{}})},
 })
 load('src/hooks/useCRM.tsx').useCRMLeads()
 await queries[0].queryFn()
 assert(!selected[0].split(',').includes('*'),'list still fetches the full source for every lead')
 assert(!selected[0].split(',').includes('import_snapshot'),'list still downloads complete source snapshots')
 for(const field of ['id','name','phone','lead_received_at','import_channel','import_method'])assert(selected[0].split(',').includes(field))
})
