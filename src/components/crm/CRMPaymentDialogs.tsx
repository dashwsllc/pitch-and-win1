import { useState } from "react";
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
import { brasiliaLocalInputToIso, isoToBrasiliaLocalInput } from "@/lib/brasilia-time";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUS_LABELS,
  emptyPaymentForm,
  paymentFormFrom,
  paymentPayload,
  validatePaymentForm,
  validateReason,
  validateStatusChange,
  type PaymentStatus,
} from "@/lib/crm-payments";
import { money } from "@/lib/sales";
import type { CRMLeadPayment, PaymentSaveData } from "@/hooks/useCRMPayments";
import { PAYMENT_STATUS_STYLE } from "./payment-status-style";

function Shell({
  title,
  description,
  busy,
  onClose,
  onSubmit,
  children,
  submit,
}: {
  title: React.ReactNode;
  description: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
  submit: React.ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-lenis-prevent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <fieldset disabled={busy} className="space-y-4">
            {children}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              {submit}
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const Problem = ({ text }: { text: string }) =>
  text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;

export function CRMPaymentFormDialog({
  payment,
  leadLabel,
  busy,
  onClose,
  onSave,
}: {
  payment: CRMLeadPayment | null;
  leadLabel: string;
  busy: boolean;
  onClose: () => void;
  onSave: (data: PaymentSaveData) => Promise<string | null>;
}) {
  const [form, setForm] = useState(payment ? paymentFormFrom(payment) : emptyPaymentForm);
  const [error, setError] = useState("");
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = validatePaymentForm(form);
    if (problem) return setError(problem);
    const failure = await onSave(paymentPayload(form));
    if (failure === null) onClose();
    else setError(failure);
  };
  return (
    <Shell
      title={payment ? "Editar lançamento" : "Novo lançamento de pagamento"}
      description={leadLabel}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submit={<Button type="submit">{busy ? "Salvando..." : payment ? "Salvar alterações" : "Registrar lançamento"}</Button>}
    >
      <div className="space-y-2">
        <Label htmlFor="payment-description">Descrição *</Label>
        <Input id="payment-description" required maxLength={120} placeholder="Entrada, Parcela 2/6, Pagamento único..." value={form.description} onChange={set("description")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="payment-amount">Valor (R$) *</Label>
          <Input id="payment-amount" required inputMode="decimal" placeholder="0,00" value={form.amount} onChange={set("amount")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="payment-method">Forma de pagamento *</Label>
          <select id="payment-method" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.method} onChange={set("method")}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>{method.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-due">Vencimento</Label>
        <Input id="payment-due" type="date" value={form.dueDate} onChange={set("dueDate")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-proof">Comprovante (link do Google Drive)</Label>
        <Input id="payment-proof" inputMode="url" placeholder="https://drive.google.com/..." value={form.proofUrl} onChange={set("proofUrl")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-notes">Observação</Label>
        <Textarea id="payment-notes" maxLength={1000} value={form.notes} onChange={set("notes")} />
      </div>
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        O lançamento nasce como Pendente. Depois, marque como Pago ou Não pago. O pagamento é só informativo: não altera a aprovação da venda, a comissão nem a Arena.
      </p>
      <Problem text={error} />
    </Shell>
  );
}

const STATUS_COPY: Record<PaymentStatus, { title: string; hint: string; action: string }> = {
  pago: { title: "Marcar como Pago", hint: "Confirme quando o cliente pagou. Sem alterar a data, vale o momento atual.", action: "Marcar como Pago" },
  nao_pago: { title: "Marcar como Não pago", hint: "Registre por que o pagamento não aconteceu. O motivo fica no histórico do lead.", action: "Marcar como Não pago" },
  pendente: { title: "Voltar para Pendente", hint: "O lançamento volta a aguardar o pagamento e a data de pagamento é apagada.", action: "Voltar para Pendente" },
};

export function CRMPaymentStatusDialog({
  payment,
  status,
  busy,
  onClose,
  onConfirm,
}: {
  payment: CRMLeadPayment;
  status: PaymentStatus;
  busy: boolean;
  onClose: () => void;
  onConfirm: (extra: { paidAt: string | null; reason: string | null }) => Promise<string | null>;
}) {
  const [paidAt, setPaidAt] = useState(() => isoToBrasiliaLocalInput(new Date().toISOString()));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const copy = STATUS_COPY[status];
  const Icon = PAYMENT_STATUS_STYLE[status].icon;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = validateStatusChange({ status, reason, paidAt });
    if (problem) return setError(problem);
    const failure = await onConfirm({
      paidAt: status === "pago" && paidAt ? brasiliaLocalInputToIso(paidAt) : null,
      reason: status === "nao_pago" ? reason.trim() : null,
    });
    if (failure === null) onClose();
    else setError(failure);
  };
  return (
    <Shell
      title={<span className={`flex items-center gap-2 ${PAYMENT_STATUS_STYLE[status].text}`}><Icon className="h-5 w-5" aria-hidden="true" />{copy.title}</span>}
      description={`${payment.description} · ${money(Number(payment.amount))} · hoje: ${PAYMENT_STATUS_LABELS[payment.status as PaymentStatus] ?? payment.status}`}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submit={<Button type="submit" variant="outline" className={PAYMENT_STATUS_STYLE[status].button}>{busy ? "Salvando..." : copy.action}</Button>}
    >
      {status === "pago" && (
        <div className="space-y-2">
          <Label htmlFor="payment-paid-at">Pago em · Brasília</Label>
          <Input id="payment-paid-at" type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </div>
      )}
      {status === "nao_pago" && (
        <div className="space-y-2">
          <Label htmlFor="payment-reason">Motivo *</Label>
          <Textarea id="payment-reason" required minLength={3} maxLength={500} placeholder="Ex.: cartão recusado, cliente não respondeu..." value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      )}
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{copy.hint}</p>
      <Problem text={error} />
    </Shell>
  );
}

export function CRMPaymentRemoveDialog({
  payment,
  busy,
  onClose,
  onConfirm,
}: {
  payment: CRMLeadPayment;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = validateReason(reason);
    if (problem) return setError(problem);
    const failure = await onConfirm(reason.trim());
    if (failure === null) onClose();
    else setError(failure);
  };
  return (
    <Shell
      title="Remover lançamento"
      description={`${payment.description} · ${money(Number(payment.amount))}`}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submit={<Button type="submit" variant="destructive">{busy ? "Removendo..." : "Remover lançamento"}</Button>}
    >
      <div className="space-y-2">
        <Label htmlFor="payment-remove-reason">Motivo da remoção *</Label>
        <Textarea id="payment-remove-reason" required minLength={3} maxLength={500} placeholder="Ex.: lançado por engano" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        O lançamento sai da lista, mas a remoção e o motivo ficam registrados no histórico do lead.
      </p>
      <Problem text={error} />
    </Shell>
  );
}
