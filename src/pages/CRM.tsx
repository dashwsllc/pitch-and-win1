import { useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  Users,
  Flame,
  CalendarClock,
  ArrowRight,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCRMLeads,
  useCRMRealtime,
  useCRMActivities,
  useCRMAssignees,
  useCRMSaleLinks,
  CRMLead,
  CRMActivity,
  PIPELINE_STAGES,
  APPROACH_STAGES,
} from "@/hooks/useCRM";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/sales";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { CRMLeadDetail } from "@/components/crm/CRMLeadDetail";
import { CRMLeadEditor } from "@/components/crm/CRMLeadEditor";
import { CRMLeadCard } from "@/components/crm/CRMLeadCard";
import { CRMActionDialog } from "@/components/crm/CRMActionDialog";
import { CRMCallScheduler } from "@/components/crm/CRMCalls";
import { CRMUserManagement } from "@/components/crm/CRMUserManagement";
import { CRMPermissionsReport } from "@/components/crm/CRMPermissionsReport";

const temperatures = [
  { value: "frio", label: "Frios" },
  { value: "morno", label: "Mornos" },
  { value: "quente", label: "Quentes" },
];
const closedStages = ["fechado_ganho", "fechado_perdido", "lead_perdido"];
const sdrGroup = (lead: CRMLead) =>
  lead.pipeline_stage === "novo"
    ? "novo"
    : lead.pipeline_stage === "repassado_closer"
      ? "enviados"
      : lead.pipeline_stage === "pronto_closer"
        ? "prontos"
        : closedStages.includes(lead.pipeline_stage)
          ? "encerrados"
          : lead.approach_stage === "em_abordagem"
            ? "abordagem"
            : "qualificacao";
