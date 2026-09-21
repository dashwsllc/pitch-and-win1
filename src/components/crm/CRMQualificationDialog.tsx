import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CRMActivity, CRMLead } from "@/hooks/useCRM";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/sales";
import { brasiliaLocalInputToIso } from "@/lib/brasilia-time";
import {
  DECISION_MAKERS,
  INCOME_RANGES,
  PURCHASE_TIMELINES,
} from "@/lib/crm-qualification";
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

export function CRMQualificationDialog({
  lead,
  call,
  onClose,
}: {
  lead: CRMLead;
  call: CRMActivity;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [outcome, setOutcome] = useState("avancou");
  const [incomeRange, setIncomeRange] = useState(lead.qualification_income_range || "");
  const [goal, setGoal] = useState(lead.qualification_goal || "");
  const [decisionMaker, setDecisionMaker] = useState(lead.qualification_decision_maker || "");
  const [timeline, setTimeline] = useState(lead.qualification_timeline || "");
  const [summary, setSummary] = useState(lead.qualification_summary || "");
  const [negativeReason, setNegativeReason] = useState(lead.negative_reason || "");
  const [nextAt, setNextAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const requiresNext = outcome === "followup_sdr" || outcome === "lead_perdido";
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const scheduledAt = requiresNext ? brasiliaLocalInputToIso(nextAt) : null;
    if (!summary.trim()) {
      setFailure("Registre o resumo da qualificação para o histórico do lead.");
      return;
    }
    if (outcome === "avancou" && (!incomeRange || !decisionMaker || !timeline || !goal.trim())) {
      setFailure("Para enviar ao Closer, preencha renda, objetivo, decisor e prazo.");
      return;
    }
    if (outcome === "lead_perdido" && negativeReason.trim().length < 2) {
      setFailure("Informe o motivo da negativa.");
      return;
    }
    if (requiresNext && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) {
      setFailure("Escolha uma próxima data futura.");
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      const { error } = await supabase.rpc("resolve_sdr_qualification_call", {
        p_activity_id: call.id,
        p_outcome: outcome,
        p_expected_revision: call.updated_at,
        p_data: {
          income_range: incomeRange || null,
          goal: goal.trim() || null,
          decision_maker: decisionMaker || null,
          timeline: timeline || null,
          summary: summary.trim(),
          negative_reason: negativeReason.trim() || null,
          next_at: scheduledAt,
        },
      });
      if (error) throw error;
      await client.invalidateQueries({ queryKey: ["crm"] });
      toast({
        title:
          outcome === "avancou"
            ? "Qualificação concluída"
            : outcome === "lead_perdido"
              ? "Lead enviado ao remarketing"
              : "Acompanhamento do SDR agendado",
      });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error));
      void client.invalidateQueries({ queryKey: ["crm"] });
    } finally {
      setSaving(false);
    }
  };
  const selectClass = "h-9 w-full rounded border bg-background px-3 text-sm";
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-lenis-prevent>
        <DialogHeader>
          <DialogTitle>Resultado da call de qualificação</DialogTitle>
          <DialogDescription>
            {lead.athlete_name || lead.name} · os dados abaixo acompanham o lead no repasse ao Closer.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qualification-outcome">Resultado *</Label>
              <select id="qualification-outcome" className={selectClass} value={outcome} onChange={(event) => setOutcome(event.target.value)}>
                <option value="avancou">Qualificado para o Closer</option>
                <option value="followup_sdr">Manter em acompanhamento pelo SDR</option>
                <option value="lead_perdido">Negativa — enviar para remarketing</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="qualification-income">Faixa de renda média{outcome === "avancou" ? " *" : ""}</Label>
                <select id="qualification-income" className={selectClass} value={incomeRange} onChange={(event) => setIncomeRange(event.target.value)}>
                  <option value="">Selecionar</option>
                  {INCOME_RANGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qualification-decision-maker">Quem decide{outcome === "avancou" ? " *" : ""}</Label>
                <select id="qualification-decision-maker" className={selectClass} value={decisionMaker} onChange={(event) => setDecisionMaker(event.target.value)}>
                  <option value="">Selecionar</option>
                  {DECISION_MAKERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="qualification-timeline">Prazo de decisão{outcome === "avancou" ? " *" : ""}</Label>
                <select id="qualification-timeline" className={selectClass} value={timeline} onChange={(event) => setTimeline(event.target.value)}>
                  <option value="">Selecionar</option>
                  {PURCHASE_TIMELINES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="qualification-goal">Objetivo e necessidade principal{outcome === "avancou" ? " *" : ""}</Label>
              <Textarea id="qualification-goal" maxLength={2000} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="O que o lead busca, urgência e expectativa de resultado" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qualification-summary">Resumo para o Closer / histórico *</Label>
              <Textarea id="qualification-summary" required minLength={3} maxLength={5000} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Principais dores, objeções, contexto familiar e pontos importantes da conversa" />
            </div>
            {outcome === "lead_perdido" && (
              <div className="space-y-2">
                <Label htmlFor="qualification-negative-reason">Motivo da negativa *</Label>
                <Input id="qualification-negative-reason" required minLength={2} maxLength={500} value={negativeReason} onChange={(event) => setNegativeReason(event.target.value)} placeholder="Ex.: sem orçamento neste momento" />
              </div>
            )}
            {requiresNext && (
              <div className="space-y-2">
                <Label htmlFor="qualification-next-at">
                  {outcome === "lead_perdido" ? "Primeiro follow-up de remarketing" : "Próxima ação do SDR"} · Brasília *
                </Label>
                <Input id="qualification-next-at" type="datetime-local" required value={nextAt} onChange={(event) => setNextAt(event.target.value)} />
              </div>
            )}
            {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar resultado"}</Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

