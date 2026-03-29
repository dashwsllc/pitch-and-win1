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
  DollarSign, TrendingUp, Trash2, Edit, RefreshCw, Phone, Mail,
  Snowflake, Thermometer, Zap, ArrowRight, LayoutList, LayoutGrid
} from 'lucide-react'
import { useCRMLeads, CRMLead, PIPELINE_STAGES, LEAD_SOURCES } from '@/hooks/useCRM'
import { useRoles } from '@/hooks/useRoles'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { CRMLeadDetail } from '@/components/crm/CRMLeadDetail'
import { CRMUserManagement } from '@/components/crm/CRMUserManagement'
import { CRMPermissionsReport } from '@/components/crm/CRMPermissionsReport'

// ─── Temperature Selector Interativo ────────────────────────────────────────
function TemperatureSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const options = [
    {
      key: 'frio',
      label: 'Frio',
      icon: Snowflake,
      active: 'bg-blue-500/20 border-blue-500 text-blue-400 ring-2 ring-blue-500/30',
      hover: 'hover:bg-blue-500/10 hover:border-blue-500/50 hover:text-blue-400',
    },
    {
      key: 'morno',
      label: 'Morno',
      icon: Thermometer,
      active: 'bg-orange-500/20 border-orange-500 text-orange-400 ring-2 ring-orange-500/30',
      hover: 'hover:bg-orange-500/10 hover:border-orange-500/50 hover:text-orange-400',
    },
    {
      key: 'quente',
      label: 'Quente',
      icon: Flame,
      active: 'bg-red-500/20 border-red-500 text-red-400 ring-2 ring-red-500/30',
      hover: 'hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const Icon = opt.icon
        const isActive = value === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all duration-200 cursor-pointer
              ${isActive
                ? opt.active
                : `border-border text-muted-foreground bg-muted/30 ${opt.hover}`
              }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs font-semibold">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Lead Card ───────────────────────────────────────────────────────────────
function LeadCard({
  lead,
  onEdit,
  onDelete,
  onToggleTemperature,
  onToggleApproached,
  isExecutive,
}: {
  lead: CRMLead
  onEdit: () => void
  onDelete: () => void
  onToggleTemperature: () => void
  onToggleApproached: () => void
  isExecutive: boolean
}) {
  const tempConfig = {
    quente: {
      border: 'border-l-red-500',
      badge: 'bg-red-500/15 text-red-400 border-red-500/30',
      glow: 'shadow-[0_0_20px_hsl(0_84%_60%/0.1)]',
      label: '🔥 Quente',
      icon: Flame,
    },
    morno: {
      border: 'border-l-orange-500',
      badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
      glow: '',
      label: '🌡️ Morno',
      icon: Thermometer,
    },
    frio: {
      border: 'border-l-blue-500',
      badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      glow: '',
      label: '❄️ Frio',
      icon: Snowflake,
    },
  }

  const cfg = tempConfig[lead.temperature as keyof typeof tempConfig] || tempConfig.frio
  const initials = lead.name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const avatarColors: Record<string, string> = {
    quente: 'from-red-500/80 to-orange-500/80',
    morno: 'from-orange-500/80 to-yellow-500/80',
    frio: 'from-blue-500/80 to-cyan-500/80',
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const pipeline = PIPELINE_STAGES.find((s) => s.value === lead.pipeline_stage)

  return (
    <div
      className={`bg-card border border-border/60 border-l-4 ${cfg.border} ${cfg.glow} rounded-xl p-4 transition-all duration-200 hover:border-border hover:bg-card/80 group`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Avatar + Info */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarColors[lead.temperature] || avatarColors.frio} flex items-center justify-center text-white font-bold text-sm shrink-0`}
          >
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={onEdit}
                className="font-semibold text-foreground hover:text-primary transition-colors text-sm"
              >
                {lead.name}
              </button>
              {lead.age && (
                <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md">
                  {lead.age} anos
                </span>
              )}
              {lead.temperature === 'quente' && (
                <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Pronto p/ Closer
                </Badge>
              )}
            </div>

            {lead.company && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {lead.job_title ? `${lead.job_title} • ` : ''}
                {lead.company}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 mt-2">
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                >
                  <Mail className="w-3 h-3" /> {lead.email}
                </a>
              )}
              {lead.phone && (
                <a
                  href={`tel:${lead.phone}`}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <Phone className="w-3 h-3" /> {lead.phone}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit}>
            <Edit className="w-3.5 h-3.5" />
          </Button>
          {isExecutive && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Temperature toggle */}
          <button
            onClick={onToggleTemperature}
            className={`text-xs px-2 py-1 rounded-lg border font-medium transition-all ${cfg.badge} hover:opacity-80`}
          >
            {cfg.label}
          </button>

          {pipeline && (
            <span className="text-xs text-muted-foreground bg-muted/40 border border-border/40 px-2 py-1 rounded-lg">
              {pipeline.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lead.estimated_deal_value && (
            <span className="text-xs font-semibold text-green-400">
              {formatCurrency(Number(lead.estimated_deal_value))}
            </span>
          )}
          {/* Approached toggle */}
          <button
            onClick={onToggleApproached}
            title={lead.approached ? 'Abordado' : 'Marcar como abordado'}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all text-[10px] font-bold ${
              lead.approached
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-muted-foreground/50 hover:border-primary'
            }`}
          >
            {lead.approached && '✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main CRM Page ───────────────────────────────────────────────────────────
export default function CRM() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isExecutive, hasCRMAccess, loading: rolesLoading } = useRoles()
  const { leads, loading, fetchLeads, createLead, updateLead, deleteLead } = useCRMLeads()
  const { toast } = useToast()

  useEffect(() => {
    if (!rolesLoading && !hasCRMAccess && !isExecutive) {
      toast({
        title: 'Acesso restrito',
        description: 'Solicite autorização a um executive para acessar o CRM.',
        variant: 'destructive',
      })
      navigate('/')
    }
  }, [rolesLoading, hasCRMAccess, isExecutive])

  const [search, setSearch] = useState('')
  const [tempFilter, setTempFilter] = useState<string>('todos')
  const [pipelineFilter, setPipelineFilter] = useState<string>('todos')
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmLead, setDeleteConfirmLead] = useState<CRMLead | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [formData, setFormData] = useState({
    name: '', age: '', email: '', phone: '', company: '', job_title: '',
    temperature: 'frio', priority: 'normal', pipeline_stage: 'novo',
    lead_source: '', estimated_deal_value: '', observations: '',
    conversion_probability: '0',
  })

  const resetForm = () => {
    setFormData({
      name: '', age: '', email: '', phone: '', company: '', job_title: '',
      temperature: 'frio', priority: 'normal', pipeline_stage: 'novo',
      lead_source: '', estimated_deal_value: '', observations: '',
      conversion_probability: '0',
    })
  }

  const filteredLeads = useMemo(() => {
    let result = leads

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(
        (l) =>
          l.name?.toLowerCase().includes(s) ||
          l.email?.toLowerCase().includes(s) ||
          l.company?.toLowerCase().includes(s) ||
          l.phone?.includes(s)
      )
    }

    if (tempFilter !== 'todos') result = result.filter((l) => l.temperature === tempFilter)
    if (pipelineFilter !== 'todos') result = result.filter((l) => l.pipeline_stage === pipelineFilter)

    const tempOrder: Record<string, number> = { quente: 3, morno: 2, frio: 1 }
    const prioOrder: Record<string, number> = { urgente: 4, alta: 3, normal: 2, baixa: 1 }

    result.sort((a, b) => {
      const td = (tempOrder[b.temperature] || 0) - (tempOrder[a.temperature] || 0)
      if (td !== 0) return td
      const pd = (prioOrder[b.priority] || 0) - (prioOrder[a.priority] || 0)
      if (pd !== 0) return pd
      if (a.next_followup_at && b.next_followup_at)
        return new Date(a.next_followup_at).getTime() - new Date(b.next_followup_at).getTime()
      if (a.next_followup_at) return -1
      if (b.next_followup_at) return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return result
  }, [leads, search, tempFilter, pipelineFilter])

  const kpis = useMemo(() => {
    const total = leads.length
    const quentes = leads.filter((l) => l.temperature === 'quente').length
    const mornos = leads.filter((l) => l.temperature === 'morno').length
    const frios = leads.filter((l) => l.temperature === 'frio').length
    const today = new Date().toISOString().split('T')[0]
    const followupsToday = leads.filter((l) => l.next_followup_at?.startsWith(today)).length
    const overdue = leads.filter((l) => {
      if (!l.next_followup_at) return false
      return (
        new Date(l.next_followup_at) < new Date() &&
        !['fechado_ganho', 'fechado_perdido'].includes(l.pipeline_stage)
      )
    }).length
    const pipelineTotal = leads
      .filter((l) => !['fechado_ganho', 'fechado_perdido'].includes(l.pipeline_stage))
      .reduce((s, l) => s + (Number(l.estimated_deal_value) || 0), 0)
    const ganhos = leads.filter((l) => l.pipeline_stage === 'fechado_ganho').length
    const conversionRate = total > 0 ? (ganhos / total) * 100 : 0

    return { total, quentes, mornos, frios, followupsToday, overdue, pipelineTotal, conversionRate }
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
        age: formData.age ? parseInt(formData.age) : null,
        email: formData.email || null,
        phone: formData.phone || null,
        company: formData.company || null,
        job_title: formData.job_title || null,
        temperature: formData.temperature as any,
        priority: formData.priority as any,
        pipeline_stage: formData.pipeline_stage,
        lead_source: formData.lead_source || null,
        estimated_deal_value: formData.estimated_deal_value
          ? parseFloat(formData.estimated_deal_value)
          : null,
        observations: formData.observations || null,
        conversion_probability: parseInt(formData.conversion_probability) || 0,
        created_by: user?.id,
        assigned_to: user?.id,
      } as any)
      toast({ title: 'Lead criado com sucesso! 🎯' })
      setShowCreateModal(false)
      resetForm()
    } catch (err: any) {
      toast({ title: 'Erro ao criar lead', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLead = (lead: CRMLead) => setDeleteConfirmLead(lead)

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
    const s = PIPELINE_STAGES.find((p) => p.value === stage)
    return <Badge variant="outline">{s?.label || stage}</Badge>
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Users className="w-3.5 h-3.5" /> Total
              </div>
              <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
            </CardContent>
          </Card>

          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-red-400 text-xs mb-1">
                <Flame className="w-3.5 h-3.5" /> Quentes
              </div>
              <p className="text-2xl font-bold text-red-400">{kpis.quentes}</p>
            </CardContent>
          </Card>

          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-orange-400 text-xs mb-1">
                <Thermometer className="w-3.5 h-3.5" /> Mornos
              </div>
              <p className="text-2xl font-bold text-orange-400">{kpis.mornos}</p>
            </CardContent>
          </Card>

          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-blue-400 text-xs mb-1">
                <Snowflake className="w-3.5 h-3.5" /> Frios
              </div>
              <p className="text-2xl font-bold text-blue-400">{kpis.frios}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <CalendarClock className="w-3.5 h-3.5" /> Follow-ups
              </div>
              <p className="text-2xl font-bold text-foreground">{kpis.followupsToday}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="w-3.5 h-3.5" /> Pipeline
              </div>
              <p className="text-sm font-bold text-foreground">{formatCurrency(kpis.pipelineTotal)}</p>
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
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, email, empresa..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Temperature quick filters */}
              <div className="flex items-center gap-1 bg-muted/40 border border-border/50 rounded-lg p-1">
                {[
                  { val: 'todos', label: 'Todos' },
                  { val: 'quente', label: '🔥' },
                  { val: 'morno', label: '🌡️' },
                  { val: 'frio', label: '❄️' },
                ].map((f) => (
                  <button
                    key={f.val}
                    onClick={() => setTempFilter(f.val)}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
                      tempFilter === f.val
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos estágios</SelectItem>
                  {PIPELINE_STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* View mode toggle */}
              <div className="flex items-center gap-1 bg-muted/40 border border-border/50 rounded-lg p-1 ml-auto">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 rounded-md transition-all ${viewMode === 'cards' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <LayoutList className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Leads Content */}
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="w-14 h-14 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Nenhum lead encontrado</p>
                <p className="text-sm mt-1">Crie seu primeiro lead clicando em "Novo Lead"</p>
                <Button onClick={() => setShowCreateModal(true)} className="mt-4 bg-gradient-primary hover:opacity-90">
                  <Plus className="w-4 h-4 mr-2" /> Criar Lead
                </Button>
              </div>
            ) : viewMode === 'cards' ? (
              /* Cards View */
              <div className="space-y-4">
                {/* Quentes section */}
                {filteredLeads.filter((l) => l.temperature === 'quente').length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Flame className="w-4 h-4 text-red-400" />
                      <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide">
                        Quentes — Prontos para o Closer
                      </h3>
                      <div className="flex-1 h-px bg-red-500/20" />
                      <Badge className="bg-red-500/15 text-red-400 border-red-500/30">
                        {filteredLeads.filter((l) => l.temperature === 'quente').length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredLeads
                        .filter((l) => l.temperature === 'quente')
                        .map((lead) => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onEdit={() => setSelectedLead(lead)}
                            onDelete={() => handleDeleteLead(lead)}
                            onToggleTemperature={() => handleToggleTemperature(lead)}
                            onToggleApproached={() => handleToggleApproached(lead)}
                            isExecutive={isExecutive}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Mornos section */}
                {filteredLeads.filter((l) => l.temperature === 'morno').length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Thermometer className="w-4 h-4 text-orange-400" />
                      <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wide">
                        Mornos — Em Aquecimento
                      </h3>
                      <div className="flex-1 h-px bg-orange-500/20" />
                      <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30">
                        {filteredLeads.filter((l) => l.temperature === 'morno').length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredLeads
                        .filter((l) => l.temperature === 'morno')
                        .map((lead) => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onEdit={() => setSelectedLead(lead)}
                            onDelete={() => handleDeleteLead(lead)}
                            onToggleTemperature={() => handleToggleTemperature(lead)}
                            onToggleApproached={() => handleToggleApproached(lead)}
                            isExecutive={isExecutive}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Frios section */}
                {filteredLeads.filter((l) => l.temperature === 'frio').length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Snowflake className="w-4 h-4 text-blue-400" />
                      <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">
                        Frios — Aguardando Abordagem
                      </h3>
                      <div className="flex-1 h-px bg-blue-500/20" />
                      <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30">
                        {filteredLeads.filter((l) => l.temperature === 'frio').length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredLeads
                        .filter((l) => l.temperature === 'frio')
                        .map((lead) => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onEdit={() => setSelectedLead(lead)}
                            onDelete={() => handleDeleteLead(lead)}
                            onToggleTemperature={() => handleToggleTemperature(lead)}
                            onToggleApproached={() => handleToggleApproached(lead)}
                            isExecutive={isExecutive}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Table View */
              <Card className="border-border/50">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left p-3 font-medium">Temp.</th>
                          <th className="text-left p-3 font-medium">Nome</th>
                          <th className="text-left p-3 font-medium hidden sm:table-cell">Idade</th>
                          <th className="text-left p-3 font-medium hidden md:table-cell">Contato</th>
                          <th className="text-left p-3 font-medium hidden lg:table-cell">Pipeline</th>
                          <th className="text-left p-3 font-medium hidden lg:table-cell">Valor</th>
                          <th className="text-left p-3 font-medium hidden md:table-cell">Abordado</th>
                          <th className="text-left p-3 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeads.map((lead) => (
                          <tr key={lead.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="p-3">
                              <button onClick={() => handleToggleTemperature(lead)} className="cursor-pointer">
                                {getTemperatureBadge(lead.temperature)}
                              </button>
                            </td>
                            <td className="p-3">
                              <button onClick={() => setSelectedLead(lead)} className="text-left hover:underline">
                                <p className="font-medium text-foreground">{lead.name}</p>
                                {lead.company && (
                                  <p className="text-xs text-muted-foreground">
                                    {lead.job_title ? `${lead.job_title} • ` : ''}
                                    {lead.company}
                                  </p>
                                )}
                                {lead.temperature === 'quente' && (
                                  <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] mt-0.5">
                                    <Zap className="w-2.5 h-2.5 mr-1" /> Closer
                                  </Badge>
                                )}
                              </button>
                            </td>
                            <td className="p-3 hidden sm:table-cell text-muted-foreground">
                              {lead.age ? `${lead.age} anos` : '—'}
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
                                  lead.approached
                                    ? 'bg-primary border-primary text-primary-foreground'
                                    : 'border-muted-foreground'
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
                </CardContent>
              </Card>
            )}
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
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo Lead</DialogTitle>
              <DialogDescription>Preencha os dados do novo lead para o pipeline</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* Temperatura — Interactive first, destaque */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Temperatura do Lead</Label>
                <TemperatureSelector
                  value={formData.temperature}
                  onChange={(v) => setFormData((f) => ({ ...f, temperature: v }))}
                />
                <p className="text-xs text-muted-foreground">
                  {formData.temperature === 'quente'
                    ? '🔥 Lead pronto para ser enviado ao closer!'
                    : formData.temperature === 'morno'
                    ? '🌡️ Lead em aquecimento, continue o processo.'
                    : '❄️ Lead frio, requer mais abordagens.'}
                </p>
              </div>

              <div className="h-px bg-border" />

              {/* Dados pessoais */}
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2 col-span-2">
                  <Label>Nome *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nome completo do lead"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Idade</Label>
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    value={formData.age}
                    onChange={(e) => setFormData((f) => ({ ...f, age: e.target.value }))}
                    placeholder="Ex: 32"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Telefone / WhatsApp</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label>Email</Label>
                  <Input
                    value={formData.email}
                    onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                    type="email"
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Empresa</Label>
                  <Input
                    value={formData.company}
                    onChange={(e) => setFormData((f) => ({ ...f, company: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Cargo</Label>
                  <Input
                    value={formData.job_title}
                    onChange={(e) => setFormData((f) => ({ ...f, job_title: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select value={formData.priority} onValueChange={(v) => setFormData((f) => ({ ...f, priority: v }))}>
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
                  <Label>Estágio Pipeline</Label>
                  <Select value={formData.pipeline_stage} onValueChange={(v) => setFormData((f) => ({ ...f, pipeline_stage: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PIPELINE_STAGES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Origem</Label>
                  <Select value={formData.lead_source} onValueChange={(v) => setFormData((f) => ({ ...f, lead_source: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Valor estimado (R$)</Label>
                  <Input
                    type="number"
                    value={formData.estimated_deal_value}
                    onChange={(e) => setFormData((f) => ({ ...f, estimated_deal_value: e.target.value }))}
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    value={formData.observations}
                    onChange={(e) => setFormData((f) => ({ ...f, observations: e.target.value }))}
                    rows={3}
                    placeholder="Detalhes relevantes sobre este lead..."
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowCreateModal(false); resetForm() }}>
                Cancelar
              </Button>
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

        {/* Delete Confirmation */}
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
