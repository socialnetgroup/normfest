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
      agent_ai_reports: {
        Row: {
          agent_id: string
          created_at: string
          generated_by: string | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          period_end: string
          period_start: string
          stats_snapshot: Json
          summary: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          generated_by?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          period_end: string
          period_start: string
          stats_snapshot: Json
          summary: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          generated_by?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          period_end?: string
          period_start?: string
          stats_snapshot?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_ai_reports_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_ai_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_attendance: {
        Row: {
          agent_id: string
          created_at: string
          date: string
          hours_worked: number
          id: string
          lost_hours: number
          note: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          date: string
          hours_worked?: number
          id?: string
          lost_hours?: number
          note?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          date?: string
          hours_worked?: number
          id?: string
          lost_hours?: number
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_attendance_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
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
      agent_evaluations: {
        Row: {
          agent_id: string
          call_date: string
          call_duration_minutes: number | null
          call_reference: string | null
          comment: string | null
          created_at: string
          evaluated_by: string | null
          f1_note: string | null
          f1_score: number
          f2_note: string | null
          f2_score: number
          f3_note: string | null
          f3_score: number
          f4_note: string | null
          f4_score: number
          f5_note: string | null
          f5_score: number
          id: string
          total_score: number
        }
        Insert: {
          agent_id: string
          call_date: string
          call_duration_minutes?: number | null
          call_reference?: string | null
          comment?: string | null
          created_at?: string
          evaluated_by?: string | null
          f1_note?: string | null
          f1_score: number
          f2_note?: string | null
          f2_score: number
          f3_note?: string | null
          f3_score: number
          f4_note?: string | null
          f4_score: number
          f5_note?: string | null
          f5_score: number
          id?: string
          total_score: number
        }
        Update: {
          agent_id?: string
          call_date?: string
          call_duration_minutes?: number | null
          call_reference?: string | null
          comment?: string | null
          created_at?: string
          evaluated_by?: string | null
          f1_note?: string | null
          f1_score?: number
          f2_note?: string | null
          f2_score?: number
          f3_note?: string | null
          f3_score?: number
          f4_note?: string | null
          f4_score?: number
          f5_note?: string | null
          f5_score?: number
          id?: string
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_evaluations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      brand_consumption_profiles: {
        Row: {
          brand: string
          category: string
          id: string
          note: string
          source: string | null
          verified: boolean
          weight: number
        }
        Insert: {
          brand: string
          category: string
          id?: string
          note: string
          source?: string | null
          verified?: boolean
          weight?: number
        }
        Update: {
          brand?: string
          category?: string
          id?: string
          note?: string
          source?: string | null
          verified?: boolean
          weight?: number
        }
        Relationships: []
      }
      chat_log: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          role: string
          tool_calls: Json | null
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          role: string
          tool_calls?: Json | null
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          role?: string
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_log_agent_id_fkey"
            columns: ["agent_id"]
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
          brand_focus: string | null
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
          telefon_2: string | null
          telefon_3: string | null
          updated_at: string
          verband: string | null
          website: string | null
        }
        Insert: {
          active?: boolean
          article_count?: number | null
          branche_code?: string | null
          branche_name?: string | null
          brand_focus?: string | null
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
          telefon_2?: string | null
          telefon_3?: string | null
          updated_at?: string
          verband?: string | null
          website?: string | null
        }
        Update: {
          active?: boolean
          article_count?: number | null
          branche_code?: string | null
          branche_name?: string | null
          brand_focus?: string | null
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
          telefon_2?: string | null
          telefon_3?: string | null
          updated_at?: string
          verband?: string | null
          website?: string | null
        }
        Relationships: []
      }
      company_enrichment: {
        Row: {
          analysis_input_tokens: number | null
          analysis_model: string | null
          analysis_output_tokens: number | null
          analysis_raw: Json | null
          analyzed_at: string | null
          brand_focus_guess: string[] | null
          company_id: string
          created_at: string
          external_opportunities: Json | null
          id: string
          places_address: string | null
          places_ambiguous: boolean
          places_candidates: Json | null
          places_name: string | null
          places_phone: string | null
          places_place_id: string | null
          places_rating: number | null
          places_resolved_at: string | null
          places_review_count: number | null
          places_reviews: Json | null
          places_website: string | null
          strengths: string[] | null
          updated_at: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
          weaknesses: string[] | null
          website_fetched_at: string | null
          website_text: string | null
        }
        Insert: {
          analysis_input_tokens?: number | null
          analysis_model?: string | null
          analysis_output_tokens?: number | null
          analysis_raw?: Json | null
          analyzed_at?: string | null
          brand_focus_guess?: string[] | null
          company_id: string
          created_at?: string
          external_opportunities?: Json | null
          id?: string
          places_address?: string | null
          places_ambiguous?: boolean
          places_candidates?: Json | null
          places_name?: string | null
          places_phone?: string | null
          places_place_id?: string | null
          places_rating?: number | null
          places_resolved_at?: string | null
          places_review_count?: number | null
          places_reviews?: Json | null
          places_website?: string | null
          strengths?: string[] | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          weaknesses?: string[] | null
          website_fetched_at?: string | null
          website_text?: string | null
        }
        Update: {
          analysis_input_tokens?: number | null
          analysis_model?: string | null
          analysis_output_tokens?: number | null
          analysis_raw?: Json | null
          analyzed_at?: string | null
          brand_focus_guess?: string[] | null
          company_id?: string
          created_at?: string
          external_opportunities?: Json | null
          id?: string
          places_address?: string | null
          places_ambiguous?: boolean
          places_candidates?: Json | null
          places_name?: string | null
          places_phone?: string | null
          places_place_id?: string | null
          places_rating?: number | null
          places_resolved_at?: string | null
          places_review_count?: number | null
          places_reviews?: Json | null
          places_website?: string | null
          strengths?: string[] | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
          weaknesses?: string[] | null
          website_fetched_at?: string | null
          website_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_enrichment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_enrichment_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_rfm: {
        Row: {
          company_id: string
          computed_at: string | null
          frequency: number | null
          monetary: number | null
          recency_days: number | null
          segment: string | null
        }
        Insert: {
          company_id: string
          computed_at?: string | null
          frequency?: number | null
          monetary?: number | null
          recency_days?: number | null
          segment?: string | null
        }
        Update: {
          company_id?: string
          computed_at?: string | null
          frequency?: number | null
          monetary?: number | null
          recency_days?: number | null
          segment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_rfm_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
      dialer_daily_snapshots: {
        Row: {
          agents: Json
          captured_at: string
          id: string
          snapshot_date: string
        }
        Insert: {
          agents: Json
          captured_at?: string
          id?: string
          snapshot_date: string
        }
        Update: {
          agents?: Json
          captured_at?: string
          id?: string
          snapshot_date?: string
        }
        Relationships: []
      }
      email_list_exclusions: {
        Row: {
          company_id: string
          created_at: string
          excluded_by: string | null
          id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          excluded_by?: string | null
          id?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          excluded_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_list_exclusions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_list_exclusions_excluded_by_fkey"
            columns: ["excluded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_jobs: {
        Row: {
          company_id: string
          created_at: string
          error: string | null
          id: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          error?: string | null
          id?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          error?: string | null
          id?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_list_items: {
        Row: {
          company_id: string
          created_at: string
          focus_list_id: string
          id: string
          note: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          focus_list_id: string
          id?: string
          note?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          focus_list_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "focus_list_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_list_items_focus_list_id_fkey"
            columns: ["focus_list_id"]
            isOneToOne: false
            referencedRelation: "focus_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_list_products: {
        Row: {
          created_at: string
          focus_list_id: string
          id: string
          note: string | null
          product_id: string
        }
        Insert: {
          created_at?: string
          focus_list_id: string
          id?: string
          note?: string | null
          product_id: string
        }
        Update: {
          created_at?: string
          focus_list_id?: string
          id?: string
          note?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_list_products_focus_list_id_fkey"
            columns: ["focus_list_id"]
            isOneToOne: false
            referencedRelation: "focus_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_list_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_lists: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          note: string | null
          pdf_path: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          note?: string | null
          pdf_path?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          note?: string | null
          pdf_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "focus_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          heading: string | null
          id: string
          metadata: Json | null
          search_vector: unknown
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          heading?: string | null
          id?: string
          metadata?: Json | null
          search_vector?: unknown
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          heading?: string | null
          id?: string
          metadata?: Json | null
          search_vector?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "kb_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_documents: {
        Row: {
          collection: string
          created_at: string
          deleted_at: string | null
          id: string
          source_path: string | null
          title: string
          updated_at: string
        }
        Insert: {
          collection: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          source_path?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          collection?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          source_path?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      objection_cards: {
        Row: {
          category: string | null
          created_at: string
          deleted_at: string | null
          id: string
          objection: string
          response_bs: string | null
          response_de: string | null
          source_document_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          objection: string
          response_bs?: string | null
          response_de?: string | null
          source_document_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          objection?: string
          response_bs?: string | null
          response_de?: string | null
          source_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objection_cards_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      product_duplicate_candidates: {
        Row: {
          created_at: string
          id: string
          product_a_id: string
          product_b_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          similarity: number
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_a_id: string
          product_b_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity: number
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          product_a_id?: string
          product_b_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_duplicate_candidates_product_a_id_fkey"
            columns: ["product_a_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_duplicate_candidates_product_b_id_fkey"
            columns: ["product_b_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_duplicate_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_relations: {
        Row: {
          created_at: string
          id: string
          note: string | null
          origin: string
          product_id: string
          related_product_id: string
          relation_type: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          origin?: string
          product_id: string
          related_product_id: string
          relation_type: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          origin?: string
          product_id?: string
          related_product_id?: string
          relation_type?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relations_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
          description_is_generated: boolean
          extraction_confidence: number | null
          id: string
          image_is_representative: boolean
          image_path: string | null
          launched_at: string | null
          name: string
          pack_content: string | null
          pack_qty: number | null
          pack_rank: number | null
          season: string | null
          sku: string
          source: string
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
          description_is_generated?: boolean
          extraction_confidence?: number | null
          id?: string
          image_is_representative?: boolean
          image_path?: string | null
          launched_at?: string | null
          name: string
          pack_content?: string | null
          pack_qty?: number | null
          pack_rank?: number | null
          season?: string | null
          sku: string
          source?: string
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
          description_is_generated?: boolean
          extraction_confidence?: number | null
          id?: string
          image_is_representative?: boolean
          image_path?: string | null
          launched_at?: string | null
          name?: string
          pack_content?: string | null
          pack_qty?: number | null
          pack_rank?: number | null
          season?: string | null
          sku?: string
          source?: string
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
          last_seen_at: string | null
          last_seen_path: string | null
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
          last_seen_at?: string | null
          last_seen_path?: string | null
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
          last_seen_at?: string | null
          last_seen_path?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_feedback: {
        Row: {
          agent_id: string
          comment: string | null
          company_id: string
          created_at: string
          id: string
          objection: string | null
          outcome: string
          product_id: string | null
          qty: number | null
          value_net: number | null
          wiedervorlage_date: string | null
          wiedervorlage_done: boolean
        }
        Insert: {
          agent_id: string
          comment?: string | null
          company_id: string
          created_at?: string
          id?: string
          objection?: string | null
          outcome: string
          product_id?: string | null
          qty?: number | null
          value_net?: number | null
          wiedervorlage_date?: string | null
          wiedervorlage_done?: boolean
        }
        Update: {
          agent_id?: string
          comment?: string | null
          company_id?: string
          created_at?: string
          id?: string
          objection?: string | null
          outcome?: string
          product_id?: string | null
          qty?: number | null
          value_net?: number | null
          wiedervorlage_date?: string | null
          wiedervorlage_done?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sales_feedback_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_feedback_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
      signal_dismissals: {
        Row: {
          company_id: string
          created_at: string
          dismissed_by: string | null
          id: string
          product_id: string | null
          type: string
        }
        Insert: {
          company_id: string
          created_at?: string
          dismissed_by?: string | null
          id?: string
          product_id?: string | null
          type: string
        }
        Update: {
          company_id?: string
          created_at?: string
          dismissed_by?: string | null
          id?: string
          product_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_dismissals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_dismissals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          company_id: string
          created_at: string
          id: string
          origin: string
          product_id: string | null
          reason: string
          score: number
          source: Json | null
          tier: number
          type: string
          verified: boolean
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          origin?: string
          product_id?: string | null
          reason: string
          score?: number
          source?: Json | null
          tier: number
          type: string
          verified?: boolean
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          origin?: string
          product_id?: string | null
          reason?: string
          score?: number
          source?: Json | null
          tier?: number
          type?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "signals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      webshop_products_staging: {
        Row: {
          category_breadcrumb: string | null
          cross_sell_candidates: Json | null
          id: string
          image_hotlink_url: string | null
          image_stored_path: string | null
          matched_product_id: string | null
          name: string
          scraped_at: string
          sku: string
          source_url: string
        }
        Insert: {
          category_breadcrumb?: string | null
          cross_sell_candidates?: Json | null
          id?: string
          image_hotlink_url?: string | null
          image_stored_path?: string | null
          matched_product_id?: string | null
          name: string
          scraped_at?: string
          sku: string
          source_url: string
        }
        Update: {
          category_breadcrumb?: string | null
          cross_sell_candidates?: Json | null
          id?: string
          image_hotlink_url?: string | null
          image_stored_path?: string | null
          matched_product_id?: string | null
          name?: string
          scraped_at?: string
          sku?: string
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webshop_products_staging_matched_product_id_fkey"
            columns: ["matched_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      company_gebiet_coverage: {
        Row: {
          gebiet: string | null
          not_contacted_last_2_months: number | null
          not_contacted_last_3_months: number | null
          not_contacted_this_month: number | null
          total: number | null
        }
        Relationships: []
      }
      company_gebiet_enrichment_coverage: {
        Row: {
          ai_analyzed: number | null
          ambiguous: number | null
          gebiet: string | null
          places_resolved: number | null
          total: number | null
          website_fetched: number | null
        }
        Relationships: []
      }
      feedback_sales: {
        Row: {
          agent_id: string | null
          company_id: string | null
          created_at: string | null
          product_id: string | null
          qty: number | null
          value_net: number | null
        }
        Insert: {
          agent_id?: string | null
          company_id?: string | null
          created_at?: string | null
          product_id?: string | null
          qty?: number | null
          value_net?: number | null
        }
        Update: {
          agent_id?: string | null
          company_id?: string | null
          created_at?: string | null
          product_id?: string | null
          qty?: number | null
          value_net?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_feedback_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_feedback_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_code: string | null
          category_name: string | null
        }
        Relationships: []
      }
      product_winner_stats: {
        Row: {
          last_sold_at: string | null
          product_id: string | null
          sold_count: number | null
          total_qty: number | null
          total_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_feedback_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      fn_bulk_set_image_path: { Args: { pairs: Json }; Returns: undefined }
      fn_bulk_set_matched_product: { Args: { pairs: Json }; Returns: undefined }
      fn_bulk_set_product_category: {
        Args: { pairs: Json }
        Returns: undefined
      }
      fn_bulk_set_product_description: {
        Args: { pairs: Json }
        Returns: undefined
      }
      fn_chat_check_budget_and_log: {
        Args: { p_agent_id: string; p_content: string }
        Returns: {
          allowed: boolean
          daily_budget: number
          used_today: number
        }[]
      }
      fn_chat_get_brand_profile: {
        Args: { p_brand: string }
        Returns: {
          category: string
          note: string
          weight: number
        }[]
      }
      fn_chat_get_company_brief: {
        Args: { p_company_id: string }
        Returns: Json
      }
      fn_chat_list_objection_cards: {
        Args: never
        Returns: {
          category: string
          objection: string
          response_bs: string
          response_de: string
        }[]
      }
      fn_chat_log_sales_feedback: {
        Args: {
          p_comment?: string
          p_company_id: string
          p_objection?: string
          p_outcome: string
          p_product_id?: string
          p_qty?: number
          p_value_net?: number
        }
        Returns: string
      }
      fn_chat_search_companies: {
        Args: { p_query: string }
        Returns: {
          branche_name: string
          id: string
          kundennummer: string
          name: string
          ort: string
          plz: string
        }[]
      }
      fn_chat_search_kb: {
        Args: { p_collection?: string; p_query: string }
        Returns: {
          collection: string
          content: string
          doc_title: string
          heading: string
        }[]
      }
      fn_chat_search_products: {
        Args: { p_category?: string; p_query: string }
        Returns: {
          category_name: string
          description: string
          id: string
          name: string
          pack_content: string
          sku: string
        }[]
      }
      fn_company_gebiet_coverage: {
        Args: never
        Returns: {
          gebiet: string
          not_contacted_last_2_months: number
          not_contacted_last_3_months: number
          not_contacted_this_month: number
          total: number
        }[]
      }
      fn_company_visible: { Args: { p_gebiet: string }; Returns: boolean }
      fn_dashboard_company_counts: {
        Args: never
        Returns: {
          not_contacted_2months: number
          not_contacted_3months: number
          not_contacted_this_month: number
          total_count: number
        }[]
      }
      fn_dashboard_signals: {
        Args: { p_limit?: number }
        Returns: {
          company_id: string
          company_name: string
          id: string
          product_id: string
          reason: string
          score: number
          total_count: number
          type: string
        }[]
      }
      fn_dashboard_signals_count: { Args: never; Returns: number }
      fn_dashboard_top_signals: {
        Args: { p_limit?: number }
        Returns: {
          company_id: string
          company_name: string
          id: string
          product_id: string
          product_name: string
          reason: string
          score: number
          type: string
        }[]
      }
      fn_delete_sales_feedback: { Args: { p_id: string }; Returns: undefined }
      fn_dismiss_signal: {
        Args: { p_company_id: string; p_product_id?: string; p_type: string }
        Returns: undefined
      }
      fn_email_list: {
        Args: { p_gebiet?: string }
        Returns: {
          company_id: string
          company_name: string
          email: string
        }[]
      }
      fn_flag_representative_images: { Args: never; Returns: undefined }
      fn_get_agent_login_status: {
        Args: never
        Returns: {
          agent_id: string
          has_account: boolean
          last_seen_at: string
          last_seen_path: string
          last_sign_in_at: string
        }[]
      }
      fn_heartbeat: { Args: { p_path: string }; Returns: undefined }
      fn_is_admin: { Args: never; Returns: boolean }
      fn_log_call: {
        Args: never
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
      fn_log_sales_feedback: {
        Args: {
          p_comment?: string
          p_company_id: string
          p_objection?: string
          p_outcome: string
          p_product_id?: string
          p_qty?: number
          p_value_net?: number
          p_wiedervorlage_date?: string
        }
        Returns: string
      }
      fn_merge_duplicate_products: {
        Args: { p_keep_id: string; p_remove_id: string }
        Returns: undefined
      }
      fn_refresh_signals: { Args: never; Returns: undefined }
      fn_search_companies: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          call_priority: boolean
          do_not_contact: boolean
          gebiet: string
          id: string
          kundennummer: string
          name: string
          ort: string
          plz: string
          total_count: number
        }[]
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
      fn_set_wiedervorlage_done: {
        Args: { p_done?: boolean; p_id: string }
        Returns: undefined
      }
      fn_update_company_contact: {
        Args: {
          p_company_id: string
          p_email?: string
          p_telefon?: string
          p_telefon_2?: string
          p_telefon_3?: string
          p_website?: string
        }
        Returns: {
          active: boolean
          article_count: number | null
          branche_code: string | null
          branche_name: string | null
          brand_focus: string | null
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
          telefon_2: string | null
          telefon_3: string | null
          updated_at: string
          verband: string | null
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_update_sales_feedback: {
        Args: {
          p_comment?: string
          p_id: string
          p_objection?: string
          p_outcome: string
          p_product_id?: string
          p_qty?: number
          p_value_net?: number
          p_wiedervorlage_date?: string
          p_wiedervorlage_done?: boolean
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
