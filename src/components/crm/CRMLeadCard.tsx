import {
  BookOpen,
  Pencil,
  Phone,
  CalendarClock,
  AlertTriangle,
  MoreHorizontal,
  MessageSquareText,
  CalendarPlus,
  PhoneCall,
  Play,
  CircleX,
  Undo2,
  UserCog,
  CheckCircle2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
      className={`min-w-0 rounded-lg border border-l-4 bg-card p-3 space-y-2 ${color} ${overdue ? "border-amber-600/60" : "border-border/60"}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm break-words">{lead.name}</h3>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">Atleta: {lead.athlete_name || "Não informado"}</span>
            {lead.phone ? (
              <a
                href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-primary"
              >
                <Phone className="h-3 w-3 shrink-0" />
                {lead.phone}
              </a>
            ) : (
              <span>WhatsApp não informado</span>
            )}
          </div>
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
                  className="h-8 w-8"
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
      <div className="flex flex-wrap gap-1">
        <Badge className={`h-5 px-2 text-[10px] ${tempColor}`}>
          {{ frio: "Frio", morno: "Morno", quente: "Quente" }[lead.temperature]}
        </Badge>
        <Badge variant="outline" className="h-5 px-2 text-[10px]">{APPROACH_LABELS[lead.approach_stage]}</Badge>
        <Badge variant="secondary" className="h-5 px-2 text-[10px]">
          {PIPELINE_STAGES.find((s) => s.value === lead.pipeline_stage)
            ?.label || lead.pipeline_stage}
        </Badge>
        {incomplete && (
          <Badge variant="outline" className="h-5 px-2 text-[10px] text-amber-400">
            Cadastro incompleto
          </Badge>
        )}
        {overdue && (
          <Badge variant="outline" className="h-5 px-2 text-[10px] text-amber-400">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Atrasado
          </Badge>
        )}
      </div>
      <div className="text-[11px] leading-4 text-muted-foreground">
        <p className="truncate" title={`SDR: ${names[lead.sdr_id || ""] || (lead.sdr_id ? "Usuário anterior" : "Sem responsável")} · Closer: ${names[lead.closer_id || ""] || (lead.closer_id ? "Usuário anterior" : handed ? "Fila compartilhada" : "Sem responsável")}`}>
          SDR:{" "}
          {names[lead.sdr_id || ""] ||
            (lead.sdr_id ? "Usuário anterior" : "Sem responsável")} · Closer:{" "}
          {names[lead.closer_id || ""] ||
            (lead.closer_id
              ? "Usuário anterior"
              : handed
                ? "Fila compartilhada"
                : "Sem responsável")}
        </p>
        <p className="flex min-w-0 items-center gap-1 truncate">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          {next
            ? `${call ? "Próxima call/ação" : "Próximo retorno"}: ${callDate(next)}`
            : "Sem próxima ação agendada"}
        </p>
      </div>
      {lead.pipeline_stage === "pronto_closer" && (
        <p className="text-[11px] leading-4 text-orange-400">Pronto para repasse ao Closer.</p>
      )}
      {capabilities.sdr && (
        <div className="grid grid-cols-2 gap-1.5 border-t border-border/40 pt-2">
          <label className="min-w-0">
            <span className="sr-only">Aquecimento</span>
            <select
              aria-label={`Aquecimento de ${lead.name}`}
              className="h-8 w-full min-w-0 rounded border bg-background px-2 text-[11px]"
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
          <label className="min-w-0">
            <span className="sr-only">Abordagem</span>
            <select
              aria-label={`Abordagem de ${lead.name}`}
              className="h-8 w-full min-w-0 rounded border bg-background px-2 text-[11px]"
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
      <div className="flex items-center gap-1.5 border-t border-border/40 pt-2">
        {!closed && !handed && capabilities.sdr && (
          <Button className="h-8 flex-1 px-2 text-xs" size="sm" disabled={busy} onClick={() => onAction("handoff")}>
            Enviar para Closer
          </Button>
        )}
        {handed && capabilities.closer && !lead.closer_id && (
          <Button className="h-8 flex-1 px-2 text-xs" size="sm" disabled={busy} onClick={() => onTransition("claim")}>
            Assumir lead
          </Button>
        )}
        {handed && capabilities.closer && own && (
          <Button className="h-8 flex-1 px-2 text-xs" size="sm" disabled={busy} onClick={() => onAction("close")}>
            Registrar fechamento
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 shrink-0 px-2 text-xs" disabled={busy} aria-label={`Ações de ${lead.name}`}>
              Ações <MoreHorizontal className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => onAction("contact")}>
              <MessageSquareText className="mr-2 h-4 w-4" /> Registrar contato/anotação
            </DropdownMenuItem>
            {canOperate && (
              <>
                <DropdownMenuItem onSelect={() => onAction("followup")}>
                  <CalendarPlus className="mr-2 h-4 w-4" /> Agendar retorno
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onSchedule}>
                  <PhoneCall className="mr-2 h-4 w-4" /> {call ? "Reagendar call" : "Agendar call"}
                </DropdownMenuItem>
              </>
            )}
            {!closed && !handed && capabilities.sdr && (
              <>
                <DropdownMenuSeparator />
                {lead.pipeline_stage === "novo" && (
                  <DropdownMenuItem onSelect={() => onTransition("qualify")}>
                    <Play className="mr-2 h-4 w-4" /> Iniciar qualificação
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onAction("lose")} className="text-destructive focus:text-destructive">
                  <CircleX className="mr-2 h-4 w-4" /> Lead perdido
                </DropdownMenuItem>
              </>
            )}
            {handed && capabilities.closer && own && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onAction("return")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolver ao SDR
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction("assign")}>
                  <UserCog className="mr-2 h-4 w-4" /> Atribuir lead
                </DropdownMenuItem>
              </>
            )}
            {call?.call_type === "qualificacao" && !call.is_completed && capabilities.sdr && (capabilities.admin || call.assigned_to === user?.id) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onQualifyCall("avancou")}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Concluir qualificação
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {lead.pipeline_stage === "fechado_ganho" && (
        <div
          className="border border-primary/30 bg-primary/5 rounded-md p-2 space-y-1.5"
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
