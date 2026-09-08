export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      products: {
        Row: { id: string; name: string; description: string | null; active: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; name: string; description?: string | null; active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { name?: string; description?: string | null; active?: boolean; updated_at?: string }
        Relationships: []
      }
      product_tickets: {
        Row: { id: string; product_id: string; name: string; price: number; active: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; product_id: string; name: string; price: number; active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { name?: string; price?: number; active?: boolean; updated_at?: string }
        Relationships: [{ foreignKeyName: "product_tickets_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] }]
      }
      dashboard_events: {
        Row: { topic: string; revision: number; updated_at: string }
        Insert: { topic: string; revision?: number; updated_at?: string }
        Update: { revision?: number; updated_at?: string }
        Relationships: []
      }
      executive_audit_events: {
        Row: { id: string; actor_id: string | null; actor_name: string; action: string; target_id: string; target_label: string; reason: string; before_data: Json | null; after_data: Json | null; created_at: string }
        Insert: { id?: string; actor_id?: string | null; actor_name: string; action: string; target_id: string; target_label: string; reason: string; before_data?: Json | null; after_data?: Json | null; created_at?: string }
        Update: { reason?: string }
        Relationships: []
      }
      abordagens: {
        Row: {
          created_at: string
          dados_abordados: string
          id: string
          mostrou_ia: boolean
          nomes_abordados: string
          tempo_medio_abordagem: number
          updated_at: string
          user_id: string
          visao_geral: string
        }
        Insert: {
          created_at?: string
          dados_abordados: string
          id?: string
          mostrou_ia?: boolean
          nomes_abordados: string
          tempo_medio_abordagem: number
          updated_at?: string
          user_id: string
          visao_geral: string
        }
        Update: {
          created_at?: string
          dados_abordados?: string
          id?: string
          mostrou_ia?: boolean
          nomes_abordados?: string
          tempo_medio_abordagem?: number
          updated_at?: string
          user_id?: string
          visao_geral?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          content: string
          created_at: string | null
          created_by: string
          id: string
          pinned: boolean | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by: string
          id?: string
          pinned?: boolean | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string
          id?: string
          pinned?: boolean | null
          title?: string
        }
        Relationships: []
      }
      assinaturas: {
        Row: {
          created_at: string
          email_cliente: string
          id: string
          nome_cliente: string
          nome_produto: string
          status: string
          updated_at: string
          user_id: string
          valor_assinatura: string
          whatsapp_cliente: string
        }
        Insert: {
          created_at?: string
          email_cliente: string
          id?: string
          nome_cliente: string
          nome_produto: string
          status?: string
          updated_at?: string
          user_id: string
          valor_assinatura: string
          whatsapp_cliente: string
        }
        Update: {
          created_at?: string
          email_cliente?: string
          id?: string
          nome_cliente?: string
          nome_produto?: string
          status?: string
          updated_at?: string
          user_id?: string
          valor_assinatura?: string
          whatsapp_cliente?: string
        }
        Relationships: []
      }
      closing_forms: {
        Row: {
          closed_at: string | null
          closer_id: string
          created_at: string | null
          how_closed: string | null
          id: string
          lead_name: string
          lead_whatsapp: string | null
          next_steps: string | null
          objections_raised: string | null
          product: string
          status: string | null
          value: number
        }
        Insert: {
          closed_at?: string | null
          closer_id: string
          created_at?: string | null
          how_closed?: string | null
          id?: string
          lead_name: string
          lead_whatsapp?: string | null
          next_steps?: string | null
          objections_raised?: string | null
          product: string
          status?: string | null
          value: number
        }
        Update: {
          closed_at?: string | null
          closer_id?: string
          created_at?: string | null
          how_closed?: string | null
          id?: string
          lead_name?: string
          lead_whatsapp?: string | null
          next_steps?: string | null
          objections_raised?: string | null
          product?: string
          status?: string | null
          value?: number
        }
        Relationships: []
      }
      company_goals: {
        Row: {
          created_at: string | null
          created_by: string | null
          current: number | null
          deadline: string | null
          description: string | null
          id: string
          period: string
          status: string | null
          target: number | null
          title: string
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          current?: number | null
          deadline?: string | null
          description?: string | null
          id?: string
          period: string
          status?: string | null
          target?: number | null
          title: string
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          current?: number | null
          deadline?: string | null
          description?: string | null
          id?: string
          period?: string
          status?: string | null
          target?: number | null
          title?: string
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_activities: {
        Row: {
          activity_type: string
          completed_at: string | null
          created_at: string | null
          description: string | null
          id: string
          is_completed: boolean
          is_pinned: boolean
          lead_id: string
          outcome: string | null
          scheduled_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          activity_type: string
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_completed?: boolean
          is_pinned?: boolean
          lead_id: string
          outcome?: string | null
          scheduled_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          activity_type?: string
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_completed?: boolean
          is_pinned?: boolean
          lead_id?: string
          outcome?: string | null
          scheduled_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          age: number | null
          approach_count: number
          approached: boolean
          approached_at: string | null
          assigned_to: string | null
          company: string | null
          conversion_probability: number | null
          created_at: string | null
          created_by: string | null
          email: string | null
          estimated_deal_value: number | null
          expected_close_at: string | null
          first_contact_at: string | null
          id: string
          job_title: string | null
          last_contact_at: string | null
          lead_source: string | null
          linkedin_url: string | null
          name: string
          next_followup_at: string | null
          observations: string | null
          observations_updated_at: string | null
          observations_updated_by: string | null
          phone: string | null
          pipeline_stage: string
          priority: string
          profile_photo_url: string | null
          tags: string[] | null
          temperature: string
          updated_at: string | null
        }
        Insert: {
          age?: number | null
          approach_count?: number
          approached?: boolean
          approached_at?: string | null
          assigned_to?: string | null
          company?: string | null
          conversion_probability?: number | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          estimated_deal_value?: number | null
          expected_close_at?: string | null
          first_contact_at?: string | null
          id?: string
          job_title?: string | null
          last_contact_at?: string | null
          lead_source?: string | null
          linkedin_url?: string | null
          name: string
          next_followup_at?: string | null
          observations?: string | null
          observations_updated_at?: string | null
          observations_updated_by?: string | null
          phone?: string | null
          pipeline_stage?: string
          priority?: string
          profile_photo_url?: string | null
          tags?: string[] | null
          temperature?: string
          updated_at?: string | null
        }
        Update: {
          age?: number | null
          approach_count?: number
          approached?: boolean
          approached_at?: string | null
          assigned_to?: string | null
          company?: string | null
          conversion_probability?: number | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          estimated_deal_value?: number | null
          expected_close_at?: string | null
          first_contact_at?: string | null
          id?: string
          job_title?: string | null
          last_contact_at?: string | null
          lead_source?: string | null
          linkedin_url?: string | null
          name?: string
          next_followup_at?: string | null
          observations?: string | null
          observations_updated_at?: string | null
          observations_updated_by?: string | null
          phone?: string | null
          pipeline_stage?: string
          priority?: string
          profile_photo_url?: string | null
          tags?: string[] | null
          temperature?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      custom_positions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          max_members: number
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_members?: number
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_members?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_categories: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          category_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          link_url: string
          title: string
          updated_at: string
          visible_to_roles: string[] | null
        }
        Insert: {
          category_id: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          link_url: string
          title: string
          updated_at?: string
          visible_to_roles?: string[] | null
        }
        Update: {
          category_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          link_url?: string
          title?: string
          updated_at?: string
          visible_to_roles?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "document_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string | null
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_requests: {
        Row: {
          email: string
          id: string
          processed_at: string | null
          processed_by: string | null
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          email: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          email?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      playbooks: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          tags: string[] | null
          target_roles: string[]
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          tags?: string[] | null
          target_roles?: string[]
          title: string
          type: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          tags?: string[] | null
          target_roles?: string[]
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          last_seen_at: string
          suspended: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_seen_at?: string
          suspended?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_seen_at?: string
          suspended?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saldos_disponiveis: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string
          valor_liberado_para_saque: number
          valor_sacado: number
          valor_total_comissoes: number
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          valor_liberado_para_saque?: number
          valor_sacado?: number
          valor_total_comissoes?: number
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          valor_liberado_para_saque?: number
          valor_sacado?: number
          valor_total_comissoes?: number
        }
        Relationships: []
      }
      saques: {
        Row: {
          chave_pix: string | null
          cpf_titular: string | null
          created_at: string
          data_processamento: string | null
          data_solicitacao: string
          id: string
          motivo_rejeicao: string | null
          nome_titular: string | null
          observacoes: string | null
          pago_em: string | null
          previsao_pagamento: string | null
          processado_por: string | null
          revisado_em: string | null
          revisado_por: string | null
          status: string
          tipo_chave_pix: string | null
          updated_at: string
          user_id: string
          valor_aprovado: number | null
          valor_solicitado: number
          vendas_incluidas: string[] | null
        }
        Insert: {
          chave_pix?: string | null
          cpf_titular?: string | null
          created_at?: string
          data_processamento?: string | null
          data_solicitacao?: string
          id?: string
          motivo_rejeicao?: string | null
          nome_titular?: string | null
          observacoes?: string | null
          pago_em?: string | null
          previsao_pagamento?: string | null
          processado_por?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string
          tipo_chave_pix?: string | null
          updated_at?: string
          user_id: string
          valor_aprovado?: number | null
          valor_solicitado: number
          vendas_incluidas?: string[] | null
        }
        Update: {
          chave_pix?: string | null
          cpf_titular?: string | null
          created_at?: string
          data_processamento?: string | null
          data_solicitacao?: string
          id?: string
          motivo_rejeicao?: string | null
          nome_titular?: string | null
          observacoes?: string | null
          pago_em?: string | null
          previsao_pagamento?: string | null
          processado_por?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string
          tipo_chave_pix?: string | null
          updated_at?: string
          user_id?: string
          valor_aprovado?: number | null
          valor_solicitado?: number
          vendas_incluidas?: string[] | null
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: unknown
          record_id: string | null
          table_name: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          record_id?: string | null
          table_name: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          record_id?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      team_member_history: {
        Row: {
          action_type: string
          created_at: string
          created_by: string | null
          id: string
          member_id: string | null
          new_values: Json | null
          old_values: Json | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          action_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string | null
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string | null
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_member_history_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          custom_tags: string[] | null
          date_added: string
          id: string
          name: string
          position: string
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_tags?: string[] | null
          date_added?: string
          id?: string
          name: string
          position: string
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_tags?: string[] | null
          date_added?: string
          id?: string
          name?: string
          position?: string
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      team_messages: {
        Row: {
          content: string | null
          created_at: string | null
          file_name: string | null
          file_type: string | null
          file_url: string | null
          id: string
          link_title: string | null
          link_url: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          link_title?: string | null
          link_url?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          link_title?: string | null
          link_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      traffic_metrics: {
        Row: {
          ad_set_name: string | null
          campaign_name: string
          clicks: number | null
          cpc: number | null
          cpl: number | null
          created_at: string | null
          ctr: number | null
          date: string
          id: string
          impressions: number | null
          leads_generated: number | null
          manager_id: string
          notes: string | null
          platform: string
          spend: number
          updated_at: string | null
        }
        Insert: {
          ad_set_name?: string | null
          campaign_name: string
          clicks?: number | null
          cpc?: number | null
          cpl?: number | null
          created_at?: string | null
          ctr?: number | null
          date: string
          id?: string
          impressions?: number | null
          leads_generated?: number | null
          manager_id: string
          notes?: string | null
          platform?: string
          spend?: number
          updated_at?: string | null
        }
        Update: {
          ad_set_name?: string | null
          campaign_name?: string
          clicks?: number | null
          cpc?: number | null
          cpl?: number | null
          created_at?: string | null
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number | null
          leads_generated?: number | null
          manager_id?: string
          notes?: string | null
          platform?: string
          spend?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          can_view_sales: boolean | null
          commission_rate: number
          created_at: string
          crm_access: boolean
          granted_at: string | null
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          can_view_sales?: boolean | null
          commission_rate?: number
          created_at?: string
          crm_access?: boolean
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          can_view_sales?: boolean | null
          commission_rate?: number
          created_at?: string
          crm_access?: boolean
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vendas: {
        Row: {
          product_id: string | null
          ticket_id: string | null
          ticket_name: string | null
          approval_status: string
          commission_amount: number | null
          consideracoes_gerais: string | null
          created_at: string
          email_comprador: string
          id: string
          nome_comprador: string
          nome_produto: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          user_id: string
          valor_venda: number
          whatsapp_comprador: string
          withdrawal_id: string | null
          withdrawn: boolean
          withdrawn_at: string | null
        }
        Insert: {
          product_id?: string | null
          ticket_id?: string | null
          ticket_name?: string | null
          approval_status?: string
          commission_amount?: number | null
          consideracoes_gerais?: string | null
          created_at?: string
          email_comprador: string
          id?: string
          nome_comprador: string
          nome_produto: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          user_id: string
          valor_venda: number
          whatsapp_comprador: string
          withdrawal_id?: string | null
          withdrawn?: boolean
          withdrawn_at?: string | null
        }
        Update: {
          product_id?: string | null
          ticket_id?: string | null
          ticket_name?: string | null
          approval_status?: string
          commission_amount?: number | null
          consideracoes_gerais?: string | null
          created_at?: string
          email_comprador?: string
          id?: string
          nome_comprador?: string
          nome_produto?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          user_id?: string
          valor_venda?: number
          whatsapp_comprador?: string
          withdrawal_id?: string | null
          withdrawn?: boolean
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      workboard_completions: {
        Row: {
          completed_at: string | null
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workboard_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "workboard_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workboard_tasks: {
        Row: {
          assigned_to: string[] | null
          created_at: string | null
          created_by: string
          deadline: string | null
          description: string | null
          id: string
          is_active: boolean | null
          priority: string | null
          target_roles: string[] | null
          title: string
        }
        Insert: {
          assigned_to?: string[] | null
          created_at?: string | null
          created_by: string
          deadline?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          priority?: string | null
          target_roles?: string[] | null
          title: string
        }
        Update: {
          assigned_to?: string[] | null
          created_at?: string | null
          created_by?: string
          deadline?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          priority?: string | null
          target_roles?: string[] | null
          title?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      executive_create_product: { Args: { p_name: string; p_description: string | null; p_ticket_name: string; p_ticket_price: number; p_active?: boolean }; Returns: Database["public"]["Tables"]["products"]["Row"] }
      executive_save_product: { Args: { p_product_id: string | null; p_name: string; p_description?: string | null; p_active?: boolean; p_expected_updated_at?: string | null }; Returns: Database["public"]["Tables"]["products"]["Row"] }
      executive_save_product_ticket: { Args: { p_ticket_id: string | null; p_product_id: string; p_name: string; p_price: number; p_active?: boolean; p_expected_updated_at?: string | null }; Returns: Database["public"]["Tables"]["product_tickets"]["Row"] }
      executive_review_sale: { Args: { p_sale_id: string; p_action: string; p_reason?: string; p_expected_status?: string }; Returns: Json }
      get_sales_board: { Args: { p_status?: string; p_search?: string; p_page?: number; p_page_size?: number }; Returns: Json }
      get_team_ranking: { Args: never; Returns: Json }
      get_company_goal_totals: { Args: never; Returns: Json }
      executive_cancel_withdrawal: { Args: { p_id: string; p_reason: string }; Returns: undefined }
      executive_set_crm_access: { Args: { p_user_id: string; p_enabled: boolean; p_reason: string }; Returns: undefined }
      executive_list_users: { Args: never; Returns: Json }
      approve_sale: {
        Args: { p_sale_id: string }
        Returns: {
          approval_status: string
          commission_amount: number | null
          consideracoes_gerais: string | null
          created_at: string
          email_comprador: string
          id: string
          nome_comprador: string
          nome_produto: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          user_id: string
          valor_venda: number
          whatsapp_comprador: string
          withdrawal_id: string | null
          withdrawn: boolean
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vendas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calculate_and_update_commissions: { Args: never; Returns: undefined }
      check_user_not_suspended: { Args: never; Returns: boolean }
      get_auth_users_for_executives: {
        Args: never
        Returns: {
          email: string
          id: string
          last_sign_in_at: string
        }[]
      }
      get_available_balance: { Args: { p_seller_id: string }; Returns: number }
      get_pending_commission: { Args: { p_seller_id: string }; Returns: number }
      get_user_details: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          email: string
          id: string
          last_seen: string
          last_sign_in_at: string
          suspended: boolean
          user_id: string
        }[]
      }
      get_user_role: { Args: { uid: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_executive: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      log_security_event: {
        Args: {
          p_action: string
          p_details?: Json
          p_record_id?: string
          p_table_name: string
        }
        Returns: undefined
      }
      process_withdrawal: {
        Args: { p_user_id: string; p_withdrawal_amount: number }
        Returns: undefined
      }
      recalculate_all_balances: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role:
        | "seller"
        | "executive"
        | "super_admin"
        | "closer"
        | "sdr"
        | "bdr"
        | "traffic_manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "seller",
        "executive",
        "super_admin",
        "closer",
        "sdr",
        "bdr",
        "traffic_manager",
      ],
    },
  },
} as const
