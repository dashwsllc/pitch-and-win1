import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'

export interface CRMLead {
  id: string
  name: string
  age: number | null
  email: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  linkedin_url: string | null
  profile_photo_url: string | null
  temperature: 'frio' | 'morno' | 'quente'
  priority: 'baixa' | 'normal' | 'alta' | 'urgente'
  conversion_probability: number
  estimated_deal_value: number | null
  pipeline_stage: string
  lead_source: string | null
  approached: boolean
  approached_at: string | null
  approach_count: number
  first_contact_at: string | null
  last_contact_at: string | null
  next_followup_at: string | null
  expected_close_at: string | null
  assigned_to: string | null
  observations: string | null
  observations_updated_at: string | null
  observations_updated_by: string | null
  tags: string[] | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CRMActivity {
  id: string
  lead_id: string
  user_id: string
  activity_type: string
  title: string
  description: string | null
  outcome: string | null
  scheduled_at: string | null
  completed_at: string | null
  is_completed: boolean
  is_pinned: boolean
  created_at: string
}

export const PIPELINE_STAGES = [
  { value: 'novo', label: 'Novo', color: 'bg-blue-500' },
  { value: 'contato_feito', label: 'Contato Feito', color: 'bg-cyan-500' },
  { value: 'proposta_enviada', label: 'Proposta Enviada', color: 'bg-yellow-500' },
  { value: 'negociacao', label: 'Negociação', color: 'bg-orange-500' },
  { value: 'fechado_ganho', label: 'Fechado (Ganho)', color: 'bg-green-500' },
  { value: 'fechado_perdido', label: 'Fechado (Perdido)', color: 'bg-red-500' },
  { value: 'reativacao', label: 'Reativação', color: 'bg-purple-500' },
]

export const LEAD_SOURCES = [
  'instagram', 'facebook', 'linkedin', 'indicacao',
  'cold_outreach', 'evento', 'site', 'whatsapp',
  'google_ads', 'email_marketing', 'outro'
]

export const ACTIVITY_TYPES = [
  { value: 'ligacao', label: 'Ligação' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'proposta', label: 'Proposta' },
  { value: 'nota', label: 'Nota' },
  { value: 'tarefa', label: 'Tarefa' },
  { value: 'visita', label: 'Visita' },
]

export function useCRMLeads() {
  const { user } = useAuth()
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLeads = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('crm_leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw error
      setLeads((data || []) as CRMLead[])
    } catch (err) {
      console.error('Error fetching leads:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const createLead = async (lead: Partial<CRMLead>) => {
    const { data, error } = await supabase
      .from('crm_leads')
      .insert([lead as any])
      .select()
    if (error) throw error
    await fetchLeads()
    return data?.[0]
  }

  const updateLead = async (id: string, updates: Partial<CRMLead>) => {
    const { error } = await supabase
      .from('crm_leads')
      .update(updates as any)
      .eq('id', id)
    if (error) throw error
    await fetchLeads()
  }

  const deleteLead = async (id: string) => {
    const { error } = await supabase
      .from('crm_leads')
      .delete()
      .eq('id', id)
    if (error) throw error
    await fetchLeads()
  }

  return { leads, loading, fetchLeads, createLead, updateLead, deleteLead }
}

export function useCRMActivities(leadId: string | null) {
  const [activities, setActivities] = useState<CRMActivity[]>([])
  const [loading, setLoading] = useState(false)

  const fetchActivities = useCallback(async () => {
    if (!leadId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('crm_activities')
        .select('*')
        .eq('lead_id', leadId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setActivities((data || []) as CRMActivity[])
    } catch (err) {
      console.error('Error fetching activities:', err)
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { fetchActivities() }, [fetchActivities])

  const createActivity = async (activity: Partial<CRMActivity>) => {
    const { error } = await supabase
      .from('crm_activities')
      .insert([activity as any])
    if (error) throw error

    // Update last_contact_at on lead
    if (leadId) {
      await supabase
        .from('crm_leads')
        .update({ last_contact_at: new Date().toISOString() } as any)
        .eq('id', leadId)
    }
    await fetchActivities()
  }

  return { activities, loading, fetchActivities, createActivity }
}
