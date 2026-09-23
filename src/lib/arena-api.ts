import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { ArenaNotification, ArenaEvent } from "./arena";

// Additive contract until the generated project schema is refreshed after the
// migration. This is the SAME authenticated Supabase client and auth session.
type FunctionDef<Args> = { Args: Args; Returns: Json };
type ExtraFunctions = {
  arena_classify_legacy: FunctionDef<{
    p_audit_id: string;
    p_approved: boolean;
    p_reason: string;
  }>;
  arena_live_cursor: FunctionDef<Record<string, never>>;
  arena_revision: FunctionDef<Record<string, never>>;
  arena_dashboard: FunctionDef<{ p_start: string; p_end: string }>;
  arena_management: FunctionDef<{ p_tab: string; p_offset?: number }>;
  arena_assignees: FunctionDef<Record<string, never>>;
  arena_save_goal: FunctionDef<{
    p_data: Json;
    p_reason: string;
    p_previous?: string;
  }>;
  arena_adjust_score: FunctionDef<{
    p_person: string;
    p_role: string;
    p_delta: number;
    p_source: string;
    p_reason: string;
    p_request: string;
  }>;
  arena_set_visibility: FunctionDef<{
    p_person: string;
    p_hidden: boolean;
    p_reason: string;
  }>;
  arena_complete_task: FunctionDef<{
    p_id: string;
    p_completed: boolean;
    p_version: number;
    p_comment?: string;
  }>;
  arena_assign_tasks: FunctionDef<{
    p_title: string;
    p_date: string;
    p_people: string[];
    p_roles: string[];
    p_status?: string;
  }>;
  arena_task_status: FunctionDef<{
    p_id: string;
    p_version: number;
    p_status: string;
  }>;
  arena_read_notifications: FunctionDef<{ p_ids: string[] }>;
  arena_reverse_sale: FunctionDef<{
    p_id: string;
    p_status: string;
    p_reason: string;
    p_revision: string;
  }>;
  arena_cancel_call: FunctionDef<{
    p_id: string;
    p_revision: string;
    p_reason: string;
  }>;
  arena_save_traffic: FunctionDef<{
    p_id: string | null;
    p_date: string;
    p_platform: string;
    p_campaign: string;
    p_spend: number;
    p_leads: number;
    p_revision?: string | null;
  }>;
};
type ReadTable<Row> = {
  Row: { [K in keyof Row]: Row[K] };
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
type ArenaDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions" | "Tables"> & {
    Functions: Database["public"]["Functions"] & ExtraFunctions;
    Tables: Database["public"]["Tables"] & {
      arena_notifications: ReadTable<ArenaNotification>;
      activity_feed: ReadTable<ArenaEvent>;
    };
  };
};
export const arenaClient = supabase as unknown as SupabaseClient<ArenaDatabase>;
export async function arenaRpc<
  T,
  N extends keyof ExtraFunctions = keyof ExtraFunctions,
>(name: N, args: ExtraFunctions[N]["Args"]): Promise<T> {
  const { data, error } = await arenaClient.rpc(name, args);
  if (error) throw error;
  return data as unknown as T;
}
