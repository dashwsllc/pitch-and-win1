import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CRMLead } from "@/hooks/useCRM";
import { CRMPaymentsPanel } from "./CRMPaymentsPanel";

// Ficha própria do pagamento: abre pelo ícone ao lado do de Contexto no card, separada da ficha de contexto.
export function CRMPaymentSheet({
  lead,
  names,
  onClose,
}: {
  lead: CRMLead;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const label = lead.athlete_name?.trim() || lead.name;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-[560px]" data-lenis-prevent>
        <SheetHeader className="space-y-1 pr-8">
          <SheetTitle className="text-base">Pagamento de {label}</SheetTitle>
          <SheetDescription className="text-xs">
            Responsável: {lead.name} · entrada, parcelas e situação do pagamento
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <CRMPaymentsPanel lead={lead} names={names} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
