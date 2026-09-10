import { useState } from "react";
import type { CRMLead } from "@/hooks/useCRM";
import type { Json } from "@/integrations/supabase/types";
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

const actionTitles: Record<string, string> = {
  assign: "Atribuir lead",
  contact: "Registrar contato/anotação",
  note: "Registrar anotação",
  followup: "Agendar retorno",
  close: "Registrar fechamento",
  return: "Devolver ao SDR",
  lose: "Marcar lead perdido",
};
export function CRMActionDialog({
  lead,
  action,
  candidates,
  busy,
  onClose,
  onSave,
}: {
  lead: CRMLead;
  action: string;
  candidates: { user_id: string; display_name: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Json) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [assigned, setAssigned] = useState(lead.closer_id || "");
  const [outcome, setOutcome] = useState("");
  const [when, setWhen] = useState("");
  const [failure, setFailure] = useState("");
  const needsDate =
    action === "followup" || (action === "close" && outcome === "followup");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (
      needsDate &&
      (!when ||
        !Number.isFinite(+new Date(when)) ||
        new Date(when) <= new Date())
    ) {
      setFailure("Escolha uma próxima data futura.");
      return;
    }
    setFailure("");
    if (
      await onSave({
        note,
        closer_id: assigned || null,
        outcome,
        next_at: needsDate ? new Date(when).toISOString() : null,
      })
    )
      onClose();
    else
      setFailure(
        "A ação não foi concluída. Confira o erro exibido; os dados foram atualizados.",
      );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[92dvh] gap-3 overflow-y-auto p-4 sm:max-w-[480px]"
        data-lenis-prevent
      >
        <DialogHeader>
          <DialogTitle>{actionTitles[action]}</DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.athlete_name || "Atleta não informado"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <fieldset disabled={busy} className="space-y-3">
            {action === "assign" && (
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="handoff-closer">Responsável Closer</Label>
                <select
                  id="handoff-closer"
                  className="h-9 w-full rounded border bg-background px-3 text-sm"
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Fila compartilhada</option>
                  {candidates.map((a) => (
                    <option value={a.user_id} key={a.user_id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  A call pendente também acompanhará o novo responsável.
                </p>
              </div>
            )}
            {action === "close" && (
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="close-outcome">Resultado *</Label>
                <select
                  id="close-outcome"
                  required
                  className="h-9 w-full rounded border bg-background px-3 text-sm"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  <option value="">Selecionar resultado</option>
                  <option value="venda_concluida">Venda concluída</option>
                  <option value="venda_perdida">Venda perdida</option>
                  <option value="followup">Follow-up necessário</option>
                  <option value="devolvido_sdr">Devolver ao SDR</option>
                </select>
              </div>
            )}
            {needsDate && (
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="next-at">Próxima data e hora *</Label>
                <Input
                  className="h-9"
                  id="next-at"
                  type="datetime-local"
                  required
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="action-note">
                {action === "close" ? "Observações da call" : "Anotação"}
              </Label>
              <Textarea
                id="action-note"
                className="min-h-20"
                maxLength={10000}
                required={["contact", "note"].includes(action)}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {action === "close" && (
              <p className="text-xs text-muted-foreground">
                Data, hora e autor serão registrados automaticamente. Após uma
                venda concluída, cadastre a venda pelo botão do módulo Vendas.
              </p>
            )}
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
            <DialogFooter className="gap-1 sm:space-x-0">
              <Button className="h-9" type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button className="h-9" type="submit">
                {busy ? "Salvando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
