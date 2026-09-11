import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, Flame, RefreshCw, Sparkles, Target } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { useDailyGoals, type DailyGoalTask } from '@/hooks/useGoals'
import { formatDateKey, millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import { safePlainText } from '@/lib/plain-text'
import { errorMessage } from '@/lib/sales'
import { cn } from '@/lib/utils'

function countdownLabel(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
}

export function GoalsProgress() {
  const { tasks, today, loading, error, refreshing, refetch, setCompleted } = useDailyGoals()
  const { toast } = useToast()
  const [now, setNow] = useState(() => new Date())
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const completed = tasks.filter((task) => task.is_completed).length
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0
  const allCompleted = tasks.length > 0 && completed === tasks.length
  const remainingMs = millisecondsUntilBrasiliaMidnight(now)
  const urgency = remainingMs <= 2 * 60 * 60 * 1000
    ? 'critical'
    : remainingMs <= 6 * 60 * 60 * 1000
      ? 'attention'
      : 'normal'
  const countdown = useMemo(() => countdownLabel(remainingMs), [remainingMs])

  const toggle = async (task: DailyGoalTask, checked: boolean) => {
    if (busyIds.has(task.id)) return
    setBusyIds((current) => new Set(current).add(task.id))
    try {
      await setCompleted(task, checked)
      const willCompleteDay = checked && completed + 1 === tasks.length
      toast({
        title: willCompleteDay ? 'Metas do dia concluídas!' : checked ? 'Tarefa concluída' : 'Tarefa reaberta',
        description: willCompleteDay ? 'Checklist em 100%. Excelente fechamento de dia.' : undefined,
      })
    } catch (cause) {
      toast({
        title: 'Não foi possível atualizar a tarefa',
        description: errorMessage(cause),
        variant: 'destructive',
      })
      void refetch()
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  if (loading) {
    return (
      <Card className="surface-inset-glow rounded-2xl border-0">
        <CardContent className="space-y-4 p-6">
          <div className="h-6 w-56 animate-pulse rounded bg-white/[0.04]" />
          <div className="h-2 animate-pulse rounded-full bg-white/[0.04]" />
          {[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-white/[0.035]" />)}
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="surface-inset-glow rounded-2xl border-0">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar suas metas de hoje.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={refreshing}>
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!tasks.length) {
    return (
      <Card className="surface-inset-glow rounded-2xl border-0">
        <CardContent className="p-8 text-center sm:p-10">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.035] shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]">
            <Target className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
          </div>
          <p className="text-sm font-medium text-ash">Nenhuma tarefa definida para hoje</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O executivo pode cadastrar seu checklist de {formatDateKey(today)}.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn(
      'surface-inset-glow overflow-hidden rounded-2xl border-0 transition-shadow',
      allCompleted && 'shadow-[rgba(52,211,153,0.18)_0_0_0_1px_inset]',
      !allCompleted && urgency === 'critical' && 'shadow-[rgba(244,63,94,0.22)_0_0_0_1px_inset]',
      !allCompleted && urgency === 'attention' && 'shadow-[rgba(251,191,36,0.18)_0_0_0_1px_inset]',
    )}>
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">Checklist de hoje</p>
              <span className="text-xs tabular-nums text-muted-foreground">{completed}/{tasks.length} concluídas</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={progress} className="h-2 flex-1" aria-label={`${progress}% das metas concluídas`} />
              <span className="w-10 text-right text-sm font-medium tabular-nums text-white">{progress}%</span>
            </div>
          </div>
          <div className={cn(
            'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs tabular-nums',
            allCompleted ? 'bg-emerald-400/10 text-emerald-300' :
              urgency === 'critical' ? 'bg-rose-400/10 text-rose-300' :
                urgency === 'attention' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/[0.035] text-muted-foreground',
          )}>
            {allCompleted ? <CheckCircle2 className="h-4 w-4" /> : urgency === 'normal' ? <Clock3 className="h-4 w-4" /> : <Flame className="h-4 w-4" />}
            <span>{allCompleted ? 'Dia concluído' : `${countdown} restantes`}</span>
          </div>
        </div>

        {allCompleted && (
          <div role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-400/[0.08] px-4 py-3 text-sm text-emerald-200">
            <Sparkles className="h-4 w-4" />
            Todas as metas do dia foram concluídas.
          </div>
        )}

        <div className="mt-5 space-y-2">
          {tasks.map((task) => {
            const busy = busyIds.has(task.id)
            return (
              <label
                key={task.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.025] px-4 py-3 text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] transition-colors hover:bg-white/[0.04]',
                  task.is_completed && 'bg-emerald-400/[0.055]',
                  busy && 'cursor-wait opacity-65',
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={task.is_completed}
                  disabled={busy}
                  onCheckedChange={(value) => void toggle(task, value === true)}
                  aria-label={`${task.is_completed ? 'Reabrir' : 'Concluir'} ${safePlainText(task.title, 280)}`}
                />
                <span className={cn('min-w-0 flex-1 break-words leading-5 text-ash', task.is_completed && 'text-muted-foreground line-through')}>
                  {safePlainText(task.title, 280)}
                </span>
                {task.is_completed && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
              </label>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
