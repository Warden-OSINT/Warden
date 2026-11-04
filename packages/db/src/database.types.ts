export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alert_settings: {
        Row: {
          created_by: string | null
          id: string
          recipients: Json
          threshold_grade: string
        }
        Insert: {
          created_by?: string | null
          id?: string
          recipients?: Json
          threshold_grade: string
        }
        Update: {
          created_by?: string | null
          id?: string
          recipients?: Json
          threshold_grade?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          channel: string
          id: string
          new_grade: string
          previous_grade: string | null
          score_id: string
          sent_at: string | null
        }
        Insert: {
          alert_type: string
          channel: string
          id?: string
          new_grade: string
          previous_grade?: string | null
          score_id: string
          sent_at?: string | null
        }
        Update: {
          alert_type?: string
          channel?: string
          id?: string
          new_grade?: string
          previous_grade?: string | null
          score_id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_score_id_fkey"
            columns: ["score_id"]
            isOneToOne: false
            referencedRelation: "scores"
            referencedColumns: ["id"]
          },
        ]
      }
      archives: {
        Row: {
          archived_at: string
          company_id: string
          file_hash: string
          id: string
          period_end: string
          period_start: string
          record_count: number
          source_table: string
          storage_path: string
        }
        Insert: {
          archived_at?: string
          company_id: string
          file_hash: string
          id?: string
          period_end: string
          period_start: string
          record_count: number
          source_table: string
          storage_path: string
        }
        Update: {
          archived_at?: string
          company_id?: string
          file_hash?: string
          id?: string
          period_end?: string
          period_start?: string
          record_count?: number
          source_table?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "archives_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_type: string
          attribution_status: string
          company_id: string
          confirmed_by: string | null
          discovery_source: string
          first_seen: string
          id: string
          last_seen: string
          value: string
        }
        Insert: {
          asset_type: string
          attribution_status?: string
          company_id: string
          confirmed_by?: string | null
          discovery_source?: string
          first_seen?: string
          id?: string
          last_seen?: string
          value: string
        }
        Update: {
          asset_type?: string
          attribution_status?: string
          company_id?: string
          confirmed_by?: string | null
          discovery_source?: string
          first_seen?: string
          id?: string
          last_seen?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          entity_id: string | null
          entity_type: string
          id: number
          ip_address: unknown
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          ip_address?: unknown
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          ip_address?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          primary_domain: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          primary_domain: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          primary_domain?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_sources: {
        Row: {
          finding_id: string
          last_seen_scan_id: string | null
          raw_reference: Json | null
          source_key: string
        }
        Insert: {
          finding_id: string
          last_seen_scan_id?: string | null
          raw_reference?: Json | null
          source_key: string
        }
        Update: {
          finding_id?: string
          last_seen_scan_id?: string | null
          raw_reference?: Json | null
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_sources_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_sources_last_seen_scan_id_fkey"
            columns: ["last_seen_scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_sources_source_key_fkey"
            columns: ["source_key"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["source_key"]
          },
        ]
      }
      findings: {
        Row: {
          asset_id: string | null
          company_id: string
          confidence: string
          evidence: Json
          evidence_path: string | null
          fingerprint: string
          id: string
          observed_at: string
          risk_domain_id: number
          scan_id: string
          severity: string
          status: string
          status_by: string | null
          status_reason: string | null
          title: string
        }
        Insert: {
          asset_id?: string | null
          company_id: string
          confidence: string
          evidence?: Json
          evidence_path?: string | null
          fingerprint: string
          id?: string
          observed_at: string
          risk_domain_id: number
          scan_id: string
          severity: string
          status?: string
          status_by?: string | null
          status_reason?: string | null
          title: string
        }
        Update: {
          asset_id?: string | null
          company_id?: string
          confidence?: string
          evidence?: Json
          evidence_path?: string | null
          fingerprint?: string
          id?: string
          observed_at?: string
          risk_domain_id?: number
          scan_id?: string
          severity?: string
          status?: string
          status_by?: string | null
          status_reason?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "findings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_risk_domain_id_fkey"
            columns: ["risk_domain_id"]
            isOneToOne: false
            referencedRelation: "risk_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_status_by_fkey"
            columns: ["status_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_outbox: {
        Row: {
          attempts: number
          created_at: string
          destination: string
          event_type: string
          id: number
          payload: Json
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          destination: string
          event_type: string
          id?: never
          payload: Json
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          destination?: string
          event_type?: string
          id?: never
          payload?: Json
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          role: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          content: Json | null
          context_hash: string | null
          error_message: string | null
          generated_at: string
          id: string
          model_used: string | null
          pdf_path: string | null
          prompt_version: string | null
          requested_at: string
          score_id: string
          status: string
          summary_text: string | null
        }
        Insert: {
          content?: Json | null
          context_hash?: string | null
          error_message?: string | null
          generated_at?: string
          id?: string
          model_used?: string | null
          pdf_path?: string | null
          prompt_version?: string | null
          requested_at?: string
          score_id: string
          status?: string
          summary_text?: string | null
        }
        Update: {
          content?: Json | null
          context_hash?: string | null
          error_message?: string | null
          generated_at?: string
          id?: string
          model_used?: string | null
          pdf_path?: string | null
          prompt_version?: string | null
          requested_at?: string
          score_id?: string
          status?: string
          summary_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_score_id_fkey"
            columns: ["score_id"]
            isOneToOne: true
            referencedRelation: "scores"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_domains: {
        Row: {
          description: string | null
          id: number
          key: string
          name: string
        }
        Insert: {
          description?: string | null
          id?: never
          key: string
          name: string
        }
        Update: {
          description?: string | null
          id?: never
          key?: string
          name?: string
        }
        Relationships: []
      }
      scan_sources: {
        Row: {
          assets_returned: number
          findings_returned: number
          id: string
          items_returned: number
          latency_ms: number | null
          message: string | null
          notices: Json
          scan_id: string
          source_key: string
          status: string
        }
        Insert: {
          assets_returned?: number
          findings_returned?: number
          id?: string
          items_returned?: number
          latency_ms?: number | null
          message?: string | null
          notices?: Json
          scan_id: string
          source_key: string
          status: string
        }
        Update: {
          assets_returned?: number
          findings_returned?: number
          id?: string
          items_returned?: number
          latency_ms?: number | null
          message?: string | null
          notices?: Json
          scan_id?: string
          source_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_sources_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_sources_source_key_fkey"
            columns: ["source_key"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["source_key"]
          },
        ]
      }
      scans: {
        Row: {
          cancelled_by: string | null
          company_id: string
          created_at: string
          current_source: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          raw_payload_hash: string | null
          raw_payload_path: string | null
          requested_by: string | null
          sources_total: number | null
          started_at: string | null
          status: string
          trigger_type: string
          weight_version_id: string | null
        }
        Insert: {
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          current_source?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          raw_payload_hash?: string | null
          raw_payload_path?: string | null
          requested_by?: string | null
          sources_total?: number | null
          started_at?: string | null
          status?: string
          trigger_type: string
          weight_version_id?: string | null
        }
        Update: {
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          current_source?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          raw_payload_hash?: string | null
          raw_payload_path?: string | null
          requested_by?: string | null
          sources_total?: number | null
          started_at?: string | null
          status?: string
          trigger_type?: string
          weight_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scans_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scans_current_source_fkey"
            columns: ["current_source"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["source_key"]
          },
          {
            foreignKeyName: "scans_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scans_weight_version_id_fkey"
            columns: ["weight_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          company_id: string
          frequency: string
          id: string
          is_active: boolean
          next_run_at: string
        }
        Insert: {
          company_id: string
          frequency: string
          id?: string
          is_active?: boolean
          next_run_at: string
        }
        Update: {
          company_id?: string
          frequency?: string
          id?: string
          is_active?: boolean
          next_run_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      score_domains: {
        Row: {
          domain_score: number
          findings_count: number
          grade: string
          risk_domain_id: number
          score_id: string
        }
        Insert: {
          domain_score: number
          findings_count?: number
          grade: string
          risk_domain_id: number
          score_id: string
        }
        Update: {
          domain_score?: number
          findings_count?: number
          grade?: string
          risk_domain_id?: number
          score_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_domains_risk_domain_id_fkey"
            columns: ["risk_domain_id"]
            isOneToOne: false
            referencedRelation: "risk_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_domains_score_id_fkey"
            columns: ["score_id"]
            isOneToOne: false
            referencedRelation: "scores"
            referencedColumns: ["id"]
          },
        ]
      }
      scores: {
        Row: {
          company_id: string
          computed_at: string
          excluded_domains: string[]
          global_score: number
          grade: string
          id: string
          scan_id: string
          weight_version_id: string
        }
        Insert: {
          company_id: string
          computed_at?: string
          excluded_domains?: string[]
          global_score: number
          grade: string
          id?: string
          scan_id: string
          weight_version_id: string
        }
        Update: {
          company_id?: string
          computed_at?: string
          excluded_domains?: string[]
          global_score?: number
          grade?: string
          id?: string
          scan_id?: string
          weight_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: true
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_weight_version_id_fkey"
            columns: ["weight_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_weight_items: {
        Row: {
          confidence_factors: Json
          risk_domain_id: number
          severity_points: Json
          weight: number
          weight_version_id: string
        }
        Insert: {
          confidence_factors?: Json
          risk_domain_id: number
          severity_points?: Json
          weight: number
          weight_version_id: string
        }
        Update: {
          confidence_factors?: Json
          risk_domain_id?: number
          severity_points?: Json
          weight?: number
          weight_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_weight_items_risk_domain_id_fkey"
            columns: ["risk_domain_id"]
            isOneToOne: false
            referencedRelation: "risk_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_weight_items_weight_version_id_fkey"
            columns: ["weight_version_id"]
            isOneToOne: false
            referencedRelation: "scoring_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_weights: {
        Row: {
          created_by: string | null
          effective_from: string
          id: string
          is_active: boolean
          version: number
        }
        Insert: {
          created_by?: string | null
          effective_from?: string
          id?: string
          is_active?: boolean
          version: number
        }
        Update: {
          created_by?: string | null
          effective_from?: string
          id?: string
          is_active?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_weights_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      source_credentials: {
        Row: {
          id: string
          is_valid: boolean | null
          last_checked_at: string | null
          secret_ref: string
          source_key: string
        }
        Insert: {
          id?: string
          is_valid?: boolean | null
          last_checked_at?: string | null
          secret_ref: string
          source_key: string
        }
        Update: {
          id?: string
          is_valid?: boolean | null
          last_checked_at?: string | null
          secret_ref?: string
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_credentials_source_key_fkey"
            columns: ["source_key"]
            isOneToOne: true
            referencedRelation: "sources"
            referencedColumns: ["source_key"]
          },
        ]
      }
      sources: {
        Row: {
          is_enabled: boolean
          is_no_contact: boolean
          license: string | null
          name: string
          risk_domain_id: number
          source_key: string
        }
        Insert: {
          is_enabled?: boolean
          is_no_contact?: boolean
          license?: string | null
          name: string
          risk_domain_id: number
          source_key: string
        }
        Update: {
          is_enabled?: boolean
          is_no_contact?: boolean
          license?: string | null
          name?: string
          risk_domain_id?: number
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_risk_domain_id_fkey"
            columns: ["risk_domain_id"]
            isOneToOne: false
            referencedRelation: "risk_domains"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_scoring_weights: {
        Args: { p_weight_version_id: string }
        Returns: undefined
      }
      app_role: { Args: never; Returns: string }
      cancel_scan: { Args: { p_scan_id: string }; Returns: boolean }
      enqueue_due_scans: { Args: never; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      is_member: { Args: never; Returns: boolean }
      queue_delete: {
        Args: { p_msg_id: number; p_queue: string }
        Returns: boolean
      }
      queue_read: {
        Args: {
          p_quantity: number
          p_queue: string
          p_visibility_timeout: number
        }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      queue_set_vt: {
        Args: {
          p_msg_id: number
          p_queue: string
          p_visibility_timeout: number
        }
        Returns: boolean
      }
      request_report: { Args: { p_score_id: string }; Returns: undefined }
      request_scan: { Args: { p_company_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

