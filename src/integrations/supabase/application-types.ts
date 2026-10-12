import type { Database, TablesInsert } from './types'

// PostgreSQL's BEFORE INSERT trigger supplies this NOT NULL column when omitted.
// Keep the generated schema intact and describe that insert contract separately.
export type CRMLeadInsert = Omit<TablesInsert<'crm_leads'>, 'lead_generated_at'> & { lead_generated_at?: string }
export type ApplicationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'|'Functions'> & {
    Functions: Database['public']['Functions'] & {
      crm_schedule_call_details:{Args:{p_lead_id:string;p_call_type:string;p_scheduled_at:string;p_assigned_to:string;p_context:string;p_duration_minutes:number;p_expected_version:number|null};Returns:Database['public']['Tables']['crm_activities']['Row']}
      crm_edit_call_details:{Args:{p_activity_id:string;p_assigned_to:string|null;p_scheduled_at:string|null;p_expected_revision:string;p_duration_minutes:number};Returns:Database['public']['Tables']['crm_activities']['Row']}
    }
    Tables: Omit<Database['public']['Tables'], 'crm_leads'> & {
      crm_leads: Omit<Database['public']['Tables']['crm_leads'], 'Insert'> & { Insert: CRMLeadInsert }
    }
  }
}