const sdrGroups = [
  { value: "novo", label: "Novos" },
  { value: "abordagem", label: "Em abordagem" },
  { value: "qualificacao", label: "Em qualificação / aquecimento" },
  { value: "prontos", label: "Prontos para Closer" },
  { value: "enviados", label: "Enviados ao Closer" },
  { value: "encerrados", label: "Encerrados" },
];
const selectClass =
  "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm";

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
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "leads";
  const [search, setSearch] = useState("");
  const [temperature, setTemperature] = useState("all");
  const [approach, setApproach] = useState("all");
  const [pipeline, setPipeline] = useState("all");
  const [owner, setOwner] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [order, setOrder] = useState("newest");
  const [view, setView] = useState("list");
  const [queue, setQueue] = useState("queue");
  const [readId, setReadId] = useState<string | null>(null);
  const [editor, setEditor] = useState<CRMLead | "new" | null>(null);
  const [action, setAction] = useState<{ lead: CRMLead; name: string } | null>(
    null,
  );
  const [schedule, setSchedule] = useState<{
    lead: CRMLead;
    call?: CRMActivity;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { realtimeUnavailable } = useCRMRealtime();
  const names = Object.fromEntries(
    (assignees.data || []).map((a) => [a.user_id, a.display_name]),
  );
  const candidates = (assignees.data || []).filter((a) => a.role === "closer");
  const openCalls = new Map(
    callsQuery.activities
      .filter((a) => !a.is_completed)
      .map((a) => [a.lead_id, a]),
  );
  const saleMap = new Map(
    (sales.data || []).map((sale) => [sale.lead_id, sale]),
  );
  const now = new Date();
  const next = (lead: CRMLead) =>
    [lead.next_followup_at, openCalls.get(lead.id)?.scheduled_at]
      .filter(Boolean)
      .sort()[0];
  const overdue = (lead: CRMLead) =>
    !closedStages.includes(lead.pipeline_stage) &&
    !!next(lead) &&
    new Date(next(lead)!) < now;
  const closed = (lead: CRMLead) =>
    ["fechado_ganho", "fechado_perdido"].includes(lead.pipeline_stage);
  const inQueue = (lead: CRMLead, value: string) => {
    if (value === "closed") return closed(lead);
    if (lead.pipeline_stage !== "repassado_closer") return false;
    const date = openCalls.get(lead.id)?.scheduled_at;
    if (value === "unclaimed") return !lead.closer_id;
    if (value === "mine") return lead.closer_id === user?.id;
    if (value === "today")
      return !!date && new Date(date).toDateString() === now.toDateString();
    if (value === "future")
      return (
        !!date &&
        new Date(date) > now &&
        new Date(date).toDateString() !== now.toDateString()
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
    { value: "closed", label: "Fechamentos realizados" },
  ];
  const filtered = crm.leads
    .filter(
      (lead) =>
        `${lead.name} ${lead.athlete_name || ""} ${lead.phone || ""} ${lead.email || ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()) &&
        (temperature === "all" || lead.temperature === temperature) &&
        (approach === "all" || lead.approach_stage === approach) &&
        (pipeline === "all" || lead.pipeline_stage === pipeline) &&
        (owner === "all" ||
          lead.sdr_id === owner ||
          lead.closer_id === owner) &&
        (!overdueOnly || overdue(lead)) &&
        (tab !== "closer" || inQueue(lead, queue)),
    )
    .sort((a, b) =>
      order === "name"
        ? a.name.localeCompare(b.name, "pt-BR")
        : order === "next"
          ? (next(a) || "9999").localeCompare(next(b) || "9999")
          : order === "hot"
            ? ["quente", "morno", "frio"].indexOf(a.temperature) -
              ["quente", "morno", "frio"].indexOf(b.temperature)
            : (b.created_at || "").localeCompare(a.created_at || ""),
    );
  const mode = view;
  const groups =
    tab === "closer" || mode === "list"
      ? [{ value: "all", label: "Leads" }]
      : mode === "temperature"
        ? temperatures
        : mode === "approach"
          ? APPROACH_STAGES
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
  const renderLead = (lead: CRMLead) => (
    <CRMLeadCard
      key={lead.id}
      lead={lead}
      call={openCalls.get(lead.id)}
      names={names}
      sale={saleMap.get(lead.id)}
      busy={busy}
      onRead={() => setReadId(lead.id)}
      onEdit={() => setEditor(lead)}
      onAction={(name) => setAction({ lead, name })}
      onTransition={(name, data) => {
        void transition(lead, name, data);
      }}
      onSchedule={() => setSchedule({ lead, call: openCalls.get(lead.id) })}
      onQualifyCall={(outcome) => {
        const call = openCalls.get(lead.id);
        if (call)
          void run(async () => {
            try {
              const { error } = await supabase.rpc("resolve_closer_call", {
                p_activity_id: call.id,
                p_outcome: outcome,
                p_expected_revision: call.updated_at,
              });
              if (error) throw error;
            } finally {
              await crm.fetchLeads();
            }
          }, "Qualificação concluída");
      }}
    />
  );
  const retry = () => {
    void crm.fetchLeads();
    void assignees.refetch();
    void sales.refetch();
    void callsQuery.fetchActivities();
    void retryRoles();
  };
  const failure =
    crm.error ||
    callsQuery.error ||
    assignees.error ||
    sales.error ||
    rolesError;
  const loading =
    rolesLoading ||
    crm.loading ||
    callsQuery.loading ||
    assignees.isPending ||
    sales.isPending;
  const permittedTab =
    tab === "leads" ||
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
      {realtimeUnavailable && <p role="status" className="mb-4 rounded-lg border p-3 text-sm text-muted-foreground">Conexão em tempo real indisponível. Atualização automática a cada 15 segundos e ao voltar à janela.</p>}
      <div className="min-w-0 space-y-6">
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
            <Button onClick={() => setEditor("new")} disabled={loading || busy}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Lead
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Leads", value: crm.leads.length, icon: Users },
            {
              label: "Prontos para Closer",
              value: crm.leads.filter(
                (l) => l.pipeline_stage === "pronto_closer",
              ).length,
              icon: Flame,
            },
            {
              label: "Fila Closer",
              value: crm.leads.filter(
                (l) => l.pipeline_stage === "repassado_closer",
              ).length,
              icon: ArrowRight,
            },
            {
              label: "Atrasados",
              value: crm.leads.filter(overdue).length,
              icon: CalendarClock,
            },
          ].map((item) => (
            <Card key={item.label} className="border-border/50">
              <CardContent className="p-4">
                <item.icon className="h-4 w-4 text-muted-foreground mb-2" />
                <p className="text-2xl font-bold">{item.value}</p>
                <p className="text-xs text-muted-foreground">{item.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setParams({ tab: value });
            setView(value === "sdr" ? "pipeline" : "list");
          }}
        >
          <TabsList className="h-auto flex flex-wrap justify-start gap-1 w-fit max-w-full">
            <TabsTrigger value="leads">Leads</TabsTrigger>
            {capabilities.sdr && <TabsTrigger value="sdr">SDR</TabsTrigger>}
            {capabilities.closer && (
              <TabsTrigger value="closer">Closer</TabsTrigger>
            )}
            {capabilities.admin && (
              <>
                <TabsTrigger value="users">Gerenciar Usuários</TabsTrigger>
                <TabsTrigger value="permissions">
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
                  <div className="flex flex-wrap gap-3 justify-between items-center rounded-lg border border-primary/30 bg-primary/5 p-4">
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
                        setTemperature("all");
                        setApproach("all");
                        setPipeline("all");
                        setOwner("all");
                        setOverdueOnly(false);
                      }}
                    >
                      Ver fechamentos
                    </Button>
                  </div>
                )}
                {tab === "closer" ? (
                  <Tabs value={queue} onValueChange={setQueue}>
                    <TabsList className="h-auto flex flex-wrap justify-start gap-1">
                      {queues.map((q) => (
                        <TabsTrigger value={q.value} key={q.value}>
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
                ) : (
                  <Tabs value={mode} onValueChange={setView}>
                    <TabsList className="h-auto flex flex-wrap justify-start gap-1">
                      {[
                        { value: "list", label: "Todos os leads" },
                        { value: "temperature", label: "Aquecimento" },
                        { value: "approach", label: "Abordagem" },
                        { value: "pipeline", label: "Esteira SDR" },
                      ].map((v) => (
                        <TabsTrigger value={v.value} key={v.value}>
                          {v.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
                <div className="rounded-xl border bg-card p-4 space-y-3">
                  <Input
                    aria-label="Buscar leads"
                    placeholder="Buscar responsável, atleta, WhatsApp ou e-mail"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-2">
                    <select
                      className={selectClass}
                      aria-label="Filtrar aquecimento"
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                    >
                      <option value="all">Todo aquecimento</option>
                      {temperatures.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={selectClass}
                      aria-label="Filtrar abordagem"
                      value={approach}
                      onChange={(e) => setApproach(e.target.value)}
                    >
                      <option value="all">Toda abordagem</option>
                      {APPROACH_STAGES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
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
                      value={order}
                      onChange={(e) => setOrder(e.target.value)}
                    >
                      <option value="newest">Mais recentes</option>
                      <option value="name">Nome A–Z</option>
                      <option value="next">Próxima ação</option>
                      <option value="hot">Mais quentes</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
                    <label className="flex gap-2 items-center">
                      <input
                        type="checkbox"
                        checked={overdueOnly}
                        onChange={(e) => setOverdueOnly(e.target.checked)}
                      />
                      Somente atrasados
                    </label>
                    <span>
                      {filtered.length} de {crm.leads.length} leads ·
                      atualização automática
                    </span>
                  </div>
                </div>
                <div
                  className={
                    groups.length > 1
                      ? "grid gap-4 xl:grid-cols-3"
                      : "space-y-4"
                  }
                >
                  {groups.map((group) => {
                    const rows = filtered.filter(
                      (l) => groupFor(l) === group.value,
                    );
                    return (
                      <section key={group.value} className="min-w-0 space-y-3">
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
                                ? "space-y-3"
                                : "grid gap-4 lg:grid-cols-2 2xl:grid-cols-3"
                            }
                          >
                            {rows.map(renderLead)}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                            Nenhum lead nesta visualização.
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        {selected && (
          <CRMLeadDetail
            key={selected.id}
            lead={selected}
            names={names}
            onClose={() => setReadId(null)}
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
            onSave={(data) => transition(action.lead, action.name, data)}
          />
        )}
        {schedule && (
          <CRMCallScheduler
            lead={schedule.lead}
            call={schedule.call}
            onClose={() => setSchedule(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
