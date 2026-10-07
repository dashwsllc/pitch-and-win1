import { useState } from "react";
import { PIPELINE_STAGES, type CRMLead } from "@/hooks/useCRM";
import type { TablesInsert } from "@/integrations/supabase/types";
import { CRMContactFields } from "./CRMContactFields";
import {
  contactFromLead,
  contactPayload,
  emptyContact,
  findDuplicateLeads,
  validateContact,
} from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function CRMLeadEditor({
  lead,
  existingLeads = [],
  busy,
  onClose,
  onSave,
}: {
  lead?: CRMLead;
  /** Os leads que o CRM já tem: base do aviso de WhatsApp ou e-mail que já existe em outro lead. */
  existingLeads?: CRMLead[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: TablesInsert<"crm_leads">) => Promise<boolean>;
}) {
  const [contact, setContact] = useState(
    lead ? contactFromLead(lead) : { ...emptyContact },
  );
  const [extra, setExtra] = useState({
    lead_source: lead?.lead_source || "",
    estimated_deal_value: String(lead?.estimated_deal_value ?? ""),
    observations: lead?.observations || "",
    priority: lead?.priority || "",
  });
  const [failure, setFailure] = useState("");
  const [duplicates, setDuplicates] = useState<CRMLead[]>([]);
  const owners = (item: CRMLead) => item.athlete_name?.trim() || item.name;
  const stageLabel = (item: CRMLead) =>
    PIPELINE_STAGES.find((stage) => stage.value === item.pipeline_stage)?.label || item.pipeline_stage;
  // `force`: quem viu o aviso e decidiu salvar mesmo assim. Na edição só se avisa quando o WhatsApp ou o e-mail mudou
  // (um lead que já nasceu duplicado não pode ficar impossível de editar).
  const submit = async (force: boolean) => {
    if (busy) return;
    const invalid = validateContact(contact);
    if (invalid) {
      setFailure(invalid);
      return;
    }
    setFailure("");
    if (!force) {
      const changed = !lead || contact.phone.trim() !== (lead.phone ?? "") || contact.email.trim() !== (lead.email ?? "");
      const found = changed ? findDuplicateLeads(contact, existingLeads, lead?.id) : [];
      setDuplicates(found);
      if (found.length) return;
    }
    const ok = await onSave({
      ...contactPayload(contact),
      lead_source: extra.lead_source.trim() || null,
      estimated_deal_value:
        extra.estimated_deal_value === ""
          ? null
          : Number(extra.estimated_deal_value),
      observations: extra.observations.trim() || null,
      priority: extra.priority || null,
    });
    if (ok) onClose();
    else
      setFailure(
        "Não foi possível salvar. Confira a mensagem de erro e tente novamente.",
      );
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    return submit(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[92dvh] gap-3 overflow-y-auto p-4 sm:max-w-[720px]"
        data-lenis-prevent
      >
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo Lead"}</DialogTitle>
          <DialogDescription>
            {lead
              ? "Atualize o cadastro compartilhado entre Leads, SDR e Closer."
              : "Comece com responsável, atleta e WhatsApp. O lead entra na etapa Novo."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <fieldset disabled={busy} className="space-y-3">
            <CRMContactFields
              value={contact}
              onChange={(next) => {
                setContact(next);
                setDuplicates([]);
              }}
              prefix="lead-editor"
            />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="lead-source">Origem</Label>
                <Input
                  className="h-9"
                  id="lead-source"
                  maxLength={160}
                  value={extra.lead_source}
                  onChange={(e) =>
                    setExtra({ ...extra, lead_source: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="lead-value">Valor estimado (R$)</Label>
                <Input
                  className="h-9"
                  id="lead-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={extra.estimated_deal_value}
                  onChange={(e) =>
                    setExtra({ ...extra, estimated_deal_value: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="lead-priority">Prioridade</Label>
              <select
                id="lead-priority"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={extra.priority}
                onChange={(e) =>
                  setExtra({ ...extra, priority: e.target.value })
                }
              >
                <option value="">Não informada</option>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="lead-observations">Observações</Label>
              <Textarea
                id="lead-observations"
                className="min-h-16"
                maxLength={10000}
                value={extra.observations}
                onChange={(e) =>
                  setExtra({ ...extra, observations: e.target.value })
                }
              />
            </div>
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
            {duplicates.length > 0 && (
              <div role="alert" aria-label="Lead possivelmente duplicado" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">
                  {duplicates.length === 1 ? "Já existe um lead com este WhatsApp ou e-mail:" : `Já existem ${duplicates.length} leads com este WhatsApp ou e-mail:`}
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {duplicates.map((item) => (
                    <li key={item.id}>
                      <span className="font-medium text-foreground">{owners(item)}</span> · responsável {item.name} · {stageLabel(item)} · {item.phone || item.email}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Se for a mesma pessoa, abra o lead que já existe em vez de criar outro. Se for outro atleta do mesmo responsável, salve mesmo assim.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setDuplicates([])}>
                    Revisar os dados
                  </Button>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void submit(true)}>
                    Salvar mesmo assim
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter className="gap-1 sm:space-x-0">
              <Button className="h-9" type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button className="h-9" type="submit">
                {busy ? "Salvando..." : lead ? "Salvar cadastro" : "Criar Lead"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
