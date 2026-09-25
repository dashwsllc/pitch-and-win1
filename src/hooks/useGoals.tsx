import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { addDaysToDateKey, brasiliaDateKey, millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import { fetchAllPages } from '@/lib/supabase-pages'
import { sanitizePlainText } from '@/lib/plain-text'

export type DailyGoalTask = Tables<'daily_goal_tasks'>

export function useBrasiliaToday() {
  const [today, setToday] = useState(() => brasiliaDateKey())

  useEffect(() => {
    const update = () => {
      setToday(brasiliaDateKey())
    }
    let timeout: number
    const schedule = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => {
        update()
        schedule()
      }, millisecondsUntilBrasiliaMidnight() + 50)
    }
    update()
    schedule()
    const refreshWhenVisible = () => {
      if (document.hidden) return
      update()
      schedule()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  return today
}

// An untouched date field follows Brasilia's day rollover. Once a person
// chooses a date (including when editing an older record), preserve it.
export function useBrasiliaDateSelection() {
  const today = useBrasiliaToday()
  const [selectedDate, setDate] = useState<string | null>(null)
  return { today, date: selectedDate ?? today, setDate }
}

export function useDailyGoals() {
  const { user } = useAuth()
  const today = useBrasiliaToday()
  const yesterday = addDaysToDateKey(today, -1)
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
        .is('deadline_at', null)
        .order('position')
        .order('created_at')
        .order('id')
        .range(from, to))
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const previousQuery = useQuery({
    queryKey: ['daily-goals', 'mine', user?.id, yesterday],
    enabled: !!user,
    queryFn: async () => fetchAllPages((from, to) => supabase
      .from('daily_goal_tasks')
      .select('*')
      .eq('assignee_id', user!.id)
      .eq('task_date', yesterday)
      .is('deadline_at', null)
      .order('position')
      .order('created_at')
      .order('id')
      .range(from, to)),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
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
    yesterday,
    previousTasks: previousQuery.data ?? [],
    previousError: previousQuery.error,
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
    refetchOnWindowFocus: false,
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
