import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CRMLead,
  PIPELINE_STAGES,
  APPROACH_LABELS,
  useCRMActivities,
} from "@/hooks/useCRM";
import { callDate } from "@/lib/crm";
import type { Json } from "@/integrations/supabase/types";

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
  names,
}: {
  lead: CRMLead;
  onClose: () => void;
  names: Record<string, string>;
}) {
  const { activities, loading, error, fetchActivities } = useCRMActivities(
    lead.id,
  );
  const fields: [string, string | number | null][] = [
    ["Responsável", lead.name],
    ["Atleta", lead.athlete_name],
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
        className="w-full sm:max-w-[620px] overflow-y-auto"
        data-lenis-prevent
      >
        <SheetHeader>
          <SheetTitle>Ficha de {lead.name}</SheetTitle>
          <SheetDescription>
            Cadastro e histórico completo · leitura
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6 break-words">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{lead.temperature}</Badge>
            <Badge variant="outline">
              {APPROACH_LABELS[lead.approach_stage]}
            </Badge>
            <Badge variant="secondary">
              {PIPELINE_STAGES.find((s) => s.value === lead.pipeline_stage)
                ?.label || lead.pipeline_stage}
            </Badge>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            {fields.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm whitespace-pre-wrap break-words">
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
          <section className="space-y-3 border-t pt-4">
            <h2 className="font-semibold">Histórico do lead</h2>
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
                <article key={a.id} className="rounded-lg border p-3 space-y-2">
                  <p className="font-medium text-sm">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.author_name || names[a.user_id] || a.user_id} ·{" "}
                    {callDate(a.created_at)}
                  </p>
                  {a.description && (
                    <p className="text-sm whitespace-pre-wrap">
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
                    <p className="text-sm">
                      Call: {callDate(a.scheduled_at)} ·{" "}
                      {names[a.assigned_to || ""] || "Sem responsável"}
                    </p>
                  )}
                  {a.outcome && (
                    <Badge variant="outline">
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
