import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { useGoals, useGoalsManagement } from '@/hooks/useGoals'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Plus, Target, Trash2, Edit2, Calendar, DollarSign, Hash, CheckCircle2, XCircle, CalendarDays, CalendarRange, Loader2 } from 'lucide-react'

export function ExecutiveGoalsManagement() {
  const { goals, loading, refetch } = useGoals(true)
  const { createGoal, updateGoal, deleteGoal, saving } = useGoalsManagement()
  const { toast } = useToast()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  // Form state
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formTarget, setFormTarget] = useState('')
  const [formPeriod, setFormPeriod] = useState('daily')
  const [formUnit, setFormUnit] = useState('currency')
  const [formDeadline, setFormDeadline] = useState('')

  const resetForm = () => {
    setFormTitle('')
    setFormDescription('')
    setFormTarget('')
    setFormPeriod('daily')
    setFormUnit('currency')
    setFormDeadline('')
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!formTitle || !formTarget) {
      toast({ title: 'Erro', description: 'Preencha título e valor alvo', variant: 'destructive' })
      return
    }

    try {
      await createGoal({
        title: formTitle,
        description: formDescription || undefined,
        target: parseFloat(formTarget),
        period: formPeriod,
        unit: formUnit,
        deadline: formDeadline || undefined,
      })
      toast({ title: 'Meta criada!', description: `Meta "${formTitle}" criada com sucesso.` })
      resetForm()
      setIsCreateOpen(false)
      refetch()
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível criar a meta.', variant: 'destructive' })
    }
  }

  const handleToggleStatus = async (id: string, currentStatus: string | null) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
      await updateGoal(id, { status: newStatus })
      toast({ title: newStatus === 'active' ? 'Meta ativada' : 'Meta desativada' })
      refetch()
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível atualizar a meta.', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Excluir a meta "${title}"?`)) return
    try {
      await deleteGoal(id)
      toast({ title: 'Meta excluída', description: `Meta "${title}" foi removida.` })
      refetch()
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível excluir a meta.', variant: 'destructive' })
    }
  }

  const periodLabels: Record<string, string> = {
    daily: 'Diária',
    weekly: 'Semanal',
    monthly: 'Mensal',
  }

  const unitLabels: Record<string, string> = {
    currency: 'Valor (R$)',
    count: 'Quantidade',
    percentage: 'Percentual (%)',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Target className="w-5 h-5 text-ember" />
            Gerenciar Metas
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Defina metas diárias, semanais e mensais para a equipe de vendas
          </p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-ember text-white border-0 hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" />
              Nova Meta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Nova Meta</DialogTitle>
              <DialogDescription>Defina uma meta para a equipe alcançar</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Título da Meta *</Label>
                <Input 
                  placeholder="Ex: Meta de Vendas Diária" 
                  value={formTitle} 
                  onChange={e => setFormTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição (opcional)</Label>
                <Input 
                  placeholder="Descrição da meta" 
                  value={formDescription} 
                  onChange={e => setFormDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Valor Alvo *</Label>
                  <Input 
                    type="number" 
                    placeholder="10000" 
                    value={formTarget} 
                    onChange={e => setFormTarget(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Período</Label>
                  <Select value={formPeriod} onValueChange={setFormPeriod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diária</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Select value={formUnit} onValueChange={setFormUnit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="currency">Valor (R$)</SelectItem>
                      <SelectItem value="count">Quantidade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prazo (opcional)</Label>
                  <Input 
                    type="date" 
                    value={formDeadline} 
                    onChange={e => setFormDeadline(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                onClick={handleCreate} 
                disabled={saving || !formTitle || !formTarget}
                className="w-full bg-gradient-ember text-white border-0 hover:opacity-90"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Criar Meta
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Goals List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <Card className="border-dashed border-border/30">
          <CardContent className="p-12 text-center">
            <Target className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma meta criada</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Clique em "Nova Meta" para começar</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.map(goal => (
            <Card key={goal.id} className="border-border/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    {/* Progress circle mini */}
                    <div className="relative w-12 h-12">
                      <svg width={48} height={48} className="-rotate-90">
                        <circle cx={24} cy={24} r={20} strokeWidth={3} fill="none" className="stroke-border/30" />
                        <circle 
                          cx={24} cy={24} r={20} strokeWidth={3} fill="none" 
                          stroke={goal.isCompleted ? 'rgb(16, 185, 129)' : 'rgb(253, 137, 37)'}
                          strokeLinecap="round"
                          strokeDasharray={125.66}
                          strokeDashoffset={125.66 - (Math.min(goal.progress, 100) / 100) * 125.66}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-bold">{Math.round(Math.min(goal.progress, 100))}%</span>
                      </div>
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-foreground">{goal.title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {periodLabels[goal.period] || goal.period}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {unitLabels[goal.unit || 'currency'] || goal.unit}
                        </Badge>
                        {goal.status === 'active' ? (
                          <Badge className="bg-success/10 text-success border-success/20 text-xs">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Ativa
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <XCircle className="w-3 h-3 mr-1" /> Inativa
                          </Badge>
                        )}
                      </div>
                      {goal.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{goal.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>
                          Alvo: {goal.unit === 'count' ? goal.target : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(goal.target)}
                        </span>
                        <span>
                          Atual: {goal.unit === 'count' ? goal.current : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(goal.current)}
                        </span>
                        {goal.deadline && <span>Prazo: {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleStatus(goal.id, goal.status)}
                    >
                      {goal.status === 'active' ? (
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(goal.id, goal.title)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
