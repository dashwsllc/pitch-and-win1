import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { arenaRpc } from "@/lib/arena-api";
import {
  ARENA_REVISION_INTERVAL,
  canAccessArena,
  type ArenaDashboard,
  type ArenaAssignee,
} from "@/lib/arena";

export function useArena(start: string, end: string, valid = true) {
  const { user } = useAuth();
  const { roles } = useRoles();
  const enabled = !!user && canAccessArena(roles) && valid;
  const client = useQueryClient();
  const [checkedAt, setCheckedAt] = useState(0);
  const [connected, setConnected] = useState(true);
  const observedRevision = useRef<number>();
  const query = useQuery({
    queryKey: ["arena", user?.id, start, end],
    enabled,
    queryFn: () =>
      arenaRpc<ArenaDashboard>("arena_dashboard", {
        p_start: start,
        p_end: end,
      }),
    staleTime: 8_000,
    retry: 1,
  });
  useEffect(() => {
    observedRevision.current = query.data?.revision;
  }, [query.data?.revision]);
  useEffect(() => {
    if (!query.data?.cycles.length) return;
    const end = Math.min(
      ...query.data.cycles.map((cycle) => Date.parse(cycle.ends_at)),
    );
    const delay = Math.max(
      1000,
      end - Date.parse(query.data.server_time) + ARENA_REVISION_INTERVAL,
    );
    const timer = setTimeout(
      () => {
        void client.invalidateQueries({ queryKey: ["arena"] });
      },
      Math.min(delay, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [query.data, client]);
  // Existing DataSync handles primary Realtime invalidation. The TV fallback
  // reads one revision value, never the full CRM or the aggregate every 5 seconds.
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (stopped) return;
      try {
        if (!document.hidden) {
          const revision = await arenaRpc<number>("arena_revision", {});
          if (stopped) return;
          if (observedRevision.current === undefined || observedRevision.current !== revision)
            await client.invalidateQueries({ queryKey: ["arena"] });
          setConnected(true);
          setCheckedAt(Date.now());
        }
      } catch {
        if (!stopped) setConnected(false);
      } finally {
        if (!stopped) timer = setTimeout(check, ARENA_REVISION_INTERVAL);
      }
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, user?.id, client]);
  return { ...query, connected: connected && !query.isError, checkedAt };
}

export function useArenaAssignees() {
  const { user } = useAuth();
  const { isExecutive } = useRoles();
  return useQuery({
    queryKey: ["arena-assignees", user?.id],
    enabled: !!user && isExecutive,
    queryFn: () => arenaRpc<ArenaAssignee[]>("arena_assignees", {}),
    staleTime: 15_000,
  });
}
