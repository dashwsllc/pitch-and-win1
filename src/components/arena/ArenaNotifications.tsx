import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { arenaClient, arenaRpc } from "@/lib/arena-api";
import type { ArenaEvent, ArenaNotification } from "@/lib/arena";
import { exactDate, errorMessage, money } from "@/lib/sales";
import { addPopup, type ArenaPopup } from "@/lib/arena-popups";

export function SaleAlerts() {
  const { user } = useAuth();
  const userId = user?.id;
  const queue = useRef<ArenaPopup[]>([]);
  useEffect(() => {
    if (!userId) return;
    const storageKey = `arena-sale-seen:${userId}`;
    let initial: string[] = [];
    try {
      const cached: unknown = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      if (Array.isArray(cached)) initial = cached.filter((id): id is string => typeof id === "string");
    } catch {
      /* Invalid browser cache is discarded. */
    }
    const seen = new Set(initial.slice(-500));
    const remember = (id: string) => {
      seen.add(id);
      if (seen.size > 500) seen.delete(seen.values().next().value!);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...seen]));
      } catch {
        // Realtime's server cursor and this bounded set still prevent replays.
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = false;
    const next = () => {
      const event = queue.current.shift();
      if (!event) {
        active = false;
        return;
      }
      active = true;
      toast(event.title, {
        description: event.description,
        id: event.id,
        duration: 4500,
      });
      timer = setTimeout(next, 5000);
    };
    const receive = (raw: Event) => {
      const event = (raw as CustomEvent<ArenaEvent>).detail;
      if (
        event.action_type !== "sale.approved" ||
        event.responsible_role !== "closer" ||
        event.provenance !== "live" ||
        seen.has(event.id)
      )
        return;
      remember(event.id);
      queue.current = addPopup(queue.current, {
        id: event.id,
        title: `${event.responsible_name} · venda aprovada`,
        description: `${money(event.revenue_delta)} · crédito na meta semanal do Closer`,
        priority: 3,
        sound: false,
        receivedAt: Date.now(),
      });
      if (!active) next();
    };
    const notification = (raw: Event) => {
      const event = (raw as CustomEvent<ArenaNotification>).detail;
      if (event.kind === "sale.approved" || seen.has(event.id)) return;
      remember(event.id);
      queue.current = addPopup(queue.current, {
        id: event.id,
        title: event.title,
        priority: ["cycle.achieved", "cycle.exceeded", "cycle.closed"].includes(
          event.kind,
        )
          ? 2
          : 1,
        sound: false,
        receivedAt: Date.now(),
      });
      if (!active) next();
    };
    const manualBell = () => {
      queue.current = addPopup(queue.current, {
        id: `manual-bell:${Date.now()}:${Math.random()}`,
        title: "🔔 Venda!",
        description: "Sino acionado manualmente · sem lançar venda ou alterar metas",
        priority: 3,
        sound: false,
        receivedAt: Date.now(),
      });
      if (!active) next();
    };
    window.addEventListener("arena-fresh-event", receive);
    window.addEventListener("arena-fresh-notification", notification);
    window.addEventListener("arena-manual-sale-bell", manualBell);
    return () => {
      clearTimeout(timer);
      queue.current = [];
      window.removeEventListener("arena-fresh-event", receive);
      window.removeEventListener("arena-fresh-notification", notification);
      window.removeEventListener("arena-manual-sale-bell", manualBell);
    };
  }, [userId]);
  return null;
}
export function NotificationInbox() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["arena-notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await arenaClient
        .from("arena_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });
  const unread = (query.data ?? []).filter((n) => !n.read_at);
  const markRead = async () => {
    try {
      await arenaRpc("arena_read_notifications", {
        p_ids: unread.map((n) => n.id),
      });
      await query.refetch();
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notificações, ${unread.length} não lidas`}
        >
          <Bell className="h-4 w-4" />
          {!!unread.length && (
            <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-ember" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Notificações</h2>
          <button
            className="text-xs text-ember"
            disabled={!unread.length}
            onClick={markRead}
          >
            Marcar lidas
          </button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {query.isError ? (
            <p role="alert">Não foi possível carregar as notificações.</p>
          ) : !query.data?.length ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma notificação.
            </p>
          ) : (
            query.data.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg p-2 ${n.read_at ? "opacity-60" : "bg-white/5"}`}
              >
                <p className="text-xs">{n.title}</p>
                <time className="text-[10px] text-muted-foreground">
                  {exactDate(n.created_at)}
                </time>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
