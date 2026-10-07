import { useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2, CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useRoles } from "@/hooks/useRoles";
import type { CRMLead } from "@/hooks/useCRM";
import {
  useCRMPaymentActions,
  useLeadPayments,
  type CRMLeadPayment,
  type PaymentSaveData,
} from "@/hooks/useCRMPayments";
import { formatBrasiliaDate, formatDateKey } from "@/lib/brasilia-time";
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  isPaymentStatus,
  paymentMethodLabel,
  summarizePayments,
  type PaymentStatus,
} from "@/lib/crm-payments";
import { errorMessage, exactDate, money } from "@/lib/sales";
import { CRMPaymentBadge } from "./CRMPaymentBadge";
import { PAYMENT_STATUS_STYLE } from "./payment-status-style";
import {
  CRMPaymentFormDialog,
  CRMPaymentRemoveDialog,
  CRMPaymentStatusDialog,
} from "./CRMPaymentDialogs";

const when = (value: string) => formatBrasiliaDate(value, { hour: "2-digit", minute: "2-digit" });

export function CRMPaymentsPanel({
  lead,
  names,
}: {
  lead: CRMLead;
  names: Record<string, string>;
}) {
  const { capabilities } = useRoles();
  const canEdit = capabilities.closer;
  const payments = useLeadPayments(lead.id);
  const actions = useCRMPaymentActions();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ payment: CRMLeadPayment | null } | null>(null);
  const [changing, setChanging] = useState<{ payment: CRMLeadPayment; status: PaymentStatus } | null>(null);
  const [removing, setRemoving] = useState<CRMLeadPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = payments.data ?? [];
  const summary = summarizePayments(rows);
  const leadLabel = `${lead.athlete_name?.trim() || lead.name} · ${lead.name}`;

  // Devolve a mensagem de erro (ou null) para o diálogo mostrá-la no lugar; o sucesso vira aviso na tela.
  const run = async (operation: () => Promise<unknown>, title: string): Promise<string | null> => {
    if (busy) return "Aguarde a operação em andamento.";
    setBusy(true);
    try {
      await operation();
      toast({ title });
      return null;
    } catch (error) {
      return errorMessage(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`payments-${lead.id}`} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`payments-${lead.id}`} className="flex items-center gap-2 text-sm font-semibold">
          <CircleDollarSign className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Pagamento
        </h2>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => setEditing({ payment: null })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Novo lançamento
          </Button>
        )}
      </div>

      {payments.isLoading && <p role="status" className="text-xs text-muted-foreground">Carregando pagamentos...</p>}
      {payments.error && (
        <div role="alert" className="text-xs">
          Não foi possível carregar os pagamentos.{" "}
          <Button type="button" variant="outline" size="sm" onClick={() => payments.refetch()}>Tentar novamente</Button>
        </div>
      )}

      {!payments.isLoading && !payments.error && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            {summary.status ? (
              <CRMPaymentBadge status={summary.status} large />
            ) : (
              <Badge variant="outline" className="h-7 px-3 text-sm text-muted-foreground">
                <CircleDollarSign className="mr-1 h-4 w-4" aria-hidden="true" />
                Sem pagamento registrado
              </Badge>
            )}
            {summary.status && (
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">{money(summary.paid)}</strong> de {money(summary.total)} recebidos
              </p>
            )}
          </div>
          {summary.status && (
            <>
              <div
                role="progressbar"
                aria-label="Valor recebido"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={summary.percent}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className={`h-full rounded-full ${PAYMENT_STATUS_STYLE[summary.status].bar}`} style={{ width: `${summary.percent}%` }} />
              </div>
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className={PAYMENT_STATUS_STYLE.pago.text}>{summary.paidCount} pago(s)</span>
                <span className={PAYMENT_STATUS_STYLE.pendente.text}>{summary.pendingCount} pendente(s)</span>
                <span className={PAYMENT_STATUS_STYLE.nao_pago.text}>{summary.unpaidCount} não pago(s)</span>
                {summary.nextDue && <span>Próximo vencimento: {formatDateKey(summary.nextDue)}</span>}
              </p>
            </>
          )}
          {!rows.length && (
            <p className="text-xs text-muted-foreground">
              {canEdit ? "Nenhum lançamento ainda. Use “Novo lançamento” para registrar entrada, parcelas ou pagamento único." : "Nenhum lançamento registrado para este lead."}
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((payment) => {
            const status = isPaymentStatus(payment.status) ? payment.status : "pendente";
            return (
              <li key={payment.id} className="space-y-1.5 rounded-md border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold">{payment.description}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {money(Number(payment.amount))} · {paymentMethodLabel(payment.method)}
                      {payment.due_date && ` · vence em ${formatDateKey(payment.due_date)}`}
                    </p>
                  </div>
                  <CRMPaymentBadge status={status} />
                </div>
                {payment.paid_at && <p className={`text-[11px] ${PAYMENT_STATUS_STYLE.pago.text}`}>Pago em {when(payment.paid_at)}</p>}
                {payment.status_reason && <p className={`text-[11px] ${PAYMENT_STATUS_STYLE.nao_pago.text}`}>Motivo: {payment.status_reason}</p>}
                {payment.notes && <p className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{payment.notes}</p>}
                {payment.proof_url && /^https:\/\//.test(payment.proof_url) && (
                  <a href={payment.proof_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary underline">
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    Abrir comprovante
                  </a>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Atualizado por {names[payment.updated_by] || "usuário anterior"} · {exactDate(payment.updated_at)}
                </p>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {PAYMENT_STATUSES.filter((option) => option !== status).map((option) => {
                      const Icon = PAYMENT_STATUS_STYLE[option].icon;
                      return (
                        <Button
                          key={option}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          className={`h-7 gap-1 px-2 text-[11px] ${PAYMENT_STATUS_STYLE[option].button}`}
                          aria-label={`Marcar ${payment.description} como ${PAYMENT_STATUS_LABELS[option]}`}
                          onClick={() => setChanging({ payment, status: option })}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {PAYMENT_STATUS_LABELS[option]}
                        </Button>
                      );
                    })}
                    <Button type="button" size="icon" variant="ghost" disabled={busy} className="ml-auto h-7 w-7 text-muted-foreground" aria-label={`Editar ${payment.description}`} title="Editar lançamento" onClick={() => setEditing({ payment })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" disabled={busy} className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Remover ${payment.description}`} title="Remover lançamento" onClick={() => setRemoving(payment)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <CRMPaymentFormDialog
          key={editing.payment?.id ?? "new"}
          payment={editing.payment}
          leadLabel={leadLabel}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(data: PaymentSaveData) =>
            run(() => actions.save(lead.id, editing.payment, data), editing.payment ? "Lançamento atualizado" : "Lançamento registrado")
          }
        />
      )}
      {changing && (
        <CRMPaymentStatusDialog
          key={`${changing.payment.id}-${changing.status}`}
          payment={changing.payment}
          status={changing.status}
          busy={busy}
          onClose={() => setChanging(null)}
          onConfirm={(extra) =>
            run(() => actions.setStatus(changing.payment, changing.status, extra), `Pagamento marcado como ${PAYMENT_STATUS_LABELS[changing.status]}`)
          }
        />
      )}
      {removing && (
        <CRMPaymentRemoveDialog
          key={removing.id}
          payment={removing}
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={(reason) => run(() => actions.remove(removing, reason), "Lançamento removido")}
        />
      )}
    </section>
  );
}
