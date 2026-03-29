import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Mail, Phone, Linkedin, Plus } from 'lucide-react'
import { CRMLead, PIPELINE_STAGES, ACTIVITY_TYPES, useCRMActivities } from '@/hooks/useCRM'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

interface Props {
  lead: CRMLead
  onClose: () => void
  onUpdate: (updates: Partial<CRMLead>) => Promise<void>
  isExecutive: boolean
}

export function CRMLeadDetail({ lead, onClose, onUpdate, isExecutive }: Props) {
  const { user } = useAuth()
  const { toast } = useToast()
  const { activities, createActivity } = useCRMActivities(lead.id)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [activityForm, setActivityForm] = useState({
    activity_type: 'nota', title: '', description: '', outcome: ''
  })
  const [savingActivity, setSavingActivity] = useState(false)
  const [observations, setObservations] = useState(lead.observations || '')

  const handleSaveObservations = async () => {
    await onUpdate({
      observations,
      observations_updated_at: new Date().toISOString(),
      observations_updated_by: user?.id,
    } as any)
    toast({ title: 'Observações salvas' })
  }

  const handleCreateActivity = async () => {
    if (!activityForm.title.trim()) {
      toast({ title: 'Título obrigatório', variant: 'destructive' })
      return
    }
    setSavingActivity(true)
    try {
      await createActivity({
        lead_id: lead.id,
        user_id: user?.id || '',
        activity_type: activityForm.activity_type,
        title: activityForm.title,
        description: activityForm.description || null,
        outcome: activityForm.outcome || null,
      })
      toast({ title: 'Atividade registrada!' })
      setShowActivityModal(false)
      setActivityForm({ activity_type: 'nota', title: '', description: '', outcome: '' })
    } catch {
      toast({ title: 'Erro ao registrar atividade', variant: 'destructive' })
    } finally {
      setSavingActivity(false)
    }
  }

  const tempColors: Record<string, string> = {
    frio: 'border-blue-500 bg-blue-500/10',
    morno: 'border-orange-500 bg-orange-500/10',
    quente: 'border-red-500 bg-red-500/10',
  }

  return (
    <>
      <Sheet open={!!lead} onOpenChange={() => onClose()}>
        <SheetContent className="w-full sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-xl">{lead.name}</SheetTitle>
          </SheetHeader>

          <div className="space-y-6 mt-6">
            {/* Contact Info */}
            <div className="space-y-2">
              {lead.job_title && <p className="text-sm text-muted-foreground">{lead.job_title}{lead.company ? ` • ${lead.company}` : ''}</p>}
              <div className="flex flex-wrap gap-2">
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="text-sm text-primary flex items-center gap-1 hover:underline">
                    <Mail className="w-3.5 h-3.5" /> {lead.email}
                  </a>
                )}
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> {lead.phone}
                  </a>
                )}
                {lead.linkedin_url && (
                  <a href={lead.linkedin_url} target="_blank" rel="noopener" className="text-sm text-primary flex items-center gap-1 hover:underline">
                    <Linkedin className="w-3.5 h-3.5" /> LinkedIn
                  </a>
                )}
              </div>
            </div>

            <Separator />

            {/* Temperature */}
            <div className="space-y-2">
              <Label>Temperatura</Label>
              <div className="flex gap-2">
                {(['frio', 'morno', 'quente'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => onUpdate({ temperature: t })}
                    className={`flex-1 p-3 rounded-lg border-2 text-center text-sm font-medium transition-all ${
                      lead.temperature === t ? tempColors[t] : 'border-border/50 opacity-50 hover:opacity-75'
                    }`}
                  >
                    {t === 'frio' ? '❄️ Frio' : t === 'morno' ? '🌡️ Morno' : '🔥 Quente'}
                  </button>
                ))}
              </div>
            </div>

            {/* Pipeline */}
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={lead.pipeline_stage} onValueChange={v => onUpdate({ pipeline_stage: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <div className="flex gap-2">
                {(['baixa', 'normal', 'alta', 'urgente'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => onUpdate({ priority: p })}
                    className={`flex-1 p-2 rounded text-xs font-medium border transition-all ${
                      lead.priority === p
                        ? p === 'urgente' ? 'bg-red-500/20 border-red-500 text-red-400'
                        : p === 'alta' ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                        : p === 'normal' ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                        : 'bg-muted border-border text-muted-foreground'
                        : 'border-border/50 opacity-50'
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Observations */}
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={observations}
                onChange={e => setObservations(e.target.value)}
                rows={4}
                placeholder="Anotações sobre o lead..."
              />
              <Button size="sm" variant="outline" onClick={handleSaveObservations}>Salvar observações</Button>
            </div>

            <Separator />

            {/* Activities */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Atividades</Label>
                <Button size="sm" variant="outline" onClick={() => setShowActivityModal(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Nova
                </Button>
              </div>

              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma atividade registrada</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {activities.map(act => (
                    <div key={act.id} className={`p-3 rounded-lg border ${act.is_pinned ? 'border-primary/30 bg-primary/5' : 'border-border/50'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{act.activity_type}</Badge>
                        {act.is_pinned && <span className="text-xs">📌</span>}
                        {act.outcome && (
                          <Badge className={`text-xs ${
                            act.outcome === 'positivo' ? 'bg-green-500/20 text-green-400' :
                            act.outcome === 'negativo' ? 'bg-red-500/20 text-red-400' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {act.outcome}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground">{act.title}</p>
                      {act.description && <p className="text-xs text-muted-foreground mt-1">{act.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(act.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Activity Modal */}
      <Dialog open={showActivityModal} onOpenChange={setShowActivityModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Atividade</DialogTitle>
            <DialogDescription>Adicione uma nova atividade para {lead.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={activityForm.activity_type} onValueChange={v => setActivityForm(f => ({ ...f, activity_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input value={activityForm.title} onChange={e => setActivityForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={activityForm.description} onChange={e => setActivityForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Resultado</Label>
              <Select value={activityForm.outcome} onValueChange={v => setActivityForm(f => ({ ...f, outcome: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="positivo">Positivo</SelectItem>
                  <SelectItem value="neutro">Neutro</SelectItem>
                  <SelectItem value="negativo">Negativo</SelectItem>
                  <SelectItem value="sem_resposta">Sem resposta</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActivityModal(false)}>Cancelar</Button>
            <Button onClick={handleCreateActivity} disabled={savingActivity} className="bg-gradient-primary hover:opacity-90">
              {savingActivity ? 'Salvando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
