import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { CRMLead, PIPELINE_STAGES, useCRMActivities } from '@/hooks/useCRM'
import { useAuth } from '@/hooks/useAuth'
import { useRoles } from '@/hooks/useRoles'
import { useToast } from '@/hooks/use-toast'
import { errorMessage } from '@/lib/sales'
import { CRMContactFields } from './CRMContactFields'
import { contactFromLead, contactPayload, validateContact, callDate } from '@/lib/crm'
import { CRMCallList, CRMCallScheduler, CRMTemperature } from './CRMCalls'

interface Props {
  lead: CRMLead
  onClose: () => void
  onUpdate: (updates: Partial<CRMLead>) => Promise<void>
  isExecutive: boolean
}
export function CRMLeadDetail({ lead, onClose, onUpdate, isExecutive }: Props) {
  const { user } = useAuth()
  const { roles } = useRoles()
  const { toast } = useToast()
  const { activities, loading, error, createActivity } = useCRMActivities(lead.id)
  const [contact, setContact] = useState(() => contactFromLead(lead))
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [schedule, setSchedule] = useState(false)
  const reportError = (error: unknown) =>
    toast({ title: 'Não foi possível salvar', description: errorMessage(error), variant: 'destructive' })
  const saveContact = async () => {
    const invalid = validateContact(contact)
    if (invalid) {
      toast({ title: invalid, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await onUpdate(contactPayload(contact))
      setEditing(false)
      toast({ title: 'Cadastro atualizado' })
    } catch (error) {
      reportError(error)
    } finally {
      setSaving(false)
    }
  }
  const addNote = async () => {
    if (!note.trim() || !user || saving) return
    setSaving(true)
    try {
      await createActivity({
        lead_id: lead.id,
        user_id: user.id,
        activity_type: 'contexto_vida',
        title: 'Contexto de vida',
        description: note.trim()
      })
      setNote('')
      toast({ title: 'Contexto registrado' })
    } catch (error) {
      reportError(error)
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <SheetContent className="w-full sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{lead.athlete_name || lead.name}</SheetTitle>
            <SheetDescription>Responsável: {lead.name}</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 mt-6">
            <div className="flex flex-wrap gap-3 justify-between">
              <CRMTemperature
                lead={lead}
                onChange={(temperature) => {
                  void onUpdate({ temperature }).catch(reportError)
                }}
              />
              <span className="text-sm">
                {PIPELINE_STAGES.find((s) => s.value === lead.pipeline_stage)?.label || lead.pipeline_stage}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-priority">Prioridade</Label>
              <select
                id="lead-priority"
                className="h-10 w-full rounded border bg-background px-3"
                value={lead.priority}
                onChange={(e) => {
                  void onUpdate({ priority: e.target.value }).catch(reportError)
                }}
              >
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            {editing ? (
              <>
                <CRMContactFields value={contact} onChange={setContact} prefix="edit-lead" />
                <div className="flex gap-2">
                  <Button onClick={saveContact} disabled={saving}>
                    Salvar cadastro
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                    Cancelar
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-2 text-sm">
                <p>WhatsApp: {lead.phone || 'Não informado'}</p>
                <p>E-mail: {lead.email || 'Não informado'}</p>
                <p>Cidade / UF: {lead.city_state || 'Não informada'}</p>
                <p>
                  Nascimento:{' '}
                  {lead.athlete_birth_date
                    ? new Date(`${lead.athlete_birth_date}T12:00:00`).toLocaleDateString('pt-BR')
                    : 'Não informado'}{' '}
                  · Posição: {lead.athlete_position || 'Não informada'}
                </p>
                <p>
                  Altura: {lead.athlete_height_cm ? `${lead.athlete_height_cm} cm` : 'Não informada'} · Peso:{' '}
                  {lead.athlete_weight_kg ? `${lead.athlete_weight_kg} kg` : 'Não informado'}
                </p>
                {lead.performance_report_url && /^https:\/\//.test(lead.performance_report_url) && (
                  <a
                    className="text-primary underline block"
                    href={lead.performance_report_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir relatório de performance
                  </a>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setContact(contactFromLead(lead))
                    setEditing(true)
                  }}
                >
                  Editar cadastro
                </Button>
              </div>
            )}
            <section className="space-y-3 border-t pt-4">
              <h2 className="font-semibold">Contexto de vida</h2>
              {lead.observations && (
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Observações anteriores · preservadas</p>
                  <p className="whitespace-pre-wrap text-sm">{lead.observations}</p>
                </div>
              )}
              <Label htmlFor="crm-new-context">Nova anotação</Label>
              <Textarea
                id="crm-new-context"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={10000}
                placeholder="Acrescente contexto sem apagar o histórico"
              />
              <Button onClick={addNote} disabled={saving || !note.trim()}>
                Adicionar contexto
              </Button>
              {error && (
                <p role="alert" className="text-destructive">
                  Não foi possível carregar o histórico.
                </p>
              )}
              {loading && <p role="status">Carregando histórico...</p>}
              {activities
                .filter((a) => !a.call_type)
                .map((a) => (
                  <article key={a.id} className="rounded border p-3 space-y-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-sm whitespace-pre-wrap">{a.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.author_name || a.user_id} · {callDate(a.created_at)}
                    </p>
                    {a.outcome && <p className="text-xs">{a.outcome}</p>}
                  </article>
                ))}
            </section>
            <section className="space-y-3 border-t pt-4">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold">Histórico de calls</h2>
                {(isExecutive || roles.includes('sdr')) &&
                  !['fechado_ganho', 'fechado_perdido', 'lead_perdido'].includes(lead.pipeline_stage) && (
                    <Button
                      size="sm"
                      onClick={() => setSchedule(true)}
                      disabled={loading || !!error || activities.some((a) => a.call_type && !a.is_completed)}
                    >
                      Agendar call
                    </Button>
                  )}
              </div>
              <CRMCallList calls={activities.filter((a) => !!a.call_type)} leads={[lead]} />
            </section>
          </div>
        </SheetContent>
      </Sheet>
      {schedule && <CRMCallScheduler lead={lead} onClose={() => setSchedule(false)} />}
    </>
  )
}
