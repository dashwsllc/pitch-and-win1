import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  Users,
  CalendarClock,
  ArrowRight,
  ListFilter,
  Trash2,
  RefreshCcw,
  PhoneCall,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useCRMLeads,
  useCRMRealtime,
  useCRMActivities,
  useCRMAssignees,
  useCRMSaleLinks,
  useCRMContextSummary,
  CRMLead,
  CRMActivity,
  PIPELINE_STAGES,
  APPROACH_STAGES,
} from "@/hooks/useCRM";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/sales";
import type { Json } from "@/integrations/supabase/types";
import { CRMLeadDetail } from "@/components/crm/CRMLeadDetail";
import { CRMLeadEditor } from "@/components/crm/CRMLeadEditor";
import { CRMLeadCard } from "@/components/crm/CRMLeadCard";
import { CRMActionDialog } from "@/components/crm/CRMActionDialog";
import { CRMCallScheduler, type CRMCallIntent } from "@/components/crm/CRMCalls";
import { CRMQualificationDialog } from "@/components/crm/CRMQualificationDialog";
import { CRMRemarketingDialog } from "@/components/crm/CRMRemarketingDialog";
import { CRMResults } from "@/components/crm/CRMResults";
import { CRMRemarketingBoard } from "@/components/crm/CRMRemarketingBoard";
import { CRMReturnDialog } from "@/components/crm/CRMReturnDialog";
import { leadResult, leadScheduledOn } from "@/lib/crm-results";
import { CRMUserManagement } from "@/components/crm/CRMUserManagement";
import { CRMPermissionsReport } from "@/components/crm/CRMPermissionsReport";
import {
  addDaysToDateKey,
  brasiliaDateKey,
  formatDateKey,
  isValidDateKey,
} from "@/lib/brasilia-time";
import { callMatchesDateKey, type CallDateFilter } from "@/lib/crm-call-status";
import { useCRMNotifications } from "@/hooks/useCRMNotifications";
import { useLiveClock } from "@/hooks/useLiveClock";
import { useSalesBoard } from "@/hooks/useSalesBoard";
import {
  compareCallProximity,
  compareLeadRecency,
  compareLeadUrgency,
  nextLeadSchedule,
} from "@/lib/crm-order";
import { CRM_CLOCK_INTERVAL_MS } from "@/lib/sync";

const temperatures = [
  { value: "frio", label: "Frios" },
  { value: "morno", label: "Mornos" },
  { value: "quente", label: "Quentes" },
];
const approachFilters = [
  { value: "nao_abordado", label: "Não abordado" },
  { value: "em_abordagem", label: "Em abordagem" },
  { value: "abordado", label: "Abordado" },
];
const closedStages = ["fechado_ganho", "fechado_perdido", "lead_perdido"];
const negativeStages = ["fechado_perdido", "lead_perdido"];
// Depois que o SDR agenda a call de fechamento, o lead passa a pertencer ao
// Closer (repassado_closer) e permanece do lado do Closer até ser devolvido
// (devolvido_sdr volta para em_qualificacao) ou até o próprio fechamento
// (fechado_ganho/fechado_perdido, só alcançáveis a partir de repassado_closer).
// Enquanto isso, a aba SDR não deve mais exibir esse lead.
const sdrGroup = (lead: CRMLead) =>
  lead.pipeline_stage === "novo"
    ? "novo"
    : lead.pipeline_stage === "repassado_closer"
      ? "enviados"
      : lead.pipeline_stage === "pronto_closer"
        ? "prontos"
        : lead.approach_stage === "em_abordagem"
            ? "abordagem"
            : "qualificacao";
const sdrGroups = [
  { value: "novo", label: "Novos" },
  { value: "abordagem", label: "Em abordagem" },
  { value: "qualificacao", label: "Em qualificação / aquecimento" },
  { value: "prontos", label: "Prontos para Closer" },
  { value: "enviados", label: "Enviados ao Closer" },
];
const sdrQueues = [
  { value: "active", label: "Em atendimento" },
  { value: "calls", label: "Calls de qualificação" },
  { value: "closed", label: "Resultados" },
  { value: "negative", label: "Remarketing" },
];
const selectClass =
  "h-9 min-w-0 w-full rounded-md border border-input bg-background px-2 text-xs";

