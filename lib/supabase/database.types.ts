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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          adapter: string | null
          commit_sha: string | null
          coverage: Json | null
          created_at: string
          failure_message: string | null
          failure_stage: string | null
          finished_at: string | null
          id: string
          is_seed: boolean
          organization_id: string
          parser_schema_version: number | null
          project_id: string
          repository_name: string | null
          routes_extracted: boolean
          run_id: string
          stage: string | null
          stage_message: string | null
          stage_messages: Json
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          adapter?: string | null
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          failure_message?: string | null
          failure_stage?: string | null
          finished_at?: string | null
          id?: string
          is_seed?: boolean
          organization_id: string
          parser_schema_version?: number | null
          project_id: string
          repository_name?: string | null
          routes_extracted?: boolean
          run_id?: string
          stage?: string | null
          stage_message?: string | null
          stage_messages?: Json
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          adapter?: string | null
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          failure_message?: string | null
          failure_stage?: string | null
          finished_at?: string | null
          id?: string
          is_seed?: boolean
          organization_id?: string
          parser_schema_version?: number | null
          project_id?: string
          repository_name?: string | null
          routes_extracted?: boolean
          run_id?: string
          stage?: string | null
          stage_message?: string | null
          stage_messages?: Json
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_organization_id_fkey"
            columns: ["project_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          id: string
          kinds: string[]
          organization_id: string
          parser_order: number
          source_file_id: string
          target_file_id: string
        }
        Insert: {
          analysis_id: string
          id?: string
          kinds: string[]
          organization_id: string
          parser_order: number
          source_file_id: string
          target_file_id: string
        }
        Update: {
          analysis_id?: string
          id?: string
          kinds?: string[]
          organization_id?: string
          parser_order?: number
          source_file_id?: string
          target_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "edges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_file_id_analysis_id_organization_id_fkey"
            columns: ["source_file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "edges_target_file_id_analysis_id_organization_id_fkey"
            columns: ["target_file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
        ]
      }
      explanations: {
        Row: {
          analysis_id: string
          content: string
          file_id: string
          id: string
          organization_id: string
        }
        Insert: {
          analysis_id: string
          content: string
          file_id: string
          id?: string
          organization_id: string
        }
        Update: {
          analysis_id?: string
          content?: string
          file_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "explanations_file_id_analysis_id_organization_id_fkey"
            columns: ["file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "explanations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          organization_id: string
          role: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          organization_id: string
          role: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "file_roles_file_id_analysis_id_organization_id_fkey"
            columns: ["file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "file_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          commonjs_exports: string[] | null
          extension: string
          fan_in: number
          fan_out: number
          folder: string
          hash: string
          id: string
          kind: string | null
          lines: number
          module: string
          organization_id: string
          parser_order: number
          path: string
        }
        Insert: {
          analysis_id: string
          commonjs_exports?: string[] | null
          extension: string
          fan_in: number
          fan_out: number
          folder: string
          hash: string
          id?: string
          kind?: string | null
          lines: number
          module: string
          organization_id: string
          parser_order: number
          path: string
        }
        Update: {
          analysis_id?: string
          commonjs_exports?: string[] | null
          extension?: string
          fan_in?: number
          fan_out?: number
          folder?: string
          hash?: string
          id?: string
          kind?: string | null
          lines?: number
          module?: string
          organization_id?: string
          parser_order?: number
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          content: string
          id: string
          organization_id: string
        }
        Insert: {
          analysis_id: string
          content: string
          id?: string
          organization_id: string
        }
        Update: {
          analysis_id?: string
          content?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          repository_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          repository_url: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          repository_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          line: number | null
          method: string
          organization_id: string
          parser_order: number | null
          path: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          line?: number | null
          method: string
          organization_id: string
          parser_order?: number | null
          path: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          line?: number | null
          method?: string
          organization_id?: string
          parser_order?: number | null
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_organization_id_fkey"
            columns: ["analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "routes_file_id_analysis_id_organization_id_fkey"
            columns: ["file_id", "analysis_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "organization_id"]
          },
          {
            foreignKeyName: "routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_repository_analysis: {
        Args: {
          p_analysis_id: string
          p_commit_sha?: string
          p_message: string
          p_organization_id: string
          p_run_id: string
          p_stage: string
        }
        Returns: undefined
      }
      begin_repository_analysis: {
        Args: { p_organization_id: string; p_repository_url: string }
        Returns: {
          analysis_id: string
          created: boolean
          run_id: string
          status: string
        }[]
      }
      fail_repository_analysis: {
        Args: {
          p_analysis_id: string
          p_message: string
          p_organization_id: string
          p_run_id: string
          p_stage: string
        }
        Returns: boolean
      }
      read_repository_analysis: {
        Args: { p_analysis_id: string }
        Returns: Json
      }
      restart_repository_analysis: {
        Args: { p_analysis_id: string; p_organization_id: string }
        Returns: {
          analysis_id: string
          created: boolean
          repository_url: string
          run_id: string
          status: string
        }[]
      }
      store_repository_analysis: {
        Args: {
          p_analysis_id: string
          p_organization_id: string
          p_result: Json
          p_run_id: string
        }
        Returns: undefined
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
