import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CRMActivity,
  CRMLead,
  useCRMAssignees,
} from "@/hooks/useCRM";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
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
  const { capabilities } = useRoles();
  const assignees = useCRMAssignees();
  const client = useQueryClient();
  const { toast } = useToast();
  const isSdrHandoff =
    !call &&
    lead.pipeline_stage !== "repassado_closer" &&
    capabilities.sdr;
  const [type] = useState(
    call?.call_type ||
      (isSdrHandoff || lead.pipeline_stage === "repassado_closer"
        ? "fechamento_closer"
        : "qualificacao"),
  );
  const [assigned, setAssigned] = useState(
    call?.assigned_to ||
      (isSdrHandoff
        ? lead.closer_id
        : lead.pipeline_stage === "repassado_closer"
          ? lead.closer_id
          : lead.sdr_id) ||
      (isSdrHandoff ? "" : user?.id) ||
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
    .filter((a, i, all) => all.findIndex((b) => b.user_id === a.user_id) === i)
    .filter(
      (a) =>
        isSdrHandoff ||
        type !== "fechamento_closer" ||
        !!lead.closer_id ||
        capabilities.admin ||
        a.user_id === user?.id,
    );
  const assignedName = candidates.find((a) => a.user_id === assigned)?.display_name;
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
      const scheduledAt = new Date(when).toISOString();
      const { error } = call
        ? await supabase.rpc("reschedule_crm_call", {
            p_activity_id: call.id,
            p_scheduled_at: scheduledAt,
            p_expected_revision: call.updated_at,
          })
        : isSdrHandoff
          ? await supabase.rpc("handoff_and_schedule_closer_call", {
              p_lead_id: lead.id,
              p_expected_version: lead.version,
              p_assigned_to: assigned,
              p_scheduled_at: scheduledAt,
              p_context: context,
            })
          : await supabase.rpc("schedule_closer_call", {
              p_lead_id: lead.id,
              p_call_type: type,
              p_assigned_to: assigned,
              p_scheduled_at: scheduledAt,
              p_context: context,
            });
      if (error) throw error;
      await client.invalidateQueries({ queryKey: ["crm"] });
      toast({
        title: call
          ? "Call reagendada"
          : isSdrHandoff
            ? "Call agendada e lead enviado ao Closer"
            : "Call agendada",
      });
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
        className="max-h-[92dvh] gap-3 overflow-y-auto p-4 sm:max-w-[480px]"
        data-lenis-prevent
      >
        <DialogHeader>
          <DialogTitle>
            {call
              ? "Reagendar call"
              : isSdrHandoff
                ? "Agendar call e enviar ao Closer"
                : "Agendar call"}
          </DialogTitle>
          <DialogDescription>
            {lead.athlete_name || "Atleta não informado"} · {lead.name}
            {isSdrHandoff && (
              <span className="mt-1 block">
                O lead só será enviado ao Closer depois que o agendamento for
                salvo com sucesso.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          {!call && (
            <>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="call-assignee">Responsável</Label>
                <select
                  id="call-assignee"
                  disabled={type === "fechamento_closer" && !!lead.closer_id}
                  required
                  className="h-9 w-full rounded border bg-background px-3 text-sm"
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
                {isSdrHandoff && assigned && (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    Após agendar, {assignedName || "o responsável selecionado"}
                    receberá o lead, o horário e o contexto automaticamente.
                  </p>
                )}
                {!isSdrHandoff && type === "fechamento_closer" && !lead.closer_id && assigned && (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    Ao agendar, {assignedName || "o responsável selecionado"} será definido como Closer deste lead.
                  </p>
                )}
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
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="call-when">Data e hora (horário local)</Label>
            <Input
              className="h-9"
              id="call-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </div>
          {!call && (
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="call-context">Contexto da reunião</Label>
              <Textarea
                id="call-context"
                className="min-h-20"
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
          <DialogFooter className="gap-1 sm:space-x-0">
            <Button
              className="h-9"
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              className="h-9"
              disabled={
                saving ||
                (!call &&
                  (assignees.isPending ||
                    assignees.isError ||
                    !candidates.some((a) => a.user_id === assigned)))
              }
            >
              {saving
                ? "Salvando..."
                : call
                  ? "Salvar horário"
                  : isSdrHandoff
                    ? "Agendar e enviar"
                    : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
