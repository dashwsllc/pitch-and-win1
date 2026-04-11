import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'

export type UserRole = 'seller' | 'executive' | 'super_admin' | 'closer' | 'sdr' | 'bdr' | 'traffic_manager'

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  executive: 'Executivo',
  closer: 'Closer',
  sdr: 'SDR',
  bdr: 'BDR',
  traffic_manager: 'Gestor de Tráfego',
  seller: 'Vendedor',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-role-admin',
  executive: 'bg-role-admin',
  closer: 'bg-role-closer',
  sdr: 'bg-role-sdr',
  bdr: 'bg-role-bdr',
  traffic_manager: 'bg-role-traffic',
  seller: 'bg-role-seller',
}

export const ROLE_DEPARTMENTS: Record<string, UserRole[]> = {
  'Administração': ['super_admin', 'executive'],
  'Comercial': ['closer', 'sdr'],
  'Prospecção': ['bdr'],
  'Tráfego': ['traffic_manager'],
  'Vendas': ['seller'],
}

export function useRoles() {
  const { user } = useAuth()
  const [roles, setRoles] = useState<UserRole[]>([])
  const [loading, setLoading] = useState(true)
  const [isExecutive, setIsExecutive] = useState(false)
  const [hasCRMAccess, setHasCRMAccess] = useState(false)
  const [canViewSales, setCanViewSales] = useState(false)
  const [commissionRate, setCommissionRate] = useState<number>(10)

  useEffect(() => {
    if (!user) {
      setRoles([])
      setIsExecutive(false)
      setHasCRMAccess(false)
      setCanViewSales(false)
      setLoading(false)
      return
    }

    fetchUserRoles()
  }, [user])

  const fetchUserRoles = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role, crm_access, commission_rate, can_view_sales')
        .eq('user_id', user.id)

      if (error) {
        console.error('Error fetching user roles:', error)
        return
      }

      const userRoles = data?.map(r => r.role as UserRole) || ['seller']
      setRoles(userRoles)
      setIsExecutive(
        userRoles.includes('executive') || userRoles.includes('super_admin')
      )
      setHasCRMAccess(
        data?.some(r => r.crm_access === true) || 
        userRoles.includes('executive') || 
        userRoles.includes('super_admin') ||
        userRoles.includes('bdr')
      )
      setCanViewSales(
        data?.some(r => r.can_view_sales === true) ||
        userRoles.includes('executive') ||
        userRoles.includes('super_admin')
      )
      const rate = data?.find(r => r.commission_rate != null)
      if (rate) setCommissionRate(Number(rate.commission_rate) || 10)
    } catch (error) {
      console.error('Error in fetchUserRoles:', error)
    } finally {
      setLoading(false)
    }
  }

  const hasRole = (role: UserRole) => roles.includes(role)
  const primaryRole = roles[0] || 'seller'

  return {
    roles,
    primaryRole,
    isExecutive,
    hasCRMAccess,
    canViewSales,
    commissionRate,
    hasRole,
    loading,
    refetch: fetchUserRoles
  }
}

export function useAllUsers() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAllUsers = async () => {
    try {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select(`
          *,
          user_roles(role, can_view_sales, crm_access, commission_rate)
        `)
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) {
        console.error('Error fetching all users:', error)
        return
      }

      setUsers(profiles || [])
    } catch (error) {
      console.error('Error in fetchAllUsers:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllUsers()
  }, [])

  return {
    users,
    loading,
    refetch: fetchAllUsers
  }
}
