import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DragEndEvent,
  type DropAnimationFunction,
  type DropAnimationFunctionArguments,
  type Over,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { APPROACH_LABELS, type CRMLead } from "@/hooks/useCRM";
import "@/components/crm/crm-pipeline-dnd.css";

// Arrastar e soltar da Esteira do LEAD. Soltar numa coluna chama a mesma ação
// do seletor "Abordagem" do card; tudo aqui é só aparência do movimento. Fora
// da Esteira os três componentes devolvem exatamente o DOM de antes.

type Pending = { leadId: string; stage: string } | null;
type DropKind = "move" | "return";

const PipelineDnd = createContext<{ pending: Pending; busy: boolean; pressing: UniqueIdentifier | null } | null>(null);

// Botões, links e campos do card continuam funcionando: o arraste só começa
// quando se pega o card fora deles.
const CONTROLS =
  "a,button,input,select,textarea,label,summary,[role='button'],[role='checkbox'],[role='combobox'],[contenteditable='true']";
const startsOnControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest(CONTROLS) !== null;

class LeadMouseSensor extends MouseSensor {
  static activators: typeof MouseSensor.activators = [{
    eventName: "onMouseDown",
    handler: ({ nativeEvent }) => nativeEvent.button === 0 && !startsOnControl(nativeEvent.target),
  }];
}

class LeadTouchSensor extends TouchSensor {
  static activators: typeof TouchSensor.activators = [{
    eventName: "onTouchStart",
    handler: ({ nativeEvent }) => nativeEvent.touches.length <= 1 && !startsOnControl(nativeEvent.target),
  }];
}

const SETTLE_EASING = "cubic-bezier(0.2, 0.9, 0.25, 1)";
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// Soltar: o card assenta em 180ms e a sombra termina em 220ms (a inclinação e
// a sombra voltam pelo CSS de .crm-dnd-lift[data-settle]). Cancelado, solto
// fora ou na mesma coluna, ele volta ao lugar de origem. Movido, assenta onde
// foi solto e some: o card só muda de coluna quando o banco confirma.
function settleOverlay({ active, dragOverlay, transform }: DropAnimationFunctionArguments, kind: DropKind) {
  dragOverlay.node.querySelector(".crm-dnd-lift")?.setAttribute("data-settle", "");
  const reduce = prefersReducedMotion();
  const from = `translate3d(${transform.x}px, ${transform.y}px, 0)`;
  const to = `translate3d(${transform.x - (dragOverlay.rect.left - active.rect.left)}px, ${transform.y - (dragOverlay.rect.top - active.rect.top)}px, 0)`;
  const frames: Keyframe[] = kind === "return"
    ? [{ transform: from, easing: SETTLE_EASING }, { transform: to, offset: reduce ? 1 : 180 / 220 }, { transform: to }]
    : [{ opacity: 1 }, { opacity: 1, offset: reduce ? 0 : 0.4, easing: "ease-out" }, { opacity: 0 }];
  return dragOverlay.node
    .animate(frames, { duration: reduce ? 80 : 220, fill: "forwards" })
    .finished.then(() => undefined, () => undefined);
}

// Cópia visual do card que acompanha o ponteiro: mesma largura e aparência, sem
// ids nem foco. Os valores dos seletores são copiados à parte porque o React os
// guarda como propriedade, não como atributo.
function copyCard(source: HTMLElement) {
  const card = (source.firstElementChild as HTMLElement | null) ?? source;
  const copy = card.cloneNode(true) as HTMLElement;
  const fields = card.querySelectorAll<HTMLInputElement>("input, select, textarea");
  copy.querySelectorAll<HTMLInputElement>("input, select, textarea").forEach((field, index) => {
    if (field.type !== "file") field.value = fields[index].value;
    if (field instanceof HTMLInputElement) field.checked = fields[index].checked;
  });
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  copy.setAttribute("inert", "");
  return copy;
}

function LiftedCopy({ source }: { source: HTMLElement }) {
  const mount = useCallback((lift: HTMLDivElement | null) => {
    if (lift && !lift.firstChild) lift.appendChild(copyCard(source));
  }, [source]);
  return <div ref={mount} className="crm-dnd-lift" aria-hidden="true" />;
}

function LiftedLead({ dropAnimation }: { dropAnimation: DropAnimationFunction }) {
  const { activeNode } = useDndContext();
  return (
    <DragOverlay dropAnimation={dropAnimation} zIndex={2147483647} className="crm-dnd-overlay">
      {activeNode ? <LiftedCopy source={activeNode} /> : null}
    </DragOverlay>
  );
}

