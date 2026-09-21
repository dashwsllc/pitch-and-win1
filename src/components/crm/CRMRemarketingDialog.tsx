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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CRMRemarketingDialog({
  lead,
  busy,
  onClose,
  onSave,
}: {
  lead: CRMLead;
  busy: boolean;
  onClose: () => void;
  onSave: (data: { action: string; nextAt?: string | null; note?: string }) => Promise<boolean>;
}) {
  const [action, setAction] = useState("schedule");
  const [nextAt, setNextAt] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState("");
  const needsNext = action === "schedule" || action === "contacted";
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const scheduledAt = needsNext ? brasiliaLocalInputToIso(nextAt) : null;
    if (needsNext && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) {
      setFailure("Escolha uma próxima data futura.");
      return;
    }
    if (["contacted", "do_not_contact"].includes(action) && note.trim().length < 3) {
      setFailure("Registre o resultado deste contato.");
      return;
    }
    setFailure("");
    const ok = await onSave({ action, nextAt: scheduledAt, note: note.trim() });
    if (ok) onClose();
    else setFailure("Não foi possível salvar. Atualize a lista e tente novamente.");
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg" data-lenis-prevent>
        <DialogHeader>
          <DialogTitle>Acompanhamento de remarketing</DialogTitle>
          <DialogDescription>{lead.athlete_name || lead.name} · {lead.negative_reason || "Negativa registrada"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="remarketing-action">Ação *</Label>
              <select id="remarketing-action" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={action} onChange={(event) => setAction(event.target.value)}>
                <option value="schedule">Agendar follow-up</option>
                <option value="contacted">Registrar contato e próxima tentativa</option>
                <option value="reactivate">Reativar para qualificação</option>
                <option value="do_not_contact">Encerrar — não contatar</option>
              </select>
            </div>
            {needsNext && (
              <div className="space-y-2">
                <Label htmlFor="remarketing-next-at">Próximo follow-up · Brasília *</Label>
                <Input id="remarketing-next-at" type="datetime-local" required value={nextAt} onChange={(event) => setNextAt(event.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="remarketing-note">Registro {action === "schedule" ? "(opcional)" : "*"}</Label>
              <Textarea id="remarketing-note" maxLength={5000} required={["contacted", "do_not_contact"].includes(action)} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Mensagem enviada, retorno recebido, objeções e próximo passo" />
            </div>
            {action === "reactivate" && <p className="text-xs text-muted-foreground">O lead volta para Em qualificação e reaparece na operação ativa do SDR.</p>}
            {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
              <Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar acompanhamento"}</Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

