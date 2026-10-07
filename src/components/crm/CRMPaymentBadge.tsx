import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/crm-payments";
import { PAYMENT_STATUS_STYLE } from "./payment-status-style";

export function CRMPaymentBadge({
  status,
  detail,
  large = false,
  className,
}: {
  status: PaymentStatus;
  detail?: string;
  large?: boolean;
  className?: string;
}) {
  const style = PAYMENT_STATUS_STYLE[status];
  const Icon = style.icon;
  const label = PAYMENT_STATUS_LABELS[status];
  return (
    <Badge
      variant="outline"
      aria-label={`Pagamento: ${label}${detail ? `, ${detail}` : ""}`}
      title={detail ? `${label} · ${detail}` : label}
      className={cn(
        "shrink-0 gap-1 whitespace-nowrap",
        large ? "h-7 px-3 text-sm" : "h-5 px-2 text-[10px]",
        style.badge,
        className,
      )}
    >
      <Icon className={large ? "h-4 w-4" : "h-3 w-3"} aria-hidden="true" />
      {label}
      {detail && <span className="font-normal opacity-80">· {detail}</span>}
    </Badge>
  );
}
