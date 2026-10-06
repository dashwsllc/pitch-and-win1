import { brasiliaLocalInputToIso, isoToBrasiliaLocalInput } from '@/lib/brasilia-time'

export type CallEditPlan =
  | { ok: true; assignedTo: string | null; scheduledAt: string | null }
  | { ok: false; reason: 'nothing' | 'invalid_time' | 'past_time' }

// O que de fato mudou numa call já agendada. Só os campos alterados seguem para o banco: assim trocar o
// responsável de uma call atrasada não exige inventar um horário novo, e quem só remarca não mexe no responsável.
// O horário é comparado como a pessoa o vê (minuto, Brasília): a call guarda segundos, o campo não.
export function planCallEdit(
  call: { assigned_to: string | null; scheduled_at: string | null },
  form: { assignedTo: string; when: string },
  now: number = Date.now(),
): CallEditPlan {
  const assigneeChanged = !!form.assignedTo && form.assignedTo !== call.assigned_to
  const timeChanged = form.when !== isoToBrasiliaLocalInput(call.scheduled_at)
  if (!assigneeChanged && !timeChanged) return { ok: false, reason: 'nothing' }
  let scheduledAt: string | null = null
  if (timeChanged) {
    scheduledAt = brasiliaLocalInputToIso(form.when)
    if (!scheduledAt) return { ok: false, reason: 'invalid_time' }
    if (Date.parse(scheduledAt) <= now) return { ok: false, reason: 'past_time' }
  }
  return { ok: true, assignedTo: assigneeChanged ? form.assignedTo : null, scheduledAt }
}

export function callEditToast(plan: { assignedTo: string | null; scheduledAt: string | null }) {
  if (plan.assignedTo && plan.scheduledAt) return 'Responsável e horário da call atualizados'
  return plan.assignedTo ? 'Responsável da call atualizado' : 'Call reagendada'
}
