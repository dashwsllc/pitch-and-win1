import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { arenaRpc } from "@/lib/arena-api";
import { eventLabels, type ArenaEvent } from "@/lib/arena";
import { money, exactDate, errorMessage } from "@/lib/sales";

interface Legacy {
  id: string;
  target_id: string;
  target_label: string;
  amount: string;
  reason: string;
  created_at: string;
}
export function EventAudit() {
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["arena-events", page],
    queryFn: () =>
      arenaRpc<ArenaEvent[]>("arena_management", {
        p_tab: "events",
        p_offset: page * 50,
      }),
  });
  const legacy = useQuery({
    queryKey: ["arena-legacy"],
    queryFn: () =>
      arenaRpc<Legacy[]>("arena_management", { p_tab: "reconciliation" }),
  });
  const [selected, setSelected] = useState<ArenaEvent | null>(null);
  const [classification, setClassification] = useState<Legacy | null>(null);
  const [approved, setApproved] = useState("");
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState("");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (selected)
        await arenaRpc("arena_adjust_score", {
          p_person: selected.responsible_id,
          p_role: selected.responsible_role,
          p_delta: Number(delta),
          p_source: selected.id,
          p_reason: reason,
          p_request: request,
        });
      if (classification)
        await arenaRpc("arena_classify_legacy", {
          p_audit_id: classification.id,
          p_approved: approved === "yes",
          p_reason: reason,
        });
      setSelected(null);
      setClassification(null);
      await Promise.all([
        query.refetch(),
        legacy.refetch(),
        client.invalidateQueries({ queryKey: ["arena"] }),
        client.invalidateQueries({ queryKey: ["arena-records"] }),
      ]);
      toast.success("Decisão registrada na auditoria");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      <h2 className="text-lg">Eventos comerciais e correções</h2>
      <p className="text-sm text-muted-foreground">
        Correções de pontuação entram no ciclo atual e referenciam o evento
        original. Não reescrevem ciclos encerrados.
      </p>
      {!!legacy.data?.length && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
          <h3 className="text-amber-300">Histórico aguardando classificação</h3>
          <p className="my-2 text-xs text-muted-foreground">
            Estas vendas foram excluídas antes da Arena. Confirme se houve
            aprovação válida antes do cancelamento.
          </p>
          {legacy.data.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <p className="text-sm">
                {row.target_label} · {money(Number(row.amount))} · motivo
                registrado: {row.reason}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setClassification(row);
                  setReason("");
                  setApproved("");
                }}
              >
                Classificar
              </Button>
            </div>
          ))}
        </div>
      )}
      {(query.isError || legacy.isError) && (
        <p role="alert">{errorMessage(query.error || legacy.error)}</p>
      )}
      <div className="space-y-2">
        {query.data?.map((row) => (
          <article
            key={row.id}
            className="surface-panel flex items-center justify-between gap-3 rounded-xl p-4"
          >
            <div>
              <p className="text-sm">
                {row.responsible_name} ·{" "}
                {eventLabels[row.action_type] || row.action_type}
              </p>
              <p className="text-xs text-muted-foreground">
                {exactDate(row.occurred_at)} · {row.score_delta > 0 ? "+" : ""}
                {row.score_delta} p.p. · {money(row.revenue_delta)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(row);
                setReason("");
                setDelta("");
                setRequest(crypto.randomUUID());
              }}
            >
              Corrigir pontos
            </Button>
          </article>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          disabled={(query.data?.length || 0) < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </div>
      <Dialog
        open={!!selected || !!classification}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelected(null);
            setClassification(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected
                ? "Confirmar correção de pontuação"
                : "Classificar venda histórica"}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.responsible_name} · ${eventLabels[selected.action_type]}. Registre somente o acréscimo ou desconto necessário.`
                : "Uma aprovação válida preserva o faturamento bruto. Uma aprovação registrada por engano permanece fora dos indicadores."}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <>
              <Label htmlFor="score-delta">
                Ajuste (p.p., negativo para desconto)
              </Label>
              <Input
                id="score-delta"
                type="number"
                step="0.1"
                min="-100"
                max="100"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
            </>
          ) : (
            <>
              <Label htmlFor="legacy-approved">
                Houve aprovação comercial válida?
              </Label>
              <select
                id="legacy-approved"
                className="rounded border bg-background p-2"
                value={approved}
                onChange={(e) => setApproved(e.target.value)}
              >
                <option value="">Selecione a classificação</option>
                <option value="yes">
                  Sim, houve aprovação e depois cancelamento
                </option>
                <option value="no">
                  Não, a aprovação foi registrada por engano
                </option>
              </select>
            </>
          )}
          <Label htmlFor="event-reason">Motivo e evidência da decisão</Label>
          <Input
            id="event-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={
              busy ||
              reason.trim().length < 5 ||
              (!!selected && (!delta || Number(delta) === 0)) ||
              (!!classification && !approved)
            }
            onClick={save}
          >
            Confirmar e registrar
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
