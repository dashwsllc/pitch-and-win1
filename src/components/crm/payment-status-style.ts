import { CheckCircle2, Clock3, XCircle, type LucideIcon } from "lucide-react";
import type { PaymentStatus } from "@/lib/crm-payments";

// Pago verde, Não pago vermelho, Pendente amarelo: o mesmo código de cor e ícone em todo o CRM.
export const PAYMENT_STATUS_STYLE: Record<
  PaymentStatus,
  { icon: LucideIcon; badge: string; text: string; soft: string; bar: string; button: string }
> = {
  pago: {
    icon: CheckCircle2,
    badge: "border-green-500/40 bg-green-500/15 text-green-400",
    text: "text-green-400",
    soft: "bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300",
    bar: "bg-green-500",
    button: "border-green-500/40 text-green-400 hover:bg-green-500/10 hover:text-green-300",
  },
  nao_pago: {
    icon: XCircle,
    badge: "border-red-500/40 bg-red-500/15 text-red-400",
    text: "text-red-400",
    soft: "bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300",
    bar: "bg-red-500",
    button: "border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300",
  },
  pendente: {
    icon: Clock3,
    badge: "border-yellow-500/40 bg-yellow-500/15 text-yellow-400",
    text: "text-yellow-400",
    soft: "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 hover:text-yellow-300",
    bar: "bg-yellow-500",
    button: "border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 hover:text-yellow-300",
  },
};
