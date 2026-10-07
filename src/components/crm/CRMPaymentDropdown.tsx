import { useState } from "react";
import { CircleDollarSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSetCRMPaymentStatus } from "@/hooks/useCRMPayments";
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/crm-payments";
import { errorMessage } from "@/lib/sales";
import { cn } from "@/lib/utils";
import { PAYMENT_STATUS_STYLE } from "./payment-status-style";

export function CRMPaymentDropdown({
  leadId, leadName, status, canEdit, disabled, loading, loadError, onRetry,
}: {
  leadId: string;
  leadName: string;
  status?: PaymentStatus;
  canEdit: boolean;
  disabled: boolean;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSetCRMPaymentStatus();
  const label = `Pagamento de ${leadName}`;
  const select = async (next: PaymentStatus) => {
    if (!canEdit || save.isPending || disabled || loading || loadError) return;
    if (next === status) { setOpen(false); return; }
    setError(null);
    try {
      await save.mutateAsync({ leadId, status: next });
      setOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={next => { setOpen(next); if (next) setError(null); }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost" size="icon"
          className={cn("h-8 w-8", status ? PAYMENT_STATUS_STYLE[status].soft : "text-muted-foreground")}
          aria-label={label}
          aria-busy={loading || save.isPending}
          title={loadError ? "Não foi possível carregar o pagamento" : status ? `Pagamento: ${PAYMENT_STATUS_LABELS[status]}` : "Pagamento: sem status"}
          disabled={disabled || loading || save.isPending}
        >
          {loading || save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" aria-label={label}>
        <DropdownMenuLabel>Pagamento</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loadError ? <>
          <p role="alert" className="px-2 py-2 text-xs text-destructive">Não foi possível carregar o pagamento.</p>
          <DropdownMenuItem onSelect={event => { event.preventDefault(); onRetry(); }}>Tentar novamente</DropdownMenuItem>
        </> : <>
          <DropdownMenuRadioGroup value={status ?? ""}>
            {PAYMENT_STATUSES.map(option => {
              const style = PAYMENT_STATUS_STYLE[option];
              const Icon = style.icon;
              return (
                <DropdownMenuRadioItem
                  key={option} value={option}
                  className={cn("min-h-10 gap-2 cursor-pointer", style.menu)}
                  disabled={!canEdit || save.isPending || disabled || loading}
                  onSelect={event => { event.preventDefault(); void select(option); }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />{PAYMENT_STATUS_LABELS[option]}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          {!canEdit && <p className="px-2 py-1.5 text-xs text-muted-foreground">Somente leitura</p>}
          {save.isPending && <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Salvando…</p>}
          {error && <p role="alert" className="px-2 py-2 text-xs text-destructive">{error}</p>}
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
