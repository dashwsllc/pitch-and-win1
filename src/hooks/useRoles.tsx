import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'

export type UserRole = 'seller' | 'executive'

interface UserRoleData {
  id: string
  user_id: string
  role: UserRole
  created_at: string
}

export function useRoles() {
  const { user } = useAuth()
  const [roles, setRoles] = useState<UserRole[]>([])
  const [loading, setLoading] = useState(true)
  const [isExecutive, setIsExecutive] = useState(false)

  useEffect(() => {
    if (!user) {
      setRoles([])
      setIsExecutive(false)
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
        .select('role')
        .eq('user_id', user.id)

      if (error) {
        console.error('Error fetching user roles:', error)
        return
      }

      const userRoles = data?.map(r => r.role) || ['seller']
      setRoles(userRoles)
      setIsExecutive(userRoles.includes('executive'))
    } catch (error) {
      console.error('Error in fetchUserRoles:', error)
    } finally {
      setLoading(false)
    }
  }

  const hasRole = (role: UserRole) => roles.includes(role)

  return {
    roles,
    isExecutive,
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
          user_roles!inner(role)
        `)
        .order('created_at', { ascending: false })

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