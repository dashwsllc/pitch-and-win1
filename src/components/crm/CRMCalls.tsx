import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CRMActivity, CRMLead, CALL_OUTCOMES, useCRMAssignees, useCRMActivities } from '@/hooks/useCRM'
import { useRoles } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'
import { callDate } from '@/lib/crm'
import { errorMessage } from '@/lib/sales'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'

const temperatureColors: Record<string, string> = {
  frio: 'bg-slate-500/15 text-slate-300',
  morno: 'bg-yellow-600/15 text-yellow-500',
  quente: 'bg-orange-600/15 text-orange-400'
}
export function CRMTemperature({ lead, onChange }: { lead: CRMLead; onChange?: (value: string) => void }) {
  return onChange ? (
    <select
      aria-label={`Temperatura de ${lead.name}`}
      className={`rounded border px-2 py-1 text-sm ${temperatureColors[lead.temperature]}`}
      value={lead.temperature}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="frio">Frio</option>
      <option value="morno">Morno</option>
      <option value="quente">Quente</option>
    </select>
  ) : (
    <Badge className={temperatureColors[lead.temperature]}>{lead.temperature}</Badge>
  )
}

export function CRMCallScheduler({
  lead,
  call,
  onClose
}: {
  lead: CRMLead
  call?: CRMActivity
  onClose: () => void
}) {
  const { user } = useAuth()
  const assignees = useCRMAssignees()
  const client = useQueryClient()
  const { toast } = useToast()
  const [type, setType] = useState(call?.call_type || 'qualificacao')
  const [assigned, setAssigned] = useState(call?.assigned_to || user?.id || '')
  const [when, setWhen] = useState(() => {
    if (!call?.scheduled_at) return ''
    const date = new Date(call.scheduled_at)
    return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })
  const [context, setContext] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const candidates = (assignees.data || [])
    .filter((a) => [type === 'qualificacao' ? 'sdr' : 'closer', 'executive', 'super_admin'].includes(a.role))
    .filter((a, i, all) => all.findIndex((b) => b.user_id === a.user_id) === i)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!when || !Number.isFinite(+new Date(when)) || new Date(when) <= new Date()) {
      setFailure('Escolha um horário futuro.')
      return
    }
    setSaving(true)
    setFailure('')
    try {
      const { error } = call
        ? await supabase.rpc('reschedule_crm_call', {
            p_activity_id: call.id,
            p_scheduled_at: new Date(when).toISOString(),
            p_expected_revision: call.updated_at
          })
        : await supabase.rpc('schedule_closer_call', {
            p_lead_id: lead.id,
            p_call_type: type,
            p_assigned_to: assigned,
            p_scheduled_at: new Date(when).toISOString(),
            p_context: context
          })
      if (error) throw error
      await client.invalidateQueries({ queryKey: ['crm'] })
      toast({ title: call ? 'Call reagendada' : 'Call agendada' })
      onClose()
    } catch (error) {
      setFailure(errorMessage(error))
      void client.invalidateQueries({ queryKey: ['crm'] })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{call ? 'Reagendar call' : 'Agendar call'}</DialogTitle>
          <DialogDescription>
            {lead.athlete_name || 'Atleta não informado'} · {lead.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {!call && (
            <>
              <div className="space-y-2">
                <Label htmlFor="call-type">Tipo da call</Label>
                <select
                  id="call-type"
                  className="w-full h-10 rounded border bg-background px-3"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value)
                    setAssigned('')
                  }}
                >
                  <option value="qualificacao">Qualificação</option>
                  <option value="fechamento_closer">Fechamento com Closer</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="call-assignee">Responsável</Label>
                <select
                  id="call-assignee"
                  required
                  className="w-full h-10 rounded border bg-background px-3"
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Selecionar</option>
                  {candidates.map((a) => (
                    <option value={a.user_id} key={a.user_id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
                {assignees.isError && <p role="alert">Não foi possível carregar os responsáveis.</p>}
                {!assignees.isPending && !assignees.isError && !candidates.length && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum usuário com a função e o acesso CRM necessários.
                  </p>
                )}
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="call-when">Data e hora (horário local)</Label>
            <Input
              id="call-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </div>
          {!call && (
            <div className="space-y-2">
              <Label htmlFor="call-context">Contexto da reunião</Label>
              <Textarea
                id="call-context"
                maxLength={10000}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Participantes e informações para a call"
              />
            </div>
          )}
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              disabled={
                saving ||
                (!call &&
                  (assignees.isPending ||
                    assignees.isError ||
                    !candidates.some((a) => a.user_id === assigned)))
              }
            >
              {saving ? 'Salvando...' : call ? 'Salvar horário' : 'Agendar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CRMCallList({
  calls,
  leads,
  onOpenLead
}: {
  calls: CRMActivity[]
  leads: CRMLead[]
  onOpenLead?: (lead: CRMLead) => void
}) {
  const { user } = useAuth()
  const { roles, isExecutive } = useRoles()
  const client = useQueryClient()
  const assignees = useCRMAssignees()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [reschedule, setReschedule] = useState<CRMActivity | null>(null)
  const [resolution, setResolution] = useState<{ call: CRMActivity; outcome: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(new Date())
  const [won, setWon] = useState<CRMLead | null>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  const resolve = async () => {
    if (!resolution || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('resolve_closer_call', {
        p_activity_id: resolution.call.id,
        p_outcome: resolution.outcome,
        p_expected_revision: resolution.call.updated_at
      })
      if (error) throw error
      if (resolution.outcome === 'venda_concluida')
        setWon(leads.find((l) => l.id === resolution.call.lead_id) || null)
      toast({ title: CALL_OUTCOMES[resolution.outcome] })
      setResolution(null)
    } catch (error) {
      toast({ title: 'Não foi possível concluir', description: errorMessage(error), variant: 'destructive' })
      setResolution(null)
    } finally {
      await client.invalidateQueries({ queryKey: ['crm'] })
      setBusy(false)
    }
  }
  const rescheduleLead = leads.find((l) => l.id === reschedule?.lead_id)
  return (
    <div className="space-y-3">
      {won && (
        <div role="status" className="rounded-lg border border-primary/40 bg-primary/10 p-4 space-y-3">
          <p className="font-semibold">Fechou. Bola pra frente, a próxima venda é sempre a melhor.</p>
          <p className="text-sm">Registre essa venda no módulo Vendas pra fechar o ciclo.</p>
          <Button onClick={() => navigate(`/vendas?lead=${won.id}`)}>Registrar venda de {won.name}</Button>
        </div>
      )}
      {!calls.length && <p className="text-sm text-muted-foreground py-4">Nenhuma call nesta lista.</p>}
      {calls.map((call) => {
        const lead = leads.find((l) => l.id === call.lead_id)
        if (!lead) return null
        const past = !call.is_completed && !!call.scheduled_at && new Date(call.scheduled_at) < now
        const today = !!call.scheduled_at && new Date(call.scheduled_at).toDateString() === now.toDateString()
        const canResolve =
          !call.is_completed &&
          (isExecutive ||
            (call.assigned_to === user?.id &&
              roles.includes(call.call_type === 'qualificacao' ? 'sdr' : 'closer')))
        const outcomes =
          call.call_type === 'qualificacao'
            ? ['avancou', 'lead_perdido']
            : ['venda_concluida', 'venda_perdida', 'devolvido_sdr']
        return (
          <article
            key={call.id}
            className={`rounded-lg border p-4 space-y-3 ${past ? 'border-amber-600/60 bg-amber-600/10' : today ? 'border-primary/50 bg-primary/5' : 'border-border'}`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <button
                  className="font-semibold text-left hover:underline"
                  onClick={() => onOpenLead?.(lead)}
                >
                  {lead.athlete_name || 'Atleta não informado'}
                </button>
                <p className="text-sm text-muted-foreground">Responsável: {lead.name}</p>
              </div>
              <CRMTemperature lead={lead} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{call.title}</Badge>
              {call.is_completed ? (
                <Badge variant="secondary">{CALL_OUTCOMES[call.outcome || ''] || call.outcome}</Badge>
              ) : (
                <Badge variant="outline">
                  {past ? 'Atrasada · atualizar resultado' : today ? 'Hoje' : 'Agendada'}
                </Badge>
              )}
            </div>
            <p className="text-sm">
              {callDate(call.scheduled_at)} ·{' '}
              {assignees.data?.find((a) => a.user_id === call.assigned_to)?.display_name ||
                call.assigned_to ||
                'Sem responsável'}
            </p>
            {call.description && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{call.description}</p>
            )}
            {lead.performance_report_url && /^https:\/\//.test(lead.performance_report_url) ? (
              <a
                href={lead.performance_report_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline"
              >
                Abrir relatório de performance
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">Relatório ainda não informado</p>
            )}
            <div className="flex gap-2 flex-wrap">
              {!call.is_completed && (isExecutive || roles.includes('sdr')) && (
                <Button variant="outline" size="sm" onClick={() => setReschedule(call)}>
                  Reagendar
                </Button>
              )}
              {canResolve &&
                outcomes.map((outcome) => (
                  <Button
                    key={outcome}
                    size="sm"
                    variant={outcome === 'venda_concluida' ? 'default' : 'outline'}
                    onClick={() => setResolution({ call, outcome })}
                  >
                    {CALL_OUTCOMES[outcome]}
                  </Button>
                ))}
              {call.outcome === 'venda_concluida' && (
                <Button size="sm" onClick={() => navigate(`/vendas?lead=${lead.id}`)}>
                  Ir para Nova Venda
                </Button>
              )}
            </div>
          </article>
        )
      })}
      {reschedule && rescheduleLead && (
        <CRMCallScheduler lead={rescheduleLead} call={reschedule} onClose={() => setReschedule(null)} />
      )}
      <Dialog
        open={!!resolution}
        onOpenChange={(open) => {
          if (!open && !busy) setResolution(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar resultado</DialogTitle>
            <DialogDescription>
              {resolution && CALL_OUTCOMES[resolution.outcome]}. Esse resultado encerra a call e atualiza o
              pipeline do lead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolution(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={resolve} disabled={busy}>
              {busy ? 'Salvando...' : 'Confirmar resultado'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CRMDepartment({
  mode,
  leads,
  onOpenLead,
  onTemperature
}: {
  mode: 'sdr' | 'closer'
  leads: CRMLead[]
  onOpenLead: (lead: CRMLead) => void
  onTemperature: (lead: CRMLead, value: string) => void
}) {
  const { activities, loading, error, fetchActivities } = useCRMActivities(null, true)
  const [search, setSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const matching = leads.filter((l) =>
    `${l.name} ${l.athlete_name || ''}`.toLowerCase().includes(search.toLowerCase())
  )
  const calls = activities
    .filter((c) => matching.some((l) => l.id === c.lead_id) && (showHistory || !c.is_completed))
    .sort(
      (a, b) =>
        Number(a.is_completed) - Number(b.is_completed) ||
        Date.parse(a.scheduled_at || '') - Date.parse(b.scheduled_at || '')
    )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between">
        <Input
          aria-label="Buscar responsável ou atleta"
          placeholder="Buscar responsável ou atleta"
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Incluir calls realizadas
        </label>
      </div>
      {error && (
        <div role="alert">
          Não foi possível carregar as calls.{' '}
          <Button variant="outline" onClick={() => fetchActivities()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {loading && <p role="status">Carregando calls...</p>}
      {!error && !loading && (
        <>
          {mode === 'sdr' && (
            <div className="grid gap-3 md:grid-cols-2">
              {matching
                .filter(
                  (l) =>
                    !['repassado_closer', 'fechado_ganho', 'fechado_perdido', 'lead_perdido'].includes(
                      l.pipeline_stage
                    )
                )
                .map((lead) => {
                  const next = activities
                    .filter((c) => c.lead_id === lead.id && !c.is_completed)
                    .sort((a, b) => Date.parse(a.scheduled_at || '') - Date.parse(b.scheduled_at || ''))[0]
                  return (
                    <article className="rounded-lg border p-4 space-y-2" key={lead.id}>
                      <button
                        className="font-semibold text-left hover:underline"
                        onClick={() => onOpenLead(lead)}
                      >
                        {lead.athlete_name || 'Completar dados do atleta'}
                      </button>
                      <p className="text-sm text-muted-foreground">{lead.name}</p>
                      <CRMTemperature lead={lead} onChange={(value) => onTemperature(lead, value)} />
                      <p className="text-sm">
                        {next ? `Próxima call: ${callDate(next.scheduled_at)}` : 'Sem call agendada'}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => onOpenLead(lead)}>
                        Abrir ficha / agendar
                      </Button>
                    </article>
                  )
                })}
            </div>
          )}
          <h2 className="font-semibold">
            {mode === 'sdr' ? 'Calls de qualificação' : 'Calls de fechamento'}
          </h2>
          <CRMCallList
            calls={calls.filter(
              (c) => c.call_type === (mode === 'sdr' ? 'qualificacao' : 'fechamento_closer')
            )}
            leads={matching}
            onOpenLead={onOpenLead}
          />
          {mode === 'sdr' && (
            <>
              <h2 className="font-semibold">Repasses para Closer · acompanhamento</h2>
              <CRMCallList
                calls={calls.filter((c) => c.call_type === 'fechamento_closer')}
                leads={matching}
                onOpenLead={onOpenLead}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
