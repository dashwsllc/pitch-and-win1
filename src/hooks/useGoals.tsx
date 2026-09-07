import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'

export interface Goal {
  id: string
  title: string
  description: string | null
  target: number
  current: number
  period: 'daily' | 'weekly' | 'monthly'
  unit: string | null
  status: string | null
  deadline: string | null
  created_by: string | null
}

export interface GoalWithProgress extends Goal {
  progress: number // 0-100 percentage
  isCompleted: boolean
  remaining: number
}

export function useGoals() {
  const { user } = useAuth()
  const [goals, setGoals] = useState<GoalWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const calculateProgress = useCallback(async (rawGoals: Goal[]) => {
    if (!user) return []

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    // Get start of current week (Monday)
    const weekStart = new Date(todayStart)
    const dayOfWeek = weekStart.getDay()
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    weekStart.setDate(weekStart.getDate() - diff)
    
    // Get start of current month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

    // Fetch all approved sales for different periods
    const [dailyRes, weeklyRes, monthlyRes] = await Promise.all([
      supabase
        .from('vendas')
        .select('valor_venda')
        .gte('created_at', todayStart.toISOString())
        .lt('created_at', tomorrow.toISOString()),
      supabase
        .from('vendas')
        .select('valor_venda')
        .gte('created_at', weekStart.toISOString())
        .lt('created_at', tomorrow.toISOString()),
      supabase
        .from('vendas')
        .select('valor_venda')
        .gte('created_at', monthStart.toISOString())
        .lt('created_at', tomorrow.toISOString()),
    ])

    const dailyTotal = dailyRes.data?.reduce((sum, v) => sum + Number(v.valor_venda), 0) || 0
    const dailyCount = dailyRes.data?.length || 0
    const weeklyTotal = weeklyRes.data?.reduce((sum, v) => sum + Number(v.valor_venda), 0) || 0
    const weeklyCount = weeklyRes.data?.length || 0
    const monthlyTotal = monthlyRes.data?.reduce((sum, v) => sum + Number(v.valor_venda), 0) || 0
    const monthlyCount = monthlyRes.data?.length || 0

    return rawGoals.map(goal => {
      let current = 0
      
      if (goal.unit === 'currency' || goal.unit === 'BRL' || !goal.unit) {
        switch (goal.period) {
          case 'daily': current = dailyTotal; break
          case 'weekly': current = weeklyTotal; break
          case 'monthly': current = monthlyTotal; break
        }
      } else if (goal.unit === 'count') {
        switch (goal.period) {
          case 'daily': current = dailyCount; break
          case 'weekly': current = weeklyCount; break
          case 'monthly': current = monthlyCount; break
        }
      }

      const target = goal.target || 1
      const progress = Math.min((current / target) * 100, 150) // Cap at 150%
      
      return {
        ...goal,
        current,
        progress,
        isCompleted: current >= target,
        remaining: Math.max(target - current, 0),
      }
    })
  }, [user])

  const fetchGoals = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('company_goals')
        .select('*')
        .or('status.eq.active,status.is.null')
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError

      const rawGoals: Goal[] = (data || []).map(g => ({
        id: g.id,
        title: g.title,
        description: g.description,
        target: g.target || 0,
        current: g.current || 0,
        period: (g.period as 'daily' | 'weekly' | 'monthly') || 'daily',
        unit: g.unit,
        status: g.status,
        deadline: g.deadline,
        created_by: g.created_by,
      }))

      const goalsWithProgress = await calculateProgress(rawGoals)
      setGoals(goalsWithProgress)
    } catch (err) {
      console.error('Erro ao buscar metas:', err)
      setError('Erro ao carregar metas')
    } finally {
      setLoading(false)
    }
  }, [calculateProgress])

  useEffect(() => {
    fetchGoals()

    // Polling every 30 seconds for real-time updates
    const interval = setInterval(fetchGoals, 30000)
    return () => clearInterval(interval)
  }, [fetchGoals])

  return { goals, loading, error, refetch: fetchGoals }
}

// Hook for executive CRUD operations
export function useGoalsManagement() {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)

  const createGoal = async (goal: {
    title: string
    description?: string
    target: number
    period: string
    unit?: string
    deadline?: string
  }) => {
    if (!user) return null
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('company_goals')
        .insert({
          title: goal.title,
          description: goal.description || null,
          target: goal.target,
          period: goal.period,
          unit: goal.unit || 'currency',
          deadline: goal.deadline || null,
          status: 'active',
          current: 0,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    } catch (err) {
      console.error('Erro ao criar meta:', err)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const updateGoal = async (id: string, updates: Partial<{
    title: string
    description: string
    target: number
    period: string
    unit: string
    deadline: string
    status: string
  }>) => {
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('company_goals')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (err) {
      console.error('Erro ao atualizar meta:', err)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const deleteGoal = async (id: string) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('company_goals')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (err) {
      console.error('Erro ao excluir meta:', err)
      throw err
    } finally {
      setSaving(false)
    }
  }

  return { createGoal, updateGoal, deleteGoal, saving }
}
