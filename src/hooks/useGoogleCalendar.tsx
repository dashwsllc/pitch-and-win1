import {useEffect,useRef} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {useAuth} from '@/hooks/useAuth'
import {useRoles} from '@/hooks/useRoles'
import {adminQueryKey,callStatusesQueryKey,fetchCalendarStatuses,manageCalendar} from '@/lib/google-calendar-api'
import type {ManageRequest} from '../../supabase/functions/_shared/google-calendar-contract'
function useCalendarSession(){
  const {user,loading,registrationStatus}=useAuth(),{capabilities,loading:rolesLoading}=useRoles(),client=useQueryClient()
  const userId=user?.id??'',approved=!!userId&&!loading&&!rolesLoading&&registrationStatus==='approved'
  useEffect(()=>()=>{if(userId)client.removeQueries({predicate:q=>q.queryKey[0]==='google-calendar'&&q.queryKey[2]===userId})},[client,userId])
  const adminAllowed=approved&&capabilities.executive
  const lifecycle=useRef({userId,adminAllowed,generation:0,mounted:true})
  if(lifecycle.current.userId!==userId||lifecycle.current.adminAllowed!==adminAllowed){
    lifecycle.current={...lifecycle.current,userId,adminAllowed,generation:lifecycle.current.generation+1}
  }
  useEffect(()=>{
    lifecycle.current.mounted=true
    return()=>{lifecycle.current.mounted=false;lifecycle.current.generation++}
  },[])
  const generation=lifecycle.current.generation
  const isCurrent=()=>lifecycle.current.mounted&&lifecycle.current.adminAllowed&&lifecycle.current.generation===generation
  useEffect(()=>{if(!adminAllowed&&userId)client.removeQueries({predicate:q=>q.queryKey[0]==='google-calendar'&&q.queryKey[1]==='admin'&&q.queryKey[2]===userId})},[client,userId,adminAllowed])
  return{userId,adminAllowed,allowed:approved&&capabilities.leads,client,sessionKey:`${userId}:${generation}`,isCurrent}
}
export function useGoogleCalendarAdmin(){
  const {userId,adminAllowed,client,sessionKey,isCurrent}=useCalendarSession()
  const query=useQuery({queryKey:adminQueryKey(userId),enabled:adminAllowed,queryFn:()=>manageCalendar({action:'status'}),refetchInterval:30000,refetchOnWindowFocus:true,retry:1})
  const mutation=useMutation({mutationFn:async(request:ManageRequest)=>{
    if(!isCurrent())throw new Error('calendar_admin_required')
    const result=await manageCalendar(request)
    if(!isCurrent())throw new Error('calendar_session_changed')
    return result
  },onSuccess:async()=>{if(isCurrent())await client.invalidateQueries({predicate:q=>q.queryKey[0]==='google-calendar'&&q.queryKey[2]===userId})}})
  return{...mutation,query,allowed:adminAllowed,status:adminAllowed?query.data:undefined,sessionKey,isCurrent}
}
export function useGoogleCalendarStatuses(callIds:string[]){
  const {userId,allowed}=useCalendarSession()
  const ids=[...new Set(callIds)].sort()
  const query=useQuery({queryKey:callStatusesQueryKey(userId,ids),enabled:allowed&&ids.length>0,queryFn:()=>fetchCalendarStatuses(ids),refetchInterval:30000,refetchOnWindowFocus:true,retry:1})
  return{statuses:allowed?query.data??new Map():new Map(),loading:allowed&&ids.length>0&&query.isLoading,error:allowed?query.error:null}
}
