import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { arenaRpc } from "@/lib/arena-api";
import { useAuth } from "@/hooks/useAuth";
import { useArenaAssignees } from "@/hooks/useArena";
import type { ArenaGoal } from "@/lib/arena";
import { errorMessage, exactDate, money } from "@/lib/sales";
import { brasiliaLocalInputToIso, isoToBrasiliaLocalInput } from "@/lib/brasilia-time";
import { useArena } from "@/hooks/useArena";
import { useBrasiliaToday } from "@/hooks/useGoals";
import {
  createDefaultDashboardCustomRange,
  resolveDashboardPeriod,
} from "@/lib/dashboard-period";
import { progressPercent, stateLabels } from "@/lib/arena";

type ArenaScoreWeight = { action_type: string; label: string; weight: number };
function ScoreWeights() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["arena-score-weights", user?.id],
    enabled: !!user,
    queryFn: () => arenaRpc<ArenaScoreWeight[]>("arena_score_weights", {}),
  });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.data || busy) return;
    const values: Record<string, number> = {};
    for (const w of query.data) {
      const raw = overrides[w.action_type] ?? String(w.weight);
      const n = Number(raw);
      if (!raw.trim() || !Number.isFinite(n) || n < 0 || n > 100000) {
        toast.error(`Valor inválido para "${w.label}".`);
        return;
      }
      values[w.action_type] = n;
    }
    setBusy(true);
    try {
      await arenaRpc("arena_save_score_weights", { p_weights: values, p_reason: reason });
      setOverrides({});
      setReason("");
      await query.refetch();
      toast.success("Pontuação da Arena atualizada");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="surface-panel space-y-3 rounded-xl p-5">
      <div>
        <h3 className="font-medium">Pontuação por evento</h3>
        <p className="text-xs text-muted-foreground">
          Quanto cada evento vale em pontos na Arena. Vale só para eventos novos a partir de
          agora; o que já foi registrado no histórico não muda.
        </p>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(query.error)}
        </p>
      )}
      <form onSubmit={save} className="space-y-3">
        {query.data?.map((w) => (
          <div
            key={w.action_type}
            className="flex items-center justify-between gap-3 border-t border-white/5 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm">{w.label}</p>
              <p className="text-xs text-muted-foreground">{w.action_type}</p>
            </div>
            <Input
              type="number"
              min="0"
              max="100000"
              step="0.1"
              className="w-28 shrink-0"
              aria-label={`Pontos para ${w.label}`}
              value={overrides[w.action_type] ?? String(w.weight)}
              onChange={(e) =>
                setOverrides((o) => ({ ...o, [w.action_type]: e.target.value }))
              }
            />
          </div>
        ))}
        {!query.isLoading && !query.data?.length && (
          <p className="text-sm text-muted-foreground">
            Nenhuma métrica configurável encontrada.
          </p>
        )}
        <div>
          <Label htmlFor="weights-reason">Motivo da alteração</Label>
          <Input
            id="weights-reason"
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || !query.data?.length}>
          Salvar pontuação
        </Button>
      </form>
    </section>
  );
}
const emptyGoal = {
  title: "",
  target: "100",
  scope: "role",
  target_role: "sdr",
  assignee_id: "",
  period: "daily",
  recurring: true,
  show_countdown: true,
  ticket_reference: "2997",
  enabled: true,
};
export function GoalManagement({
  configuration = false,
}: {
  configuration?: boolean;
}) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["company-goals", "arena", user?.id],
    enabled: !!user,
    queryFn: () =>
      arenaRpc<ArenaGoal[]>("arena_management", { p_tab: "goals" }),
  });
  const people = useArenaAssignees();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState<string>();
  const [form, setForm] = useState(emptyGoal);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [originalEnd, setOriginalEnd] = useState("");
  const [effective, setEffective] = useState("");
  const today = useBrasiliaToday();
  const period = resolveDashboardPeriod(
    "hoje",
    createDefaultDashboardCustomRange(),
  );
  const current = useArena(
    period.start!.toISOString(),
    period.end!.toISOString(),
  );
  const [visibility, setVisibility] = useState<{
    id: string;
    name: string;
    hidden: boolean;
  }>();
  const [deleting, setDeleting] = useState<{
    family_id: string;
    title: string;
  }>();
  const edit = (goal?: ArenaGoal) => {
    setPrevious(goal?.id);
    setForm(
      goal
        ? {
            title: goal.title,
            target: String(goal.target),
            scope: goal.scope,
            target_role: goal.target_role || "",
            assignee_id: goal.assignee_id || "",
            period: goal.period,
            recurring: goal.recurring,
            show_countdown: goal.show_countdown,
            ticket_reference: String(goal.ticket_reference),
            enabled: goal.enabled,
          }
        : emptyGoal,
    );
    setReason("");
    const active = goal && current.data?.cycles.find((cycle) => cycle.goal_id === goal.id);
    setStarts(active ? isoToBrasiliaLocalInput(active.starts_at, true) : "");
    const activeEnd = active ? isoToBrasiliaLocalInput(active.ends_at, true) : "";
    setEnds(activeEnd);
    setOriginalEnd(activeEnd);
    setEffective(goal && Date.parse(goal.effective_at) > Date.now() ? isoToBrasiliaLocalInput(goal.effective_at, true) : "");
    setOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const target = Number(form.target);
      const ticketReference = Number(form.ticket_reference);
      if (!form.target.trim() || !Number.isFinite(target) || target <= 0 || target > 100000000)
        throw new Error("Informe uma meta válida maior que zero.");
      if (!form.ticket_reference.trim() || !Number.isFinite(ticketReference) || ticketReference <= 0)
        throw new Error("Informe um ticket de referência válido maior que zero.");
      if (!!starts !== !!ends)
        throw new Error("Informe início e fim do ciclo personalizado.");
      if (
        starts &&
        (!brasiliaLocalInputToIso(starts) ||
          !brasiliaLocalInputToIso(ends) ||
          Date.parse(brasiliaLocalInputToIso(ends)!) <=
            Date.parse(brasiliaLocalInputToIso(starts)!))
      )
        throw new Error("O fim precisa ser posterior ao início.");
      if (effective && !brasiliaLocalInputToIso(effective))
        throw new Error("Vigência inválida.");
      await arenaRpc("arena_save_goal", {
        p_data: {
          ...form,
          target,
          ticket_reference: ticketReference,
          effective_at: effective ? brasiliaLocalInputToIso(effective) : null,
          ...(starts && (!previous || ends !== originalEnd)
            ? {
                cycle_start: brasiliaLocalInputToIso(starts),
                cycle_end: brasiliaLocalInputToIso(ends),
              }
            : {}),
        },
        p_reason: reason,
        p_previous: previous,
      });
      await Promise.all([
        query.refetch(),
        client.invalidateQueries({ queryKey: ["arena"] }),
        client.invalidateQueries({ queryKey: ["visible-goals"] }),
      ]);
      setOpen(false);
      toast.success("Nova versão da meta salva");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const removeGoal = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await arenaRpc("arena_delete_goal", {
        p_family_id: deleting.family_id,
        p_reason: reason,
      });
      setDeleting(undefined);
      await Promise.all([
        query.refetch(),
        client.invalidateQueries({ queryKey: ["arena"] }),
        client.invalidateQueries({ queryKey: ["visible-goals"] }),
      ]);
      toast.success("Meta removida: desativada e ciclo aberto encerrado");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const changeVisibility = async () => {
    if (!visibility) return;
    setBusy(true);
    try {
      await arenaRpc("arena_set_visibility", {
        p_person: visibility.id,
        p_hidden: !visibility.hidden,
        p_reason: reason,
      });
      setVisibility(undefined);
      await people.refetch();
      await client.invalidateQueries({ queryKey: ["arena"] });
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg">
            {configuration ? "Configurações da Arena" : "Metas e ciclos"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Metas individuais têm acompanhamento próprio para o colaborador
            escolhido. Alterações criam versões; ciclos encerrados permanecem intactos.
          </p>
        </div>
        <Button onClick={() => edit()}>Nova meta</Button>
      </div>
      {query.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {query.data?.map((goal) => (
          <article
            key={goal.id}
            className="surface-panel space-y-3 rounded-xl p-5"
          >
            <div className="flex justify-between gap-2">
              <h3 className="font-medium">{goal.title}</h3>
              <span className="text-xs text-muted-foreground">
                v{goal.version}
              </span>
            </div>
            <p className="text-2xl text-ember">
              {goal.metric === "revenue"
                ? money(goal.target)
                : `${goal.target.toLocaleString("pt-BR")} pontos = 100%`}
            </p>
            <p className="text-sm text-muted-foreground">
              {goal.scope === "global"
                ? "Global"
                : goal.scope === "user"
                  ? people.data?.find((p) => p.user_id === goal.assignee_id)
                      ?.display_name
                  : goal.target_role?.toUpperCase()}{" "}
              ·{" "}
              {
                { daily: "Diária", weekly: "Semanal", monthly: "Mensal" }[
                  goal.period
                ]
              }
            </p>
            <p className="text-xs text-muted-foreground">
              Desde {exactDate(goal.effective_at)} ·{" "}
              {goal.recurring ? "Recorrente" : "Ciclo único"} ·{" "}
              {goal.enabled ? "Ativa" : "Desativada"}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => edit(goal)}>
                Alterar com nova versão
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-300"
                disabled={!goal.enabled}
                onClick={() => {
                  setReason("");
                  setDeleting({ family_id: goal.family_id, title: goal.title });
                }}
              >
                Remover
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!configuration && <ScoreWeights />}
      {!configuration && (
        <section
          className="surface-panel space-y-3 rounded-xl p-5"
          data-day={today}
        >
          <h3 className="font-medium">Situação nos ciclos abertos</h3>
          <p className="text-xs text-muted-foreground">
            No ritmo: realização ≥ tempo decorrido. Em risco: realização entre
            80% e 100% do ritmo esperado. Abaixo do ritmo: menos de 80%. Após o
            prazo, só conta o resultado final.
          </p>
          {current.data?.cycles
            .filter((c) => c.scope === "role" || c.scope === "user")
            .map((c) => (
              <div key={c.id}>
                <h4 className="mt-3 text-sm text-ember">{c.title}{c.scope === "user" && c.result.members[0] ? ` · ${c.result.members[0].display_name}` : ""}</h4>
                {c.result.members.map((p) => (
                  <div
                    key={p.user_id}
                    className="flex justify-between border-t border-white/5 py-2 text-sm"
                  >
                    <span>{p.display_name}</span>
                    <span>
                      {progressPercent(p.actual, p.target).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta ·{" "}
                      {stateLabels[p.state]}
                    </span>
                  </div>
                ))}
              </div>
            ))}
        </section>
      )}
      {configuration && (
        <section className="surface-panel space-y-3 rounded-xl p-5">
          <h3 className="font-medium">Visibilidade de colaboradores</h3>
          <p className="text-sm text-muted-foreground">
            Contas desativadas continuam no histórico e nos resultados. Ocultar
            afeta somente a exibição dos ciclos abertos.
          </p>
          {people.data?.map((p) => (
            <div
              className="flex items-center justify-between border-t border-white/5 py-2"
              key={p.user_id}
            >
              <span className="text-sm">
                {p.display_name}
                {p.suspended ? " · inativo" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReason("");
                  setVisibility({
                    id: p.user_id,
                    name: p.display_name,
                    hidden: p.arena_hidden,
                  });
                }}
              >
                {p.arena_hidden ? "Voltar a exibir" : "Ocultar"}
              </Button>
            </div>
          ))}
        </section>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {previous ? "Nova versão da meta" : "Criar meta"}
            </DialogTitle>
            <DialogDescription>
              O resultado acumulado é preservado. A confirmação registra o
              motivo e o autor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="goal-title">Título</Label>
              <Input
                id="goal-title"
                required
                minLength={2}
                maxLength={160}
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="goal-target">
                  Meta{" "}
                  {form.scope === "global" ? "(R$)" : "(pontos necessários para 100%)"}
                </Label>
                <Input
                  id="goal-target"
                  type="number"
                  required
                  min="0.01"
                  max="100000000"
                  step="0.01"
                  value={form.target}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, target: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="goal-period">Ciclo</Label>
                <select
                  id="goal-period"
                  disabled={!!previous}
                  className="h-10 w-full rounded border bg-background px-2"
                  value={form.period}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, period: e.target.value }))
                  }
                >
                  <option value="daily">Diário</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensal</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="goal-scope">Escopo</Label>
                <select
                  id="goal-scope"
                  disabled={!!previous}
                  className="h-10 w-full rounded border bg-background px-2"
                  value={form.scope}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      scope: e.target.value,
                      target_role: e.target.value === "global" ? "" : "sdr",
                      assignee_id: "",
                    }))
                  }
                >
                  <option value="global">Global · faturamento</option>
                  <option value="role">Por cargo</option>
                  <option value="user">Individual</option>
                </select>
              </div>
              {form.scope !== "global" && (
                <div>
                  <Label htmlFor="goal-role">Cargo</Label>
                  <select
                    id="goal-role"
                    disabled={!!previous}
                    className="h-10 w-full rounded border bg-background px-2"
                    value={form.target_role}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, target_role: e.target.value }))
                    }
                  >
                    <option value="sdr">SDR</option>
                    <option value="closer">Closer</option>
                  </select>
                </div>
              )}
            </div>
            {form.scope === "user" && (
              <div>
                <Label htmlFor="goal-person">Colaborador</Label>
                <select
                  id="goal-person"
                  required
                  disabled={!!previous}
                  className="h-10 w-full rounded border bg-background px-2"
                  value={form.assignee_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, assignee_id: e.target.value }))
                  }
                >
                  <option value="">Selecione</option>
                  {people.data
                    ?.filter((p) => p.roles.includes(form.target_role))
                    .map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.display_name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {form.scope === "global" && (
              <div>
                <Label htmlFor="goal-ticket">Ticket de referência (R$)</Label>
                <Input
                  id="goal-ticket"
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={form.ticket_reference}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      ticket_reference: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["recurring", "Repetir ciclo"],
                  ["show_countdown", "Exibir countdown"],
                  ["enabled", "Ativa"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div>
              <Label htmlFor="goal-effective">
                Vigência da nova versão · Brasília (vazio = agora)
              </Label>
              <Input
                id="goal-effective"
                type="datetime-local"
                step="1"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
            </div>
            {(!previous || (starts && !(form.scope === "global" && form.period === "monthly"))) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="goal-start">Início do ciclo (opcional)</Label>
                  <Input
                    id="goal-start"
                    type="datetime-local"
                    step="1"
                    disabled={!!previous}
                    value={starts}
                    onChange={(e) => setStarts(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="goal-end">Fim do ciclo (opcional)</Label>
                  <Input
                    id="goal-end"
                    type="datetime-local"
                    step="1"
                    value={ends}
                    onChange={(e) => setEnds(e.target.value)}
                  />
                </div>
              </div>
            )}
            {previous && starts && <p className="text-xs text-muted-foreground">{form.scope === "global" && form.period === "monthly" ? "O ciclo mensal e seu ranking seguem o mês civil de Brasília." : "O início é preservado. Alterar o fim atualiza o prazo do ciclo aberto imediatamente e registra uma nova versão."}</p>}
            <div>
              <Label htmlFor="goal-reason">Motivo da alteração</Label>
              <Input
                id="goal-reason"
                required
                minLength={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              Confirmar e salvar versão
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!visibility}
        onOpenChange={(open) => {
          if (!open) setVisibility(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Alterar visibilidade de {visibility?.name}
            </DialogTitle>
            <DialogDescription>
              A mudança não apaga eventos nem resultados encerrados.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="visibility-reason">Motivo</Label>
          <Input
            id="visibility-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={busy || reason.trim().length < 5}
            onClick={changeVisibility}
          >
            Confirmar
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover {deleting?.title}?</DialogTitle>
            <DialogDescription>
              A meta é desativada e o ciclo em aberto é encerrado imediatamente.
              Ciclos já fechados e o histórico de resultados permanecem intactos.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="delete-goal-reason">Motivo</Label>
          <Input
            id="delete-goal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={busy || reason.trim().length < 5}
            variant="destructive"
            onClick={removeGoal}
          >
            Confirmar remoção
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
