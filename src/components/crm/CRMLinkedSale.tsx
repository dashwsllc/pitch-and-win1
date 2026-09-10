import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { money, exactDate, errorMessage } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CRMLinkedSale() {
  const [params, setParams] = useSearchParams();
  const id = params.get("sale");
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["crm", "linked-sale", user?.id, id],
    enabled: !!id && !!user,
    queryFn: async () => {
      if (!id || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
        throw new Error("Identificador de venda inválido.");
      const { data, error } = await supabase
        .from("vendas")
        .select(
          "id,nome_comprador,email_comprador,whatsapp_comprador,nome_produto,ticket_name,valor_venda,approval_status,created_at,crm_lead_id",
        )
        .eq("id", id)
        .single();
      if (error)
        throw new Error("Venda indisponível ou sem permissão de acesso.");
      return data;
    },
    retry: 1,
    refetchOnWindowFocus: true,
  });
  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open)
          setParams(
            (p) => {
              p.delete("sale");
              return p;
            },
            { replace: true },
          );
      }}
    >
      <DialogContent className="gap-3 p-4 sm:max-w-md">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Venda cadastrada</DialogTitle>
          <DialogDescription className="text-xs">
            Registro vinculado ao fechamento do CRM.
          </DialogDescription>
        </DialogHeader>
        {query.isPending && <p role="status">Carregando venda...</p>}
        {query.error && (
          <div role="alert">
            {errorMessage(query.error)}{" "}
            <Button variant="outline" onClick={() => query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {query.data && (
          <div className="grid gap-x-3 gap-y-1.5 text-xs break-words sm:grid-cols-2">
            <p className="font-medium">{query.data.nome_comprador}</p>
            <p>{query.data.whatsapp_comprador}</p>
            <p>{query.data.email_comprador}</p>
            <p>
              {query.data.nome_produto} · {query.data.ticket_name}
            </p>
            <p>
              {money(query.data.valor_venda)} · {query.data.approval_status}
            </p>
            <p className="text-muted-foreground">
              {exactDate(query.data.created_at)}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
