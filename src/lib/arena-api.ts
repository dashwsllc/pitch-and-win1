import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { ArenaNotification, ArenaEvent } from "./arena";
import type { MetaDailyRow } from "./meta-traffic";
import type { MetaFormLead } from "./meta-leads";

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
  arena_visible_goals: FunctionDef<Record<string, never>>;
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
  arena_assign_checklist_task: FunctionDef<{
    p_title: string;
    p_assignee: string;
    p_deadline_at: string;
    p_items: string[];
  }>;
  arena_toggle_task_checklist: FunctionDef<{
    p_id: string;
    p_item_id: string;
    p_done: boolean;
    p_version: number;
  }>;
  arena_set_task_checklist_completion: FunctionDef<{
    p_id: string;
    p_completed: boolean;
    p_version: number;
  }>;
  arena_create_shift_approach_goals: FunctionDef<{
    p_title: string;
    p_people: string[];
    p_roles: string[];
    p_starts_at: string;
    p_duration_minutes: number;
    p_target_approaches: number;
    p_source: "crm" | "manual";
  }>;
  arena_convert_task_to_shift_goal: FunctionDef<{
    p_task_id: string;
    p_expected_version: number;
    p_starts_at: string;
    p_duration_minutes: number;
    p_target_approaches: number;
    p_source: "crm" | "manual";
  }>;
  arena_shift_approach_progress: FunctionDef<{
    p_day: string;
    p_person?: string | null;
    p_offset?: number;
  }>;
  arena_cancel_shift_approach_goal: FunctionDef<{ p_id: string; p_reason: string }>;
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
  meta_import_daily: FunctionDef<{ p_filename: string; p_rows: Json }>;
  traffic_create_suggestion: FunctionDef<{ p_subject: string; p_body: string; p_campaign_id?: string | null }>;
  traffic_reply_suggestion: FunctionDef<{ p_id: string; p_body: string }>;
  traffic_set_suggestion_status: FunctionDef<{ p_id: string; p_status: string }>;
  meta_promote_form_lead: FunctionDef<{ p_id: string; p_contact: Json }>;
  meta_ignore_form_lead: FunctionDef<{ p_id: string; p_reason: string }>;
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
      meta_traffic_daily: ReadTable<MetaDailyRow>;
      traffic_suggestions: ReadTable<{ id: string; author_id: string; author_name: string; subject: string; body: string; campaign_id: string | null; status: string; created_at: string; updated_at: string }>;
      traffic_suggestion_replies: ReadTable<{ id: string; suggestion_id: string; author_id: string; author_name: string; body: string; created_at: string }>;
      meta_import_batches: ReadTable<{ id: string; imported_by: string; filename: string; row_count: number; created_at: string }>;
      meta_form_leads: ReadTable<MetaFormLead>;
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
