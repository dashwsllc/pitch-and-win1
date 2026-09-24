import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { useArenaAssignees } from '@/hooks/useArena'
import { useLiveClock } from '@/hooks/useLiveClock'
import { arenaRpc } from '@/lib/arena-api'
import { brasiliaLocalInputToIso, formatBrasiliaDate, isoToBrasiliaLocalInput } from '@/lib/brasilia-time'
import { progressPercent } from '@/lib/arena'
import { errorMessage } from '@/lib/sales'
import { refreshDashboardMutation } from '@/lib/sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ShiftGoal = {
  id: string
  assignee_id: string
  display_name: string
  title: string
  target_approaches: number
  approach_source: 'crm' | 'manual'
  actual: number
  starts_at: string
  ends_at: string
  created_at: string
  cancelled_at: string | null
}

function defaultStart(date: string) {
  const now = isoToBrasiliaLocalInput(new Date().toISOString())
  return date === now.slice(0, 10) ? now : `${date}T09:00`
}

const formatShiftTime = (value: Date | string | number) => formatBrasiliaDate(value, {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function ShiftApproachGoals({ date, person = '', management = false }: {
  date: string
  person?: string
  management?: boolean
}) {
  const { user } = useAuth()
  const { isExecutive } = useRoles()
  const assignees = useArenaAssignees()
  const client = useQueryClient()
  const now = useLiveClock(30_000)
  const [page, setPage] = useState(0)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('50')
  const [duration, setDuration] = useState('480')
  const [source, setSource] = useState<'crm' | 'manual'>('crm')
  const [start, setStart] = useState(() => defaultStart(date))
  const [selectedPerson, setSelectedPerson] = useState(person)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState<ShiftGoal | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => { setStart(defaultStart(date)); setPage(0) }, [date])
  useEffect(() => { setPage(0); setSelectedPerson(person) }, [person])
  const query = useQuery({
    queryKey: ['shift-approach-goals', user?.id, isExecutive && management, date, isExecutive && management ? person : user?.id, page],
    enabled: !!user && !!date,
    queryFn: () => arenaRpc<ShiftGoal[]>('arena_shift_approach_progress', {
      p_day: date,
      p_person: isExecutive && management ? person || null : user!.id,
      p_offset: page * 50,
    }),
  })

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const startsAt = brasiliaLocalInputToIso(start)
    const targetCount = Number(target)
    const durationMinutes = Number(duration)
    if (!startsAt || !Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100000
      || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440
      || !selectedPerson) {
      toast.error('Informe início, duração, quantidade e destinatários válidos.')
      return
    }
    setBusy(true)
    try {
      const count = await arenaRpc<number>('arena_create_shift_approach_goals', {
        p_title: title.trim(),
        p_people: [selectedPerson],
        p_roles: [],
        p_starts_at: startsAt,
        p_duration_minutes: durationMinutes,
        p_target_approaches: targetCount,
        p_source: source,
      })
      setTitle('')
      await refreshDashboardMutation(client)
      toast.success(`Meta de turno atribuída a ${count} colaborador${count === 1 ? '' : 'es'}`)
    } catch (cause) {
      toast.error(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!cancelling || reason.trim().length < 5 || busy) return
    setBusy(true)
    try {
      await arenaRpc('arena_cancel_shift_approach_goal', { p_id: cancelling.id, p_reason: reason.trim() })
      setCancelling(null)
      setReason('')
      await refreshDashboardMutation(client)
      toast.success('Meta de turno cancelada e registrada na auditoria')
    } catch (cause) {
      toast.error(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4" aria-label="Metas de abordagens por turno">
      <div>
        <h2 className="text-lg">Metas de abordagens por turno</h2>
        <p className="text-sm text-muted-foreground">Contagem automática somente para o colaborador responsável, dentro do turno e na fonte escolhida pelo Executive.</p>
      </div>
      {management && isExecutive && (
        <form onSubmit={create} className="surface-panel space-y-4 rounded-xl p-5">
          <h3 className="font-medium">Definir meta e duração</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label htmlFor="shift-title">Tarefa</Label><Input id="shift-title" required minLength={2} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Abordar leads da lista" /></div>
            <div><Label htmlFor="shift-target">Quantidade de abordagens</Label><Input id="shift-target" type="number" required min={1} max={100000} step={1} value={target} onChange={(event) => setTarget(event.target.value)} /></div>
            <div><Label htmlFor="shift-start">Início do turno · Brasília</Label><Input id="shift-start" type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></div>
            <div><Label htmlFor="shift-duration">Duração em minutos (até 24 horas)</Label><Input id="shift-duration" type="number" required min={1} max={1440} step={1} value={duration} onChange={(event) => setDuration(event.target.value)} /></div>
            <div><Label htmlFor="shift-source">Fonte das abordagens</Label><select id="shift-source" className="mt-2 h-10 w-full rounded-lg border bg-background px-3" value={source} onChange={(event) => setSource(event.target.value as 'crm' | 'manual')}><option value="crm">CRM</option><option value="manual">Registros de Abordagens</option></select></div>
          </div>
          {brasiliaLocalInputToIso(start) && Number(duration) > 0 && Number(duration) <= 1440 && (
            <p className="text-xs text-muted-foreground">Fim previsto: {formatShiftTime(Date.parse(brasiliaLocalInputToIso(start)!) + Number(duration) * 60_000)}</p>
          )}
          <div><Label htmlFor="shift-person">Colaborador específico</Label><select id="shift-person" required className="mt-2 h-10 w-full rounded-lg border bg-background px-3" value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)}><option value="">Selecione uma pessoa</option>{assignees.data?.filter((candidate) => !candidate.suspended).map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.display_name}</option>)}</select></div>
          <Button disabled={busy || !selectedPerson}>Atribuir meta de turno</Button>
        </form>
      )}
      {query.isError && <p role="alert" className="text-destructive">{errorMessage(query.error)}</p>}
      <div className="space-y-3">
        {query.data?.map((goal) => {
          const percentage = progressPercent(goal.actual, goal.target_approaches)
          const status = goal.cancelled_at ? 'Cancelada' : now.getTime() < Date.parse(goal.starts_at) ? 'Programada' : now.getTime() >= Date.parse(goal.ends_at) ? 'Encerrada' : 'Em andamento'
          return <article key={goal.id} className="surface-panel space-y-3 rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium">{goal.title}</h3><p className="text-xs text-muted-foreground">{isExecutive && management ? `${goal.display_name} · ` : ''}{status} · {formatShiftTime(goal.starts_at)} → {formatShiftTime(goal.ends_at)}</p><p className="text-xs text-muted-foreground">Fonte: {goal.approach_source === 'crm' ? 'CRM' : 'Registros de Abordagens'}</p></div>{management && isExecutive && !goal.cancelled_at && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setCancelling(goal); setReason('') }}>Cancelar</Button>}</div>
            <div className="flex items-center gap-3"><Progress value={Math.min(100, Math.max(0, percentage))} className="h-2 flex-1" aria-label={`${percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da meta de abordagens`} /><span className="text-sm tabular-nums">{goal.actual}/{goal.target_approaches} · {percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></div>
          </article>
        })}
        {!query.isLoading && !query.isError && !query.data?.length && <p className="text-sm text-muted-foreground">Nenhuma meta de turno para esta seleção.</p>}
      </div>
      {(page > 0 || (query.data?.length ?? 0) === 50) && <div className="flex justify-end gap-2"><Button variant="outline" disabled={!page} onClick={() => setPage((value) => value - 1)}>Anterior</Button><Button variant="outline" disabled={(query.data?.length ?? 0) < 50} onClick={() => setPage((value) => value + 1)}>Próxima</Button></div>}
      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open && !busy) setCancelling(null) }}>
        <DialogContent><DialogHeader><DialogTitle>Cancelar meta de turno?</DialogTitle><DialogDescription>A ação será registrada e o colaborador será avisado.</DialogDescription></DialogHeader><Label htmlFor="shift-cancel-reason">Motivo</Label><Input id="shift-cancel-reason" minLength={5} value={reason} onChange={(event) => setReason(event.target.value)} /><Button disabled={busy || reason.trim().length < 5} variant="destructive" onClick={() => void cancel()}>Confirmar cancelamento</Button></DialogContent>
      </Dialog>
    </section>
  )
}
