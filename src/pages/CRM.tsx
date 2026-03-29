import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { 
  Plus, Search, Users, Flame, CalendarClock, AlertTriangle, 
  DollarSign, TrendingUp, Trash2, Edit, RefreshCw, Phone, Mail
} from 'lucide-react'
import { useCRMLeads, CRMLead, PIPELINE_STAGES, LEAD_SOURCES } from '@/hooks/useCRM'
import { useRoles } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { CRMLeadDetail } from '@/components/crm/CRMLeadDetail'
import { CRMUserManagement } from '@/components/crm/CRMUserManagement'
import { CRMPermissionsReport } from '@/components/crm/CRMPermissionsReport'

export default function CRM() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isExecutive, hasCRMAccess, loading: rolesLoading } = useRoles()
  const { leads, loading, fetchLeads, createLead, updateLead, deleteLead } = useCRMLeads()
  const { toast } = useToast()

  // ✅ FIX CRÍTICO: Guard de rota — redireciona usuários sem acesso ao CRM
  useEffect(() => {
    if (!rolesLoading && !hasCRMAccess && !isExecutive) {
      toast({
        title: 'Acesso restrito',
        description: 'Solicite autorização a um executive para acessar o CRM.',
        variant: 'destructive'
      })
      navigate('/')
    }
  }, [rolesLoading, hasCRMAccess, isExecutive])

  const [search, setSearch] = useState('')
  const [tempFilter, setTempFilter] = useState<string>('todos')
  const [pipelineFilter, setPipelineFilter] = useState<string>('todos')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null)
  const [saving, setSaving] = useState(false)
  // ✅ FIX MODERADO: estado para confirmação de deleção
  const [deleteConfirmLead, setDeleteConfirmLead] = useState<CRMLead | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', company: '', job_title: '',
    temperature: 'frio', priority: 'normal', pipeline_stage: 'novo',
    lead_source: '', estimated_deal_value: '', observations: '',
    conversion_probability: '0'
  })

  const resetForm = () => {
    setFormData({
      name: '', email: '', phone: '', company: '', job_title: '',
      temperature: 'frio', priority: 'normal', pipeline_stage: 'novo',
      lead_source: '', estimated_deal_value: '', observations: '',
      conversion_probability: '0'
    })
  }

  // Filtered & sorted leads
  const filteredLeads = useMemo(() => {
    let result = leads

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(l => 
        l.name?.toLowerCase().includes(s) ||
        l.email?.toLowerCase().includes(s) ||
        l.company?.toLowerCase().includes(s) ||
        l.phone?.includes(s)
      )
    }

    if (tempFilter !== 'todos') {
      result = result.filter(l => l.temperature === tempFilter)
    }

    if (pipelineFilter !== 'todos') {
      result = result.filter(l => l.pipeline_stage === pipelineFilter)
    }

    // Sort: quente > morno > frio, then urgente > alta > normal > baixa
    const tempOrder: Record<string, number> = { quente: 3, morno: 2, frio: 1 }
    const prioOrder: Record<string, number> = { urgente: 4, alta: 3, normal: 2, baixa: 1 }

    result.sort((a, b) => {
      const td = (tempOrder[b.temperature] || 0) - (tempOrder[a.temperature] || 0)
      if (td !== 0) return td
      const pd = (prioOrder[b.priority] || 0) - (prioOrder[a.priority] || 0)
      if (pd !== 0) return pd
      // next_followup_at ASC NULLS LAST
      if (a.next_followup_at && b.next_followup_at) return new Date(a.next_followup_at).getTime() - new Date(b.next_followup_at).getTime()
      if (a.next_followup_at) return -1
      if (b.next_followup_at) return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return result
  }, [leads, search, tempFilter, pipelineFilter])

  // KPIs
  const kpis = useMemo(() => {
    const total = leads.length
    const quentes = leads.filter(l => l.temperature === 'quente').length
    const today = new Date().toISOString().split('T')[0]
    const followupsToday = leads.filter(l => l.next_followup_at?.startsWith(today)).length
    const overdue = leads.filter(l => {
      if (!l.next_followup_at) return false
      return new Date(l.next_followup_at) < new Date() && !['fechado_ganho', 'fechado_perdido'].includes(l.pipeline_stage)
    }).length
    const pipelineTotal = leads
      .filter(l => !['fechado_ganho', 'fechado_perdido'].includes(l.pipeline_stage))
      .reduce((s, l) => s + (Number(l.estimated_deal_value) || 0), 0)
    const ganhos = leads.filter(l => l.pipeline_stage === 'fechado_ganho').length
    const conversionRate = total > 0 ? (ganhos / total) * 100 : 0

    return { total, quentes, followupsToday, overdue, pipelineTotal, conversionRate }
  }, [leads])

  const handleCreateLead = async () => {
    if (!formData.name.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await createLead({
        name: formData.name.trim(),
        email: formData.email || null,
        phone: formData.phone || null,
        company: formData.company || null,
        job_title: formData.job_title || null,
        temperature: formData.temperature as any,
        priority: formData.priority as any,
        pipeline_stage: formData.pipeline_stage,
        lead_source: formData.lead_source || null,
        estimated_deal_value: formData.estimated_deal_value ? parseFloat(formData.estimated_deal_value) : null,
        observations: formData.observations || null,
        conversion_probability: parseInt(formData.conversion_probability) || 0,
        created_by: user?.id,
        assigned_to: user?.id,
      } as any)
      toast({ title: 'Lead criado com sucesso!' })
      setShowCreateModal(false)
      resetForm()
    } catch (err: any) {
      toast({ title: 'Erro ao criar lead', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLead = async (lead: CRMLead) => {
    // ✅ FIX: Abre modal de confirmação em vez de deletar direto
    setDeleteConfirmLead(lead)
  }

  const confirmDeleteLead = async () => {
    if (!deleteConfirmLead) return
    setDeleting(true)
    try {
      await deleteLead(deleteConfirmLead.id)
      toast({ title: 'Lead excluído' })
      setDeleteConfirmLead(null)
    } catch {
      toast({ title: 'Erro ao excluir', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleTemperature = async (lead: CRMLead) => {
    const cycle: Record<string, string> = { frio: 'morno', morno: 'quente', quente: 'frio' }
    try {
      await updateLead(lead.id, { temperature: cycle[lead.temperature] as any })
    } catch { /* silent */ }
  }

  const handleToggleApproached = async (lead: CRMLead) => {
    try {
      await updateLead(lead.id, {
        approached: !lead.approached,
        approached_at: !lead.approached ? new Date().toISOString() : null,
        approach_count: lead.approach_count + (!lead.approached ? 1 : 0),
      } as any)
    } catch { /* silent */ }
  }

  const getTemperatureBadge = (temp: string) => {
    switch (temp) {
      case 'quente': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">🔥 Quente</Badge>
      case 'morno': return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">🌡️ Morno</Badge>
      default: return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">❄️ Frio</Badge>
    }
  }

  const getPipelineBadge = (stage: string) => {
    const s = PIPELINE_STAGES.find(p => p.value === stage)
    return <Badge variant="outline">{s?.label || stage}</Badge>
  }

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">CRM</h1>
            <p className="text-muted-foreground">Gestão de leads e pipeline de vendas</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchLeads} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button onClick={() => setShowCreateModal(true)} className="bg-gradient-primary hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" /> Novo Lead
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Users className="w-3.5 h-3.5" /> Total
              </div>
              <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Flame className="w-3.5 h-3.5 text-red-400" /> Quentes
              </div>
              <p className="text-2xl font-bold text-red-400">{kpis.quentes}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <CalendarClock className="w-3.5 h-3.5" /> Follow-ups Hoje
              </div>
              <p className="text-2xl font-bold text-foreground">{kpis.followupsToday}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" /> Atrasados
              </div>
              <p className="text-2xl font-bold text-yellow-400">{kpis.overdue}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="w-3.5 h-3.5" /> Pipeline
              </div>
              <p className="text-lg font-bold text-foreground">{formatCurrency(kpis.pipelineTotal)}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-green-400" /> Conversão
              </div>
              <p className="text-2xl font-bold text-green-400">{kpis.conversionRate.toFixed(1)}%</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="leads">
          <TabsList>
            <TabsTrigger value="leads">Leads</TabsTrigger>
            {isExecutive && <TabsTrigger value="users">Gerenciar Usuários</TabsTrigger>}
            {isExecutive && <TabsTrigger value="report">Relatório de Permissões</TabsTrigger>}
          </TabsList>

          <TabsContent value="leads" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, email, empresa..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={tempFilter} onValueChange={setTempFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas temp.</SelectItem>
                  <SelectItem value="quente">🔥 Quente</SelectItem>
                  <SelectItem value="morno">🌡️ Morno</SelectItem>
                  <SelectItem value="frio">❄️ Frio</SelectItem>
                </SelectContent>
              </Select>
              <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos estágios</SelectItem>
                  {PIPELINE_STAGES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Leads Table */}
            <Card className="border-border/50">
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-3 p-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : filteredLeads.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum lead encontrado</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left p-3 font-medium">Temp.</th>
                          <th className="text-left p-3 font-medium">Nome</th>
                          <th className="text-left p-3 font-medium hidden md:table-cell">Contato</th>
                          <th className="text-left p-3 font-medium hidden lg:table-cell">Pipeline</th>
                          <th className="text-left p-3 font-medium hidden lg:table-cell">Valor</th>
                          <th className="text-left p-3 font-medium hidden md:table-cell">Abordado</th>
                          <th className="text-left p-3 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeads.map(lead => (
                          <tr key={lead.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="p-3">
                              <button onClick={() => handleToggleTemperature(lead)} className="cursor-pointer">
                                {getTemperatureBadge(lead.temperature)}
                              </button>
                            </td>
                            <td className="p-3">
                              <button onClick={() => setSelectedLead(lead)} className="text-left hover:underline">
                                <p className="font-medium text-foreground">{lead.name}</p>
                                {lead.company && <p className="text-xs text-muted-foreground">{lead.job_title ? `${lead.job_title} • ` : ''}{lead.company}</p>}
                              </button>
                            </td>
                            <td className="p-3 hidden md:table-cell">
                              <div className="flex flex-col gap-0.5">
                                {lead.email && (
                                  <a href={`mailto:${lead.email}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                                    <Mail className="w-3 h-3" /> {lead.email}
                                  </a>
                                )}
                                {lead.phone && (
                                  <a href={`tel:${lead.phone}`} className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Phone className="w-3 h-3" /> {lead.phone}
                                  </a>
                                )}
                              </div>
                            </td>
                            <td className="p-3 hidden lg:table-cell">
                              {getPipelineBadge(lead.pipeline_stage)}
                            </td>
                            <td className="p-3 hidden lg:table-cell text-foreground">
                              {lead.estimated_deal_value ? formatCurrency(Number(lead.estimated_deal_value)) : '—'}
                            </td>
                            <td className="p-3 hidden md:table-cell">
                              <button
                                onClick={() => handleToggleApproached(lead)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                  lead.approached ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
                                }`}
                              >
                                {lead.approached && '✓'}
                              </button>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSelectedLead(lead)}>
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                                {isExecutive && (
                                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDeleteLead(lead)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {isExecutive && (
            <TabsContent value="users">
              <CRMUserManagement />
            </TabsContent>
          )}

          {isExecutive && (
            <TabsContent value="report">
              <CRMPermissionsReport />
            </TabsContent>
          )}
        </Tabs>


        {/* Create Lead Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo Lead</DialogTitle>
              <DialogDescription>Preencha os dados do novo lead</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2 col-span-2">
                  <Label>Nome *</Label>
                  <Input value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} placeholder="Nome do lead" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))} type="email" />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={formData.phone} onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Empresa</Label>
                  <Input value={formData.company} onChange={e => setFormData(f => ({ ...f, company: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Cargo</Label>
                  <Input value={formData.job_title} onChange={e => setFormData(f => ({ ...f, job_title: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Temperatura</Label>
                  <Select value={formData.temperature} onValueChange={v => setFormData(f => ({ ...f, temperature: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frio">❄️ Frio</SelectItem>
                      <SelectItem value="morno">🌡️ Morno</SelectItem>
                      <SelectItem value="quente">🔥 Quente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select value={formData.priority} onValueChange={v => setFormData(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pipeline</Label>
                  <Select value={formData.pipeline_stage} onValueChange={v => setFormData(f => ({ ...f, pipeline_stage: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PIPELINE_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Origem</Label>
                  <Select value={formData.lead_source} onValueChange={v => setFormData(f => ({ ...f, lead_source: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Valor estimado (R$)</Label>
                  <Input type="number" value={formData.estimated_deal_value} onChange={e => setFormData(f => ({ ...f, estimated_deal_value: e.target.value }))} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Observações</Label>
                  <Textarea value={formData.observations} onChange={e => setFormData(f => ({ ...f, observations: e.target.value }))} rows={3} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
              <Button onClick={handleCreateLead} disabled={saving} className="bg-gradient-primary hover:opacity-90">
                {saving ? 'Salvando...' : 'Criar Lead'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lead Detail Panel */}
        {selectedLead && (
          <CRMLeadDetail
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            onUpdate={async (updates) => {
              await updateLead(selectedLead.id, updates)
              const updated = { ...selectedLead, ...updates }
              setSelectedLead(updated as CRMLead)
            }}
            isExecutive={isExecutive}
          />
        )}

        {/* ✅ FIX: Modal de confirmação de exclusão */}
        <Dialog open={!!deleteConfirmLead} onOpenChange={() => setDeleteConfirmLead(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir Lead</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja excluir o lead <strong>{deleteConfirmLead?.name}</strong>? Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmLead(null)}>Cancelar</Button>
              <Button
                onClick={confirmDeleteLead}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? 'Excluindo...' : 'Excluir Lead'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  )
}
