import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { arenaClient, arenaRpc } from "@/lib/arena-api";
import { useAuth } from "@/hooks/useAuth";
import { useBrasiliaToday } from "@/hooks/useGoals";
import { errorMessage, money } from "@/lib/sales";

export default function Trafego() {
  const { user } = useAuth();
  const today = useBrasiliaToday();
  const [date, setDate] = useState(today);
  const [campaign, setCampaign] = useState("");
  const [platform, setPlatform] = useState("meta");
  const [spend, setSpend] = useState("");
  const [leads, setLeads] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    updated_at: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["arena-traffic", user?.id, page],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await arenaClient
        .from("traffic_metrics")
        .select("*")
        .order("date", { ascending: false })
        .order("id")
        .range(page * 30, page * 30 + 29);
      if (error) throw error;
      return data;
    },
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await arenaRpc("arena_save_traffic", {
        p_id: editing?.id || null,
        p_date: date,
        p_platform: platform,
        p_campaign: campaign,
        p_spend: Number(spend),
        p_leads: Number(leads),
        p_revision: editing?.updated_at,
      });
      setEditing(null);
      setCampaign("");
      setSpend("");
      setLeads("");
      await query.refetch();
      toast.success("Métricas de tráfego salvas");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-3xl font-light">Tráfego</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Investimento e leads reais por dia e campanha. CPL = investimento ÷
            leads gerados.
          </p>
        </header>
        <form
          onSubmit={save}
          className="surface-panel grid gap-4 rounded-xl p-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div>
            <Label htmlFor="traffic-date">Data</Label>
            <Input
              id="traffic-date"
              required
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="traffic-platform">Plataforma</Label>
            <select
              id="traffic-platform"
              className="h-10 w-full rounded border bg-background px-3"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {["meta", "google", "tiktok", "youtube", "other"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="traffic-campaign">Campanha</Label>
            <Input
              id="traffic-campaign"
              required
              maxLength={160}
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="traffic-spend">Investimento (R$)</Label>
            <Input
              id="traffic-spend"
              required
              type="number"
              min="0"
              step="0.01"
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="traffic-leads">Leads gerados</Label>
            <Input
              id="traffic-leads"
              required
              type="number"
              min="0"
              step="1"
              value={leads}
              onChange={(e) => setLeads(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button disabled={busy}>
              {editing ? "Salvar alteração" : "Registrar métricas"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCampaign("");
                  setSpend("");
                  setLeads("");
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
        </form>
        {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
        <div className="space-y-2">
          {query.data?.map((row) => (
            <article
              key={row.id}
              className="surface-panel flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
            >
              <div>
                <h2>
                  {row.campaign_name} · {row.platform}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {row.date.split("-").reverse().join("/")}
                </p>
              </div>
              <p className="text-sm">
                {money(row.spend)} · {row.leads_generated} leads · CPL{" "}
                {row.leads_generated
                  ? money(row.spend / row.leads_generated)
                  : "—"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing({ id: row.id, updated_at: row.updated_at });
                  setDate(row.date);
                  setCampaign(row.campaign_name || "");
                  setPlatform(row.platform);
                  setSpend(String(row.spend));
                  setLeads(String(row.leads_generated));
                }}
              >
                Editar
              </Button>
            </article>
          ))}
          {!query.isLoading && !query.data?.length && (
            <p className="py-10 text-center text-muted-foreground">
              Nenhuma métrica de tráfego registrada.
            </p>
          )}
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
            disabled={(query.data?.length || 0) < 30}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
