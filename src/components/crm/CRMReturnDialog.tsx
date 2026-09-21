import { useState } from "react";
import type { CRMLead } from "@/hooks/useCRM";
import { brasiliaLocalInputToIso } from "@/lib/brasilia-time";
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

export type CRMReturnData = {
  target: "sdr" | "closer";
  assignedTo: string;
  nextAt: string;
  note: string;
};

export function CRMReturnDialog({
  lead,
  target,
  assignees,
  busy,
  onClose,
  onSave,
}: {
  lead: CRMLead;
  target: "sdr" | "closer";
  assignees: { user_id: string; display_name: string; role: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: CRMReturnData) => Promise<boolean>;
}) {
  const candidates = assignees
    .filter((a) => [target, "executive", "super_admin"].includes(a.role))
    .filter((a, i, all) => all.findIndex((b) => b.user_id === a.user_id) === i);
  const previous =
    target === "sdr"
      ? lead.sdr_id
      : lead.closer_id || lead.last_result_closer_id;
  const [assignedTo, setAssignedTo] = useState(
    candidates.some((a) => a.user_id === previous) ? previous! : "",
  );
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const nextAt = brasiliaLocalInputToIso(when);
    if (!nextAt || Date.parse(nextAt) <= Date.now())
      return setError("Escolha uma data futura para o retorno.");
    if (!assignedTo || note.trim().length < 3)
      return setError(
        "Selecione o responsável e informe o motivo da devolução.",
      );
    if (await onSave({ target, assignedTo, nextAt, note: note.trim() }))
      onClose();
    else
      setError(
        "Não foi possível devolver. Confira a mensagem de erro e tente novamente.",
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
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        data-lenis-prevent
      >
        <DialogHeader>
          <DialogTitle>
            Devolver ao {target === "sdr" ? "SDR" : "Closer"}
          </DialogTitle>
          <DialogDescription>
            {lead.athlete_name || lead.name} · {lead.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="return-assignee">Responsável *</Label>
              <select
                id="return-assignee"
                required
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">Selecionar responsável</option>
                {candidates.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="return-date">Próxima call · Brasília *</Label>
              <Input
                id="return-date"
                type="datetime-local"
                required
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="return-reason">Motivo da devolução *</Label>
              <Textarea
                id="return-reason"
                required
                minLength={3}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              O lead volta ao atendimento com a call agendada. O resultado
              anterior, o histórico e a venda cadastrada permanecem registrados.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!candidates.length}>
                {busy ? "Devolvendo..." : "Devolver e agendar"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
