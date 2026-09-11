import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Edit2, ListChecks, Loader2, Plus, RefreshCw, Trash2, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useDailyGoalsManagement, useBrasiliaToday, type DailyGoalTask } from '@/hooks/useGoals'
import { useAllUsers } from '@/hooks/useRoles'
import { formatDateKey } from '@/lib/brasilia-time'
import { safePlainText, sanitizePlainText } from '@/lib/plain-text'
import { errorMessage } from '@/lib/sales'
import { cn } from '@/lib/utils'

export function ExecutiveGoalsManagement() {
  const { users, loading: usersLoading, error: usersError, refetch: refetchUsers } = useAllUsers()
  const today = useBrasiliaToday()
  const collaborators = useMemo(
    () => users.filter((user) => !user.suspended).sort((a, b) =>
      (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR'),
    ),
    [users],
  )
  const [assigneeId, setAssigneeId] = useState('')
  const [taskDate, setTaskDate] = useState(today)
  const [newTask, setNewTask] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<DailyGoalTask | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const { toast } = useToast()

  useEffect(() => {
    if (!assigneeId && collaborators.length) setAssigneeId(collaborators[0].user_id)
  }, [assigneeId, collaborators])

  const goals = useDailyGoalsManagement(assigneeId, taskDate)
  const selected = collaborators.find((user) => user.user_id === assigneeId)
  const completed = goals.tasks.filter((task) => task.is_completed).length
  const progress = goals.tasks.length ? Math.round((completed / goals.tasks.length) * 100) : 0
  const historical = taskDate < today

  const addTask = async (event: React.FormEvent) => {
    event.preventDefault()
    const title = sanitizePlainText(newTask, 280)
    if (!assigneeId || !taskDate || !title || saving) return
    setSaving(true)
    try {
      await goals.createTask(title)
      setNewTask('')
      toast({ title: 'Tarefa adicionada', description: `${selected?.display_name || 'Colaborador'} · ${formatDateKey(taskDate)}` })
    } catch (cause) {
      toast({ title: 'Não foi possível adicionar a tarefa', description: errorMessage(cause), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    if (!editing || saving) return
    setSaving(true)
    try {
      await goals.updateTask(editing, editTitle)
      setEditing(null)
      toast({ title: 'Tarefa atualizada' })
    } catch (cause) {
      toast({ title: 'Não foi possível editar a tarefa', description: errorMessage(cause), variant: 'destructive' })
      void goals.refetch()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (task: DailyGoalTask) => {
    if (saving || !confirm(`Remover a tarefa "${safePlainText(task.title, 280)}"?`)) return
    setSaving(true)
    try {
      await goals.deleteTask(task)
      toast({ title: 'Tarefa removida' })
    } catch (cause) {
      toast({ title: 'Não foi possível remover a tarefa', description: errorMessage(cause), variant: 'destructive' })
      void goals.refetch()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ListChecks className="h-5 w-5 text-ember" />
          Metas diárias por colaborador
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastre o checklist de cada dia. Ao virar a data em Brasília, o histórico é preservado e um novo dia começa.
        </p>
      </div>

      <Card className="border-border/30">
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="goal-assignee">Colaborador</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId} disabled={usersLoading || !collaborators.length}>
              <SelectTrigger id="goal-assignee">
                <SelectValue placeholder={usersLoading ? 'Carregando equipe...' : 'Selecione um colaborador'} />
              </SelectTrigger>
              <SelectContent>
                {collaborators.map((user) => (
                  <SelectItem key={user.user_id} value={user.user_id}>
                    {user.display_name || user.email || user.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-date">Data da tarefa · horário de Brasília</Label>
            <Input id="goal-date" type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      {usersError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Não foi possível carregar os colaboradores.
          <Button variant="outline" size="sm" onClick={() => void refetchUsers()}>Tentar novamente</Button>
        </div>
      )}

      {assigneeId && taskDate && (
        <Card className="border-border/30">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <UserRound className="h-4 w-4 text-electric" />
                  {selected?.display_name || selected?.email || 'Colaborador'}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDateKey(taskDate)}
                  {historical && <Badge variant="outline" className="ml-1 h-5 text-[10px]">Histórico preservado</Badge>}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Atualizar tarefas" disabled={goals.refreshing} onClick={() => void goals.refetch()}>
                <RefreshCw className={cn('h-4 w-4', goals.refreshing && 'animate-spin')} />
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Progress value={progress} className="h-2 flex-1" />
              <span className="text-xs tabular-nums text-muted-foreground">{completed}/{goals.tasks.length} · {progress}%</span>
            </div>

            {!historical && (
              <form onSubmit={addTask} className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label="Nova tarefa diária"
                  maxLength={280}
                  value={newTask}
                  onChange={(event) => setNewTask(event.target.value)}
                  placeholder="Escreva uma tarefa e adicione ao checklist"
                />
                <Button type="submit" disabled={saving || !sanitizePlainText(newTask, 280)} className="shrink-0 bg-gradient-ember text-white">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Adicionar tarefa
                </Button>
              </form>
            )}

            {goals.error && (
              <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                Não foi possível carregar as tarefas: {errorMessage(goals.error)}
              </p>
            )}

            {goals.loading ? (
              <div className="space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
            ) : goals.tasks.length ? (
              <div className="space-y-2">
                {goals.tasks.map((task) => (
                  <article key={task.id} className="flex items-start gap-3 rounded-lg border border-border/40 p-3">
                    <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', task.is_completed ? 'text-success' : 'text-muted-foreground/40')} />
                    <div className="min-w-0 flex-1">
                      <p className={cn('break-words text-sm text-foreground', task.is_completed && 'text-muted-foreground line-through')}>
                        {safePlainText(task.title, 280)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{task.is_completed ? 'Concluída pelo colaborador' : 'Pendente'}</p>
                    </div>
                    {!historical && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${safePlainText(task.title, 280)}`} disabled={saving} onClick={() => { setEditing(task); setEditTitle(task.title) }}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Remover ${safePlainText(task.title, 280)}`} disabled={saving} onClick={() => void remove(task)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/50 p-8 text-center">
                <p className="text-sm text-muted-foreground">Nenhuma tarefa cadastrada para esta data.</p>
                {!historical && <p className="mt-1 text-xs text-muted-foreground/70">Adicione a primeira tarefa acima.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !saving) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar tarefa diária</DialogTitle>
            <DialogDescription>A alteração será registrada e sincronizada com o colaborador.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit-daily-task">Tarefa</Label>
            <Input id="edit-daily-task" maxLength={280} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancelar</Button>
            <Button disabled={saving || !sanitizePlainText(editTitle, 280)} onClick={() => void saveEdit()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar alteração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
