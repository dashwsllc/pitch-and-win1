import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CRMActivity,
  CRMLead,
  useCRMAssignees,
} from "@/hooks/useCRM";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/sales";
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

export function CRMCallScheduler({
  lead,
  call,
  onClose,
}: {
  lead: CRMLead;
  call?: CRMActivity;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const assignees = useCRMAssignees();
  const client = useQueryClient();
  const { toast } = useToast();
  const [type] = useState(
    call?.call_type ||
      (lead.pipeline_stage === "repassado_closer"
        ? "fechamento_closer"
        : "qualificacao"),
  );
  const [assigned, setAssigned] = useState(
    call?.assigned_to ||
      (lead.pipeline_stage === "repassado_closer"
        ? lead.closer_id
        : lead.sdr_id) ||
      user?.id ||
      "",
  );
  const [when, setWhen] = useState(() => {
    if (!call?.scheduled_at) return "";
    const date = new Date(call.scheduled_at);
    return new Date(+date - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });
  const [context, setContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const candidates = (assignees.data || [])
    .filter((a) =>
      [
        type === "qualificacao" ? "sdr" : "closer",
        "executive",
        "super_admin",
      ].includes(a.role),
    )
    .filter((a, i, all) => all.findIndex((b) => b.user_id === a.user_id) === i);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (
      !when ||
      !Number.isFinite(+new Date(when)) ||
      new Date(when) <= new Date()
    ) {
      setFailure("Escolha um horário futuro.");
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      const { error } = call
        ? await supabase.rpc("reschedule_crm_call", {
            p_activity_id: call.id,
            p_scheduled_at: new Date(when).toISOString(),
            p_expected_revision: call.updated_at,
          })
        : await supabase.rpc("schedule_closer_call", {
            p_lead_id: lead.id,
            p_call_type: type,
            p_assigned_to: assigned,
            p_scheduled_at: new Date(when).toISOString(),
            p_context: context,
          });
      if (error) throw error;
      await client.invalidateQueries({ queryKey: ["crm"] });
      toast({ title: call ? "Call reagendada" : "Call agendada" });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error));
      void client.invalidateQueries({ queryKey: ["crm"] });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto"
        data-lenis-prevent
      >
        <DialogHeader>
          <DialogTitle>{call ? "Reagendar call" : "Agendar call"}</DialogTitle>
          <DialogDescription>
            {lead.athlete_name || "Atleta não informado"} · {lead.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {!call && (
            <>
              <div className="space-y-2">
                <Label htmlFor="call-assignee">Responsável</Label>
                <select
                  id="call-assignee"
                  disabled={type === "fechamento_closer"}
                  required
                  className="w-full h-10 rounded border bg-background px-3"
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Selecionar</option>
                  {candidates.map((a) => (
                    <option value={a.user_id} key={a.user_id}>
                      {a.display_name}
                    </option>
                  ))}
                </select>
                {assignees.isError && (
                  <p role="alert">Não foi possível carregar os responsáveis.</p>
                )}
                {!assignees.isPending &&
                  !assignees.isError &&
                  !candidates.length && (
                    <p className="text-sm text-muted-foreground">
                      Nenhum usuário com a função e o acesso CRM necessários.
                    </p>
                  )}
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="call-when">Data e hora (horário local)</Label>
            <Input
              id="call-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </div>
          {!call && (
            <div className="space-y-2">
              <Label htmlFor="call-context">Contexto da reunião</Label>
              <Textarea
                id="call-context"
                maxLength={10000}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Participantes e informações para a call"
              />
            </div>
          )}
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              disabled={
                saving ||
                (!call &&
                  (assignees.isPending ||
                    assignees.isError ||
                    !candidates.some((a) => a.user_id === assigned)))
              }
            >
              {saving ? "Salvando..." : call ? "Salvar horário" : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
