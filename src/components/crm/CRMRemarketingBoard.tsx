import { useState } from "react";
import {
  CalendarClock,
  RefreshCcw,
  MessageSquareText,
  UserRound,
} from "lucide-react";
import type { CRMLead } from "@/hooks/useCRM";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { callDate } from "@/lib/crm";
import { brasiliaDateKey } from "@/lib/brasilia-time";
import { inRemarketing } from "@/lib/crm-results";
import { REMARKETING_STATUS_LABELS } from "@/lib/crm-qualification";

export function CRMRemarketingBoard({
  leads,
  names,
  now,
  busy,
  onRead,
  onManage,
}: {
  leads: CRMLead[];
  names: Record<string, string>;
  now: Date;
  busy: boolean;
  onRead: (lead: CRMLead) => void;
  onManage: (lead: CRMLead) => void;
}) {
  const { user } = useAuth();
  const { capabilities } = useRoles();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [owner, setOwner] = useState("all");
  const [day, setDay] = useState("");
  const all = leads.filter((l) =>
    ["lead_perdido", "fechado_perdido"].includes(l.pipeline_stage),
  );
  const active = all.filter(inRemarketing);
  const today = brasiliaDateKey(now);
  const rows = all
    .filter(
      (l) =>
        `${l.name} ${l.athlete_name || ""} ${l.negative_reason || ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()) &&
        (status === "all" ||
          (status === "active"
            ? inRemarketing(l)
            : (l.remarketing_status || "pending") === status)) &&
        (owner === "all" || l.sdr_id === owner) &&
        (!day ||
          (!!l.remarketing_next_at &&
            brasiliaDateKey(l.remarketing_next_at) === day)),
    )
    .sort(
      (a, b) =>
        (a.remarketing_next_at ? Date.parse(a.remarketing_next_at) : 0) -
          (b.remarketing_next_at ? Date.parse(b.remarketing_next_at) : 0) ||
        a.id.localeCompare(b.id),
    );
  return (
    <section aria-label="Fila de remarketing" className="space-y-4">
      <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-card p-5">
        <div className="mb-2 flex items-center gap-2 text-violet-500">
          <RefreshCcw className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Novas oportunidades
          </span>
        </div>
        <h2 className="text-xl font-semibold">Remarketing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Organize os retornos, registre cada tentativa e retome o atendimento
          no momento certo.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Em acompanhamento", active.length],
          [
            "Contatos de hoje",
            active.filter(
              (l) =>
                l.remarketing_next_at &&
                brasiliaDateKey(l.remarketing_next_at) === today,
            ).length,
          ],
          [
            "Retornos atrasados",
            active.filter(
              (l) =>
                l.remarketing_next_at &&
                Date.parse(l.remarketing_next_at) < now.getTime(),
            ).length,
          ],
          [
            "Aguardando agenda",
            active.filter((l) => !l.remarketing_next_at).length,
          ],
        ].map(([label, count]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-semibold tabular-nums">{count}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          Buscar no remarketing
          <Input
            placeholder="Lead, atleta ou motivo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Situação
          <select
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">Em acompanhamento</option>
            <option value="all">Todas as situações</option>
            {Object.entries(REMARKETING_STATUS_LABELS)
              .filter(([value]) => value !== "reactivated")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          SDR responsável
          <select
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
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
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Data do próximo contato
          <Input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <div className="flex items-center justify-between text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
          <span>{rows.length} leads · Brasília · atualização automática</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setStatus("active");
              setOwner("all");
              setDay("");
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {rows.map((lead) => {
          const overdue =
            inRemarketing(lead) &&
            !!lead.remarketing_next_at &&
            Date.parse(lead.remarketing_next_at) < now.getTime();
          const canManage =
            capabilities.sdr &&
            (capabilities.executive ||
              !lead.sdr_id ||
              lead.sdr_id === user?.id);
          return (
            <article
              key={lead.id}
              aria-label={`Remarketing de ${lead.name}`}
              className="space-y-4 rounded-xl border bg-card p-4"
            >
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
                  className="border-violet-500/30 text-violet-500"
                >
                  {REMARKETING_STATUS_LABELS[
                    lead.remarketing_status || "pending"
                  ] || "Pendente"}
                </Badge>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Motivo do retorno
                </p>
                <p className="break-words text-sm">
                  {lead.negative_reason || "Negativa registrada"}
                </p>
              </div>
              <div className="space-y-2 text-xs">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                  {names[lead.sdr_id || ""] || "Fila compartilhada SDR"}
                </p>
                <p
                  className={`flex items-center gap-2 ${overdue ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {lead.remarketing_status === "do_not_contact"
                    ? "Não contatar"
                    : lead.remarketing_next_at
                      ? `${overdue ? "Atrasado · " : ""}${callDate(lead.remarketing_next_at)}`
                      : "Agendar próximo contato"}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  {lead.remarketing_attempt_count} tentativa(s) · Último
                  contato:{" "}
                  {lead.remarketing_last_contact_at
                    ? callDate(lead.remarketing_last_contact_at)
                    : "Ainda não realizado"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRead(lead)}
                >
                  Ver histórico
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => onManage(lead)}
                  >
                    Acompanhar lead
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhum lead encontrado para este acompanhamento.
        </div>
      )}
    </section>
  );
}
