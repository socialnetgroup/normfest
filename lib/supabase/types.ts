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
    PostgrestVersion: "14.5"
  }
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
      agent_daily_performance: {
        Row: {
          agent_id: string
          calls_count: number | null
          conversion_rate: number | null
          created_at: string
          date: string
          day_off: boolean
          id: string
          revenue: number
          sales_count: number
          source_file: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          calls_count?: number | null
          conversion_rate?: number | null
          created_at?: string
          date: string
          day_off?: boolean
          id?: string
          revenue?: number
          sales_count?: number
          source_file?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          calls_count?: number | null
          conversion_rate?: number | null
          created_at?: string
          date?: string
          day_off?: boolean
          id?: string
          revenue?: number
          sales_count?: number
          source_file?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_daily_performance_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          gebiet: string
          id: string
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          gebiet: string
          id?: string
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          gebiet?: string
          id?: string
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          article_count: number | null
          branche_code: string | null
          branche_name: string | null
          call_priority: boolean
          cluster: string | null
          created_at: string
          do_not_contact: boolean
          dunning_level: number | null
          email: string | null
          gebiet: string
          gebiet_agent_name: string | null
          gruppe: string | null
          id: string
          kundennummer: string
          land: string
          last_contact_date: string | null
          last_invoice_period: string | null
          last_review_date: string | null
          last_visit_date: string | null
          legacy_gebiet: string | null
          name: string
          name_2: string | null
          order_count: number | null
          ort: string | null
          plz: string | null
          potential_utilization_pct: number | null
          potential_value: number | null
          revenue_current_year: number | null
          revenue_current_year_ds_cod: number | null
          revenue_delta: number | null
          revenue_forecast: number | null
          revenue_prior_prior_year: number | null
          revenue_prior_year: number | null
          size_class: string | null
          soft_deleted_at: string | null
          source_row_number: number | null
          strasse: string | null
          telefon: string | null
          updated_at: string
          verband: string | null
        }
        Insert: {
          active?: boolean
          article_count?: number | null
          branche_code?: string | null
          branche_name?: string | null
          call_priority?: boolean
          cluster?: string | null
          created_at?: string
          do_not_contact?: boolean
          dunning_level?: number | null
          email?: string | null
          gebiet: string
          gebiet_agent_name?: string | null
          gruppe?: string | null
          id?: string
          kundennummer: string
          land?: string
          last_contact_date?: string | null
          last_invoice_period?: string | null
          last_review_date?: string | null
          last_visit_date?: string | null
          legacy_gebiet?: string | null
          name: string
          name_2?: string | null
          order_count?: number | null
          ort?: string | null
          plz?: string | null
          potential_utilization_pct?: number | null
          potential_value?: number | null
          revenue_current_year?: number | null
          revenue_current_year_ds_cod?: number | null
          revenue_delta?: number | null
          revenue_forecast?: number | null
          revenue_prior_prior_year?: number | null
          revenue_prior_year?: number | null
          size_class?: string | null
          soft_deleted_at?: string | null
          source_row_number?: number | null
          strasse?: string | null
          telefon?: string | null
          updated_at?: string
          verband?: string | null
        }
        Update: {
          active?: boolean
          article_count?: number | null
          branche_code?: string | null
          branche_name?: string | null
          call_priority?: boolean
          cluster?: string | null
          created_at?: string
          do_not_contact?: boolean
          dunning_level?: number | null
          email?: string | null
          gebiet?: string
          gebiet_agent_name?: string | null
          gruppe?: string | null
          id?: string
          kundennummer?: string
          land?: string
          last_contact_date?: string | null
          last_invoice_period?: string | null
          last_review_date?: string | null
          last_visit_date?: string | null
          legacy_gebiet?: string | null
          name?: string
          name_2?: string | null
          order_count?: number | null
          ort?: string | null
          plz?: string | null
          potential_utilization_pct?: number | null
          potential_value?: number | null
          revenue_current_year?: number | null
          revenue_current_year_ds_cod?: number | null
          revenue_delta?: number | null
          revenue_forecast?: number | null
          revenue_prior_prior_year?: number | null
          revenue_prior_year?: number | null
          size_class?: string | null
          soft_deleted_at?: string | null
          source_row_number?: number | null
          strasse?: string | null
          telefon?: string | null
          updated_at?: string
          verband?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          note: string | null
          phone: string | null
          role: string | null
          soft_deleted_at: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          note?: string | null
          phone?: string | null
          role?: string | null
          soft_deleted_at?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          note?: string | null
          phone?: string | null
          role?: string | null
          soft_deleted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category_code: string | null
          category_name: string | null
          created_at: string
          description: string | null
          extraction_confidence: number | null
          id: string
          name: string
          pack_content: string | null
          pack_qty: number | null
          sku: string
          source_page: number | null
          subcategory: string | null
          tech_specs: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_code?: string | null
          category_name?: string | null
          created_at?: string
          description?: string | null
          extraction_confidence?: number | null
          id?: string
          name: string
          pack_content?: string | null
          pack_qty?: number | null
          sku: string
          source_page?: number | null
          subcategory?: string | null
          tech_specs?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_code?: string | null
          category_name?: string | null
          created_at?: string
          description?: string | null
          extraction_confidence?: number | null
          id?: string
          name?: string
          pack_content?: string | null
          pack_qty?: number | null
          sku?: string
          source_page?: number | null
          subcategory?: string | null
          tech_specs?: Json
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          full_name: string | null
          gebiet: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          full_name?: string | null
          gebiet?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string | null
          gebiet?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_categories: {
        Row: {
          category_code: string | null
          category_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      fn_company_visible: { Args: { p_gebiet: string }; Returns: boolean }
      fn_is_admin: { Args: never; Returns: boolean }
      fn_log_sale: {
        Args: { p_amount: number }
        Returns: {
          agent_id: string
          calls_count: number | null
          conversion_rate: number | null
          created_at: string
          date: string
          day_off: boolean
          id: string
          revenue: number
          sales_count: number
          source_file: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_daily_performance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_set_day_off: {
        Args: { p_agent_id: string; p_date: string; p_off: boolean }
        Returns: {
          agent_id: string
          calls_count: number | null
          conversion_rate: number | null
          created_at: string
          date: string
          day_off: boolean
          id: string
          revenue: number
          sales_count: number
          source_file: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_daily_performance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
