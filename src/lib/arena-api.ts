import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { ArenaNotification, ArenaEvent } from "./arena";
import type { ImportRow, MetaDailyRow } from "./meta-traffic";
import type { MetaFormLead, MetaAuditEvent } from "./meta-leads";
import type { MetaAdAccount, MetaSyncRun } from "./meta-connection";
import type { LeadImportRow, LeadImportResult } from "./meta-lead-import";

// Additive contract until the generated project schema is refreshed after the
// migration. This is the SAME authenticated Supabase client and auth session.
type FunctionDef<Args> = { Args: Args; Returns: Json };
type ExtraFunctions = {
  crm_context_summary: FunctionDef<{ p_offset: number; p_limit: number }>;
  site_bridge_operation: FunctionDef<Record<string, never>>;
  // Legacy ranking contract may be deployed separately from the traffic schema.
  get_daily_call_ranking: FunctionDef<Record<string, never>>;
  meta_traffic_operation: FunctionDef<Record<string, never>>;
  // Levas de 20 leads (formulários da Meta e planilhas), envio ao CRM e conferência de leads.
  meta_wave_list: FunctionDef<{ p_status: 'pendente' | 'aprovada' | 'rejeitada' | null; p_limit: number; p_offset: number }>;
  meta_wave_leads: FunctionDef<{ p_wave: string }>;
  meta_wave_begin_review: FunctionDef<{ p_wave: string }>;
  meta_wave_decide_versioned: FunctionDef<{ p_wave: string; p_expected_version: number; p_members: Json; p_action: 'aprovar' | 'rejeitar'; p_excluded: Json; p_note: string; p_request_id: string }>;
  meta_wave_decide: FunctionDef<{ p_wave: string; p_action: 'aprovar' | 'rejeitar'; p_lead_ids: string[]; p_excluded: Json; p_note: string }>;
  meta_wave_retry: FunctionDef<{ p_wave: string; p_lead: string | null }>;
  meta_wave_rebuild: FunctionDef<Record<string, never>>;
  meta_wave_reopen: FunctionDef<{ p_wave: string | null; p_lead: string | null }>;
  meta_traffic_conference: FunctionDef<{ p_start: string; p_end: string }>;
  meta_traffic_review_list: FunctionDef<{ p_kind: 'metrics' | 'leads' | null; p_status: string | null; p_offset: number; p_limit: number }>;
  meta_capture_review_part: FunctionDef<{ p_id: string; p_version: number; p_offset: number; p_limit: number }>;
  meta_capture_review_decide: FunctionDef<{ p_id: string; p_version: number; p_action: 'aprovar' | 'rejeitar'; p_note: string }>;
  meta_capture_review_edit: FunctionDef<{ p_id: string; p_version: number; p_row_no: number; p_patch: Json; p_reason: string }>;
  meta_capture_review_resolve: FunctionDef<{ p_id: string; p_version: number; p_row_no: number; p_action: 'keep_published' | 'use_incoming' | 'use_edited' | 'remove'; p_payload: Json; p_reason: string }>;
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
  arena_goal_history: FunctionDef<{
    p_person?: string | null;
    p_outcome?: "all" | "achieved" | "failed" | "unassigned";
    p_offset?: number;
    p_limit?: number;
  }>;
  arena_assignees: FunctionDef<Record<string, never>>;
  arena_save_goal: FunctionDef<{
    p_data: Json;
    p_reason: string;
    p_previous?: string;
  }>;
  arena_delete_goal: FunctionDef<{
    p_family_id: string;
    p_reason: string;
  }>;
  arena_score_weights: FunctionDef<Record<string, never>>;
  arena_save_score_weights: FunctionDef<{
    p_weights: Json;
    p_reason: string;
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
  meta_review_traffic_import: FunctionDef<{ p_batch_id: string; p_action: 'aprovar' | 'rejeitar'; p_expected_updated_at: string; p_note?: string }>;
  meta_import_leads: FunctionDef<{ p_filename: string; p_rows: Json }>;
  meta_review_lead_import: FunctionDef<{ p_batch_id: string; p_action: 'aprovar' | 'rejeitar'; p_expected_updated_at: string; p_note?: string }>;
  meta_review_form_lead: FunctionDef<{ p_id: string; p_action: 'aprovar' | 'rejeitar'; p_expected_updated_at: string; p_note?: string }>;
  meta_get_traffic_lead: FunctionDef<{ p_id: string }>;
  meta_edit_form_lead: FunctionDef<{ p_id: string; p_expected_updated_at: string; p_expected_crm_version: number | null; p_patch: Json; p_reason: string }>;
  meta_edit_import_row: FunctionDef<{ p_kind: 'leads' | 'metrics'; p_batch_id: string; p_row_index: number; p_expected_updated_at: string; p_patch: Json; p_reason: string }>;
  meta_edit_traffic_row: FunctionDef<{ p_id: string; p_expected_updated_at: string; p_patch: Json; p_reason: string }>;
  traffic_create_suggestion: FunctionDef<{ p_subject: string; p_body: string; p_campaign_id?: string | null }>;
  traffic_reply_suggestion: FunctionDef<{ p_id: string; p_body: string }>;
  traffic_set_suggestion_status: FunctionDef<{ p_id: string; p_status: string }>;
  meta_promote_form_lead: FunctionDef<{ p_id: string; p_contact: Json }>;
  meta_ignore_form_lead: FunctionDef<{ p_id: string; p_reason: string }>;
  meta_crm_attribution_daily: FunctionDef<{ p_start: string; p_end: string }>;
  meta_traffic_cohort: FunctionDef<{ p_start: string; p_end: string; p_account_id?: string | null; p_campaign_id?: string | null; p_source?: 'api' | 'csv' | 'manual_legacy' | null }>;
  meta_traffic_lead_reconciliation: FunctionDef<{ p_start: string; p_end: string }>;
  meta_connect_ad_account: FunctionDef<{ p_account_id: string; p_account_name: string; p_currency?: string; p_timezone?: string }>;
  meta_disconnect_ad_account: FunctionDef<{ p_account_id: string; p_reason: string }>;
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
      meta_import_batches: ReadTable<{ id: string; imported_by: string | null; filename: string; row_count: number; created_at: string;
        status: 'pendente' | 'aprovado' | 'rejeitado'; rows: ImportRow[]; updated_at: string;
        source: 'csv' | 'api'; sync_run_id: string | null; account_id: string | null; level: 'campaign' | 'adset' | 'ad' | null;
        reviewed_by: string | null; reviewed_at: string | null; review_note: string | null }>;
      meta_lead_import_batches: ReadTable<{ id: string; imported_by: string; filename: string; row_count: number; created_at: string;
        status: 'pendente' | 'aprovado' | 'rejeitado'; rows: LeadImportRow[]; updated_at: string;
        reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; result: LeadImportResult | null }>;
      meta_form_leads: ReadTable<MetaFormLead>;
      site_import_events: ReadTable<{ event_id: string; receipt_id: string; source_project: string; source_lead_id: string; source_revision: number; schema_version: number; body_sha256: string; event: Json; received_at: string; meta_form_lead_id: string | null; status: string; error_code: string | null }>;
      meta_audit_events: ReadTable<MetaAuditEvent>;
      meta_ad_accounts: ReadTable<MetaAdAccount>;
      meta_sync_runs: ReadTable<MetaSyncRun>;
      meta_webhook_events: ReadTable<{ id: string; leadgen_id: string; page_id: string; form_id: string; status: 'pending' | 'processed' | 'error' | 'ignored'; attempts: number; last_error: string | null; meta_form_lead_id: string | null; received_at: string; processed_at: string | null; updated_at: string }>;
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
