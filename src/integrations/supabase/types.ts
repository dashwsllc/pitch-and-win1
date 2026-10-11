
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "abordagens": {
                  Row: {
                    "created_at": string,"crm_lead_id": string | null,"dados_abordados": string,"id": string,"mostrou_ia": boolean,"nomes_abordados": string,"tempo_medio_abordagem": number,"updated_at": string,"user_id": string,"visao_geral": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"crm_lead_id"?: string | null,"dados_abordados": string,"id"?: string,"mostrou_ia"?: boolean,"nomes_abordados": string,"tempo_medio_abordagem": number,"updated_at"?: string,"user_id": string,"visao_geral": string
                  }
                  Update: {
                    "created_at"?: string,"crm_lead_id"?: string | null,"dados_abordados"?: string,"id"?: string,"mostrou_ia"?: boolean,"nomes_abordados"?: string,"tempo_medio_abordagem"?: number,"updated_at"?: string,"user_id"?: string,"visao_geral"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "abordagens_crm_lead_id_fkey"
      columns: ["crm_lead_id"]
isOneToOne: false
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"account_deletion_requests": {
                  Row: {
                    "actor_id": string,"actor_name": string,"before_data": NonNullable<Json>,"created_at": string,"reason": string,"target_id": string,"target_label": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"actor_name": string,"before_data": NonNullable<Json>,"created_at"?: string,"reason": string,"target_id": string,"target_label": string
                  }
                  Update: {
                    "actor_id"?: string,"actor_name"?: string,"before_data"?: NonNullable<Json>,"created_at"?: string,"reason"?: string,"target_id"?: string,"target_label"?: string
                  }
                  Relationships: [

                  ]
                },"activity_feed": {
                  Row: {
                    "action_type": string | null,"actor_id": string | null,"actor_name": string | null,"created_at": string | null,"entity_title": string | null,"event_key": string | null,"id": string,"lead_id": string | null,"occurred_at": string,"provenance": string,"reason": string | null,"responsible_id": string | null,"responsible_name": string | null,"responsible_role": string | null,"revenue_delta": number,"reverses_id": string | null,"rule_version": number,"score_delta": number,"source_id": string | null,"source_type": string | null,"target_names": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_type"?: string | null,"actor_id"?: string | null,"actor_name"?: string | null,"created_at"?: string | null,"entity_title"?: string | null,"event_key"?: string | null,"id"?: string,"lead_id"?: string | null,"occurred_at"?: string,"provenance"?: string,"reason"?: string | null,"responsible_id"?: string | null,"responsible_name"?: string | null,"responsible_role"?: string | null,"revenue_delta"?: number,"reverses_id"?: string | null,"rule_version"?: number,"score_delta"?: number,"source_id"?: string | null,"source_type"?: string | null,"target_names"?: (string)[] | null
                  }
                  Update: {
                    "action_type"?: string | null,"actor_id"?: string | null,"actor_name"?: string | null,"created_at"?: string | null,"entity_title"?: string | null,"event_key"?: string | null,"id"?: string,"lead_id"?: string | null,"occurred_at"?: string,"provenance"?: string,"reason"?: string | null,"responsible_id"?: string | null,"responsible_name"?: string | null,"responsible_role"?: string | null,"revenue_delta"?: number,"reverses_id"?: string | null,"rule_version"?: number,"score_delta"?: number,"source_id"?: string | null,"source_type"?: string | null,"target_names"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_feed_reverses_id_fkey"
      columns: ["reverses_id"]
isOneToOne: false
      referencedRelation: "activity_feed"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_feed_reverses_id_fkey"
      columns: ["reverses_id"]
isOneToOne: false
      referencedRelation: "arena_counted_call_events"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "content": string,"created_at": string | null,"created_by": string,"id": string,"pinned": boolean | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"created_at"?: string | null,"created_by": string,"id"?: string,"pinned"?: boolean | null,"title": string
                  }
                  Update: {
                    "content"?: string,"created_at"?: string | null,"created_by"?: string,"id"?: string,"pinned"?: boolean | null,"title"?: string
                  }
                  Relationships: [

                  ]
                },"arena_closer_exceptions": {
                  Row: {
                    "created_at": string,"reason": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"reason": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"reason"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"arena_notifications": {
                  Row: {
                    "created_at": string,"event_key": string,"id": string,"kind": string,"read_at": string | null,"recipient_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_key": string,"id"?: string,"kind": string,"read_at"?: string | null,"recipient_id": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"event_key"?: string,"id"?: string,"kind"?: string,"read_at"?: string | null,"recipient_id"?: string,"title"?: string
                  }
                  Relationships: [

                  ]
                },"arena_score_weights": {
                  Row: {
                    "action_type": string,"label": string,"updated_at": string,"updated_by": string | null,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action_type": string,"label": string,"updated_at"?: string,"updated_by"?: string | null,"weight": number
                  }
                  Update: {
                    "action_type"?: string,"label"?: string,"updated_at"?: string,"updated_by"?: string | null,"weight"?: number
                  }
                  Relationships: [

                  ]
                },"arena_sdr_exceptions": {
                  Row: {
                    "created_at": string,"qualification_calls_disabled": boolean,"reason": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"qualification_calls_disabled"?: boolean,"reason": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"qualification_calls_disabled"?: boolean,"reason"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"arena_shift_approach_goals": {
                  Row: {
                    "approach_source": string,"assignee_id": string,"cancelled_at": string | null,"cancelled_by": string | null,"created_at": string,"created_by": string | null,"ends_at": string,"id": string,"starts_at": string,"target_approaches": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approach_source": string,"assignee_id": string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_at": string,"id"?: string,"starts_at": string,"target_approaches": number,"title": string
                  }
                  Update: {
                    "approach_source"?: string,"assignee_id"?: string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string,"id"?: string,"starts_at"?: string,"target_approaches"?: number,"title"?: string
                  }
                  Relationships: [

                  ]
                },"assinaturas": {
                  Row: {
                    "created_at": string,"email_cliente": string,"id": string,"nome_cliente": string,"nome_produto": string,"status": string,"updated_at": string,"user_id": string,"valor_assinatura": string,"whatsapp_cliente": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email_cliente": string,"id"?: string,"nome_cliente": string,"nome_produto": string,"status"?: string,"updated_at"?: string,"user_id": string,"valor_assinatura": string,"whatsapp_cliente": string
                  }
                  Update: {
                    "created_at"?: string,"email_cliente"?: string,"id"?: string,"nome_cliente"?: string,"nome_produto"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string,"valor_assinatura"?: string,"whatsapp_cliente"?: string
                  }
                  Relationships: [

                  ]
                },"closing_forms": {
                  Row: {
                    "closed_at": string | null,"closer_id": string,"created_at": string | null,"how_closed": string | null,"id": string,"lead_name": string,"lead_whatsapp": string | null,"next_steps": string | null,"objections_raised": string | null,"product": string,"status": string | null,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closer_id": string,"created_at"?: string | null,"how_closed"?: string | null,"id"?: string,"lead_name": string,"lead_whatsapp"?: string | null,"next_steps"?: string | null,"objections_raised"?: string | null,"product": string,"status"?: string | null,"value": number
                  }
                  Update: {
                    "closed_at"?: string | null,"closer_id"?: string,"created_at"?: string | null,"how_closed"?: string | null,"id"?: string,"lead_name"?: string,"lead_whatsapp"?: string | null,"next_steps"?: string | null,"objections_raised"?: string | null,"product"?: string,"status"?: string | null,"value"?: number
                  }
                  Relationships: [

                  ]
                },"company_goals": {
                  Row: {
                    "assignee_id": string | null,"created_at": string | null,"created_by": string | null,"current": number | null,"cycle_end": string | null,"cycle_start": string | null,"deadline": string | null,"description": string | null,"effective_at": string,"enabled": boolean,"family_id": string,"id": string,"metric": string,"period": string,"recurring": boolean,"scope": string,"show_countdown": boolean,"status": string | null,"target": number | null,"target_role": string | null,"ticket_reference": number,"title": string,"unit": string | null,"updated_at": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"created_at"?: string | null,"created_by"?: string | null,"current"?: number | null,"cycle_end"?: string | null,"cycle_start"?: string | null,"deadline"?: string | null,"description"?: string | null,"effective_at"?: string,"enabled"?: boolean,"family_id"?: string,"id"?: string,"metric"?: string,"period": string,"recurring"?: boolean,"scope"?: string,"show_countdown"?: boolean,"status"?: string | null,"target"?: number | null,"target_role"?: string | null,"ticket_reference"?: number,"title": string,"unit"?: string | null,"updated_at"?: string | null,"version"?: number
                  }
                  Update: {
                    "assignee_id"?: string | null,"created_at"?: string | null,"created_by"?: string | null,"current"?: number | null,"cycle_end"?: string | null,"cycle_start"?: string | null,"deadline"?: string | null,"description"?: string | null,"effective_at"?: string,"enabled"?: boolean,"family_id"?: string,"id"?: string,"metric"?: string,"period"?: string,"recurring"?: boolean,"scope"?: string,"show_countdown"?: boolean,"status"?: string | null,"target"?: number | null,"target_role"?: string | null,"ticket_reference"?: number,"title"?: string,"unit"?: string | null,"updated_at"?: string | null,"version"?: number
                  }
                  Relationships: [

                  ]
                },"crm_activities": {
                  Row: {
                    "activity_type": string,"assigned_to": string | null,"author_name": string | null,"call_type": string | null,"cancellation_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"completed_at": string | null,"created_at": string | null,"description": string | null,"id": string,"is_completed": boolean,"is_pinned": boolean,"lead_id": string,"new_state": Json | null,"outcome": string | null,"performed_at": string | null,"performed_by": string | null,"previous_state": Json | null,"scheduled_at": string | null,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_type": string,"assigned_to"?: string | null,"author_name"?: string | null,"call_type"?: string | null,"cancellation_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"completed_at"?: string | null,"created_at"?: string | null,"description"?: string | null,"id"?: string,"is_completed"?: boolean,"is_pinned"?: boolean,"lead_id": string,"new_state"?: Json | null,"outcome"?: string | null,"performed_at"?: string | null,"performed_by"?: string | null,"previous_state"?: Json | null,"scheduled_at"?: string | null,"title": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "activity_type"?: string,"assigned_to"?: string | null,"author_name"?: string | null,"call_type"?: string | null,"cancellation_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"completed_at"?: string | null,"created_at"?: string | null,"description"?: string | null,"id"?: string,"is_completed"?: boolean,"is_pinned"?: boolean,"lead_id"?: string,"new_state"?: Json | null,"outcome"?: string | null,"performed_at"?: string | null,"performed_by"?: string | null,"previous_state"?: Json | null,"scheduled_at"?: string | null,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_activities_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_lead_contexts": {
                  Row: {
                    "author_id": string,"author_name": string,"author_role": string,"content": string,"context_type": string,"created_at": string,"file_content": string | null,"file_mime_type": string | null,"file_name": string | null,"id": string,"lead_id": string,"media_url": string | null,"updated_at": string,"updated_by": string | null,"updated_by_name": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"author_name": string,"author_role": string,"content": string,"context_type": string,"created_at"?: string,"file_content"?: string | null,"file_mime_type"?: string | null,"file_name"?: string | null,"id"?: string,"lead_id": string,"media_url"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"updated_by_name"?: string | null,"version"?: number
                  }
                  Update: {
                    "author_id"?: string,"author_name"?: string,"author_role"?: string,"content"?: string,"context_type"?: string,"created_at"?: string,"file_content"?: string | null,"file_mime_type"?: string | null,"file_name"?: string | null,"id"?: string,"lead_id"?: string,"media_url"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"updated_by_name"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_lead_contexts_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_lead_payment_status": {
                  Row: {
                    "lead_id": string,"status": string,"updated_at": string,"updated_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "lead_id": string,"status": string,"updated_at"?: string,"updated_by": string
                  }
                  Update: {
                    "lead_id"?: string,"status"?: string,"updated_at"?: string,"updated_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_lead_payment_status_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: true
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_lead_payments": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string,"description": string,"due_date": string | null,"id": string,"lead_id": string,"method": string,"notes": string | null,"paid_at": string | null,"proof_url": string | null,"status": string,"status_reason": string | null,"updated_at": string,"updated_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by": string,"description": string,"due_date"?: string | null,"id"?: string,"lead_id": string,"method"?: string,"notes"?: string | null,"paid_at"?: string | null,"proof_url"?: string | null,"status"?: string,"status_reason"?: string | null,"updated_at"?: string,"updated_by": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string,"description"?: string,"due_date"?: string | null,"id"?: string,"lead_id"?: string,"method"?: string,"notes"?: string | null,"paid_at"?: string | null,"proof_url"?: string | null,"status"?: string,"status_reason"?: string | null,"updated_at"?: string,"updated_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_lead_payments_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_leads": {
                  Row: {
                    "age": number | null,"approach_count": number,"approach_stage": string,"approached": boolean,"approached_at": string | null,"assigned_to": string | null,"athlete_age": number | null,"athlete_birth_date": string | null,"athlete_height_cm": number | null,"athlete_name": string | null,"athlete_position": string | null,"athlete_weight_kg": number | null,"city_state": string | null,"closed_at": string | null,"closed_by": string | null,"closer_id": string | null,"company": string | null,"conversion_probability": number | null,"created_at": string | null,"created_by": string | null,"email": string | null,"estimated_deal_value": number | null,"expected_close_at": string | null,"first_contact_at": string | null,"followup_attempt_count": number,"followup_last_contact_at": string | null,"followup_next_at": string | null,"followup_status": string | null,"handed_off_at": string | null,"id": string,"job_title": string | null,"last_contact_at": string | null,"last_result_at": string | null,"last_result_closer_id": string | null,"last_result_closer_name": string | null,"last_result_outcome": string | null,"lead_generated_at": string,"lead_source": string | null,"linkedin_url": string | null,"meta_form_lead_id": string | null,"name": string,"negative_reason": string | null,"next_followup_at": string | null,"observations": string | null,"observations_updated_at": string | null,"observations_updated_by": string | null,"performance_report_url": string | null,"phone": string | null,"pipeline_stage": string,"priority": string | null,"profile_photo_url": string | null,"qualification_completed_at": string | null,"qualification_completed_by": string | null,"qualification_decision_maker": string | null,"qualification_goal": string | null,"qualification_income_range": string | null,"qualification_summary": string | null,"qualification_timeline": string | null,"sdr_id": string | null,"tags": (string)[] | null,"temperature": string,"updated_at": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "age"?: number | null,"approach_count"?: number,"approach_stage"?: string,"approached"?: boolean,"approached_at"?: string | null,"assigned_to"?: string | null,"athlete_age"?: number | null,"athlete_birth_date"?: string | null,"athlete_height_cm"?: number | null,"athlete_name"?: string | null,"athlete_position"?: string | null,"athlete_weight_kg"?: number | null,"city_state"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"closer_id"?: string | null,"company"?: string | null,"conversion_probability"?: number | null,"created_at"?: string | null,"created_by"?: string | null,"email"?: string | null,"estimated_deal_value"?: number | null,"expected_close_at"?: string | null,"first_contact_at"?: string | null,"followup_attempt_count"?: number,"followup_last_contact_at"?: string | null,"followup_next_at"?: string | null,"followup_status"?: string | null,"handed_off_at"?: string | null,"id"?: string,"job_title"?: string | null,"last_contact_at"?: string | null,"last_result_at"?: string | null,"last_result_closer_id"?: string | null,"last_result_closer_name"?: string | null,"last_result_outcome"?: string | null,"lead_generated_at": string,"lead_source"?: string | null,"linkedin_url"?: string | null,"meta_form_lead_id"?: string | null,"name": string,"negative_reason"?: string | null,"next_followup_at"?: string | null,"observations"?: string | null,"observations_updated_at"?: string | null,"observations_updated_by"?: string | null,"performance_report_url"?: string | null,"phone"?: string | null,"pipeline_stage"?: string,"priority"?: string | null,"profile_photo_url"?: string | null,"qualification_completed_at"?: string | null,"qualification_completed_by"?: string | null,"qualification_decision_maker"?: string | null,"qualification_goal"?: string | null,"qualification_income_range"?: string | null,"qualification_summary"?: string | null,"qualification_timeline"?: string | null,"sdr_id"?: string | null,"tags"?: (string)[] | null,"temperature"?: string,"updated_at"?: string | null,"version"?: number
                  }
                  Update: {
                    "age"?: number | null,"approach_count"?: number,"approach_stage"?: string,"approached"?: boolean,"approached_at"?: string | null,"assigned_to"?: string | null,"athlete_age"?: number | null,"athlete_birth_date"?: string | null,"athlete_height_cm"?: number | null,"athlete_name"?: string | null,"athlete_position"?: string | null,"athlete_weight_kg"?: number | null,"city_state"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"closer_id"?: string | null,"company"?: string | null,"conversion_probability"?: number | null,"created_at"?: string | null,"created_by"?: string | null,"email"?: string | null,"estimated_deal_value"?: number | null,"expected_close_at"?: string | null,"first_contact_at"?: string | null,"followup_attempt_count"?: number,"followup_last_contact_at"?: string | null,"followup_next_at"?: string | null,"followup_status"?: string | null,"handed_off_at"?: string | null,"id"?: string,"job_title"?: string | null,"last_contact_at"?: string | null,"last_result_at"?: string | null,"last_result_closer_id"?: string | null,"last_result_closer_name"?: string | null,"last_result_outcome"?: string | null,"lead_generated_at"?: string,"lead_source"?: string | null,"linkedin_url"?: string | null,"meta_form_lead_id"?: string | null,"name"?: string,"negative_reason"?: string | null,"next_followup_at"?: string | null,"observations"?: string | null,"observations_updated_at"?: string | null,"observations_updated_by"?: string | null,"performance_report_url"?: string | null,"phone"?: string | null,"pipeline_stage"?: string,"priority"?: string | null,"profile_photo_url"?: string | null,"qualification_completed_at"?: string | null,"qualification_completed_by"?: string | null,"qualification_decision_maker"?: string | null,"qualification_goal"?: string | null,"qualification_income_range"?: string | null,"qualification_summary"?: string | null,"qualification_timeline"?: string | null,"sdr_id"?: string | null,"tags"?: (string)[] | null,"temperature"?: string,"updated_at"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_leads_meta_form_lead_id_fkey"
      columns: ["meta_form_lead_id"]
isOneToOne: true
      referencedRelation: "meta_form_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"custom_positions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"max_members": number,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"max_members"?: number,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"max_members"?: number,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"daily_goal_tasks": {
                  Row: {
                    "assignee_id": string,"checklist_items": NonNullable<Json>,"completed_at": string | null,"completed_by": string | null,"completion_comment": string | null,"created_at": string,"created_by": string | null,"deadline_at": string | null,"definition_id": string | null,"id": string,"is_completed": boolean,"operational_status": string,"position": number,"task_date": string,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id": string,"checklist_items"?: NonNullable<Json>,"completed_at"?: string | null,"completed_by"?: string | null,"completion_comment"?: string | null,"created_at"?: string,"created_by"?: string | null,"deadline_at"?: string | null,"definition_id"?: string | null,"id"?: string,"is_completed"?: boolean,"operational_status"?: string,"position"?: number,"task_date": string,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "assignee_id"?: string,"checklist_items"?: NonNullable<Json>,"completed_at"?: string | null,"completed_by"?: string | null,"completion_comment"?: string | null,"created_at"?: string,"created_by"?: string | null,"deadline_at"?: string | null,"definition_id"?: string | null,"id"?: string,"is_completed"?: boolean,"operational_status"?: string,"position"?: number,"task_date"?: string,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_goal_tasks_definition_id_fkey"
      columns: ["definition_id"]
isOneToOne: false
      referencedRelation: "workboard_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"dashboard_events": {
                  Row: {
                    "revision": number,"topic": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "revision"?: number,"topic": string,"updated_at"?: string
                  }
                  Update: {
                    "revision"?: number,"topic"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"document_categories": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"documents": {
                  Row: {
                    "category_id": string,"created_at": string,"created_by": string,"description": string | null,"id": string,"link_url": string,"title": string,"updated_at": string,"visible_to_roles": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"link_url": string,"title": string,"updated_at"?: string,"visible_to_roles"?: (string)[] | null
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"link_url"?: string,"title"?: string,"updated_at"?: string,"visible_to_roles"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "document_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"executive_audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_name": string,"after_data": Json | null,"before_data": Json | null,"created_at": string,"id": string,"reason": string,"target_id": string,"target_label": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_name": string,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"id"?: string,"reason": string,"target_id": string,"target_label": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_name"?: string,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"id"?: string,"reason"?: string,"target_id"?: string,"target_label"?: string
                  }
                  Relationships: [

                  ]
                },"goal_cycles": {
                  Row: {
                    "closed_at": string | null,"ends_at": string,"evaluation_revision": number,"family_id": string,"goal_id": string,"id": string,"result": Json | null,"starts_at": string,"target": number
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"ends_at": string,"evaluation_revision"?: number,"family_id": string,"goal_id": string,"id"?: string,"result"?: Json | null,"starts_at": string,"target": number
                  }
                  Update: {
                    "closed_at"?: string | null,"ends_at"?: string,"evaluation_revision"?: number,"family_id"?: string,"goal_id"?: string,"id"?: string,"result"?: Json | null,"starts_at"?: string,"target"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "goal_cycles_goal_id_fkey"
      columns: ["goal_id"]
isOneToOne: false
      referencedRelation: "company_goals"
      referencedColumns: ["id"]
    }
                  ]
                },"message_reactions": {
                  Row: {
                    "created_at": string | null,"emoji": string,"id": string,"message_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"emoji": string,"id"?: string,"message_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string | null,"emoji"?: string,"id"?: string,"message_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_reactions_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "team_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_ad_accounts": {
                  Row: {
                    "account_id": string,"account_name": string,"connected_at": string,"connected_by": string,"currency": string,"id": string,"paused_at": string | null,"paused_by": string | null,"paused_reason": string | null,"status": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"account_name"?: string,"connected_at"?: string,"connected_by": string,"currency"?: string,"id"?: string,"paused_at"?: string | null,"paused_by"?: string | null,"paused_reason"?: string | null,"status"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"account_name"?: string,"connected_at"?: string,"connected_by"?: string,"currency"?: string,"id"?: string,"paused_at"?: string | null,"paused_by"?: string | null,"paused_reason"?: string | null,"status"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"meta_audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_name": string | null,"actor_roles": (string)[],"created_at": string,"entity_id": string,"entity_type": string,"id": string,"origin": string,"summary": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_name"?: string | null,"actor_roles"?: (string)[],"created_at"?: string,"entity_id": string,"entity_type": string,"id"?: string,"origin": string,"summary"?: NonNullable<Json>
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_name"?: string | null,"actor_roles"?: (string)[],"created_at"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: string,"origin"?: string,"summary"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"meta_capture_review_rows": {
                  Row: {
                    "before_snapshot": Json | null,"before_version": string | null,"conflict_details": Json | null,"edit_reason": string | null,"edited": boolean,"effective_key": NonNullable<Json>,"operation": string,"original_key": NonNullable<Json>,"payload": NonNullable<Json>,"review_id": string,"row_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "before_snapshot"?: Json | null,"before_version"?: string | null,"conflict_details"?: Json | null,"edit_reason"?: string | null,"edited"?: boolean,"effective_key": NonNullable<Json>,"operation": string,"original_key": NonNullable<Json>,"payload": NonNullable<Json>,"review_id": string,"row_no": number
                  }
                  Update: {
                    "before_snapshot"?: Json | null,"before_version"?: string | null,"conflict_details"?: Json | null,"edit_reason"?: string | null,"edited"?: boolean,"effective_key"?: NonNullable<Json>,"operation"?: string,"original_key"?: NonNullable<Json>,"payload"?: NonNullable<Json>,"review_id"?: string,"row_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_capture_review_rows_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "meta_capture_reviews"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_capture_reviews": {
                  Row: {
                    "account_id": string,"created_at": string,"id": string,"level": string,"manifest": NonNullable<Json>,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": string,"sync_run_id": string,"updated_at": string,"version": number,"window_end": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"id"?: string,"level": string,"manifest": NonNullable<Json>,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"sync_run_id": string,"updated_at"?: string,"version"?: number,"window_end": string,"window_start": string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"id"?: string,"level"?: string,"manifest"?: NonNullable<Json>,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"sync_run_id"?: string,"updated_at"?: string,"version"?: number,"window_end"?: string,"window_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_capture_reviews_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "meta_sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_form_leads": {
                  Row: {
                    "ad_id": string,"approval_status": string,"campaign_id": string,"campaign_name": string,"created_time": string,"crm_lead_id": string | null,"custom_disclaimer_responses": NonNullable<Json>,"email": string,"field_data": NonNullable<Json>,"form_id": string,"form_name": string,"full_name": string,"id": string,"ignored_reason": string | null,"import_contact": NonNullable<Json>,"import_warning": string | null,"imported_at": string | null,"imported_by": string | null,"lead_import_batch_id": string | null,"meta_lead_id": string,"page_id": string,"phone": string,"received_at": string,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"source_snapshot": Json | null,"status": string,"traffic_edited_at": string | null,"updated_at": string,"meta_contact_from_form": Json | null
                  }
                  ComputedFields: "meta_contact_from_form"
                  Insert: {
                    "ad_id"?: string,"approval_status"?: string,"campaign_id"?: string,"campaign_name"?: string,"created_time": string,"crm_lead_id"?: string | null,"custom_disclaimer_responses"?: NonNullable<Json>,"email"?: string,"field_data": NonNullable<Json>,"form_id": string,"form_name"?: string,"full_name"?: string,"id"?: string,"ignored_reason"?: string | null,"import_contact"?: NonNullable<Json>,"import_warning"?: string | null,"imported_at"?: string | null,"imported_by"?: string | null,"lead_import_batch_id"?: string | null,"meta_lead_id": string,"page_id": string,"phone"?: string,"received_at"?: string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source_snapshot"?: Json | null,"status"?: string,"traffic_edited_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "ad_id"?: string,"approval_status"?: string,"campaign_id"?: string,"campaign_name"?: string,"created_time"?: string,"crm_lead_id"?: string | null,"custom_disclaimer_responses"?: NonNullable<Json>,"email"?: string,"field_data"?: NonNullable<Json>,"form_id"?: string,"form_name"?: string,"full_name"?: string,"id"?: string,"ignored_reason"?: string | null,"import_contact"?: NonNullable<Json>,"import_warning"?: string | null,"imported_at"?: string | null,"imported_by"?: string | null,"lead_import_batch_id"?: string | null,"meta_lead_id"?: string,"page_id"?: string,"phone"?: string,"received_at"?: string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source_snapshot"?: Json | null,"status"?: string,"traffic_edited_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_form_leads_crm_lead_id_fkey"
      columns: ["crm_lead_id"]
isOneToOne: true
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meta_form_leads_lead_import_batch_id_fkey"
      columns: ["lead_import_batch_id"]
isOneToOne: false
      referencedRelation: "meta_lead_import_batches"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_import_batches": {
                  Row: {
                    "account_id": string | null,"created_at": string,"filename": string,"id": string,"imported_by": string | null,"level": string | null,"replaced_by_review_id": string | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"row_count": number,"rows": NonNullable<Json>,"source": string,"status": string,"sync_run_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"created_at"?: string,"filename": string,"id"?: string,"imported_by"?: string | null,"level"?: string | null,"replaced_by_review_id"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"row_count": number,"rows"?: NonNullable<Json>,"source"?: string,"status"?: string,"sync_run_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"created_at"?: string,"filename"?: string,"id"?: string,"imported_by"?: string | null,"level"?: string | null,"replaced_by_review_id"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"row_count"?: number,"rows"?: NonNullable<Json>,"source"?: string,"status"?: string,"sync_run_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_import_batches_replaced_by_review_id_fkey"
      columns: ["replaced_by_review_id"]
isOneToOne: false
      referencedRelation: "meta_capture_reviews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meta_import_batches_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "meta_sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_insights_pages": {
                  Row: {
                    "created_at": string,"next_request": Json | null,"page_no": number,"request_hash": string,"rows": NonNullable<Json>,"run_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"next_request"?: Json | null,"page_no": number,"request_hash": string,"rows": NonNullable<Json>,"run_id": string
                  }
                  Update: {
                    "created_at"?: string,"next_request"?: Json | null,"page_no"?: number,"request_hash"?: string,"rows"?: NonNullable<Json>,"run_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_insights_pages_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "meta_sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_lead_discovery_state": {
                  Row: {
                    "active_form_name": string | null,"claim_token": string | null,"form_id": string | null,"form_queue": NonNullable<Json>,"forms_next": Json | null,"last_completed_until": string | null,"last_error": string | null,"leads_next": Json | null,"lease_until": string | null,"page_id": string,"version": number,"window_since": string,"window_until": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_form_name"?: string | null,"claim_token"?: string | null,"form_id"?: string | null,"form_queue"?: NonNullable<Json>,"forms_next"?: Json | null,"last_completed_until"?: string | null,"last_error"?: string | null,"leads_next"?: Json | null,"lease_until"?: string | null,"page_id": string,"version"?: number,"window_since": string,"window_until": string
                  }
                  Update: {
                    "active_form_name"?: string | null,"claim_token"?: string | null,"form_id"?: string | null,"form_queue"?: NonNullable<Json>,"forms_next"?: Json | null,"last_completed_until"?: string | null,"last_error"?: string | null,"leads_next"?: Json | null,"lease_until"?: string | null,"page_id"?: string,"version"?: number,"window_since"?: string,"window_until"?: string
                  }
                  Relationships: [

                  ]
                },"meta_lead_import_batches": {
                  Row: {
                    "created_at": string,"filename": string,"id": string,"imported_by": string,"result": Json | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"row_count": number,"rows": NonNullable<Json>,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"filename": string,"id"?: string,"imported_by": string,"result"?: Json | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"row_count": number,"rows": NonNullable<Json>,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"filename"?: string,"id"?: string,"imported_by"?: string,"result"?: Json | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"row_count"?: number,"rows"?: NonNullable<Json>,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"meta_sync_runs": {
                  Row: {
                    "account_id": string | null,"account_metadata": Json | null,"claim_token": string | null,"coverage_state": string,"definition_version": string | null,"error_message": string | null,"finished_at": string | null,"id": string,"kind": string,"lease_until": string | null,"level": string | null,"next_request": Json | null,"next_retry_at": string | null,"page_count": number,"request_params": Json | null,"rows_synced": number,"started_at": string,"status": string,"triggered_by": string,"triggered_by_user": string | null,"window_end": string | null,"window_start": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"account_metadata"?: Json | null,"claim_token"?: string | null,"coverage_state"?: string,"definition_version"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"kind": string,"lease_until"?: string | null,"level"?: string | null,"next_request"?: Json | null,"next_retry_at"?: string | null,"page_count"?: number,"request_params"?: Json | null,"rows_synced"?: number,"started_at"?: string,"status"?: string,"triggered_by": string,"triggered_by_user"?: string | null,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"account_metadata"?: Json | null,"claim_token"?: string | null,"coverage_state"?: string,"definition_version"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"kind"?: string,"lease_until"?: string | null,"level"?: string | null,"next_request"?: Json | null,"next_retry_at"?: string | null,"page_count"?: number,"request_params"?: Json | null,"rows_synced"?: number,"started_at"?: string,"status"?: string,"triggered_by"?: string,"triggered_by_user"?: string | null,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Relationships: [

                  ]
                },"meta_traffic_daily": {
                  Row: {
                    "account_id": string,"account_name": string,"ad_id": string,"ad_name": string,"adset_id": string,"adset_name": string,"attribution_window": string,"available_metrics": (string)[] | null,"campaign_id": string,"campaign_name": string,"capture_review_id": string | null,"currency": string,"date": string,"first_origin": Json | null,"id": string,"import_batch_id": string | null,"imported_by": string | null,"impressions": number,"leads": number,"level": string,"link_clicks": number,"messaging_conversations_started": number,"metric_metadata": Json | null,"objective": string,"original_key": Json | null,"purchase_value": number,"purchases": number,"reach": number,"source": string,"spend": number,"sync_run_id": string | null,"traffic_edit_reason": string | null,"traffic_edited_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"account_name"?: string,"ad_id"?: string,"ad_name"?: string,"adset_id"?: string,"adset_name"?: string,"attribution_window"?: string,"available_metrics"?: (string)[] | null,"campaign_id": string,"campaign_name": string,"capture_review_id"?: string | null,"currency"?: string,"date": string,"first_origin"?: Json | null,"id"?: string,"import_batch_id"?: string | null,"imported_by"?: string | null,"impressions"?: number,"leads": number,"level": string,"link_clicks"?: number,"messaging_conversations_started"?: number,"metric_metadata"?: Json | null,"objective"?: string,"original_key"?: Json | null,"purchase_value"?: number,"purchases": number,"reach"?: number,"source"?: string,"spend": number,"sync_run_id"?: string | null,"traffic_edit_reason"?: string | null,"traffic_edited_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"account_name"?: string,"ad_id"?: string,"ad_name"?: string,"adset_id"?: string,"adset_name"?: string,"attribution_window"?: string,"available_metrics"?: (string)[] | null,"campaign_id"?: string,"campaign_name"?: string,"capture_review_id"?: string | null,"currency"?: string,"date"?: string,"first_origin"?: Json | null,"id"?: string,"import_batch_id"?: string | null,"imported_by"?: string | null,"impressions"?: number,"leads"?: number,"level"?: string,"link_clicks"?: number,"messaging_conversations_started"?: number,"metric_metadata"?: Json | null,"objective"?: string,"original_key"?: Json | null,"purchase_value"?: number,"purchases"?: number,"reach"?: number,"source"?: string,"spend"?: number,"sync_run_id"?: string | null,"traffic_edit_reason"?: string | null,"traffic_edited_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_traffic_daily_capture_review_id_fkey"
      columns: ["capture_review_id"]
isOneToOne: false
      referencedRelation: "meta_capture_reviews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meta_traffic_daily_import_batch_id_fkey"
      columns: ["import_batch_id"]
isOneToOne: false
      referencedRelation: "meta_import_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meta_traffic_daily_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "meta_sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"meta_webhook_events": {
                  Row: {
                    "attempts": number,"claim_token": string | null,"error_class": string | null,"form_id": string,"id": string,"last_error": string | null,"leadgen_id": string,"lease_until": string | null,"meta_form_lead_id": string | null,"next_attempt_at": string,"page_id": string,"processed_at": string | null,"processing_attempts": number,"receipt_count": number,"received_at": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"claim_token"?: string | null,"error_class"?: string | null,"form_id"?: string,"id"?: string,"last_error"?: string | null,"leadgen_id": string,"lease_until"?: string | null,"meta_form_lead_id"?: string | null,"next_attempt_at"?: string,"page_id"?: string,"processed_at"?: string | null,"processing_attempts"?: number,"receipt_count"?: number,"received_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"claim_token"?: string | null,"error_class"?: string | null,"form_id"?: string,"id"?: string,"last_error"?: string | null,"leadgen_id"?: string,"lease_until"?: string | null,"meta_form_lead_id"?: string | null,"next_attempt_at"?: string,"page_id"?: string,"processed_at"?: string | null,"processing_attempts"?: number,"receipt_count"?: number,"received_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_webhook_events_meta_form_lead_id_fkey"
      columns: ["meta_form_lead_id"]
isOneToOne: false
      referencedRelation: "meta_form_leads"
      referencedColumns: ["id"]
    }
                  ]
                },"password_reset_requests": {
                  Row: {
                    "email": string,"id": string,"processed_at": string | null,"processed_by": string | null,"requested_at": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string,"id"?: string,"processed_at"?: string | null,"processed_by"?: string | null,"requested_at"?: string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "email"?: string,"id"?: string,"processed_at"?: string | null,"processed_by"?: string | null,"requested_at"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"playbooks": {
                  Row: {
                    "content": string,"created_at": string | null,"created_by": string | null,"id": string,"is_active": boolean | null,"tags": (string)[] | null,"target_roles": (string)[],"title": string,"type": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"created_at"?: string | null,"created_by"?: string | null,"id"?: string,"is_active"?: boolean | null,"tags"?: (string)[] | null,"target_roles"?: (string)[],"title": string,"type": string,"updated_at"?: string | null
                  }
                  Update: {
                    "content"?: string,"created_at"?: string | null,"created_by"?: string | null,"id"?: string,"is_active"?: boolean | null,"tags"?: (string)[] | null,"target_roles"?: (string)[],"title"?: string,"type"?: string,"updated_at"?: string | null
                  }
                  Relationships: [

                  ]
                },"product_tickets": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"id": string,"name": string,"price": number,"product_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"price": number,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"price"?: number,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_tickets_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"profiles": {
                  Row: {
                    "arena_hidden": boolean,"avatar_url": string | null,"created_at": string,"display_name": string | null,"id": string,"last_seen_at": string,"status": string | null,"suspended": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "arena_hidden"?: boolean,"avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string,"last_seen_at"?: string,"status"?: string | null,"suspended"?: boolean,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "arena_hidden"?: boolean,"avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string,"last_seen_at"?: string,"status"?: string | null,"suspended"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"registration_requests": {
                  Row: {
                    "created_at": string,"display_name": string,"email": string,"requested_role": string,"reviewed_at": string | null,"reviewed_by": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"email": string,"requested_role"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"email"?: string,"requested_role"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"saldos_disponiveis": {
                  Row: {
                    "created_at": string,"id": string,"updated_at": string,"user_id": string,"valor_liberado_para_saque": number,"valor_sacado": number,"valor_total_comissoes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"updated_at"?: string,"user_id": string,"valor_liberado_para_saque"?: number,"valor_sacado"?: number,"valor_total_comissoes"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"updated_at"?: string,"user_id"?: string,"valor_liberado_para_saque"?: number,"valor_sacado"?: number,"valor_total_comissoes"?: number
                  }
                  Relationships: [

                  ]
                },"saques": {
                  Row: {
                    "chave_pix": string | null,"cpf_titular": string | null,"created_at": string,"data_processamento": string | null,"data_solicitacao": string,"id": string,"motivo_rejeicao": string | null,"nome_titular": string | null,"observacoes": string | null,"pago_em": string | null,"previsao_pagamento": string | null,"processado_por": string | null,"revisado_em": string | null,"revisado_por": string | null,"status": string,"tipo_chave_pix": string | null,"updated_at": string,"user_id": string,"valor_aprovado": number | null,"valor_solicitado": number,"vendas_incluidas": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "chave_pix"?: string | null,"cpf_titular"?: string | null,"created_at"?: string,"data_processamento"?: string | null,"data_solicitacao"?: string,"id"?: string,"motivo_rejeicao"?: string | null,"nome_titular"?: string | null,"observacoes"?: string | null,"pago_em"?: string | null,"previsao_pagamento"?: string | null,"processado_por"?: string | null,"revisado_em"?: string | null,"revisado_por"?: string | null,"status"?: string,"tipo_chave_pix"?: string | null,"updated_at"?: string,"user_id": string,"valor_aprovado"?: number | null,"valor_solicitado": number,"vendas_incluidas"?: (string)[] | null
                  }
                  Update: {
                    "chave_pix"?: string | null,"cpf_titular"?: string | null,"created_at"?: string,"data_processamento"?: string | null,"data_solicitacao"?: string,"id"?: string,"motivo_rejeicao"?: string | null,"nome_titular"?: string | null,"observacoes"?: string | null,"pago_em"?: string | null,"previsao_pagamento"?: string | null,"processado_por"?: string | null,"revisado_em"?: string | null,"revisado_por"?: string | null,"status"?: string,"tipo_chave_pix"?: string | null,"updated_at"?: string,"user_id"?: string,"valor_aprovado"?: number | null,"valor_solicitado"?: number,"vendas_incluidas"?: (string)[] | null
                  }
                  Relationships: [

                  ]
                },"security_audit_log": {
                  Row: {
                    "action": string,"created_at": string | null,"details": Json | null,"id": string,"ip_address": unknown,"record_id": string | null,"table_name": string,"user_agent": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string | null,"details"?: Json | null,"id"?: string,"ip_address"?: unknown,"record_id"?: string | null,"table_name": string,"user_agent"?: string | null,"user_id": string
                  }
                  Update: {
                    "action"?: string,"created_at"?: string | null,"details"?: Json | null,"id"?: string,"ip_address"?: unknown,"record_id"?: string | null,"table_name"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"team_member_history": {
                  Row: {
                    "action_type": string,"created_at": string,"created_by": string | null,"id": string,"member_id": string | null,"new_values": Json | null,"old_values": Json | null,"reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_type": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"member_id"?: string | null,"new_values"?: Json | null,"old_values"?: Json | null,"reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "action_type"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"member_id"?: string | null,"new_values"?: Json | null,"old_values"?: Json | null,"reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_member_history_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "created_at": string,"custom_tags": (string)[] | null,"date_added": string,"id": string,"name": string,"position": string,"status": string,"status_reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"custom_tags"?: (string)[] | null,"date_added"?: string,"id"?: string,"name": string,"position": string,"status"?: string,"status_reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"custom_tags"?: (string)[] | null,"date_added"?: string,"id"?: string,"name"?: string,"position"?: string,"status"?: string,"status_reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"team_messages": {
                  Row: {
                    "content": string | null,"created_at": string | null,"file_name": string | null,"file_type": string | null,"file_url": string | null,"id": string,"link_title": string | null,"link_url": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: string | null,"created_at"?: string | null,"file_name"?: string | null,"file_type"?: string | null,"file_url"?: string | null,"id"?: string,"link_title"?: string | null,"link_url"?: string | null,"user_id": string
                  }
                  Update: {
                    "content"?: string | null,"created_at"?: string | null,"file_name"?: string | null,"file_type"?: string | null,"file_url"?: string | null,"id"?: string,"link_title"?: string | null,"link_url"?: string | null,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"traffic_metrics": {
                  Row: {
                    "ad_set_name": string | null,"campaign_name": string,"clicks": number | null,"cpc": number | null,"cpl": number | null,"created_at": string | null,"ctr": number | null,"date": string,"id": string,"impressions": number | null,"leads_generated": number | null,"manager_id": string,"notes": string | null,"platform": string,"spend": number,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ad_set_name"?: string | null,"campaign_name": string,"clicks"?: number | null,"cpc"?: number | null,"cpl"?: number | null,"created_at"?: string | null,"ctr"?: number | null,"date": string,"id"?: string,"impressions"?: number | null,"leads_generated"?: number | null,"manager_id": string,"notes"?: string | null,"platform"?: string,"spend"?: number,"updated_at"?: string | null
                  }
                  Update: {
                    "ad_set_name"?: string | null,"campaign_name"?: string,"clicks"?: number | null,"cpc"?: number | null,"cpl"?: number | null,"created_at"?: string | null,"ctr"?: number | null,"date"?: string,"id"?: string,"impressions"?: number | null,"leads_generated"?: number | null,"manager_id"?: string,"notes"?: string | null,"platform"?: string,"spend"?: number,"updated_at"?: string | null
                  }
                  Relationships: [

                  ]
                },"traffic_suggestion_replies": {
                  Row: {
                    "author_id": string,"author_name": string,"body": string,"created_at": string,"id": string,"suggestion_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"author_name": string,"body": string,"created_at"?: string,"id"?: string,"suggestion_id": string
                  }
                  Update: {
                    "author_id"?: string,"author_name"?: string,"body"?: string,"created_at"?: string,"id"?: string,"suggestion_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "traffic_suggestion_replies_suggestion_id_fkey"
      columns: ["suggestion_id"]
isOneToOne: false
      referencedRelation: "traffic_suggestions"
      referencedColumns: ["id"]
    }
                  ]
                },"traffic_suggestions": {
                  Row: {
                    "author_id": string,"author_name": string,"body": string,"campaign_id": string | null,"created_at": string,"id": string,"status": string,"subject": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"author_name": string,"body": string,"campaign_id"?: string | null,"created_at"?: string,"id"?: string,"status"?: string,"subject": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"author_name"?: string,"body"?: string,"campaign_id"?: string | null,"created_at"?: string,"id"?: string,"status"?: string,"subject"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"user_roles": {
                  Row: {
                    "can_view_sales": boolean | null,"commission_rate": number,"created_at": string,"crm_access": boolean,"crm_closer_access": boolean,"granted_at": string | null,"granted_by": string | null,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "can_view_sales"?: boolean | null,"commission_rate"?: number,"created_at"?: string,"crm_access"?: boolean,"crm_closer_access"?: boolean,"granted_at"?: string | null,"granted_by"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "can_view_sales"?: boolean | null,"commission_rate"?: number,"created_at"?: string,"crm_access"?: boolean,"crm_closer_access"?: boolean,"granted_at"?: string | null,"granted_by"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"vendas": {
                  Row: {
                    "approval_status": string,"commission_amount": number | null,"commission_rate_applied": number | null,"consideracoes_gerais": string | null,"created_at": string,"crm_lead_id": string | null,"email_comprador": string,"id": string,"nome_comprador": string,"nome_produto": string,"product_id": string | null,"rejection_reason": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"ticket_id": string | null,"ticket_name": string | null,"updated_at": string,"user_id": string,"valor_venda": number,"whatsapp_comprador": string,"withdrawal_id": string | null,"withdrawn": boolean,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_status"?: string,"commission_amount"?: number | null,"commission_rate_applied"?: number | null,"consideracoes_gerais"?: string | null,"created_at"?: string,"crm_lead_id"?: string | null,"email_comprador": string,"id"?: string,"nome_comprador": string,"nome_produto": string,"product_id"?: string | null,"rejection_reason"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"ticket_id"?: string | null,"ticket_name"?: string | null,"updated_at"?: string,"user_id": string,"valor_venda": number,"whatsapp_comprador": string,"withdrawal_id"?: string | null,"withdrawn"?: boolean,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "approval_status"?: string,"commission_amount"?: number | null,"commission_rate_applied"?: number | null,"consideracoes_gerais"?: string | null,"created_at"?: string,"crm_lead_id"?: string | null,"email_comprador"?: string,"id"?: string,"nome_comprador"?: string,"nome_produto"?: string,"product_id"?: string | null,"rejection_reason"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"ticket_id"?: string | null,"ticket_name"?: string | null,"updated_at"?: string,"user_id"?: string,"valor_venda"?: number,"whatsapp_comprador"?: string,"withdrawal_id"?: string | null,"withdrawn"?: boolean,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "vendas_crm_lead_id_fkey"
      columns: ["crm_lead_id"]
isOneToOne: false
      referencedRelation: "crm_leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vendas_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vendas_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "product_tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"workboard_chat": {
                  Row: {
                    "content": string,"created_at": string | null,"id": string,"task_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"created_at"?: string | null,"id"?: string,"task_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "content"?: string,"created_at"?: string | null,"id"?: string,"task_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workboard_chat_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "workboard_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"workboard_completions": {
                  Row: {
                    "completed_at": string | null,"id": string,"task_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"id"?: string,"task_id": string,"user_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"id"?: string,"task_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workboard_completions_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "workboard_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"workboard_tasks": {
                  Row: {
                    "assigned_to": (string)[] | null,"created_at": string | null,"created_by": string,"deadline": string | null,"description": string | null,"id": string,"is_active": boolean | null,"mode": string | null,"parent_id": string | null,"priority": string | null,"status": string | null,"target_roles": (string)[] | null,"title": string,"todos": Json | null,"type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: (string)[] | null,"created_at"?: string | null,"created_by": string,"deadline"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean | null,"mode"?: string | null,"parent_id"?: string | null,"priority"?: string | null,"status"?: string | null,"target_roles"?: (string)[] | null,"title": string,"todos"?: Json | null,"type"?: string | null
                  }
                  Update: {
                    "assigned_to"?: (string)[] | null,"created_at"?: string | null,"created_by"?: string,"deadline"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean | null,"mode"?: string | null,"parent_id"?: string | null,"priority"?: string | null,"status"?: string | null,"target_roles"?: (string)[] | null,"title"?: string,"todos"?: Json | null,"type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workboard_tasks_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "workboard_tasks"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "arena_closer_weekly_sale_facts": {
                  Row: {
                    "active": boolean | null,"occurred_at": string | null,"responsible_role": string | null,"revenue": number | null,"sale_id": string | null,"user_id": string | null,"weekly_credit_at": string | null
                  }
                  ComputedFields: never
                  Relationships: [

                  ]
                },"arena_counted_call_events": {
                  Row: {
                    "action_type": string | null,"actor_id": string | null,"actor_name": string | null,"created_at": string | null,"entity_title": string | null,"event_key": string | null,"id": string | null,"lead_id": string | null,"occurred_at": string | null,"provenance": string | null,"reason": string | null,"responsible_id": string | null,"responsible_name": string | null,"responsible_role": string | null,"revenue_delta": number | null,"reverses_id": string | null,"rule_version": number | null,"score_delta": number | null,"source_id": string | null,"source_type": string | null,"target_names": (string)[] | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "activity_feed_reverses_id_fkey"
      columns: ["reverses_id"]
isOneToOne: false
      referencedRelation: "activity_feed"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_feed_reverses_id_fkey"
      columns: ["reverses_id"]
isOneToOne: false
      referencedRelation: "arena_counted_call_events"
      referencedColumns: ["id"]
    }
                  ]
                },"arena_sale_facts": {
                  Row: {
                    "active": boolean | null,"occurred_at": string | null,"responsible_role": string | null,"revenue": number | null,"sale_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [

                  ]
                }
          }
          Functions: {
            "approve_sale":
{ Args: { "p_sale_id": string }; Returns: {
              "approval_status": string,
"commission_amount": number | null,
"commission_rate_applied": number | null,
"consideracoes_gerais": string | null,
"created_at": string,
"crm_lead_id": string | null,
"email_comprador": string,
"id": string,
"nome_comprador": string,
"nome_produto": string,
"product_id": string | null,
"rejection_reason": string | null,
"reviewed_at": string | null,
"reviewed_by": string | null,
"ticket_id": string | null,
"ticket_name": string | null,
"updated_at": string,
"user_id": string,
"valor_venda": number,
"whatsapp_comprador": string,
"withdrawal_id": string | null,
"withdrawn": boolean,
"withdrawn_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "vendas"
        isOneToOne: true
        isSetofReturn: false
      } },
"arena_adjust_score":
{ Args: { "p_delta": number,"p_person": string,"p_reason": string,"p_request": string,"p_role": string,"p_source": string }; Returns: undefined
                           },
"arena_assign_checklist_task":
{ Args: { "p_assignee": string,"p_deadline_at": string,"p_items": (string)[],"p_title": string }; Returns: string
                           },
"arena_assign_tasks":
{ Args: { "p_date": string,"p_people": (string)[],"p_roles": (string)[],"p_status"?: string,"p_title": string }; Returns: number
                           },
"arena_assignees":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"arena_cancel_call":
{ Args: { "p_id": string,"p_reason": string,"p_revision": string }; Returns: undefined
                           },
"arena_cancel_shift_approach_goal":
{ Args: { "p_id": string,"p_reason": string }; Returns: undefined
                           },
"arena_classification":
{ Args: { "p_actual": number,"p_end": string,"p_now": string,"p_start": string,"p_target": number }; Returns: string
                           },
"arena_classify_legacy":
{ Args: { "p_approved": boolean,"p_audit_id": string,"p_reason": string }; Returns: undefined
                           },
"arena_closer_exception":
{ Args: { "p_user": string }; Returns: boolean
                           },
"arena_collective_result":
{ Args: { "p_id": string }; Returns: Json
                           },
"arena_complete_task":
{ Args: { "p_comment"?: string,"p_completed": boolean,"p_id": string,"p_version": number }; Returns: {
              "assignee_id": string,
"checklist_items": NonNullable<Json>,
"completed_at": string | null,
"completed_by": string | null,
"completion_comment": string | null,
"created_at": string,
"created_by": string | null,
"deadline_at": string | null,
"definition_id": string | null,
"id": string,
"is_completed": boolean,
"operational_status": string,
"position": number,
"task_date": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "daily_goal_tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"arena_convert_task_to_shift_goal":
{ Args: { "p_duration_minutes": number,"p_expected_version": number,"p_source": string,"p_starts_at": string,"p_target_approaches": number,"p_task_id": string }; Returns: undefined
                           },
"arena_correct_sale_revenue":
{ Args: { "p_delta": number,"p_reason": string,"p_sale_id": string }; Returns: undefined
                           },
"arena_create_shift_approach_goals":
{ Args: { "p_duration_minutes": number,"p_people": (string)[],"p_roles": (string)[],"p_source": string,"p_starts_at": string,"p_target_approaches": number,"p_title": string }; Returns: number
                           },
"arena_cycle_result":
{ Args: { "p_id": string }; Returns: Json
                           },
"arena_dashboard":
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           },
"arena_delete_goal":
{ Args: { "p_family_id": string,"p_reason": string }; Returns: string
                           },
"arena_emit":
{ Args: { "p_actor"?: string,"p_at": string,"p_key": string,"p_kind": string,"p_lead"?: string,"p_person": string,"p_provenance"?: string,"p_reason"?: string,"p_revenue"?: number,"p_reverses"?: string,"p_role": string,"p_score"?: number,"p_source": string,"p_source_id": string }; Returns: string
                           },
"arena_goal_history":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_outcome"?: string,"p_person"?: string }; Returns: Json
                           },
"arena_has_access":
{ Args: { "p_admin"?: boolean }; Returns: boolean
                           },
"arena_live_cursor":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"arena_management":
{ Args: { "p_offset"?: number,"p_tab": string }; Returns: Json
                           },
"arena_period_metrics":
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           },
"arena_read_notifications":
{ Args: { "p_ids": (string)[] }; Returns: undefined
                           },
"arena_reverse_sale":
{ Args: { "p_id": string,"p_reason": string,"p_revision": string,"p_status": string }; Returns: undefined
                           },
"arena_revision":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"arena_save_goal":
{ Args: { "p_data": Json,"p_previous"?: string,"p_reason": string }; Returns: string
                           },
"arena_save_score_weights":
{ Args: { "p_reason": string,"p_weights": Json }; Returns: undefined
                           },
"arena_save_traffic":
{ Args: { "p_campaign": string,"p_date": string,"p_id": string,"p_leads": number,"p_platform": string,"p_revision"?: string,"p_spend": number }; Returns: string
                           },
"arena_score_weight":
{ Args: { "p_action_type": string }; Returns: number
                           },
"arena_score_weights":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"arena_sdr_exception":
{ Args: { "p_user": string }; Returns: boolean
                           },
"arena_sdr_ranking":
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           },
"arena_set_task_checklist_completion":
{ Args: { "p_completed": boolean,"p_id": string,"p_version": number }; Returns: {
              "assignee_id": string,
"checklist_items": NonNullable<Json>,
"completed_at": string | null,
"completed_by": string | null,
"completion_comment": string | null,
"created_at": string,
"created_by": string | null,
"deadline_at": string | null,
"definition_id": string | null,
"id": string,
"is_completed": boolean,
"operational_status": string,
"position": number,
"task_date": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "daily_goal_tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"arena_set_visibility":
{ Args: { "p_hidden": boolean,"p_person": string,"p_reason": string }; Returns: undefined
                           },
"arena_shift_approach_progress":
{ Args: { "p_day": string,"p_offset"?: number,"p_person"?: string }; Returns: Json
                           },
"arena_task_status":
{ Args: { "p_id": string,"p_status": string,"p_version": number }; Returns: undefined
                           },
"arena_team_ranking":
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           } |
{ Args: { "p_end": string,"p_start": string,"p_weekly_credit": boolean }; Returns: Json
                           },
"arena_tick":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"arena_toggle_task_checklist":
{ Args: { "p_done": boolean,"p_id": string,"p_item_id": string,"p_version": number }; Returns: {
              "assignee_id": string,
"checklist_items": NonNullable<Json>,
"completed_at": string | null,
"completed_by": string | null,
"completion_comment": string | null,
"created_at": string,
"created_by": string | null,
"deadline_at": string | null,
"definition_id": string | null,
"id": string,
"is_completed": boolean,
"operational_status": string,
"position": number,
"task_date": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "daily_goal_tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"arena_visible_goals":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"calculate_and_update_commissions":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"check_registration_access":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"check_user_not_suspended":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"crm_add_lead_context":
{ Args: { "p_content": string,"p_context_type": string,"p_lead_id": string }; Returns: {
              "author_id": string,
"author_name": string,
"author_role": string,
"content": string,
"context_type": string,
"created_at": string,
"file_content": string | null,
"file_mime_type": string | null,
"file_name": string | null,
"id": string,
"lead_id": string,
"media_url": string | null,
"updated_at": string,
"updated_by": string | null,
"updated_by_name": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_contexts"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_add_lead_context_with_media":
{ Args: { "p_content": string,"p_context_type": string,"p_lead_id": string,"p_media_url": string }; Returns: {
              "author_id": string,
"author_name": string,
"author_role": string,
"content": string,
"context_type": string,
"created_at": string,
"file_content": string | null,
"file_mime_type": string | null,
"file_name": string | null,
"id": string,
"lead_id": string,
"media_url": string | null,
"updated_at": string,
"updated_by": string | null,
"updated_by_name": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_contexts"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_call_assignees":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"role": string,"user_id": string
            }[]
                           },
"crm_can":
{ Args: { "p_capability": string }; Returns: boolean
                           },
"crm_can_schedule_qualification_call":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"crm_delete_lead":
{ Args: { "p_expected_version": number,"p_lead_id": string }; Returns: Json
                           },
"crm_has_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"crm_import_txt_context":
{ Args: { "p_content": string,"p_context_type": string,"p_lead_id": string,"p_source_content": string,"p_source_name": string }; Returns: {
              "author_id": string,
"author_name": string,
"author_role": string,
"content": string,
"context_type": string,
"created_at": string,
"file_content": string | null,
"file_mime_type": string | null,
"file_name": string | null,
"id": string,
"lead_id": string,
"media_url": string | null,
"updated_at": string,
"updated_by": string | null,
"updated_by_name": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_contexts"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_import_txt_context_with_media":
{ Args: { "p_content": string,"p_context_type": string,"p_lead_id": string,"p_media_url": string,"p_source_content": string,"p_source_name": string }; Returns: {
              "author_id": string,
"author_name": string,
"author_role": string,
"content": string,
"context_type": string,
"created_at": string,
"file_content": string | null,
"file_mime_type": string | null,
"file_name": string | null,
"id": string,
"lead_id": string,
"media_url": string | null,
"updated_at": string,
"updated_by": string | null,
"updated_by_name": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_contexts"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_lead_payment_summaries":
{ Args: Record<PropertyKey, never>; Returns: {
              "lead_id": string,"next_due_date": string,"paid_amount": number,"paid_count": number,"pending_count": number,"status": string,"total_amount": number,"total_count": number,"unpaid_count": number
            }[]
                           },
"crm_mark_negative":
{ Args: { "p_expected_version": number,"p_lead_id": string,"p_next_at": string,"p_note"?: string,"p_reason": string }; Returns: {
              "age": number | null,
"approach_count": number,
"approach_stage": string,
"approached": boolean,
"approached_at": string | null,
"assigned_to": string | null,
"athlete_age": number | null,
"athlete_birth_date": string | null,
"athlete_height_cm": number | null,
"athlete_name": string | null,
"athlete_position": string | null,
"athlete_weight_kg": number | null,
"city_state": string | null,
"closed_at": string | null,
"closed_by": string | null,
"closer_id": string | null,
"company": string | null,
"conversion_probability": number | null,
"created_at": string | null,
"created_by": string | null,
"email": string | null,
"estimated_deal_value": number | null,
"expected_close_at": string | null,
"first_contact_at": string | null,
"followup_attempt_count": number,
"followup_last_contact_at": string | null,
"followup_next_at": string | null,
"followup_status": string | null,
"handed_off_at": string | null,
"id": string,
"job_title": string | null,
"last_contact_at": string | null,
"last_result_at": string | null,
"last_result_closer_id": string | null,
"last_result_closer_name": string | null,
"last_result_outcome": string | null,
"lead_generated_at": string,
"lead_source": string | null,
"linkedin_url": string | null,
"meta_form_lead_id": string | null,
"name": string,
"negative_reason": string | null,
"next_followup_at": string | null,
"observations": string | null,
"observations_updated_at": string | null,
"observations_updated_by": string | null,
"performance_report_url": string | null,
"phone": string | null,
"pipeline_stage": string,
"priority": string | null,
"profile_photo_url": string | null,
"qualification_completed_at": string | null,
"qualification_completed_by": string | null,
"qualification_decision_maker": string | null,
"qualification_goal": string | null,
"qualification_income_range": string | null,
"qualification_summary": string | null,
"qualification_timeline": string | null,
"sdr_id": string | null,
"tags": (string)[] | null,
"temperature": string,
"updated_at": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_leads"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_payment_delete":
{ Args: { "p_expected_revision": string,"p_payment_id": string,"p_reason": string }; Returns: Json
                           },
"crm_payment_save":
{ Args: { "p_amount": number,"p_description": string,"p_due_date": string,"p_expected_revision": string,"p_lead_id": string,"p_method": string,"p_notes": string,"p_payment_id": string,"p_proof_url": string }; Returns: {
              "amount": number,
"created_at": string,
"created_by": string,
"description": string,
"due_date": string | null,
"id": string,
"lead_id": string,
"method": string,
"notes": string | null,
"paid_at": string | null,
"proof_url": string | null,
"status": string,
"status_reason": string | null,
"updated_at": string,
"updated_by": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_payment_set_status":
{ Args: { "p_expected_revision": string,"p_paid_at": string,"p_payment_id": string,"p_reason": string,"p_status": string }; Returns: {
              "amount": number,
"created_at": string,
"created_by": string,
"description": string,
"due_date": string | null,
"id": string,
"lead_id": string,
"method": string,
"notes": string | null,
"paid_at": string | null,
"proof_url": string | null,
"status": string,
"status_reason": string | null,
"updated_at": string,
"updated_by": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_reopen_result":
{ Args: { "p_assigned_to": string,"p_expected_version": number,"p_lead_id": string,"p_next_at": string,"p_note"?: string,"p_target": string }; Returns: {
              "age": number | null,
"approach_count": number,
"approach_stage": string,
"approached": boolean,
"approached_at": string | null,
"assigned_to": string | null,
"athlete_age": number | null,
"athlete_birth_date": string | null,
"athlete_height_cm": number | null,
"athlete_name": string | null,
"athlete_position": string | null,
"athlete_weight_kg": number | null,
"city_state": string | null,
"closed_at": string | null,
"closed_by": string | null,
"closer_id": string | null,
"company": string | null,
"conversion_probability": number | null,
"created_at": string | null,
"created_by": string | null,
"email": string | null,
"estimated_deal_value": number | null,
"expected_close_at": string | null,
"first_contact_at": string | null,
"followup_attempt_count": number,
"followup_last_contact_at": string | null,
"followup_next_at": string | null,
"followup_status": string | null,
"handed_off_at": string | null,
"id": string,
"job_title": string | null,
"last_contact_at": string | null,
"last_result_at": string | null,
"last_result_closer_id": string | null,
"last_result_closer_name": string | null,
"last_result_outcome": string | null,
"lead_generated_at": string,
"lead_source": string | null,
"linkedin_url": string | null,
"meta_form_lead_id": string | null,
"name": string,
"negative_reason": string | null,
"next_followup_at": string | null,
"observations": string | null,
"observations_updated_at": string | null,
"observations_updated_by": string | null,
"performance_report_url": string | null,
"phone": string | null,
"pipeline_stage": string,
"priority": string | null,
"profile_photo_url": string | null,
"qualification_completed_at": string | null,
"qualification_completed_by": string | null,
"qualification_decision_maker": string | null,
"qualification_goal": string | null,
"qualification_income_range": string | null,
"qualification_summary": string | null,
"qualification_timeline": string | null,
"sdr_id": string | null,
"tags": (string)[] | null,
"temperature": string,
"updated_at": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_leads"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_require_role":
{ Args: { "p_role": string }; Returns: undefined
                           },
"crm_result_sale_links":
{ Args: Record<PropertyKey, never>; Returns: {
              "approval_status": string,"can_open": boolean,"lead_id": string,"sale_id": string,"seller_id": string,"seller_name": string
            }[]
                           },
"crm_sale_links":
{ Args: Record<PropertyKey, never>; Returns: {
              "can_open": boolean,"lead_id": string,"sale_id": string
            }[]
                           },
"crm_set_payment_status":
{ Args: { "p_lead_id": string,"p_status": string }; Returns: {
              "lead_id": string,
"status": string,
"updated_at": string,
"updated_by": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_payment_status"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_transition":
{ Args: { "p_action": string,"p_data"?: Json,"p_expected_version": number,"p_lead_id": string }; Returns: {
              "age": number | null,
"approach_count": number,
"approach_stage": string,
"approached": boolean,
"approached_at": string | null,
"assigned_to": string | null,
"athlete_age": number | null,
"athlete_birth_date": string | null,
"athlete_height_cm": number | null,
"athlete_name": string | null,
"athlete_position": string | null,
"athlete_weight_kg": number | null,
"city_state": string | null,
"closed_at": string | null,
"closed_by": string | null,
"closer_id": string | null,
"company": string | null,
"conversion_probability": number | null,
"created_at": string | null,
"created_by": string | null,
"email": string | null,
"estimated_deal_value": number | null,
"expected_close_at": string | null,
"first_contact_at": string | null,
"followup_attempt_count": number,
"followup_last_contact_at": string | null,
"followup_next_at": string | null,
"followup_status": string | null,
"handed_off_at": string | null,
"id": string,
"job_title": string | null,
"last_contact_at": string | null,
"last_result_at": string | null,
"last_result_closer_id": string | null,
"last_result_closer_name": string | null,
"last_result_outcome": string | null,
"lead_generated_at": string,
"lead_source": string | null,
"linkedin_url": string | null,
"meta_form_lead_id": string | null,
"name": string,
"negative_reason": string | null,
"next_followup_at": string | null,
"observations": string | null,
"observations_updated_at": string | null,
"observations_updated_by": string | null,
"performance_report_url": string | null,
"phone": string | null,
"pipeline_stage": string,
"priority": string | null,
"profile_photo_url": string | null,
"qualification_completed_at": string | null,
"qualification_completed_by": string | null,
"qualification_decision_maker": string | null,
"qualification_goal": string | null,
"qualification_income_range": string | null,
"qualification_summary": string | null,
"qualification_timeline": string | null,
"sdr_id": string | null,
"tags": (string)[] | null,
"temperature": string,
"updated_at": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_leads"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_update_followup":
{ Args: { "p_action": string,"p_expected_version": number,"p_lead_id": string,"p_next_at"?: string,"p_note"?: string }; Returns: {
              "age": number | null,
"approach_count": number,
"approach_stage": string,
"approached": boolean,
"approached_at": string | null,
"assigned_to": string | null,
"athlete_age": number | null,
"athlete_birth_date": string | null,
"athlete_height_cm": number | null,
"athlete_name": string | null,
"athlete_position": string | null,
"athlete_weight_kg": number | null,
"city_state": string | null,
"closed_at": string | null,
"closed_by": string | null,
"closer_id": string | null,
"company": string | null,
"conversion_probability": number | null,
"created_at": string | null,
"created_by": string | null,
"email": string | null,
"estimated_deal_value": number | null,
"expected_close_at": string | null,
"first_contact_at": string | null,
"followup_attempt_count": number,
"followup_last_contact_at": string | null,
"followup_next_at": string | null,
"followup_status": string | null,
"handed_off_at": string | null,
"id": string,
"job_title": string | null,
"last_contact_at": string | null,
"last_result_at": string | null,
"last_result_closer_id": string | null,
"last_result_closer_name": string | null,
"last_result_outcome": string | null,
"lead_generated_at": string,
"lead_source": string | null,
"linkedin_url": string | null,
"meta_form_lead_id": string | null,
"name": string,
"negative_reason": string | null,
"next_followup_at": string | null,
"observations": string | null,
"observations_updated_at": string | null,
"observations_updated_by": string | null,
"performance_report_url": string | null,
"phone": string | null,
"pipeline_stage": string,
"priority": string | null,
"profile_photo_url": string | null,
"qualification_completed_at": string | null,
"qualification_completed_by": string | null,
"qualification_decision_maker": string | null,
"qualification_goal": string | null,
"qualification_income_range": string | null,
"qualification_summary": string | null,
"qualification_timeline": string | null,
"sdr_id": string | null,
"tags": (string)[] | null,
"temperature": string,
"updated_at": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_leads"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_update_lead_context":
{ Args: { "p_content": string,"p_context_id": string,"p_context_type": string,"p_expected_version": number }; Returns: {
              "author_id": string,
"author_name": string,
"author_role": string,
"content": string,
"context_type": string,
"created_at": string,
"file_content": string | null,
"file_mime_type": string | null,
"file_name": string | null,
"id": string,
"lead_id": string,
"media_url": string | null,
"updated_at": string,
"updated_by": string | null,
"updated_by_name": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_contexts"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_update_lead_context_with_media":
{ Args: { "p_content": string,"p_context_id": string,"p_context_type": string,"p_expected_version": number,"p_media_url": string }; Returns: {
              "author_id": string,
"author_name": string,
"author_role": string,
"content": string,
"context_type": string,
"created_at": string,
"file_content": string | null,
"file_mime_type": string | null,
"file_name": string | null,
"id": string,
"lead_id": string,
"media_url": string | null,
"updated_at": string,
"updated_by": string | null,
"updated_by_name": string | null,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "crm_lead_contexts"
        isOneToOne: true
        isSetofReturn: false
      } },
"crm_user_can":
{ Args: { "p_capability": string,"p_user": string }; Returns: boolean
                           },
"dashboard_account_active":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"dashboard_home_approaches":
{ Args: { "p_end"?: string,"p_start"?: string }; Returns: {
              "created_at": string,"id": string,"mostrou_ia": boolean
            }[]
                           },
"dashboard_home_calls":
{ Args: { "p_end"?: string,"p_start"?: string }; Returns: {
              "completed_at": string,"id": string,"scheduled_at": string
            }[]
                           },
"dashboard_home_sales":
{ Args: { "p_end"?: string,"p_late"?: boolean,"p_start"?: string }; Returns: {
              "created_at": string,"id": string,"nome_produto": string,"reviewed_at": string,"valor_venda": number
            }[]
                           },
"dashboard_refresh_balance":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"dashboard_require_access":
{ Args: { "p_executive"?: boolean }; Returns: undefined
                           },
"executive_can_manage_avatar":
{ Args: { "p_actor": string,"p_object_name": string }; Returns: boolean
                           },
"executive_cancel_withdrawal":
{ Args: { "p_id": string,"p_reason": string }; Returns: undefined
                           },
"executive_create_daily_goal_task":
{ Args: { "p_assignee_id": string,"p_task_date": string,"p_title": string }; Returns: {
              "assignee_id": string,
"checklist_items": NonNullable<Json>,
"completed_at": string | null,
"completed_by": string | null,
"completion_comment": string | null,
"created_at": string,
"created_by": string | null,
"deadline_at": string | null,
"definition_id": string | null,
"id": string,
"is_completed": boolean,
"operational_status": string,
"position": number,
"task_date": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "daily_goal_tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"executive_create_product":
{ Args: { "p_active"?: boolean,"p_description": string,"p_name": string,"p_ticket_name": string,"p_ticket_price": number }; Returns: {
              "active": boolean,
"created_at": string,
"created_by": string | null,
"description": string | null,
"id": string,
"name": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: true
        isSetofReturn: false
      } },
"executive_delete_account":
{ Args: { "p_actor_id": string,"p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"executive_delete_daily_goal_task":
{ Args: { "p_expected_version": number,"p_task_id": string }; Returns: undefined
                           },
"executive_list_registration_requests":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"executive_list_users":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"executive_prepare_account_deletion":
{ Args: { "p_actor_id": string,"p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"executive_review_registration":
{ Args: { "p_action": string,"p_user_id": string }; Returns: Json
                           },
"executive_review_sale":
{ Args: { "p_action": string,"p_expected_status"?: string,"p_reason"?: string,"p_sale_id": string }; Returns: Json
                           },
"executive_save_product":
{ Args: { "p_active"?: boolean,"p_description"?: string,"p_expected_updated_at"?: string,"p_name": string,"p_product_id": string }; Returns: {
              "active": boolean,
"created_at": string,
"created_by": string | null,
"description": string | null,
"id": string,
"name": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: true
        isSetofReturn: false
      } },
"executive_save_product_ticket":
{ Args: { "p_active"?: boolean,"p_expected_updated_at"?: string,"p_name": string,"p_price": number,"p_product_id": string,"p_ticket_id": string }; Returns: {
              "active": boolean,
"created_at": string,
"created_by": string | null,
"id": string,
"name": string,
"price": number,
"product_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "product_tickets"
        isOneToOne: true
        isSetofReturn: false
      } },
"executive_set_crm_access":
{ Args: { "p_enabled": boolean,"p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"executive_update_daily_goal_task":
{ Args: { "p_assignee_id": string,"p_expected_version": number,"p_task_date": string,"p_task_id": string,"p_title": string }; Returns: {
              "assignee_id": string,
"checklist_items": NonNullable<Json>,
"completed_at": string | null,
"completed_by": string | null,
"completion_comment": string | null,
"created_at": string,
"created_by": string | null,
"deadline_at": string | null,
"definition_id": string | null,
"id": string,
"is_completed": boolean,
"operational_status": string,
"position": number,
"task_date": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "daily_goal_tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"get_auth_users_for_executives":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"id": string,"last_sign_in_at": string
            }[]
                           },
"get_available_balance":
{ Args: { "p_seller_id": string }; Returns: number
                           },
"get_company_goal_totals":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_my_registration_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_pending_commission":
{ Args: { "p_seller_id": string }; Returns: number
                           },
"get_sales_board":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_search"?: string,"p_status"?: string }; Returns: Json
                           },
"get_sdr_ranking":
{ Args: Record<PropertyKey, never>; Returns: Json
                           } |
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           },
"get_team_ranking":
{ Args: Record<PropertyKey, never>; Returns: Json
                           } |
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           },
"get_user_details":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"created_at": string,"display_name": string,"email": string,"id": string,"last_seen": string,"last_sign_in_at": string,"suspended": boolean,"user_id": string
            }[]
                           },
"get_user_role":
{ Args: { "uid": string }; Returns: string
                           },
"handoff_and_schedule_closer_call":
{ Args: { "p_assigned_to": string,"p_context"?: string,"p_expected_version": number,"p_lead_id": string,"p_scheduled_at": string }; Returns: {
              "activity_type": string,
"assigned_to": string | null,
"author_name": string | null,
"call_type": string | null,
"cancellation_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"completed_at": string | null,
"created_at": string | null,
"description": string | null,
"id": string,
"is_completed": boolean,
"is_pinned": boolean,
"lead_id": string,
"new_state": Json | null,
"outcome": string | null,
"performed_at": string | null,
"performed_by": string | null,
"previous_state": Json | null,
"scheduled_at": string | null,
"title": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_activities"
        isOneToOne: true
        isSetofReturn: false
      } },
"has_role":
{ Args: { "_role": Database["public"]['Enums']["app_role"],"_user_id": string }; Returns: boolean
                           },
"is_executive":
{ Args: { "_user_id": string }; Returns: boolean
                           },
"is_super_admin":
{ Args: { "_user_id": string }; Returns: boolean
                           },
"log_security_event":
{ Args: { "p_action": string,"p_details"?: Json,"p_record_id"?: string,"p_table_name": string }; Returns: undefined
                           },
"manage_sale":
{ Args: { "p_action": string,"p_data"?: Json,"p_expected_updated_at": string,"p_reason"?: string,"p_sale_id": string }; Returns: {
              "approval_status": string,
"commission_amount": number | null,
"commission_rate_applied": number | null,
"consideracoes_gerais": string | null,
"created_at": string,
"crm_lead_id": string | null,
"email_comprador": string,
"id": string,
"nome_comprador": string,
"nome_produto": string,
"product_id": string | null,
"rejection_reason": string | null,
"reviewed_at": string | null,
"reviewed_by": string | null,
"ticket_id": string | null,
"ticket_name": string | null,
"updated_at": string,
"user_id": string,
"valor_venda": number,
"whatsapp_comprador": string,
"withdrawal_id": string | null,
"withdrawn": boolean,
"withdrawn_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "vendas"
        isOneToOne: true
        isSetofReturn: false
      } },
"meta_answer_text":
{ Args: { "p_fields": Json,"p_names": (string)[] }; Returns: string
                           },
"meta_assert_account_identity":
{ Args: { "p_id": string }; Returns: undefined
                           },
"meta_capture_abort":
{ Args: { "p_claim": string,"p_error": string,"p_id": string }; Returns: undefined
                           },
"meta_capture_append":
{ Args: { "p_claim": string,"p_id": string,"p_next": Json,"p_page_no": number,"p_request_hash": string,"p_rows": Json }; Returns: Json
                           },
"meta_capture_candidate":
{ Args: { "p_conflict"?: Json,"p_edited": boolean,"p_operation": string,"p_original": Json,"p_payload": Json,"p_reason": string,"p_review": string }; Returns: undefined
                           },
"meta_capture_check_claim":
{ Args: { "p_claim": string,"p_id": string }; Returns: {
              "account_id": string | null,
"account_metadata": Json | null,
"claim_token": string | null,
"coverage_state": string,
"definition_version": string | null,
"error_message": string | null,
"finished_at": string | null,
"id": string,
"kind": string,
"lease_until": string | null,
"level": string | null,
"next_request": Json | null,
"next_retry_at": string | null,
"page_count": number,
"request_params": Json | null,
"rows_synced": number,
"started_at": string,
"status": string,
"triggered_by": string,
"triggered_by_user": string | null,
"window_end": string | null,
"window_start": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "meta_sync_runs"
        isOneToOne: true
        isSetofReturn: false
      } },
"meta_capture_check_review":
{ Args: { "p_id": string,"p_version": number }; Returns: {
              "account_id": string,
"created_at": string,
"id": string,
"level": string,
"manifest": NonNullable<Json>,
"review_note": string | null,
"reviewed_at": string | null,
"reviewed_by": string | null,
"status": string,
"sync_run_id": string,
"updated_at": string,
"version": number,
"window_end": string,
"window_start": string
            }
                          SetofOptions: {
        from: "*"
        to: "meta_capture_reviews"
        isOneToOne: true
        isSetofReturn: false
      } },
"meta_capture_claim":
{ Args: { "p_id": string,"p_lease_seconds"?: number }; Returns: Json
                           },
"meta_capture_open":
{ Args: { "p_account_id": string,"p_actor": string,"p_end": string,"p_level": string,"p_metadata": Json,"p_params": Json,"p_start": string,"p_triggered_by": string }; Returns: string
                           },
"meta_capture_prepare":
{ Args: { "p_claim": string,"p_id": string }; Returns: string
                           },
"meta_capture_release":
{ Args: { "p_claim": string,"p_error"?: string,"p_id": string,"p_retry_at"?: string }; Returns: undefined
                           },
"meta_capture_require_service":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"meta_capture_review_decide":
{ Args: { "p_action": string,"p_id": string,"p_note"?: string,"p_version": number }; Returns: Json
                           },
"meta_capture_review_edit":
{ Args: { "p_id": string,"p_patch": Json,"p_reason": string,"p_row_no": number,"p_version": number }; Returns: Json
                           },
"meta_capture_review_part":
{ Args: { "p_id": string,"p_limit"?: number,"p_offset"?: number,"p_version": number }; Returns: Json
                           },
"meta_capture_review_resolve":
{ Args: { "p_action": string,"p_id": string,"p_payload": Json,"p_reason": string,"p_row_no": number,"p_version": number }; Returns: Json
                           },
"meta_connect_ad_account":
{ Args: { "p_account_id": string,"p_account_name": string,"p_currency"?: string,"p_timezone"?: string }; Returns: string
                           },
"meta_contact_from_form":
{ Args: { "p_form": Omit<Database["public"]['Tables']["meta_form_leads"]['Row'], Database["public"]['Tables']["meta_form_leads"]['ComputedFields']> }; Returns: Json
                           },
"meta_create_crm_lead_from_form":
{ Args: { "p_actor": string,"p_contact": Json,"v_form": Omit<Database["public"]['Tables']["meta_form_leads"]['Row'], Database["public"]['Tables']["meta_form_leads"]['ComputedFields']> }; Returns: string
                           },
"meta_crm_attribution_daily":
{ Args: { "p_end": string,"p_start": string }; Returns: {
              "campaign_id": string,"campaign_name": string,"confirmed_revenue": number,"confirmed_sales": number
            }[]
                           },
"meta_disconnect_ad_account":
{ Args: { "p_account_id": string,"p_reason": string }; Returns: undefined
                           },
"meta_edit_diff":
{ Args: { "p_after": Json,"p_before": Json }; Returns: Json
                           },
"meta_edit_form_lead":
{ Args: { "p_expected_crm_version": number,"p_expected_updated_at": string,"p_id": string,"p_patch": Json,"p_reason": string }; Returns: Json
                           },
"meta_edit_import_row":
{ Args: { "p_batch_id": string,"p_expected_updated_at": string,"p_kind": string,"p_patch": Json,"p_reason": string,"p_row_index": number }; Returns: Json
                           },
"meta_edit_traffic_row":
{ Args: { "p_expected_updated_at": string,"p_id": string,"p_patch": Json,"p_reason": string }; Returns: Json
                           },
"meta_get_traffic_lead":
{ Args: { "p_id": string }; Returns: Json
                           },
"meta_ignore_form_lead":
{ Args: { "p_id": string,"p_reason": string }; Returns: undefined
                           },
"meta_import_daily":
{ Args: { "p_filename": string,"p_rows": Json }; Returns: Json
                           },
"meta_import_daily_system":
{ Args: { "p_actor"?: string,"p_rows": Json,"p_sync_run_id": string }; Returns: Json
                           },
"meta_import_leads":
{ Args: { "p_filename": string,"p_rows": Json }; Returns: Json
                           },
"meta_ingest_form_lead":
{ Args: { "p_data": Json }; Returns: string
                           },
"meta_ingest_lead_import_row":
{ Args: { "item": Json,"p_batch_id": string,"p_reviewer": string }; Returns: undefined
                           },
"meta_lead_discovery_checkpoint":
{ Args: { "p_claim": string,"p_expected_version": number,"p_page_id": string,"p_state": Json }; Returns: number
                           },
"meta_lead_discovery_claim":
{ Args: { "p_lease_seconds"?: number,"p_page_id": string }; Returns: Json
                           },
"meta_lead_discovery_release":
{ Args: { "p_claim": string,"p_error"?: string,"p_page_id": string }; Returns: undefined
                           },
"meta_lead_event_check_claim":
{ Args: { "p_claim": string,"p_id": string }; Returns: {
              "attempts": number,
"claim_token": string | null,
"error_class": string | null,
"form_id": string,
"id": string,
"last_error": string | null,
"leadgen_id": string,
"lease_until": string | null,
"meta_form_lead_id": string | null,
"next_attempt_at": string,
"page_id": string,
"processed_at": string | null,
"processing_attempts": number,
"receipt_count": number,
"received_at": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "meta_webhook_events"
        isOneToOne: true
        isSetofReturn: false
      } },
"meta_lead_event_fail":
{ Args: { "p_claim": string,"p_class": string,"p_error": string,"p_id": string }; Returns: undefined
                           },
"meta_lead_event_ignore":
{ Args: { "p_id": string,"p_reason": string }; Returns: undefined
                           },
"meta_lead_event_ingest":
{ Args: { "p_claim": string,"p_data": Json,"p_id": string }; Returns: string
                           },
"meta_lead_events_claim":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number,"p_page_ids"?: (string)[] }; Returns: {
              "attempts": number,
"claim_token": string | null,
"error_class": string | null,
"form_id": string,
"id": string,
"last_error": string | null,
"leadgen_id": string,
"lease_until": string | null,
"meta_form_lead_id": string | null,
"next_attempt_at": string,
"page_id": string,
"processed_at": string | null,
"processing_attempts": number,
"receipt_count": number,
"received_at": string,
"status": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "meta_webhook_events"
        isOneToOne: false
        isSetofReturn: true
      } },
"meta_lead_inbox_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"meta_lead_run_start":
{ Args: { "p_discover": boolean,"p_page_id": string }; Returns: string
                           },
"meta_normalize_account_id":
{ Args: { "p_id": string }; Returns: string
                           },
"meta_promote_form_lead":
{ Args: { "p_contact": Json,"p_id": string }; Returns: string
                           },
"meta_record_edit":
{ Args: { "p_action": string,"p_id": string,"p_origin": string,"p_summary": Json,"p_type": string }; Returns: undefined
                           },
"meta_review_form_lead":
{ Args: { "p_action": string,"p_expected_updated_at": string,"p_id": string,"p_note"?: string }; Returns: Json
                           },
"meta_review_lead_import":
{ Args: { "p_action": string,"p_batch_id": string,"p_expected_updated_at": string,"p_note"?: string }; Returns: {
              "created_at": string,
"filename": string,
"id": string,
"imported_by": string,
"result": Json | null,
"review_note": string | null,
"reviewed_at": string | null,
"reviewed_by": string | null,
"row_count": number,
"rows": NonNullable<Json>,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "meta_lead_import_batches"
        isOneToOne: true
        isSetofReturn: false
      } },
"meta_review_traffic_import":
{ Args: { "p_action": string,"p_batch_id": string,"p_expected_updated_at": string,"p_note"?: string }; Returns: {
              "account_id": string | null,
"created_at": string,
"filename": string,
"id": string,
"imported_by": string | null,
"level": string | null,
"replaced_by_review_id": string | null,
"review_note": string | null,
"reviewed_at": string | null,
"reviewed_by": string | null,
"row_count": number,
"rows": NonNullable<Json>,
"source": string,
"status": string,
"sync_run_id": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "meta_import_batches"
        isOneToOne: true
        isSetofReturn: false
      } },
"meta_sync_run_finish":
{ Args: { "p_error_message"?: string,"p_id": string,"p_rows_synced"?: number,"p_status": string }; Returns: undefined
                           },
"meta_sync_run_start":
{ Args: { "p_account_id"?: string,"p_kind": string,"p_triggered_by"?: string,"p_triggered_by_user"?: string,"p_window_end"?: string,"p_window_start"?: string }; Returns: string
                           },
"meta_traffic_cohort":
{ Args: { "p_account_id"?: string,"p_campaign_id"?: string,"p_end": string,"p_source"?: string,"p_start": string }; Returns: Json
                           },
"meta_traffic_identity":
{ Args: { "item": Json }; Returns: string
                           },
"meta_traffic_lead_reconciliation":
{ Args: { "p_end": string,"p_start": string }; Returns: {
              "campaign_id": string,"campaign_name": string,"form_leads_count": number
            }[]
                           },
"meta_traffic_operation":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"meta_traffic_review_list":
{ Args: { "p_kind"?: string,"p_limit"?: number,"p_offset"?: number,"p_status"?: string }; Returns: Json
                           },
"meta_upsert_traffic_row":
{ Args: { "item": Json,"p_import_batch_id": string,"p_imported_by": string,"p_source": string,"p_sync_run_id": string }; Returns: undefined
                           },
"meta_validate_edit":
{ Args: { "p_kind": string,"p_patch": Json,"p_reason": string }; Returns: undefined
                           },
"meta_validate_traffic_row":
{ Args: { "item": Json }; Returns: undefined
                           },
"meta_webhook_event_complete":
{ Args: { "p_error"?: string,"p_id": string,"p_meta_form_lead_id"?: string,"p_status": string }; Returns: undefined
                           },
"meta_webhook_event_receive":
{ Args: { "p_form_id": string,"p_leadgen_id": string,"p_page_id": string }; Returns: string
                           },
"process_withdrawal":
{ Args: { "p_user_id": string,"p_withdrawal_amount": number }; Returns: undefined
                           },
"recalculate_all_balances":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"registration_has_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"reschedule_crm_call":
{ Args: { "p_activity_id": string,"p_expected_revision": string,"p_scheduled_at": string }; Returns: {
              "activity_type": string,
"assigned_to": string | null,
"author_name": string | null,
"call_type": string | null,
"cancellation_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"completed_at": string | null,
"created_at": string | null,
"description": string | null,
"id": string,
"is_completed": boolean,
"is_pinned": boolean,
"lead_id": string,
"new_state": Json | null,
"outcome": string | null,
"performed_at": string | null,
"performed_by": string | null,
"previous_state": Json | null,
"scheduled_at": string | null,
"title": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_activities"
        isOneToOne: true
        isSetofReturn: false
      } },
"resolve_closer_call":
{ Args: { "p_activity_id": string,"p_expected_revision": string,"p_outcome": string }; Returns: {
              "activity_type": string,
"assigned_to": string | null,
"author_name": string | null,
"call_type": string | null,
"cancellation_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"completed_at": string | null,
"created_at": string | null,
"description": string | null,
"id": string,
"is_completed": boolean,
"is_pinned": boolean,
"lead_id": string,
"new_state": Json | null,
"outcome": string | null,
"performed_at": string | null,
"performed_by": string | null,
"previous_state": Json | null,
"scheduled_at": string | null,
"title": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_activities"
        isOneToOne: true
        isSetofReturn: false
      } },
"resolve_sdr_qualification_call":
{ Args: { "p_activity_id": string,"p_data"?: Json,"p_expected_revision": string,"p_outcome": string }; Returns: {
              "activity_type": string,
"assigned_to": string | null,
"author_name": string | null,
"call_type": string | null,
"cancellation_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"completed_at": string | null,
"created_at": string | null,
"description": string | null,
"id": string,
"is_completed": boolean,
"is_pinned": boolean,
"lead_id": string,
"new_state": Json | null,
"outcome": string | null,
"performed_at": string | null,
"performed_by": string | null,
"previous_state": Json | null,
"scheduled_at": string | null,
"title": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_activities"
        isOneToOne: true
        isSetofReturn: false
      } },
"schedule_closer_call":
{ Args: { "p_assigned_to": string,"p_call_type": string,"p_context"?: string,"p_lead_id": string,"p_scheduled_at": string }; Returns: {
              "activity_type": string,
"assigned_to": string | null,
"author_name": string | null,
"call_type": string | null,
"cancellation_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"completed_at": string | null,
"created_at": string | null,
"description": string | null,
"id": string,
"is_completed": boolean,
"is_pinned": boolean,
"lead_id": string,
"new_state": Json | null,
"outcome": string | null,
"performed_at": string | null,
"performed_by": string | null,
"previous_state": Json | null,
"scheduled_at": string | null,
"title": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_activities"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_daily_goal_task_completed":
{ Args: { "p_completed": boolean,"p_expected_version": number,"p_task_id": string }; Returns: {
              "assignee_id": string,
"checklist_items": NonNullable<Json>,
"completed_at": string | null,
"completed_by": string | null,
"completion_comment": string | null,
"created_at": string,
"created_by": string | null,
"deadline_at": string | null,
"definition_id": string | null,
"id": string,
"is_completed": boolean,
"operational_status": string,
"position": number,
"task_date": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "daily_goal_tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"super_admin_reschedule_sale":
{ Args: { "p_created_at": string,"p_expected_created_at": string,"p_expected_status": string,"p_reason": string,"p_sale_id": string }; Returns: Json
                           },
"traffic_create_suggestion":
{ Args: { "p_body": string,"p_campaign_id"?: string,"p_subject": string }; Returns: string
                           },
"traffic_has_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"traffic_reply_suggestion":
{ Args: { "p_body": string,"p_id": string }; Returns: string
                           },
"traffic_set_suggestion_status":
{ Args: { "p_id": string,"p_status": string }; Returns: undefined
                           },
"update_crm_call":
{ Args: { "p_activity_id": string,"p_assigned_to": string,"p_expected_revision": string,"p_scheduled_at": string }; Returns: {
              "activity_type": string,
"assigned_to": string | null,
"author_name": string | null,
"call_type": string | null,
"cancellation_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"completed_at": string | null,
"created_at": string | null,
"description": string | null,
"id": string,
"is_completed": boolean,
"is_pinned": boolean,
"lead_id": string,
"new_state": Json | null,
"outcome": string | null,
"performed_at": string | null,
"performed_by": string | null,
"previous_state": Json | null,
"scheduled_at": string | null,
"title": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "crm_activities"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            "app_role": "seller"|"executive"|"super_admin"|"closer"|"sdr"|"bdr"|"traffic_manager"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "app_role": ["seller", "executive", "super_admin", "closer", "sdr", "bdr", "traffic_manager"]
          }
        }
} as const
