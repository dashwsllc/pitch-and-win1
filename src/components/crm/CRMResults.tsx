import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleX,
  RefreshCcw,
  Undo2,
  Trophy,
  UserRound,
} from "lucide-react";
import type { CRMLead } from "@/hooks/useCRM";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callDate } from "@/lib/crm";
import {
  canReopenResult,
  inRemarketing,
  leadResult,
  resultDate,
  resultMatches,
  type CRMResultSale,
} from "@/lib/crm-results";

const approvalLabels: Record<string, string> = {
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
  pendente: "Aguardando aprovação",
  unregistered: "Sem venda cadastrada",
};
const selectClass =
  "h-10 min-w-0 w-full rounded-md border bg-background px-3 text-sm";

export function CRMResults({
  leads,
  sales,
  names,
  closerView = false,
  busy,
  onRead,
  onReturn,
  onRemarketing,
}: {
  leads: CRMLead[];
  sales: Map<string, CRMResultSale>;
  names: Record<string, string>;
  closerView?: boolean;
  busy: boolean;
  onRead: (lead: CRMLead) => void;
  onReturn: (lead: CRMLead, target: "sdr" | "closer") => void;
  onRemarketing: (lead: CRMLead) => void;
}) {
  const { user } = useAuth();
  const { capabilities } = useRoles();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    search: "",
    outcome: "all",
    approval: "all",
    seller: "all",
    from: "",
    to: "",
  });
  const setFilter = (key: keyof typeof filters, value: string) =>
    setFilters((old) => ({ ...old, [key]: value }));
  const results = leads.filter((lead) => !!leadResult(lead));
  const sellers = new Map<string, string>();
  results.forEach((lead) => {
    const sale = sales.get(lead.id);
    const id =
      sale?.seller_id ||
      lead.last_result_closer_id ||
      lead.closer_id ||
      lead.sdr_id;
    if (id)
      sellers.set(
        id,
        sale?.seller_name ||
          names[id] ||
          lead.last_result_closer_name ||
          "Responsável indisponível",
      );
  });
  const rows = results
    .filter((lead) => resultMatches(lead, sales.get(lead.id), filters))
    .sort(
      (a, b) =>
        (resultDate(b) || "").localeCompare(resultDate(a) || "") ||
        a.id.localeCompare(b.id),
    );
  const won = rows.filter((l) => leadResult(l) === "venda_concluida").length;
  const remarketing = rows.filter(inRemarketing).length;
  return (
    <section
      className="space-y-4"
      aria-label={closerView ? "Resultados do Closer" : "Resultados comerciais"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Trophy className="h-4 w-4" />
            {closerView ? "Desempenho dos closers" : "Visão comercial"}
          </div>
          <h2 className="text-xl font-semibold">Resultados</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Último resultado de cada lead, aprovação da venda e acompanhamento
            atual.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <RefreshCcw className="h-3 w-3" /> Atualização automática
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Leads com resultado",
            count: rows.length,
            icon: Trophy,
            color: "text-foreground",
          },
          {
            label: "Vendas concluídas",
            count: won,
            icon: CheckCircle2,
            color: "text-emerald-500",
          },
          {
            label: "Vendas recusadas",
            count: rows.length - won,
            icon: CircleX,
            color: "text-rose-500",
          },
          {
            label: "Em remarketing",
            count: remarketing,
            icon: RefreshCcw,
            color: "text-violet-500",
          },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border bg-card p-4">
            <item.icon className={`mb-3 h-4 w-4 ${item.color}`} />
            <p className="text-2xl font-semibold tabular-nums">{item.count}</p>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Buscar lead ou vendedor
          <Input
            className="h-10"
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Nome do lead, atleta ou vendedor"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Resultado
          <select
            aria-label="Resultado"
            className={selectClass}
            value={filters.outcome}
            onChange={(e) => setFilter("outcome", e.target.value)}
          >
            <option value="all">Todos os resultados</option>
            <option value="won">Venda concluída</option>
            <option value="lost">Venda recusada</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Aprovação da venda
          <select
            aria-label="Aprovação da venda"
            className={selectClass}
            value={filters.approval}
            onChange={(e) => setFilter("approval", e.target.value)}
          >
            <option value="all">Todas as categorias</option>
            {Object.entries(approvalLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Vendedor
          <select
            aria-label="Vendedor"
            className={selectClass}
            value={filters.seller}
            onChange={(e) => setFilter("seller", e.target.value)}
          >
            <option value="all">Todos os vendedores</option>
            {[...sellers]
              .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Resultado a partir de
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Resultado até
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 xl:col-span-3">
          <p className="text-xs text-muted-foreground">
            {rows.length} de {results.length} resultados · Datas de Brasília
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setFilters({
                search: "",
                outcome: "all",
                approval: "all",
                seller: "all",
                from: "",
                to: "",
              })
            }
          >
            Limpar filtros
          </Button>
        </div>
        {filters.from && filters.to && filters.from > filters.to && (
          <p
            role="alert"
            className="text-xs text-destructive sm:col-span-2 xl:col-span-3"
          >
            A data inicial deve ser anterior ou igual à data final.
          </p>
        )}
      </div>
      {!rows.length && (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhum resultado encontrado para estes filtros.
        </div>
      )}
      <div
        className={
          closerView ? "grid items-start gap-4 lg:grid-cols-2" : "space-y-3"
        }
      >
        {rows.map((lead) => {
          const sale = sales.get(lead.id);
          const approved = sale?.approval_status || "unregistered";
          const concluded = leadResult(lead) === "venda_concluida";
          const closer =
            lead.last_result_closer_name ||
            names[lead.last_result_closer_id || lead.closer_id || ""] ||
            "Sem Closer atribuído";
          const canReturn = canReopenResult(lead, user?.id, capabilities);
          const canRemarket =
            capabilities.sdr &&
            (capabilities.executive ||
              !lead.sdr_id ||
              lead.sdr_id === user?.id);
          const current = inRemarketing(lead)
            ? "Em remarketing"
            : lead.remarketing_status === "do_not_contact"
              ? "Remarketing encerrado"
              : lead.pipeline_stage === "repassado_closer"
                ? "Em atendimento · Closer"
                : ![
                      "fechado_ganho",
                      "fechado_perdido",
                      "lead_perdido",
                    ].includes(lead.pipeline_stage)
                  ? "Em atendimento · SDR"
                  : "Atendimento encerrado";
          return (
            <article
              key={lead.id}
              aria-label={`Resultado de ${lead.name}`}
              className={`overflow-hidden rounded-xl border bg-card ${closerView ? "" : "lg:flex lg:items-center"}`}
            >
              <div
                className={`${closerView ? "border-b" : "lg:w-52 lg:shrink-0 lg:self-stretch lg:border-r"} bg-muted/30 p-4`}
              >
                <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" /> Closer
                </p>
                <p className="break-words font-semibold">{closer}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {callDate(resultDate(lead))}
                </p>
                {sale && sale.seller_name !== closer && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Vendedor: {sale.seller_name}
                  </p>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">
                      {lead.athlete_name || lead.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      LEAD: {lead.name}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      concluded
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                    }
                  >
                    {concluded ? "Venda concluída" : "Venda recusada"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {approvalLabels[approved] || approved}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      inRemarketing(lead)
                        ? "border-violet-500/30 text-violet-500"
                        : "text-muted-foreground"
                    }
                  >
                    {current}
                  </Badge>
                </div>
                {!concluded && lead.negative_reason && (
                  <p className="text-sm text-muted-foreground">
                    {lead.negative_reason}
                  </p>
                )}
                {inRemarketing(lead) && (
                  <p className="text-xs text-muted-foreground">
                    Próximo contato: {callDate(lead.remarketing_next_at)} ·{" "}
                    {lead.remarketing_attempt_count} tentativa(s)
                  </p>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRead(lead)}
                  >
                    Ver lead
                  </Button>
                  {canReturn && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onReturn(lead, "sdr")}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                        Devolver ao SDR
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onReturn(lead, "closer")}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                        Devolver ao Closer
                      </Button>
                    </>
                  )}
                  {inRemarketing(lead) && canRemarket && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onRemarketing(lead)}
                    >
                      <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                      Acompanhar
                    </Button>
                  )}
                  {sale?.can_open && sale.sale_id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        navigate(`/minhas-vendas?sale=${sale.sale_id}`)
                      }
                    >
                      Abrir venda
                      <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  )}
                  {!sale &&
                    lead.pipeline_stage === "fechado_ganho" &&
                    capabilities.sales &&
                    (capabilities.executive || lead.closer_id === user?.id) && (
                      <Button
                        size="sm"
                        onClick={() => navigate(`/vendas?lead=${lead.id}`)}
                      >
                        Cadastrar venda
                      </Button>
                    )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
