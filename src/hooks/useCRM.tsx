import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types'
import { useAuth } from './useAuth'
import { useRoles } from './useRoles'

export type CRMLead = Tables<'crm_leads'>
export type CRMActivity = Tables<'crm_activities'>
export const PIPELINE_STAGES = [
  { value: 'novo', label: 'Novo' },
  { value: 'em_qualificacao', label: 'Em qualificação' },
  { value: 'repassado_closer', label: 'Repassado para Closer' },
  { value: 'fechado_ganho', label: 'Venda concluída' },
  { value: 'lead_perdido', label: 'Lead perdido' },
  { value: 'fechado_perdido', label: 'Venda perdida' },
  { value: 'contato_feito', label: 'Contato feito (anterior)' },
  { value: 'proposta_enviada', label: 'Proposta enviada (anterior)' },
  { value: 'negociacao', label: 'Negociação (anterior)' },
  { value: 'reativacao', label: 'Reativação (anterior)' }
]
export const LEAD_SOURCES = [
  'instagram',
  'facebook',
  'linkedin',
  'indicacao',
  'cold_outreach',
  'evento',
  'site',
  'whatsapp',
  'google_ads',
  'email_marketing',
  'outro'
]
export const CALL_OUTCOMES: Record<string, string> = {
  avancou: 'Avançou',
  lead_perdido: 'Lead perdido',
  venda_concluida: 'Venda concluída',
  venda_perdida: 'Venda perdida',
  devolvido_sdr: 'Devolvido ao SDR'
}
const queryOptions = { staleTime: 5_000, refetchInterval: 15_000, refetchOnWindowFocus: true, retry: 1 }

export function useCRMRealtime() {
  const client = useQueryClient()
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`crm-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_leads' }, () => {
        void client.invalidateQueries({ queryKey: ['crm'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities' }, () => {
        void client.invalidateQueries({ queryKey: ['crm'] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user, client])
}

export function useCRMLeads() {
  const { user } = useAuth()
  const { hasCRMAccess } = useRoles()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['crm', 'leads', user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const rows: CRMLead[] = []
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from('crm_leads')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, from + 499)
        if (error) throw error
        rows.push(...data)
        if (data.length < 500) return rows
      }
    }
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['crm'] })
  const createLead = async (lead: TablesInsert<'crm_leads'>) => {
    const { data, error } = await supabase.from('crm_leads').insert(lead).select().single()
    if (error) throw error
    await refresh()
    return data
  }
  const updateLead = async (id: string, updates: TablesUpdate<'crm_leads'>) => {
    const { error } = await supabase.from('crm_leads').update(updates).eq('id', id).select('id').single()
    if (error) throw error
    await refresh()
  }
  const deleteLead = async (id: string) => {
    const { error } = await supabase.from('crm_leads').delete().eq('id', id).select('id').single()
    if (error) throw error
    await refresh()
  }
  return {
    leads: hasCRMAccess ? (query.data ?? []) : [],
    loading: query.isPending,
    error: query.error,
    fetchLeads: refresh,
    createLead,
    updateLead,
    deleteLead
  }
}

export function useCRMActivities(leadId: string | null, callsOnly = false) {
  const { user } = useAuth()
  const { hasCRMAccess } = useRoles()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['crm', 'activities', user?.id, leadId, callsOnly],
    enabled: !!user && hasCRMAccess && (!!leadId || callsOnly),
    ...queryOptions,
    queryFn: async () => {
      const rows: CRMActivity[] = []
      for (let from = 0; ; from += 500) {
        let request = supabase
          .from('crm_activities')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, from + 499)
        if (leadId) request = request.eq('lead_id', leadId)
        if (callsOnly) request = request.not('call_type', 'is', null)
        const { data, error } = await request
        if (error) throw error
        rows.push(...data)
        if (data.length < 500) return rows
      }
    }
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['crm'] })
  const createActivity = async (activity: TablesInsert<'crm_activities'>) => {
    const { error } = await supabase.from('crm_activities').insert(activity)
    if (error) throw error
    await refresh()
  }
  return {
    activities: hasCRMAccess ? (query.data ?? []) : [],
    loading: query.isPending,
    error: query.error,
    fetchActivities: refresh,
    createActivity
  }
}

export function useCRMAssignees() {
  const { user } = useAuth()
  const { hasCRMAccess } = useRoles()
  return useQuery({
    queryKey: ['crm', 'assignees', user?.id],
    enabled: !!user && hasCRMAccess,
    ...queryOptions,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('crm_call_assignees')
      if (error) throw error
      return data
    }
  })
}