function MultiSelectFilter({
  label,
  allLabel,
  options,
  values,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`${selectClass} justify-start font-normal`} aria-label={`Filtrar por ${label}`}>
          <ListFilter className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{values.length ? `${label}: ${values.length}` : allLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-1 p-2">
        {options.map((option) => (
          <label key={option.value} className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent">
            <Checkbox checked={values.includes(option.value)} onCheckedChange={() => toggle(option.value)} />
            {option.label}
          </label>
        ))}
        {values.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs" onClick={() => onChange([])}>Limpar seleção</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function CRM() {
  const { user } = useAuth();
  const {
    capabilities,
    loading: rolesLoading,
    error: rolesError,
    refetch: retryRoles,
  } = useRoles();
  const crm = useCRMLeads();
  const callsQuery = useCRMActivities(null, true);
  const assignees = useCRMAssignees();
  const sales = useCRMSaleLinks();
  const approvedSales = useSalesBoard("aprovada", "", 0, 50);
  const contextSummary = useCRMContextSummary();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") || "leads";
  // Keep existing Remarketing bookmarks in the SDR workspace.
  const tab = requestedTab === "remarketing" ? "sdr" : requestedTab;
  const [search, setSearch] = useState("");
  const [temperature, setTemperature] = useState<string[]>([]);
  const [approach, setApproach] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState("all");
  const [owner, setOwner] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [callDateFilter, setCallDateFilter] = useState<CallDateFilter>("all");
  const [callDateKey, setCallDateKey] = useState("");
  const [order, setOrder] = useState("newest");
  const [view, setView] = useState("list");
  const [pipelineDay, setPipelineDay] = useState(() => brasiliaDateKey());
  const [queue, setQueue] = useState("queue");
  const [sdrQueue, setSdrQueue] = useState(
    requestedTab === "remarketing" ? "negative" : "active",
  );
  const [readId, setReadId] = useState<string | null>(null);
  const [editor, setEditor] = useState<CRMLead | "new" | null>(null);
  const [deleting, setDeleting] = useState<CRMLead | null>(null);
  const [action, setAction] = useState<{ lead: CRMLead; name: string } | null>(
    null,
  );
  const [schedule, setSchedule] = useState<{
    lead: CRMLead;
    call?: CRMActivity;
    intent: CRMCallIntent;
  } | null>(null);
  const [qualification, setQualification] = useState<{
    lead: CRMLead;
    call: CRMActivity;
  } | null>(null);
  const [remarketing, setRemarketing] = useState<CRMLead | null>(null);
  const [returning, setReturning] = useState<{ lead: CRMLead; target: "sdr" | "closer" } | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useLiveClock(CRM_CLOCK_INTERVAL_MS);
  const lock = useRef(false);
  const { realtimeUnavailable } = useCRMRealtime();
  const names = Object.fromEntries(
    (assignees.data || []).map((a) => [a.user_id, a.display_name]),
  );
  const candidates = (assignees.data || []).filter((a) => a.role === "closer");
  const openCalls = new Map<string, CRMActivity>();
  callsQuery.activities
    .filter((activity) => !activity.is_completed)
    .forEach((activity) => {
      const existing = openCalls.get(activity.lead_id);
      if (!existing || Date.parse(activity.scheduled_at || '') < Date.parse(existing.scheduled_at || '')) {
        openCalls.set(activity.lead_id, activity);
      }
    });
  const saleMap = new Map(
    (sales.data || []).map((sale) => [sale.lead_id, sale]),
  );
  // Calls e abordagens são pessoais; vendas usam a aprovação real registrada
  // no painel e só entram na janela de aviso uma hora depois da revisão.
  useCRMNotifications({
    userId: user?.id,
    enabled: !!user && capabilities.leads,
    leads: crm.leads,
    calls: callsQuery.activities,
    approvedSales: approvedSales.data?.items || [],
    onOpenLead: (leadId) => setReadId(leadId),
  });
  const next = (lead: CRMLead) =>
    nextLeadSchedule(lead, openCalls.get(lead.id)?.scheduled_at);
  const overdue = (lead: CRMLead) =>
    !closedStages.includes(lead.pipeline_stage) &&
    !!next(lead) &&
    new Date(next(lead)!) < now;
  const closed = (lead: CRMLead) => !!leadResult(lead);
  const negative = (lead: CRMLead) => negativeStages.includes(lead.pipeline_stage);
  const inQueue = (lead: CRMLead, value: string) => {
    if (value === "closed") return closed(lead);
    if (lead.pipeline_stage !== "repassado_closer") return false;
    const date = openCalls.get(lead.id)?.scheduled_at;
    if (value === "unclaimed") return !lead.closer_id;
    if (value === "mine") return lead.closer_id === user?.id;
    if (value === "today")
      return !!date && brasiliaDateKey(date) === brasiliaDateKey(now);
    if (value === "future")
      return (
        !!date &&
        new Date(date) > now &&
        brasiliaDateKey(date) !== brasiliaDateKey(now)
      );
    if (value === "overdue") return !!date && new Date(date) < now;
    return true;
  };
  const queues = [
    { value: "queue", label: "Fila Closer" },
    { value: "unclaimed", label: "Não assumidos" },
    { value: "mine", label: "Meus leads" },
    { value: "today", label: "Calls de hoje" },
    { value: "future", label: "Calls futuras" },
    { value: "overdue", label: "Calls atrasadas" },
    { value: "closed", label: "Resultados" },
  ];
  const inSdrQueue = (lead: CRMLead, value: string) => {
    if (value === "calls")
      return openCalls.get(lead.id)?.call_type === "qualificacao";
    if (value === "closed") return closed(lead);
    if (value === "negative") return negative(lead);
    return !closedStages.includes(lead.pipeline_stage) && lead.pipeline_stage !== "repassado_closer";
  };
  const visibleInTab = (lead: CRMLead) => {
    if (tab === "leads") return !closedStages.includes(lead.pipeline_stage);
    if (tab === "closer") return inQueue(lead, queue);
    if (tab === "sdr") return inSdrQueue(lead, sdrQueue);
    return true;
  };
  const showResults = tab === "results" || (tab === "closer" && queue === "closed") || (tab === "sdr" && sdrQueue === "closed");
  const showRemarketing = tab === "remarketing" || (tab === "sdr" && sdrQueue === "negative");
  const dailyPipeline = view === "pipeline" && ["leads", "sdr"].includes(tab) && !showResults && !showRemarketing;
  const pipelineCalls = new Map<string, (string | null)[]>();
  callsQuery.activities.filter(call => !call.is_completed).forEach(call => {
    pipelineCalls.set(call.lead_id, [...(pipelineCalls.get(call.lead_id) || []), call.scheduled_at]);
  });
  const todayKey = brasiliaDateKey(now);
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const selectedCallDateKey =
    callDateFilter === "today"
      ? todayKey
      : callDateFilter === "tomorrow"
        ? tomorrowKey
        : isValidDateKey(callDateKey)
          ? callDateKey
          : null;
  const baseFiltered = crm.leads
    .filter(
      (lead) =>
        `${lead.name} ${lead.athlete_name || ""} ${lead.phone || ""} ${lead.email || ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()) &&
        (!temperature.length || temperature.includes(lead.temperature)) &&
        (!approach.length ||
          approach.includes(lead.approach_stage) ||
          (approach.includes("abordado") && lead.approach_stage === "reabordado")) &&
        (pipeline === "all" || lead.pipeline_stage === pipeline) &&
        (owner === "all" ||
          lead.sdr_id === owner ||
          lead.closer_id === owner) &&
        (!overdueOnly || overdue(lead)) &&
        visibleInTab(lead),
    );
  const visibleLeadCount = crm.leads.filter(visibleInTab).length;
  // Conta sobre os demais filtros ja aplicados, para o numero refletir o que o
  // usuario esta vendo.
  const callDateCount = (dateKey: string | null) =>
    baseFiltered.filter((lead) =>
      callMatchesDateKey(openCalls.get(lead.id), dateKey),
    ).length;
  const callDateOptions: { value: CallDateFilter; label: string; count: number | null }[] = [
    { value: "all", label: "Todas", count: null },
    { value: "today", label: "Hoje", count: callDateCount(todayKey) },
    { value: "tomorrow", label: "Amanhã", count: callDateCount(tomorrowKey) },
    {
      value: "specific",
      label: "Data específica",
      count: callDateFilter === "specific" ? callDateCount(selectedCallDateKey) : null,
    },
  ];
  const filtered = baseFiltered
    .filter(
      (lead) =>
        dailyPipeline
          ? leadScheduledOn(lead, pipelineCalls.get(lead.id) || [], pipelineDay)
          : callDateFilter === "all" || callMatchesDateKey(openCalls.get(lead.id), selectedCallDateKey),
    )
    .sort((a, b) => {
      if (callDateFilter !== "all" && !dailyPipeline) {
        return (
          compareCallProximity(
            openCalls.get(a.id)?.scheduled_at,
            openCalls.get(b.id)?.scheduled_at,
            now.getTime(),
          ) || compareLeadRecency(a, b)
        );
      }
      if (order === "name") return a.name.localeCompare(b.name, "pt-BR");
      if (order === "hot") {
        return (
          ["quente", "morno", "frio"].indexOf(a.temperature) -
            ["quente", "morno", "frio"].indexOf(b.temperature) ||
          compareLeadRecency(a, b)
        );
      }
      return order === "automatic"
        ? compareLeadUrgency(
            a,
            b,
            openCalls.get(a.id)?.scheduled_at,
            openCalls.get(b.id)?.scheduled_at,
          )
        : compareLeadRecency(a, b);
    });
  const mode = view;
  const groups =
    tab === "closer" || mode === "list"
      ? [{ value: "all", label: "Leads" }]
      : mode === "temperature"
        ? temperatures
        : mode === "approach"
          ? APPROACH_STAGES
          // Na aba SDR, "Enviados ao Closer" nunca teria lead (já são
          // excluídos acima); a coluna some para não ficar sempre vazia. Na
          // aba Leads, que mostra tudo, a coluna continua aparecendo.
          : tab === "sdr"
            ? sdrGroups.filter((group) => group.value !== "enviados")
            : sdrGroups;
  const groupFor = (lead: CRMLead) =>
    tab === "closer" || mode === "list"
      ? "all"
      : mode === "temperature"
        ? lead.temperature
        : mode === "approach"
          ? lead.approach_stage
          : sdrGroup(lead);
  const selected = crm.leads.find((l) => l.id === readId);
  const run = async (
    operation: () => Promise<unknown>,
    title = "Lead atualizado",
  ) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await operation();
      toast({ title });
      return true;
    } catch (error) {
      toast({
        title: "Não foi possível concluir",
        description: errorMessage(error),
        variant: "destructive",
      });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const transition = (lead: CRMLead, name: string, data: Json = {}) =>
    run(
      () => crm.transition(lead, name, data),
      name === "close"
        ? "Resultado registrado. Confira o próximo passo no card do lead."
        : name === "handoff"
          ? "Lead enviado para Closer"
          : name === "claim"
            ? "Lead assumido"
            : "Lead atualizado",
    );
  const saveAction = (lead: CRMLead, name: string, data: Json) => {
    if (name !== "lose" && name !== "remarketing") return transition(lead, name, data);
    const payload = data as {
      negative_reason?: string;
      next_at?: string;
      note?: string;
    };
    return run(
      () => crm.markNegative(lead, {
        reason: payload.negative_reason || "",
        nextAt: payload.next_at || "",
        note: payload.note,
      }),
      "Lead enviado para Remarketing",
    );
  };
  const requestDelete = (lead: CRMLead) => {
    setReadId(null);
    setEditor(null);
    setAction(null);
    setSchedule(null);
    setQualification(null);
    setRemarketing(null);
    setReturning(null);
    setDeleting(lead);
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const deleted = await run(() => crm.deleteLead(deleting), "Lead excluído");
    if (deleted) setDeleting(null);
  };
  const renderLead = (lead: CRMLead) => (
    <CRMLeadCard
      key={lead.id}
      lead={lead}
      call={openCalls.get(lead.id)}
      names={names}
      sale={saleMap.get(lead.id)}
      emphasizeCall={lead.pipeline_stage === "repassado_closer"}
      hasContext={contextSummary.leadIds.has(lead.id)}
      busy={busy}
      onRead={() => setReadId(lead.id)}
      onEdit={() => setEditor(lead)}
      onDelete={() => requestDelete(lead)}
      onAction={(name) => setAction({ lead, name })}
      onTransition={(name, data) => {
        void transition(lead, name, data);
      }}
      onSchedule={(intent) => setSchedule({ lead, call: openCalls.get(lead.id), intent })}
      onQualifyCall={() => {
        const call = openCalls.get(lead.id);
        if (call) setQualification({ lead, call });
      }}
      onRemarketing={() => setRemarketing(lead)}
    />
  );
  const retry = () => {
    void crm.fetchLeads();
    void assignees.refetch();
    void sales.refetch();
    void callsQuery.fetchActivities();
    void contextSummary.refetch();
    void retryRoles();
  };
  const failure =
    crm.error ||
    callsQuery.error ||
    assignees.error ||
    sales.error ||
    contextSummary.error ||
    rolesError;
  const loading =
    rolesLoading ||
    crm.loading ||
    callsQuery.loading ||
    assignees.isLoading ||
    sales.isLoading ||
    contextSummary.loading;
  const permittedTab =
    ["leads", "results", "remarketing"].includes(tab) ||
    (tab === "sdr" && capabilities.sdr) ||
    (tab === "closer" && capabilities.closer) ||
    (["users", "permissions"].includes(tab) && capabilities.admin);
  const pendingSales = crm.leads.filter(
    (l) => l.pipeline_stage === "fechado_ganho" && !saleMap.has(l.id),
  ).length;
  if (!rolesLoading && !rolesError && !capabilities.leads)
    return <Navigate to="/" replace />;
  return (
    <DashboardLayout>
      {realtimeUnavailable && <p role="status" className="mb-4 rounded-lg border p-3 text-sm text-muted-foreground">Conexão em tempo real indisponível. Use Atualizar CRM para consultar as alterações mais recentes.</p>}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">CRM</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Da primeira conversa ao fechamento, com o mesmo lead.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Atualizar CRM"
              onClick={retry}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button className="h-9" onClick={() => setEditor("new")} disabled={loading || busy}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Lead
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Leads ativos", value: crm.leads.filter((lead) => !closedStages.includes(lead.pipeline_stage)).length, icon: Users },
            {
              label: "Remarketing",
              value: crm.leads.filter(negative).length,
              icon: RefreshCcw,
            },
            {
              label: "Fila Closer",
              value: crm.leads.filter(
                (l) => l.pipeline_stage === "repassado_closer",
              ).length,
              icon: ArrowRight,
            },
            {
              label: "Calls SDR",
              value: crm.leads.filter((lead) => openCalls.get(lead.id)?.call_type === "qualificacao").length,
              icon: PhoneCall,
            },
          ].map((item) => (
            <Card key={item.label} className="border-border/50">
              <CardContent className="flex items-center gap-2.5 p-3">
                <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-5">{item.value}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setParams({ tab: value });
            setView("list");
            setOrder("newest");
            setSdrQueue("active");
            setQueue("queue");
          }}
        >
          <TabsList className="h-auto flex flex-wrap justify-start gap-1 w-fit max-w-full">
            <TabsTrigger className="h-8 px-3 text-xs" value="leads">Leads</TabsTrigger>
            {capabilities.sdr && <TabsTrigger className="h-8 px-3 text-xs" value="sdr">SDR</TabsTrigger>}
            {capabilities.closer && (
              <TabsTrigger className="h-8 px-3 text-xs" value="closer">Closer</TabsTrigger>
            )}
            <TabsTrigger className="h-8 px-3 text-xs" value="results">Resultados</TabsTrigger>
            {capabilities.admin && (
              <>
                <TabsTrigger className="h-8 px-3 text-xs" value="users">Gerenciar Usuários</TabsTrigger>
                <TabsTrigger className="h-8 px-3 text-xs" value="permissions">
                  Relatório de Permissões
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </Tabs>
        {!permittedTab && !rolesLoading ? (
          <div role="alert" className="rounded-lg border p-4">
            Sua função não permite acessar esta área.{" "}
            <Button
              variant="outline"
              onClick={() => setParams({ tab: "leads" })}
            >
              Voltar para Leads
            </Button>
          </div>
        ) : ["users", "permissions"].includes(tab) ? (
          capabilities.admin &&
          (tab === "users" ? <CRMUserManagement /> : <CRMPermissionsReport />)
        ) : (
          <>
            {failure && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/50 p-4 space-y-3"
              >
                <p>Não foi possível atualizar o CRM: {errorMessage(failure)}</p>
                <Button variant="outline" onClick={retry}>
                  Tentar novamente
                </Button>
              </div>
            )}
            {loading && <p role="status">Carregando CRM...</p>}
            {!loading && !failure && (
              <>
                {pendingSales > 0 && capabilities.closer && (
                  <div className="flex flex-wrap gap-2 justify-between items-center rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                    <p className="text-sm">
                      {pendingSales}{" "}
                      {pendingSales === 1
                        ? "venda pendente"
                        : "vendas pendentes"}{" "}
                      de cadastro no módulo Vendas.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setParams({ tab: "closer" });
                        setQueue("closed");
                        setSearch("");
                        setTemperature([]);
                        setApproach([]);
                        setPipeline("all");
                        setOwner("all");
                        setOverdueOnly(false);
                        setOrder("newest");
                      }}
                    >
                      Ver resultados
                    </Button>
                  </div>
                )}
                {tab === "closer" ? (
                  <Tabs value={queue} onValueChange={setQueue}>
                    <TabsList className="h-auto flex flex-wrap justify-start gap-1">
                      {queues.map((q) => (
                        <TabsTrigger className="h-8 px-3 text-xs" value={q.value} key={q.value}>
                          {q.label}{" "}
                          <span className="ml-1 text-xs">
                            {
                              crm.leads.filter((l) => inQueue(l, q.value))
                                .length
                            }
                          </span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : ["leads", "sdr"].includes(tab) ? (
                  <div className="space-y-2">
                    {tab === "sdr" && (
                      <div className="space-y-2">
                        <Tabs value={sdrQueue} onValueChange={(value) => { setSdrQueue(value); setView("list"); }}>
                          <TabsList className="h-auto flex flex-wrap justify-start gap-1">
                            {sdrQueues.map((item) => (
                              <TabsTrigger className="h-8 px-3 text-xs" value={item.value} key={item.value}>
                                {item.label} <span className="ml-1">{crm.leads.filter((lead) => inSdrQueue(lead, item.value)).length}</span>
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>
                      </div>
                    )}
                    {!showResults && !showRemarketing && <Tabs value={mode} onValueChange={value => {
                      setView(value);
                      if (value === "pipeline" && callDateFilter !== "all" && selectedCallDateKey) setPipelineDay(selectedCallDateKey);
                    }}>
                      <TabsList className="h-auto flex flex-wrap justify-start gap-1">
                        {[
                          { value: "list", label: tab === "leads" ? "Todos ativos" : "Lista" },
                          { value: "temperature", label: "Aquecimento" },
                          { value: "approach", label: "Abordagem" },
                          { value: "pipeline", label: "Esteira do LEAD" },
                        ].map((v) => (
                          <TabsTrigger className="h-8 px-3 text-xs" value={v.value} key={v.value}>
                            {v.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>}
                  </div>
                ) : null}
                {showResults ? <CRMResults leads={crm.leads} sales={saleMap} names={names} closerView={tab === "closer"} busy={busy}
                  onRead={lead => setReadId(lead.id)} onReturn={(lead, target) => setReturning({ lead, target })} onRemarketing={setRemarketing} />
                  : showRemarketing ? <CRMRemarketingBoard leads={crm.leads} names={names} now={now} busy={busy} onRead={lead => setReadId(lead.id)} onManage={setRemarketing} />
                  : <>
                {dailyPipeline && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div><h2 className="font-semibold">Esteira do LEAD</h2><p className="text-xs text-muted-foreground">Calls e retornos marcados para {isValidDateKey(pipelineDay) ? formatDateKey(pipelineDay) : "a data selecionada"} · Brasília</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="icon" variant="outline" aria-label="Dia anterior da esteira" disabled={!isValidDateKey(pipelineDay)} onClick={() => setPipelineDay(addDaysToDateKey(pipelineDay, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                    <Input type="date" aria-label="Dia da Esteira do LEAD" className="w-auto" value={pipelineDay} onChange={e => setPipelineDay(e.target.value)} />
                    <Button size="icon" variant="outline" aria-label="Próximo dia da esteira" disabled={!isValidDateKey(pipelineDay)} onClick={() => setPipelineDay(addDaysToDateKey(pipelineDay, 1))}><ChevronRight className="h-4 w-4" /></Button>
                    <Button variant="outline" onClick={() => setPipelineDay(todayKey)}>Hoje</Button>
                  </div>
                </div>}
                <div className="rounded-lg border bg-card/80 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1.8fr)_repeat(5,minmax(120px,1fr))]">
                  <Input
                    aria-label="Buscar leads"
                    placeholder="Buscar responsável, atleta, WhatsApp ou e-mail"
                    className="h-9 text-sm"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                    <MultiSelectFilter
                      label="Temperatura"
                      allLabel="Toda temperatura"
                      options={temperatures}
                      values={temperature}
                      onChange={setTemperature}
                    />
                    <MultiSelectFilter
                      label="Abordagem"
                      allLabel="Toda abordagem"
                      options={approachFilters}
                      values={approach}
                      onChange={setApproach}
                    />
                    <select
                      className={selectClass}
                      aria-label="Filtrar pipeline"
                      value={pipeline}
                      onChange={(e) => setPipeline(e.target.value)}
                    >
                      <option value="all">Todo pipeline</option>
                      {PIPELINE_STAGES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={selectClass}
                      aria-label="Filtrar responsável"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                    >
                      <option value="all">Todos os responsáveis</option>
                      {Object.entries(names).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      className={selectClass}
                      aria-label="Ordenar leads"
                      value={callDateFilter === "all" || dailyPipeline ? order : "calls"}
                      onChange={(e) => setOrder(e.target.value)}
                      disabled={callDateFilter !== "all" && !dailyPipeline}
                    >
                      {callDateFilter !== "all" && !dailyPipeline && (
                        <option value="calls">Horário mais próximo</option>
                      )}
                      <option value="newest">Mais recentes</option>
                      <option value="automatic">Calls e retornos prioritários</option>
                      <option value="name">Nome A–Z</option>
                      <option value="hot">Mais quentes</option>
                    </select>
                  </div>
                  {!dailyPipeline && <div
                    role="group"
                    aria-label="Filtrar calls por data"
                    className="mt-2 grid grid-cols-2 items-center gap-1.5 border-t border-border/40 pt-2 sm:flex sm:flex-wrap"
                  >
                    <span className="col-span-2 mr-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground sm:col-span-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Calls:
                    </span>
                    {callDateOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={callDateFilter === option.value ? "default" : "outline"}
                        aria-pressed={callDateFilter === option.value}
                        data-call-date-option={option.value}
                        className="h-8 w-full min-w-0 px-2 text-xs sm:w-auto sm:min-w-max sm:px-3"
                        onClick={() => {
                          setCallDateFilter(option.value);
                          if (option.value === "specific" && !callDateKey) {
                            setCallDateKey(todayKey);
                          }
                        }}
                      >
                        <span className="shrink-0">{option.label}</span>
                        {option.count !== null && (
                          <span className="ml-1 opacity-70">({option.count})</span>
                        )}
                      </Button>
                    ))}
                    {callDateFilter === "specific" && (
                      <Input
                        type="date"
                        aria-label="Escolher data das calls"
                        className="col-span-2 h-8 w-full text-xs sm:w-auto"
                        value={callDateKey}
                        onChange={(event) => setCallDateKey(event.target.value)}
                      />
                    )}
                    {callDateFilter === "specific" && !selectedCallDateKey && (
                      <span role="status" className="col-span-2 text-[11px] text-amber-400">
                        Escolha uma data válida.
                      </span>
                    )}
                    {callDateFilter === "specific" && selectedCallDateKey && (
                      <span className="col-span-2 text-[11px] text-muted-foreground">
                        {formatDateKey(selectedCallDateKey)}
                      </span>
                    )}
                  </div>}
                  <div className="mt-2 flex flex-wrap justify-between gap-2 px-0.5 text-[11px] leading-4 text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={overdueOnly}
                        onChange={(e) => setOverdueOnly(e.target.checked)}
                      />
                      Somente atrasados
                    </label>
                    <span>
                      {filtered.length} de {visibleLeadCount} leads nesta área · {dailyPipeline ? "agendados para o dia selecionado" : callDateFilter !== "all"
                        ? "calls mais próximas primeiro"
                        : order === "newest"
                          ? "mais recentes primeiro"
                          : order === "automatic"
                            ? "calls e retornos prioritários"
                            : order === "hot"
                              ? "mais quentes primeiro"
                              : "ordem alfabética"} · atualização automática
                    </span>
                  </div>
                </div>
                <div
                  className={
                    groups.length > 1
                      ? "grid items-start gap-3 xl:grid-cols-3"
                      : "space-y-3"
                  }
                >
                  {groups.map((group) => {
                    const rows = filtered.filter(
                      (l) => groupFor(l) === group.value,
                    );
                    return (
                      <section key={group.value} className="min-w-0 space-y-2">
                        {groups.length > 1 && (
                          <h2 className="flex gap-2 items-center text-sm font-semibold">
                            {group.label}
                            <Badge variant="secondary">{rows.length}</Badge>
                          </h2>
                        )}
                        {rows.length ? (
                          <div
                            className={
                              groups.length > 1
                                ? "space-y-2"
                                : "grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3"
                            }
                          >
                            {rows.map(renderLead)}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                            {dailyPipeline ? "Nenhum lead agendado para este dia com os filtros selecionados." : "Nenhum lead nesta visualização."}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
                </>}
              </>
            )}
          </>
        )}
        {returning && <CRMReturnDialog lead={returning.lead} target={returning.target} assignees={assignees.data || []} busy={busy}
          onClose={() => setReturning(null)} onSave={data => run(() => crm.reopenResult(returning.lead, data), `Lead devolvido ao ${data.target === "sdr" ? "SDR" : "Closer"} com call agendada`)} />}
        {selected && (
          <CRMLeadDetail
            key={selected.id}
            lead={selected}
            names={names}
            busy={busy}
            onClose={() => setReadId(null)}
            onEdit={() => {
              setReadId(null);
              setEditor(selected);
            }}
            onDelete={() => requestDelete(selected)}
          />
        )}
        {editor && (
          <CRMLeadEditor
            key={editor === "new" ? "new" : editor.id}
            lead={editor === "new" ? undefined : editor}
            busy={busy}
            onClose={() => setEditor(null)}
            onSave={(data) =>
              editor === "new"
                ? run(() => crm.createLead(data), "Lead criado")
                : transition(editor, "edit", data as Json)
            }
          />
        )}
        {action && (
          <CRMActionDialog
            key={`${action.lead.id}-${action.name}`}
            lead={action.lead}
            action={action.name}
            candidates={candidates}
            busy={busy}
            onClose={() => setAction(null)}
            onSave={(data) => saveAction(action.lead, action.name, data)}
          />
        )}
        {schedule && (
          <CRMCallScheduler
            lead={schedule.lead}
            call={schedule.call}
            intent={schedule.intent}
            onClose={() => setSchedule(null)}
          />
        )}
        {qualification && (
          <CRMQualificationDialog
            lead={qualification.lead}
            call={qualification.call}
            onClose={() => setQualification(null)}
          />
        )}
        {remarketing && (
          <CRMRemarketingDialog
            lead={remarketing}
            busy={busy}
            onClose={() => setRemarketing(null)}
            onSave={(data) => run(
              () => crm.updateRemarketing(remarketing, data),
              data.action === "reactivate" ? "Lead reativado" : "Remarketing atualizado",
            )}
          />
        )}
        <AlertDialog
          open={!!deleting}
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir este lead?</AlertDialogTitle>
              <AlertDialogDescription>
                O cadastro de {deleting?.athlete_name?.trim() || deleting?.name || "este lead"},
                suas calls, seu histórico e seus contextos serão excluídos. Vendas já
                registradas serão preservadas e apenas desvinculadas do lead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <Button variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>
                <Trash2 className="mr-2 h-4 w-4" />
                {busy ? "Excluindo..." : "Excluir lead"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
