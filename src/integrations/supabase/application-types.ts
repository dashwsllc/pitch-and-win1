import type { Database, TablesInsert } from './types'

// PostgreSQL's BEFORE INSERT trigger supplies this NOT NULL column when omitted.
// Keep the generated schema intact and describe that insert contract separately.
export type CRMLeadInsert = Omit<TablesInsert<'crm_leads'>, 'lead_generated_at'> & { lead_generated_at?: string }
export type ApplicationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Omit<Database['public']['Tables'], 'crm_leads'> & {
      crm_leads: Omit<Database['public']['Tables']['crm_leads'], 'Insert'> & { Insert: CRMLeadInsert }
    }
  }
}