const leadName = (active: Active) => (active.data.current?.lead as CRMLead | undefined)?.name?.trim() || "Lead";
const stageName = (over: Over) => APPROACH_LABELS[String(over.id)] ?? String(over.id);
const announcements: Announcements = {
  onDragStart: ({ active }) => `${leadName(active)} pego para mudar de etapa.`,
  onDragOver: ({ active, over }) => over ? `${leadName(active)} sobre ${stageName(over)}.` : `${leadName(active)} fora das etapas.`,
  onDragEnd: ({ active, over }) => over ? `${leadName(active)} solto em ${stageName(over)}.` : `${leadName(active)} solto fora das etapas.`,
  onDragCancel: ({ active }) => `Movimento de ${leadName(active)} cancelado.`,
};
const screenReaderInstructions = {
  draggable: "Para mudar a etapa pelo teclado, use o seletor Abordagem dentro do card.",
};

function PipelineBoard({ busy, onMove, children }: {
  busy: boolean;
  onMove: (lead: CRMLead, stage: string) => Promise<unknown>;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<Pending>(null);
  // Card apertado (mouse) ou segurado (toque) antes de o arraste começar.
  const [pressing, setPressing] = useState<UniqueIdentifier | null>(null);
  const dropKind = useRef<DropKind>("return");
  const sensors = useSensors(
    useSensor(LeadMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(LeadTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const dropAnimation = useCallback<DropAnimationFunction>((args) => settleOverlay(args, dropKind.current), []);
  const visual = useMemo(() => ({ pending, busy, pressing }), [pending, busy, pressing]);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const lead = active.data.current?.lead as CRMLead | undefined;
    const stage = over ? String(over.id) : null;
    if (busy || !lead || !stage || stage === lead.approach_stage) {
      dropKind.current = "return";
      return;
    }
    dropKind.current = "move";
    setPending({ leadId: lead.id, stage });
    void onMove(lead, stage).finally(() =>
      setPending((current) => (current?.leadId === lead.id ? null : current)),
    );
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragPending={({ id }) => setPressing((current) => (current === id ? current : id))}
      onDragAbort={() => setPressing(null)}
      onDragStart={() => { dropKind.current = "return"; setPressing(null); }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { dropKind.current = "return"; }}
    >
      <PipelineDnd.Provider value={visual}>
        <p className="crm-dnd-hint -mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="crm-dnd-hint-mouse">Arraste um card até outra etapa para mudar a abordagem. Esc cancela.</span>
          <span className="crm-dnd-hint-touch">Segure um card e arraste até outra etapa para mudar a abordagem.</span>
        </p>
        {children}
      </PipelineDnd.Provider>
      {createPortal(<LiftedLead dropAnimation={dropAnimation} />, document.body)}
    </DndContext>
  );
}

export function CRMPipelineDnd({ enabled, busy, onMove, children }: {
  enabled: boolean;
  busy: boolean;
  onMove: (lead: CRMLead, stage: string) => Promise<unknown>;
  children: ReactNode;
}) {
  return enabled ? <PipelineBoard busy={busy} onMove={onMove}>{children}</PipelineBoard> : <>{children}</>;
}

function DroppableColumn({ stage, className, children }: { stage: string; className: string; children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      className={`${className} crm-dnd-column`}
      data-dnd-over={isOver ? "" : undefined}
      data-dnd-dragging={active ? "" : undefined}
    >
      {children}
    </section>
  );
}

export function CRMPipelineColumn({ stage, className, children }: { stage: string; className: string; children: ReactNode }) {
  return useContext(PipelineDnd)
    ? <DroppableColumn stage={stage} className={className}>{children}</DroppableColumn>
    : <section className={className}>{children}</section>;
}

function DraggableLead({ lead, pending, busy, pressing, children }: {
  lead: CRMLead;
  pending: Pending;
  busy: boolean;
  pressing: UniqueIdentifier | null;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: lead.id, data: { lead }, disabled: busy });
  // Enquanto o banco não confirma, o original fica apagado na origem; quando
  // confirma, o card entra na coluna nova assentando.
  const moving = pending?.leadId === lead.id;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className="crm-dnd-card"
      data-dnd-disabled={busy ? "" : undefined}
      data-dnd-pressing={pressing === lead.id ? "" : undefined}
      data-dnd-ghost={isDragging || (moving && lead.approach_stage !== pending.stage) ? "" : undefined}
      data-dnd-arrived={moving && lead.approach_stage === pending.stage ? "" : undefined}
    >
      {children}
    </div>
  );
}

export function CRMPipelineCard({ lead, children }: { lead: CRMLead; children: ReactNode }) {
  const visual = useContext(PipelineDnd);
  return visual
    ? <DraggableLead lead={lead} pending={visual.pending} busy={visual.busy} pressing={visual.pressing}>{children}</DraggableLead>
    : <>{children}</>;
}
