import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { brasiliaDateKey, millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import { fetchAllPages } from '@/lib/supabase-pages'
import { sanitizePlainText } from '@/lib/plain-text'
import { AUTO_REFRESH_INTERVAL_MS } from '@/lib/sync'

export type DailyGoalTask = Tables<'daily_goal_tasks'>

export function useBrasiliaToday() {
  const [today, setToday] = useState(() => brasiliaDateKey())

  useEffect(() => {
    let timeout: number
    const update = () => {
      window.clearTimeout(timeout)
      setToday(brasiliaDateKey())
      timeout = window.setTimeout(update, millisecondsUntilBrasiliaMidnight() + 50)
    }
    update()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return today
}

export function useDailyGoals() {
  const { user } = useAuth()
  const today = useBrasiliaToday()
  const client = useQueryClient()
  const key = ['daily-goals', 'mine', user?.id, today]
  const query = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async () => {
      return fetchAllPages((from, to) => supabase
        .from('daily_goal_tasks')
        .select('*')
        .eq('assignee_id', user!.id)
        .eq('task_date', today)
        .order('position')
        .order('created_at')
        .order('id')
        .range(from, to))
    },
    staleTime: 0,
    refetchInterval: AUTO_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  })

  const setCompleted = async (task: DailyGoalTask, completed: boolean) => {
    const { data, error } = await supabase.rpc('set_daily_goal_task_completed', {
      p_task_id: task.id,
      p_completed: completed,
      p_expected_version: task.version,
    })
    if (error) throw error
    client.setQueryData<DailyGoalTask[]>(key, (rows) =>
      rows?.map((row) => row.id === data.id ? data : row),
    )
    void client.invalidateQueries({ queryKey: ['daily-goals'] })
    return data
  }

  return {
    tasks: query.data ?? [],
    today,
    loading: query.isLoading,
    refreshing: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    setCompleted,
  }
}

export function useDailyGoalsManagement(assigneeId: string, taskDate: string) {
  const { user } = useAuth()
  const { isExecutive, loading: rolesLoading } = useRoles()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['daily-goals', 'management', user?.id, assigneeId, taskDate],
    enabled: !!user && isExecutive && !!assigneeId && !!taskDate,
    queryFn: async () => {
      return fetchAllPages((from, to) => supabase
        .from('daily_goal_tasks')
        .select('*')
        .eq('assignee_id', assigneeId)
        .eq('task_date', taskDate)
        .order('position')
        .order('created_at')
        .order('id')
        .range(from, to))
    },
    staleTime: 0,
    refetchInterval: AUTO_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  })

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['daily-goals'] })
  }

  const createTask = async (title: string) => {
    const content = sanitizePlainText(title, 280)
    if (!content) throw new Error('Escreva a tarefa antes de adicionar.')
    const { data, error } = await supabase.rpc('executive_create_daily_goal_task', {
      p_assignee_id: assigneeId,
      p_task_date: taskDate,
      p_title: content,
    })
    if (error) throw error
    await refresh()
    return data
  }

  const updateTask = async (task: DailyGoalTask, title: string) => {
    const content = sanitizePlainText(title, 280)
    if (!content) throw new Error('A tarefa não pode ficar vazia.')
    const { data, error } = await supabase.rpc('executive_update_daily_goal_task', {
      p_task_id: task.id,
      p_assignee_id: assigneeId,
      p_task_date: taskDate,
      p_title: content,
      p_expected_version: task.version,
    })
    if (error) throw error
    await refresh()
    return data
  }

  const deleteTask = async (task: DailyGoalTask) => {
    const { error } = await supabase.rpc('executive_delete_daily_goal_task', {
      p_task_id: task.id,
      p_expected_version: task.version,
    })
    if (error) throw error
    await refresh()
  }

  return {
    tasks: query.data ?? [],
    loading: rolesLoading || query.isLoading,
    refreshing: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    createTask,
    updateTask,
    deleteTask,
  }
}
