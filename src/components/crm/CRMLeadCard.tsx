import {
  BookOpen,
  Pencil,
  Phone,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CRMLead,
  CRMActivity,
  APPROACH_STAGES,
  APPROACH_LABELS,
  PIPELINE_STAGES,
} from "@/hooks/useCRM";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { callDate } from "@/lib/crm";
import type { Json } from "@/integrations/supabase/types";

export function CRMLeadCard({
  lead,
  call,
  names,
  busy,
  sale,
  onRead,
  onEdit,
  onAction,
  onTransition,
  onSchedule,
  onQualifyCall,
}: {
  lead: CRMLead;
  call?: CRMActivity;
  names: Record<string, string>;
  busy: boolean;
  sale?: { sale_id: string | null; can_open: boolean };
  onRead: () => void;
  onEdit: () => void;
  onAction: (action: string) => void;
  onTransition: (action: string, data?: Json) => void;
  onSchedule: () => void;
  onQualifyCall: (outcome: string) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { capabilities } = useRoles();
  const closed = ["fechado_ganho", "fechado_perdido", "lead_perdido"].includes(
    lead.pipeline_stage,
  );
  const handed = lead.pipeline_stage === "repassado_closer";
  const own = capabilities.admin || lead.closer_id === user?.id;
  const canOperate =
    !closed && (handed ? capabilities.closer && own : capabilities.sdr);
  const next = [lead.next_followup_at, call?.scheduled_at]
    .filter(Boolean)
    .sort()[0];
  const overdue = !closed && !!next && new Date(next) < new Date();
  const incomplete =
    !lead.name?.trim() || !lead.athlete_name?.trim() || !lead.phone?.trim();
  const color = {
    frio: "border-l-slate-500",
    morno: "border-l-yellow-600",
    quente: "border-l-orange-600",
  }[lead.temperature];
  const tempColor = {
    frio: "bg-slate-500/15 text-slate-300",
    morno: "bg-yellow-600/15 text-yellow-500",
    quente: "bg-orange-600/15 text-orange-400",
  }[lead.temperature];
  return (
    <article
      aria-label={`Lead ${lead.name}`}
      className={`min-w-0 rounded-xl border border-l-4 bg-card p-4 space-y-3 ${color} ${overdue ? "border-amber-600/60" : "border-border/60"}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm break-words">{lead.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground break-words">
            Atleta: {lead.athlete_name || "Não informado"}
          </p>
        </div>
        <div className="flex shrink-0">
          {[
            {
              label: `Abrir ficha de ${lead.name}`,
              icon: BookOpen,
              action: onRead,
              tip: "Abrir ficha e histórico",
            },
            {
              label: `Editar ${lead.name}`,
              icon: Pencil,
              action: onEdit,
              tip: "Editar cadastro",
            },
          ].map((item) => (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label={item.label}
                  title={item.tip}
                  onClick={item.action}
                  disabled={busy}
                >
                  <item.icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{item.tip}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      {lead.phone ? (
        <a
          href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs hover:text-primary break-all"
        >
          <Phone className="h-3 w-3 shrink-0" />
          {lead.phone}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">WhatsApp não informado</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Badge className={tempColor}>
          {{ frio: "Frio", morno: "Morno", quente: "Quente" }[lead.temperature]}
        </Badge>
        <Badge variant="outline">{APPROACH_LABELS[lead.approach_stage]}</Badge>
        <Badge variant="secondary">
          {PIPELINE_STAGES.find((s) => s.value === lead.pipeline_stage)
            ?.label || lead.pipeline_stage}
        </Badge>
        {incomplete && (
          <Badge variant="outline" className="text-amber-400">
            Cadastro incompleto
          </Badge>
        )}
        {overdue && (
          <Badge variant="outline" className="text-amber-400">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Atrasado
          </Badge>
        )}
      </div>
      <div className="space-y-1 text-xs text-muted-foreground break-words">
        <p>
          SDR:{" "}
          {names[lead.sdr_id || ""] ||
            (lead.sdr_id ? "Usuário anterior" : "Sem responsável")}
        </p>
        <p>
          Closer:{" "}
          {names[lead.closer_id || ""] ||
            (lead.closer_id
              ? "Usuário anterior"
              : handed
                ? "Fila compartilhada"
                : "Sem responsável")}
        </p>
        <p className="flex gap-1">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          {next
            ? `${call ? "Próxima call/ação" : "Próximo retorno"}: ${callDate(next)}`
            : "Sem próxima ação agendada"}
        </p>
      </div>
      {lead.pipeline_stage === "pronto_closer" && (
        <p className="text-xs text-orange-400">
          Quente e com contato estabelecido. Pronto para repasse explícito.
        </p>
      )}
      {capabilities.sdr && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border/40 pt-3">
          <label className="space-y-1 min-w-0">
            <span className="text-[11px] text-muted-foreground">
              Aquecimento
            </span>
            <select
              aria-label={`Aquecimento de ${lead.name}`}
              className="h-9 w-full min-w-0 rounded border bg-background px-2 text-xs"
              value={lead.temperature}
              disabled={busy}
              onChange={(e) =>
                onTransition("classify", { temperature: e.target.value })
              }
            >
              <option value="frio">Frio</option>
              <option value="morno">Morno</option>
              <option value="quente">Quente</option>
            </select>
          </label>
          <label className="space-y-1 min-w-0">
            <span className="text-[11px] text-muted-foreground">Abordagem</span>
            <select
              aria-label={`Abordagem de ${lead.name}`}
              className="h-9 w-full min-w-0 rounded border bg-background px-2 text-xs"
              value={lead.approach_stage}
              disabled={busy}
              onChange={(e) =>
                onTransition("approach", { stage: e.target.value })
              }
            >
              {APPROACH_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {APPROACH_LABELS[s.value]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onAction("contact")}
        >
          Registrar contato/anotação
        </Button>
        {canOperate && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onAction("followup")}
            >
              Agendar retorno
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onSchedule}
            >
              {call ? "Reagendar call" : "Agendar call"}
            </Button>
          </>
        )}
        {!closed && !handed && capabilities.sdr && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onAction("handoff")}
            >
              Enviar para Closer
            </Button>
            {lead.pipeline_stage === "novo" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onTransition("qualify")}
              >
                Iniciar qualificação
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onAction("lose")}
            >
              Lead perdido
            </Button>
          </>
        )}
        {handed && capabilities.closer && !lead.closer_id && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onTransition("claim")}
          >
            Assumir lead
          </Button>
        )}
        {handed && capabilities.closer && own && (
          <>
            <Button size="sm" disabled={busy} onClick={() => onAction("close")}>
              Registrar fechamento
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onAction("return")}
            >
              Devolver ao SDR
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onAction("assign")}
            >
              Atribuir lead
            </Button>
          </>
        )}
        {call?.call_type === "qualificacao" &&
          !call.is_completed &&
          capabilities.sdr &&
          (capabilities.admin || call.assigned_to === user?.id) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onQualifyCall("avancou")}
            >
              Concluir qualificação
            </Button>
          )}
      </div>
      {lead.pipeline_stage === "fechado_ganho" && (
        <div
          className="border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-2"
          role="status"
        >
          <p className="text-sm font-medium">
            {sale ? "Venda cadastrada" : "Venda pendente de cadastro"}
          </p>
          {sale
            ? sale.can_open && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-auto whitespace-normal"
                  onClick={() =>
                    navigate(`/minhas-vendas?sale=${sale.sale_id}`)
                  }
                >
                  Abrir venda cadastrada
                </Button>
              )
            : capabilities.sales &&
              own && (
                <Button
                  size="sm"
                  className="h-auto whitespace-normal py-2"
                  onClick={() => navigate(`/vendas?lead=${lead.id}`)}
                >
                  Cadastrar venda no módulo Vendas
                </Button>
              )}
        </div>
      )}
    </article>
  );
}
