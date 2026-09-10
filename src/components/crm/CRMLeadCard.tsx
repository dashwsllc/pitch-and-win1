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
  emphasizeCall = false,
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
  emphasizeCall?: boolean;
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
  const own = lead.closer_id === user?.id;
  const canManage = capabilities.admin || own;
  const canOperate =
    !closed &&
    (handed
      ? capabilities.closer && !!lead.closer_id && canManage
      : capabilities.sdr);
  const canSchedule =
    !closed &&
    (handed
      ? capabilities.closer && (!lead.closer_id || canManage)
      : capabilities.sdr);
  const next = [lead.next_followup_at, call?.scheduled_at]
    .filter(Boolean)
    .sort()[0];
  const callMoment = call?.scheduled_at ? new Date(call.scheduled_at) : null;
  const callDay = callMoment?.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const callTime = callMoment?.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const showFollowup =
    !!lead.next_followup_at &&
    (!callMoment ||
      Math.abs(new Date(lead.next_followup_at).getTime() - callMoment.getTime()) >
        60_000);
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
      className={`min-w-0 self-start rounded-lg border border-l-4 bg-card p-3 space-y-2 ${color} ${overdue ? "border-amber-600/60" : "border-border/60"}`}
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
        {!emphasizeCall && (
          <p className="flex min-w-0 items-center gap-1 truncate">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            {next
              ? `${call ? "Próxima call/ação" : "Próximo retorno"}: ${callDate(next)}`
              : "Sem próxima ação agendada"}
          </p>
        )}
        {emphasizeCall && showFollowup && (
          <p className="truncate">Próximo retorno: {callDate(lead.next_followup_at)}</p>
        )}
      </div>
      {emphasizeCall && (
        <div
          role="status"
          aria-label={
            callMoment
              ? `Call agendada para ${callDay} às ${callTime}`
              : "Call ainda não agendada"
          }
          className={`rounded-md border px-2.5 py-2 ${
            callMoment
              ? callMoment < new Date()
                ? "border-amber-500/60 bg-amber-500/10"
                : "border-primary/40 bg-primary/10"
              : "border-border/70 bg-muted/30"
          }`}
        >
          {callMoment ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {callMoment < new Date() ? "Call atrasada" : "Call agendada"}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                <span>Data: {callDay}</span>
                <span className="rounded bg-background/80 px-1.5 py-0.5 text-primary">
                  Horário: {callTime}
                </span>
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
              Call ainda não agendada
            </p>
          )}
        </div>
      )}
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
          <Button className="h-8 flex-1 px-2 text-xs" size="sm" disabled={busy} onClick={onSchedule}>
            Agendar call e enviar
          </Button>
        )}
        {handed && capabilities.closer && !lead.closer_id && (
          <Button className="h-8 flex-1 px-2 text-xs" size="sm" disabled={busy} onClick={() => onTransition("claim")}>
            Assumir lead
          </Button>
        )}
        {handed && capabilities.closer && !!lead.closer_id && canManage && (
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
              </>
            )}
            {canSchedule && (
              <>
                <DropdownMenuItem onSelect={onSchedule}>
                  <PhoneCall className="mr-2 h-4 w-4" /> {call ? "Reagendar call" : handed ? "Agendar call" : "Agendar call e enviar ao Closer"}
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
            {handed && capabilities.closer && !!lead.closer_id && canManage && (
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
            {handed && capabilities.closer && !lead.closer_id && capabilities.admin && (
              <>
                <DropdownMenuSeparator />
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
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-2"
          role="status"
        >
          <p className="text-xs font-medium">
            {sale ? "Venda cadastrada" : "Venda pendente de cadastro"}
          </p>
          {sale
            ? sale.can_open && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 whitespace-normal px-2 text-xs"
                  onClick={() =>
                    navigate(`/minhas-vendas?sale=${sale.sale_id}`)
                  }
                >
                  Abrir venda cadastrada
                </Button>
              )
            : capabilities.sales &&
              canManage && (
                <Button
                  size="sm"
                  className="h-8 whitespace-normal px-2 text-xs"
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
