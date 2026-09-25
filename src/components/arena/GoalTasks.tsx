import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useBrasiliaToday, type DailyGoalTask } from "@/hooks/useGoals";
import { useArenaAssignees } from "@/hooks/useArena";
import { supabase } from "@/integrations/supabase/client";
import { arenaRpc } from "@/lib/arena-api";
import { errorMessage, exactDate } from "@/lib/sales";
import { addDaysToDateKey, addMonthsToMonthKey, brasiliaLocalInputToIso, formatDateKey, isValidDateKey, isoToBrasiliaLocalInput } from "@/lib/brasilia-time";
import { refreshDashboardMutation } from "@/lib/sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { taskChecklistItems, taskTimeRemaining } from "@/lib/task-checklist";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Task = DailyGoalTask & {
  completion_comment: string | null;
};
type TaskPeriod = "hoje" | "ontem" | "7dias" | "mes" | "custom";

export function GoalTasks() {
  const { user } = useAuth();
  const { isExecutive } = useRoles();
  const today = useBrasiliaToday();
  const [period, setPeriod] = useState<TaskPeriod>("hoje");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [assignmentDate, setAssignmentDate] = useState(today);
  const [person, setPerson] = useState("");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [draftItems, setDraftItems] = useState([""]);
  const [clock, setClock] = useState(Date.now());
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
  const rangeError = period === "custom" &&
    (!isValidDateKey(customStart) || !isValidDateKey(customEnd) || customStart > customEnd)
    ? "Informe um período válido, com início anterior ou igual ao fim."
    : null;
  const rangeEnd = period === "ontem" ? addDaysToDateKey(today, -1)
    : period === "mes" ? addDaysToDateKey(`${addMonthsToMonthKey(today.slice(0, 7), 1)}-01`, -1)
    : period === "custom" ? customEnd : today;
  const rangeStart = period === "7dias" ? addDaysToDateKey(today, -6)
    : period === "mes" ? `${today.slice(0, 7)}-01`
    : period === "custom" ? customStart : rangeEnd;
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (assignmentDate < today) setAssignmentDate(today);
  }, [assignmentDate, today]);
  const query = useQuery({
    queryKey: ["daily-goals", "arena", user?.id, isExecutive, rangeStart, rangeEnd, person, page],
    enabled: !!user && !rangeError,
    queryFn: async () => {
      let request = supabase
        .from("daily_goal_tasks")
        .select("*")
        .order("deadline_at", { ascending: true, nullsFirst: false })
        .order("position")
        .order("id")
        .range(page * 50, page * 50 + 49);
      request = request.gte("task_date", rangeStart).lte("task_date", rangeEnd);
      if (!isExecutive || person)
        request = request.eq("assignee_id", isExecutive ? person : user!.id);
      const { data, error } = await request;
      if (error) throw error;
      return data as Task[];
    },
    refetchInterval: 30_000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["daily-goals"] });
  const assign = async (event: React.FormEvent) => {
    event.preventDefault();
    const deadline = brasiliaLocalInputToIso(`${assignmentDate}T${deadlineTime}`);
    const items = draftItems.map((item) => item.trim());
    if (!deadline || Date.parse(deadline) <= Date.now() + 60_000 ||
      !items.length || items.some((item) => item.length < 2 || item.length > 200)) {
      toast.error("Informe prazo futuro e itens de checklist com pelo menos 2 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await arenaRpc("arena_assign_checklist_task", {
        p_title: title,
        p_assignee: assignee,
        p_deadline_at: deadline,
        p_items: items,
      });
      setTitle("");
      setDraftItems([""]);
      setCustomStart(assignmentDate);
      setCustomEnd(assignmentDate);
      setPeriod("custom");
      setPage(0);
      await refreshDashboardMutation(client);
      toast.success("Checklist atribuído ao colaborador");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const toggleChecklistItem = async (task: Task, itemId: string, done: boolean) => {
    if (task.assignee_id !== user?.id || busy) return;
    setBusy(true);
    try {
      await arenaRpc("arena_toggle_task_checklist", {
        p_id: task.id, p_item_id: itemId, p_done: done, p_version: task.version,
      });
      await refreshDashboardMutation(client);
    } catch (cause) {
      toast.error(errorMessage(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const setChecklistCompletion = async (task: Task, completed: boolean) => {
    if (task.assignee_id !== user?.id || busy) return;
    setBusy(true);
    try {
      await arenaRpc("arena_set_task_checklist_completion", {
        p_id: task.id, p_completed: completed, p_version: task.version,
      });
      await refreshDashboardMutation(client);
      toast.success(completed ? "Checklist concluído" : "Checklist reaberto");
    } catch (cause) {
      toast.error(errorMessage(cause));
      await refresh();
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
        <h2 className="text-lg">Metas e tarefas</h2>
        <p className="text-sm text-muted-foreground">
          Tarefas atribuídas a cada colaborador, com prazo e progresso sincronizados com o Executive.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar tarefas por prazo">
        {([
          ["hoje", "Hoje"], ["ontem", "Ontem"], ["7dias", "Últimos 7 dias"],
          ["mes", "Este mês"], ["custom", "Personalizado"],
        ] as const).map(([key, label]) => (
          <Button key={key} type="button" size="sm" variant={period === key ? "default" : "outline"}
            aria-pressed={period === key}
            onClick={() => { setPeriod(key); setPage(0); }}>
            {label}
          </Button>
        ))}
        {isExecutive && (
          <select
            className="h-9 rounded-lg border bg-background px-3 text-sm"
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
      {period === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="task-range-start">De</Label><Input id="task-range-start" className="mt-1 w-44" type="date"
            value={customStart} onChange={(event) => { setCustomStart(event.target.value); setPage(0); }} /></div>
          <div><Label htmlFor="task-range-end">Até</Label><Input id="task-range-end" className="mt-1 w-44" type="date"
            value={customEnd} onChange={(event) => { setCustomEnd(event.target.value); setPage(0); }} /></div>
          {rangeError && <p role="alert" className="text-sm text-destructive">{rangeError}</p>}
        </div>
      )}
      {isExecutive && (
        <form
          onSubmit={assign}
          className="surface-panel space-y-4 rounded-xl p-5"
        >
          <h3 className="font-medium">Atribuir checklist individual</h3>
          <Input
            required
            minLength={2}
            maxLength={200}
            placeholder="Descreva a tarefa"
            aria-label="Título da tarefa"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="grid gap-4 md:grid-cols-3">
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
              <Label htmlFor="task-deadline-date">Data do prazo</Label>
              <Input id="task-deadline-date" className="mt-2" type="date" required min={today}
                value={assignmentDate} onChange={(event) => setAssignmentDate(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="task-deadline-time">Prazo · horário de Brasília</Label>
              <Input id="task-deadline-time" className="mt-2" type="time" required value={deadlineTime}
                onChange={(event) => setDeadlineTime(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Checklist do colaborador</Label>
            {draftItems.map((item, index) => (
              <div className="flex gap-2" key={index}>
                <Input aria-label={`Item ${index + 1} do checklist`} value={item} maxLength={200}
                  placeholder={`Etapa ${index + 1}`}
                  onChange={(event) => setDraftItems((items) => items.map((value, position) => position === index ? event.target.value : value))} />
                {draftItems.length > 1 && <Button type="button" variant="ghost" size="sm"
                  aria-label={`Remover item ${index + 1}`}
                  onClick={() => setDraftItems((items) => items.filter((_, position) => position !== index))}>Remover</Button>}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={draftItems.length >= 20}
              onClick={() => setDraftItems((items) => [...items, ""])}>Adicionar item</Button>
          </div>
          <Button disabled={busy || assignmentDate < today || !isValidDateKey(assignmentDate) || !assignee || !deadlineTime ||
            draftItems.some((item) => item.trim().length < 2)}>Atribuir</Button>
        </form>
      )}
      {query.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}
        </p>
      )}
      <div className="space-y-2">
        {query.data?.map((task) => {
          const items = taskChecklistItems(task.checklist_items);
          const completedItems = items.filter((item) => item.done).length;
          const progress = items.length ? Math.round(completedItems * 100 / items.length) : task.is_completed ? 100 : 0;
          return (
          <article
            key={task.id}
            className="surface-panel flex flex-wrap items-start gap-4 rounded-xl p-4"
          >
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
                  : task.deadline_at
                    ? Date.parse(task.deadline_at) < clock ? "Atrasada" : "Em andamento"
                  : task.task_date < today
                    ? "Expirada"
                    : "Pendente"}
              </p>
              {task.completion_comment && (
                <p className="mt-1 text-xs text-muted-foreground">
                {task.completion_comment}
                </p>
              )}
              <p className={`mt-2 text-xs tabular-nums ${task.deadline_at && !task.is_completed && Date.parse(task.deadline_at) < clock ? "text-rose-300" : "text-muted-foreground"}`}>
                Prazo: {task.deadline_at ? exactDate(task.deadline_at) : `${formatDateKey(task.task_date)} · dia inteiro`}
                {task.deadline_at && !task.is_completed ? ` · ${taskTimeRemaining(task.deadline_at, clock)}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Progress value={progress} className="h-2 min-w-28 flex-1" aria-label={`${progress}% da tarefa concluída`} />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {items.length ? `${completedItems}/${items.length} · ` : ""}{progress}%
                </span>
                {(task.deadline_at ? task.assignee_id === user?.id : task.task_date === today && (task.assignee_id === user?.id || isExecutive)) && (
                  <Button type="button" size="sm" variant={task.is_completed ? "outline" : "default"} disabled={busy}
                    onClick={() => {
                      if (task.deadline_at) void setChecklistCompletion(task, !task.is_completed);
                      else { setComment(""); setSelected(task); }
                    }}>
                    {task.is_completed ? `Reabrir ${task.deadline_at ? "checklist" : "tarefa"}` : "Marcar como feito"}
                  </Button>
                )}
              </div>
              {task.deadline_at && <>
                <div className="mt-3 space-y-2">
                  {items.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={item.done}
                      disabled={busy || task.assignee_id !== user?.id}
                      onChange={() => void toggleChecklistItem(task, item.id, !item.done)} />
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.text}</span>
                  </label>)}
                </div>
              </>}
            </div>
            {isExecutive && task.task_date >= today && <div className="flex gap-1">
              {!task.deadline_at && !task.is_completed && <Button size="sm" variant="outline" disabled={busy} onClick={() => openConversion(task)}>Definir turno</Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditedTitle(task.title); setEditing({task, remove:false}); }}>Editar</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing({task, remove:true})}>Remover</Button>
            </div>}
          </article>
        );})}
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
    </div>
  );
}
