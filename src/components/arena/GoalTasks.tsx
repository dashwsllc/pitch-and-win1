import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useBrasiliaDateSelection, type DailyGoalTask } from "@/hooks/useGoals";
import { useArenaAssignees } from "@/hooks/useArena";
import { supabase } from "@/integrations/supabase/client";
import { arenaRpc } from "@/lib/arena-api";
import { operationalLabels } from "@/lib/arena";
import { ShiftApproachGoals } from "@/components/arena/ShiftApproachGoals";
import { errorMessage, exactDate } from "@/lib/sales";
import { brasiliaLocalInputToIso, isoToBrasiliaLocalInput } from "@/lib/brasilia-time";
import { refreshDashboardMutation } from "@/lib/sync";
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

type Task = DailyGoalTask & {
  operational_status: string;
  completion_comment: string | null;
};
export function GoalTasks() {
  const { user } = useAuth();
  const { isExecutive } = useRoles();
  const { today, date, setDate } = useBrasiliaDateSelection();
  const [person, setPerson] = useState("");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState("not_scheduled");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<{ task: Task; remove: boolean } | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [converting, setConverting] = useState<Task | null>(null);
  const [convertStart, setConvertStart] = useState("");
  const [convertDuration, setConvertDuration] = useState("480");
  const [convertTarget, setConvertTarget] = useState("50");
  const [convertSource, setConvertSource] = useState<"crm" | "manual">("crm");
  const [page, setPage] = useState(0);
  const assignees = useArenaAssignees();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["daily-goals", "arena", user?.id, isExecutive, date, person, page],
    enabled: !!user,
    queryFn: async () => {
      let request = supabase
        .from("daily_goal_tasks")
        .select("*")
        .eq("task_date", date)
        .order("position")
        .order("id")
        .range(page * 50, page * 50 + 49);
      if (!isExecutive || person)
        request = request.eq("assignee_id", isExecutive ? person : user!.id);
      const { data, error } = await request;
      if (error) throw error;
      return data as Task[];
    },
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["daily-goals"] });
  const assign = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const count = await arenaRpc<number>("arena_assign_tasks", {
        p_title: title,
        p_date: date,
        p_people: [assignee],
        p_roles: [],
        p_status: status,
      });
      setTitle("");
      setAssignee("");
      await refresh();
      toast.success(`Tarefa atribuída a ${count} colaboradores`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const complete = async (task: Task, note = "") => {
    setBusy(true);
    try {
      await arenaRpc("arena_complete_task", {
        p_id: task.id,
        p_completed: !task.is_completed,
        p_version: task.version,
        p_comment: note,
      });
      setSelected(null);
      setComment("");
      await refresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (task: Task, value: string) => {
    try {
      await arenaRpc("arena_task_status", {
        p_id: task.id,
        p_version: task.version,
        p_status: value,
      });
      await refresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { task, remove } = editing;
      const { error } = remove
        ? await supabase.rpc("executive_delete_daily_goal_task", { p_task_id: task.id, p_expected_version: task.version })
        : await supabase.rpc("executive_update_daily_goal_task", { p_task_id: task.id, p_assignee_id: task.assignee_id, p_task_date: task.task_date, p_title: editedTitle.trim(), p_expected_version: task.version });
      if (error) throw error;
      setEditing(null);
      await refresh();
      toast.success(remove ? "Tarefa removida e preservada na auditoria" : "Tarefa atualizada");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const openConversion = (task: Task) => {
    setConverting(task);
    setConvertStart(task.task_date === today ? isoToBrasiliaLocalInput(new Date().toISOString()) : `${task.task_date}T09:00`);
    setConvertTarget(task.title.match(/\b\d+\b/)?.[0] ?? "50");
    setConvertDuration("480");
    setConvertSource("crm");
  };
  const convert = async () => {
    if (!converting || busy) return;
    const start = brasiliaLocalInputToIso(convertStart);
    const target = Number(convertTarget);
    const duration = Number(convertDuration);
    if (!start || !Number.isInteger(target) || target < 1 || target > 100000
      || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
      toast.error("Informe quantidade, início e duração válidos.");
      return;
    }
    setBusy(true);
    try {
      await arenaRpc("arena_convert_task_to_shift_goal", {
        p_task_id: converting.id,
        p_expected_version: converting.version,
        p_starts_at: start,
        p_duration_minutes: duration,
        p_target_approaches: target,
        p_source: convertSource,
      });
      setConverting(null);
      await refreshDashboardMutation(client);
      toast.success("Tarefa convertida em meta de turno individual");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg">Tarefas operacionais</h2>
        <p className="text-sm text-muted-foreground">
          O checklist é manual. Calls, aprovações e pontuação vêm
          automaticamente do CRM e das vendas.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="w-44"
          type="date"
          aria-label="Dia das tarefas"
          value={date}
          onChange={(e) => { setDate(e.target.value); setPage(0); }}
        />
        {isExecutive && (
          <select
            className="rounded-lg border bg-background px-3"
            aria-label="Filtrar colaborador"
            value={person}
            onChange={(e) => { setPerson(e.target.value); setPage(0); }}
          >
            <option value="">Todos os colaboradores</option>
            {assignees.data?.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
                {p.suspended ? " (inativo)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      {isExecutive && (
        <form
          onSubmit={assign}
          className="surface-panel space-y-4 rounded-xl p-5"
        >
          <h3 className="font-medium">Atribuir tarefa · {date}</h3>
          <Input
            required
            minLength={2}
            maxLength={200}
            placeholder="Descreva a tarefa"
            aria-label="Título da tarefa"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="task-people">Colaborador específico</Label>
              <select
                id="task-people"
                required
                className="mt-2 h-10 w-full rounded-lg border bg-background px-3"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Selecione uma pessoa</option>
                {assignees.data
                  ?.filter((p) => !p.suspended)
                  .map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.display_name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor="task-status">Estado operacional inicial</Label>
              <select
                id="task-status"
                className="mt-2 w-full rounded-lg border bg-background p-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {Object.entries(operationalLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button disabled={busy || date < today || !assignee}>Atribuir</Button>
        </form>
      )}
      {query.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}
        </p>
      )}
      <div className="space-y-2">
        {query.data?.map((task) => (
          <article
            key={task.id}
            className="surface-panel flex flex-wrap items-center gap-4 rounded-xl p-4"
          >
            <input
              type="checkbox"
              aria-label={`Concluir ${task.title}`}
              checked={task.is_completed}
              disabled={busy || date !== today}
              onChange={() => {
                setComment('');
                setSelected(task);
              }}
            />
            <div className="min-w-0 flex-1">
              <p className={task.is_completed ? "line-through opacity-60" : ""}>
                {task.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {assignees.data?.find((p) => p.user_id === task.assignee_id)
                  ?.display_name || "Minha tarefa"}{" "}
                ·{" "}
                {task.is_completed
                  ? `Concluída em ${exactDate(task.completed_at)}`
                  : date < today
                    ? "Expirada"
                    : "Pendente"}
              </p>
              {task.completion_comment && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.completion_comment}
                </p>
              )}
            </div>
            <select
              className="rounded-lg border bg-background p-2 text-xs"
              aria-label={`Estado operacional de ${task.title}`}
              value={task.operational_status}
              disabled={date < today}
              onChange={(e) => changeStatus(task, e.target.value)}
            >
              {Object.entries(operationalLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {isExecutive && date >= today && <div className="flex gap-1">
              {!task.is_completed && <Button size="sm" variant="outline" disabled={busy} onClick={() => openConversion(task)}>Definir turno</Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditedTitle(task.title); setEditing({task, remove:false}); }}>Editar</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing({task, remove:true})}>Remover</Button>
            </div>}
          </article>
        ))}
        {!query.isLoading && !query.data?.length && (
          <p className="p-6 text-center text-muted-foreground">
            Nenhuma tarefa atribuída para esta seleção.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!page} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
        <Button variant="outline" disabled={(query.data?.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
      </div>
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.remove ? "Remover tarefa?" : "Editar tarefa"}</DialogTitle>
            <DialogDescription>{editing?.task.title}. O autor e os valores anteriores ficam na auditoria.</DialogDescription>
          </DialogHeader>
          {!editing?.remove && <><Label htmlFor="task-edit-title">Título</Label><Input id="task-edit-title" maxLength={280} value={editedTitle} onChange={(event) => setEditedTitle(event.target.value)} /></>}
          <Button disabled={busy || (!editing?.remove && !editedTitle.trim())} variant={editing?.remove ? "destructive" : "default"} onClick={saveEdit}>Confirmar {editing?.remove ? "remoção" : "alteração"}</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!converting} onOpenChange={(open) => { if (!open && !busy) setConverting(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Definir turno e meta individual</DialogTitle><DialogDescription>{converting?.title}. O Executive define quando começa, quanto dura e quantas abordagens a pessoa deve registrar.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="convert-target">Quantidade de abordagens</Label><Input id="convert-target" type="number" min={1} max={100000} step={1} value={convertTarget} onChange={(event) => setConvertTarget(event.target.value)} /></div>
            <div><Label htmlFor="convert-duration">Duração em minutos</Label><Input id="convert-duration" type="number" min={1} max={1440} step={1} value={convertDuration} onChange={(event) => setConvertDuration(event.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="convert-start">Início do turno · Brasília</Label><Input id="convert-start" type="datetime-local" value={convertStart} onChange={(event) => setConvertStart(event.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="convert-source">Fonte das abordagens</Label><select id="convert-source" className="mt-2 h-10 w-full rounded-lg border bg-background px-3" value={convertSource} onChange={(event) => setConvertSource(event.target.value as "crm" | "manual")}><option value="crm">CRM</option><option value="manual">Registros de Abordagens</option></select></div>
          </div>
          <Button disabled={busy || !convertStart || !convertTarget || !convertDuration} onClick={() => void convert()}>Salvar meta de turno</Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar {selected?.is_completed ? "reabertura" : "conclusão"} da tarefa</DialogTitle>
            <DialogDescription>
              {selected?.title}. O autor, horário e comentário ficam na
              auditoria.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="task-comment">Comentário {selected?.assignee_id !== user?.id ? 'obrigatório' : '(opcional)'}</Label>
          <Input
            id="task-comment"
            minLength={5}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            disabled={busy || (selected?.assignee_id !== user?.id && comment.trim().length < 5)}
            onClick={() => selected && complete(selected, comment)}
          >
            Confirmar {selected?.is_completed ? "reabertura" : "conclusão"}
          </Button>
        </DialogContent>
      </Dialog>
      <ShiftApproachGoals date={date} person={person} management={isExecutive} />
    </div>
  );
}
