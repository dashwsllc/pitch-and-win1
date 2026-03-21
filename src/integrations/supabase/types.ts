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
          chave_pix: string
          created_at: string
          data_processamento: string | null
          data_solicitacao: string
          id: string
          observacoes: string | null
          processado_por: string | null
          status: string
          updated_at: string
          user_id: string
          valor_solicitado: number
        }
        Insert: {
          chave_pix: string
          created_at?: string
          data_processamento?: string | null
          data_solicitacao?: string
          id?: string
          observacoes?: string | null
          processado_por?: string | null
          status?: string
          updated_at?: string
          user_id: string
          valor_solicitado: number
        }
        Update: {
          chave_pix?: string
          created_at?: string
          data_processamento?: string | null
          data_solicitacao?: string
          id?: string
          observacoes?: string | null
          processado_por?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          valor_solicitado?: number
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vendas: {
        Row: {
          consideracoes_gerais: string | null
          created_at: string
          email_comprador: string
          id: string
          nome_comprador: string
          nome_produto: string
          updated_at: string
          user_id: string
          valor_venda: number
          whatsapp_comprador: string
        }
        Insert: {
          consideracoes_gerais?: string | null
          created_at?: string
          email_comprador: string
          id?: string
          nome_comprador: string
          nome_produto: string
          updated_at?: string
          user_id: string
          valor_venda: number
          whatsapp_comprador: string
        }
        Update: {
          consideracoes_gerais?: string | null
          created_at?: string
          email_comprador?: string
          id?: string
          nome_comprador?: string
          nome_produto?: string
          updated_at?: string
          user_id?: string
          valor_venda?: number
          whatsapp_comprador?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_and_update_commissions: { Args: never; Returns: undefined }
      check_user_not_suspended: { Args: never; Returns: boolean }
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
      app_role: "seller" | "executive" | "super_admin"
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
      app_role: ["seller", "executive", "super_admin"],
    },
  },
} as const
