import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-react";
import {
  CRMLead,
  PIPELINE_STAGES,
  APPROACH_LABELS,
  useCRMActivities,
} from "@/hooks/useCRM";
import { callDate } from "@/lib/crm";
import {
  DECISION_MAKERS,
  INCOME_RANGES,
  PURCHASE_TIMELINES,
  REMARKETING_STATUS_LABELS,
  optionLabel,
} from "@/lib/crm-qualification";
import { formatAthleteAge, resolveAthleteAge } from "@/lib/crm-age";
import type { Json } from "@/integrations/supabase/types";
import { CRMContextPanel } from "./CRMContextPanel";

const stateLabels: Record<string, string> = {
  temperature: "Aquecimento",
  approach_stage: "Abordagem",
  pipeline_stage: "Pipeline",
  sdr_id: "SDR",
  closer_id: "Closer",
  next_followup_at: "Próximo retorno",
  version: "Revisão",
};
const valueLabel = (value: Json | undefined, names: Record<string, string>) => {
  if (value === null || value === undefined) return "Sem definição";
  const text = String(value);
  return (
    names[text] ||
    APPROACH_LABELS[text] ||
    PIPELINE_STAGES.find((s) => s.value === text)?.label ||
    { frio: "Frio", morno: "Morno", quente: "Quente" }[text] ||
    (/^\d{4}-\d{2}-\d{2}T/.test(text) ? callDate(text) : text)
  );
};
export function CRMLeadDetail({
  lead,
  onClose,
  onEdit,
  onDelete,
  busy,
  names,
}: {
  lead: CRMLead;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
  names: Record<string, string>;
}) {
  const { activities, loading, error, fetchActivities } = useCRMActivities(
    lead.id,
  );
  const fields: [string, string | number | null][] = [
    ["Atleta", lead.athlete_name],
    ["Idade", formatAthleteAge(lead)],
    ["Responsável", lead.name],
    ["WhatsApp", lead.phone],
    ["E-mail", lead.email],
    ["Cidade / UF", lead.city_state],
    ["Nascimento", lead.athlete_birth_date],
    ["Posição", lead.athlete_position],
    ["Altura (cm)", lead.athlete_height_cm],
    ["Peso (kg)", lead.athlete_weight_kg],
    ["Origem", lead.lead_source],
    ["Valor estimado", lead.estimated_deal_value],
    ["Prioridade", lead.priority],
    ["Observações", lead.observations],
    ["SDR", names[lead.sdr_id || ""] || lead.sdr_id],
    ["Closer", names[lead.closer_id || ""] || lead.closer_id],
    [
      "Próximo retorno",
      lead.next_followup_at ? callDate(lead.next_followup_at) : null,
    ],
    ["Repasse", lead.handed_off_at ? callDate(lead.handed_off_at) : null],
    ["Fechamento", lead.closed_at ? callDate(lead.closed_at) : null],
    ["Último resultado", lead.last_result_outcome ? (lead.last_result_outcome === "venda_concluida" ? "Venda concluída" : "Venda recusada") : null],
    ["Data do resultado", lead.last_result_at ? callDate(lead.last_result_at) : null],
    ["Closer do resultado", lead.last_result_closer_name],
    ["Faixa de renda", optionLabel(INCOME_RANGES, lead.qualification_income_range)],
    ["Decisor", optionLabel(DECISION_MAKERS, lead.qualification_decision_maker)],
    ["Prazo de decisão", optionLabel(PURCHASE_TIMELINES, lead.qualification_timeline)],
    ["Objetivo", lead.qualification_goal],
    ["Resumo da qualificação", lead.qualification_summary],
    ["Motivo da negativa", lead.negative_reason],
    ["Remarketing", lead.remarketing_status ? REMARKETING_STATUS_LABELS[lead.remarketing_status] || lead.remarketing_status : null],
    ["Próximo remarketing", lead.remarketing_next_at ? callDate(lead.remarketing_next_at) : null],
    ["Tentativas de remarketing", lead.remarketing_attempt_count ? String(lead.remarketing_attempt_count) : null],
    ["Tentativas de contato", lead.approach_count],
    ["Empresa (histórico)", lead.company],
    ["Cargo (histórico)", lead.job_title],
  ];
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="w-full overflow-y-auto p-4 sm:max-w-[680px]"
        data-lenis-prevent
      >
        <SheetHeader className="space-y-1 pr-24">
          <SheetTitle className="text-base">
            Ficha de {lead.athlete_name?.trim() || lead.name}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Cadastro e histórico completo · leitura
          </SheetDescription>
        </SheetHeader>
        <div className="absolute right-11 top-2 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            aria-label={`Editar ${lead.athlete_name?.trim() || lead.name}`}
            title="Editar cadastro"
            onClick={onEdit}
            disabled={busy}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Excluir lead de ${lead.athlete_name?.trim() || lead.name}`}
            title="Excluir lead"
            onClick={onDelete}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 space-y-4 break-words">
          <div className="flex flex-wrap gap-1">
            <Badge className="h-5 px-2 text-[10px]" variant="outline">{lead.temperature}</Badge>
            <Badge className="h-5 px-2 text-[10px]" variant="outline">
              {APPROACH_LABELS[lead.approach_stage]}
            </Badge>
            <Badge className="h-5 px-2 text-[10px]" variant="secondary">
              {PIPELINE_STAGES.find((s) => s.value === lead.pipeline_stage)
                ?.label || lead.pipeline_stage}
            </Badge>
          </div>
          <CRMContextPanel lead={lead} />
          <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-3">
            {fields.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-xs leading-4 whitespace-pre-wrap break-words">
                  {value ?? "Não informado"}
                </dd>
              </div>
            ))}
          </dl>
          {lead.performance_report_url &&
            /^https:\/\//.test(lead.performance_report_url) && (
              <a
                href={lead.performance_report_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Abrir relatório de performance
              </a>
            )}
          <section className="space-y-2 border-t pt-3">
            <h2 className="text-sm font-semibold">Histórico do lead</h2>
            {loading && <p role="status">Carregando histórico...</p>}
            {error && (
              <div role="alert">
                Não foi possível carregar o histórico.{" "}
                <Button variant="outline" onClick={() => fetchActivities()}>
                  Tentar novamente
                </Button>
              </div>
            )}
            {!loading && !error && !activities.length && (
              <p className="text-sm text-muted-foreground">
                Nenhuma atividade registrada.
              </p>
            )}
            {activities.map((a) => {
              const before =
                a.previous_state &&
                typeof a.previous_state === "object" &&
                !Array.isArray(a.previous_state)
                  ? a.previous_state
                  : {};
              const after =
                a.new_state &&
                typeof a.new_state === "object" &&
                !Array.isArray(a.new_state)
                  ? a.new_state
                  : {};
              return (
                <article key={a.id} className="rounded-md border p-2 space-y-1">
                  <p className="font-medium text-xs">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.author_name || names[a.user_id] || a.user_id} ·{" "}
                    {callDate(a.created_at)}
                  </p>
                  {a.description && (
                    <p className="text-xs leading-4 whitespace-pre-wrap">
                      {a.description}
                    </p>
                  )}
                  {Object.entries(after)
                    .filter(
                      ([key, value]) =>
                        key !== "version" && value !== before[key],
                    )
                    .map(([key, value]) => (
                      <p className="text-xs" key={key}>
                        {stateLabels[key] || key}:{" "}
                        {valueLabel(before[key], names)} →{" "}
                        {valueLabel(value, names)}
                      </p>
                    ))}
                  {a.scheduled_at && (
                    <p className="text-xs">
                      Call: {callDate(a.scheduled_at)} ·{" "}
                      {names[a.assigned_to || ""] || "Sem responsável"}
                    </p>
                  )}
                  {a.outcome && (
                    <Badge className="h-5 px-2 text-[10px]" variant="outline">
                      {{
                        venda_concluida: "Venda concluída",
                        venda_perdida: "Venda perdida",
                        followup: "Follow-up necessário",
                        devolvido_sdr: "Devolvido ao SDR",
                        repassado_closer: "Enviado ao Closer",
                        avancou: "Avançou",
                        lead_perdido: "Lead perdido",
                      }[a.outcome] || a.outcome}
                    </Badge>
                  )}
                  {a.completed_at && (
                    <p className="text-xs text-muted-foreground">
                      Concluído em {callDate(a.completed_at)}
                    </p>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
