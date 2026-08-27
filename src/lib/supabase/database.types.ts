export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      alert_access_sessions: {
        Row: {
          alert_id: string;
          created_at: string;
          event_id: string;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          session_hash: string;
        };
        Insert: {
          alert_id: string;
          created_at?: string;
          event_id: string;
          expires_at: string;
          id?: string;
          revoked_at?: string | null;
          session_hash: string;
        };
        Update: {
          alert_id?: string;
          created_at?: string;
          event_id?: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          session_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_access_sessions_alert_id_event_id_fkey";
            columns: ["alert_id", "event_id"];
            isOneToOne: false;
            referencedRelation: "guardian_alerts";
            referencedColumns: ["id", "alert_transition_id"];
          },
        ];
      };
      alert_access_tokens: {
        Row: {
          alert_id: string;
          created_at: string;
          event_id: string;
          exchanged_at: string | null;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          token_hash: string;
        };
        Insert: {
          alert_id: string;
          created_at?: string;
          event_id: string;
          exchanged_at?: string | null;
          expires_at: string;
          id?: string;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          alert_id?: string;
          created_at?: string;
          event_id?: string;
          exchanged_at?: string | null;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_access_tokens_alert_event_fk";
            columns: ["alert_id", "event_id"];
            isOneToOne: false;
            referencedRelation: "guardian_alerts";
            referencedColumns: ["id", "alert_transition_id"];
          },
          {
            foreignKeyName: "alert_access_tokens_alert_id_fkey";
            columns: ["alert_id"];
            isOneToOne: false;
            referencedRelation: "guardian_alerts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alert_access_tokens_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "alert_transitions";
            referencedColumns: ["id"];
          },
        ];
      };
      alert_transition_acknowledgements: {
        Row: {
          acknowledged_at: string;
          alert_transition_id: string;
          created_at: string;
          profile_id: string;
        };
        Insert: {
          acknowledged_at?: string;
          alert_transition_id: string;
          created_at?: string;
          profile_id: string;
        };
        Update: {
          acknowledged_at?: string;
          alert_transition_id?: string;
          created_at?: string;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_transition_acknowledgements_alert_transition_id_fkey";
            columns: ["alert_transition_id"];
            isOneToOne: false;
            referencedRelation: "alert_transitions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alert_transition_acknowledgements_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      alert_transitions: {
        Row: {
          episode_id: string;
          episode_started_at: string;
          from_level: Database["public"]["Enums"]["risk_level"];
          id: string;
          idempotency_key: string;
          occurred_at: string;
          subject_id: string;
          to_level: Database["public"]["Enums"]["risk_level"];
          transition_type: Database["public"]["Enums"]["alert_transition_type"];
        };
        Insert: {
          episode_id: string;
          episode_started_at: string;
          from_level: Database["public"]["Enums"]["risk_level"];
          id?: string;
          idempotency_key: string;
          occurred_at?: string;
          subject_id: string;
          to_level: Database["public"]["Enums"]["risk_level"];
          transition_type: Database["public"]["Enums"]["alert_transition_type"];
        };
        Update: {
          episode_id?: string;
          episode_started_at?: string;
          from_level?: Database["public"]["Enums"]["risk_level"];
          id?: string;
          idempotency_key?: string;
          occurred_at?: string;
          subject_id?: string;
          to_level?: Database["public"]["Enums"]["risk_level"];
          transition_type?: Database["public"]["Enums"]["alert_transition_type"];
        };
        Relationships: [
          {
            foreignKeyName: "alert_transitions_episode_subject_fk";
            columns: ["episode_id", "subject_id"];
            isOneToOne: false;
            referencedRelation: "risk_episodes";
            referencedColumns: ["id", "subject_id"];
          },
          {
            foreignKeyName: "alert_transitions_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      attestation_jobs: {
        Row: {
          attempt_count: number;
          attestation_uid: string | null;
          care_event_id: string | null;
          chain_id: number | null;
          created_at: string;
          error_code: string | null;
          id: string;
          idempotency_key: string;
          issuer: string | null;
          last_attempt_at: string | null;
          lease_until: string | null;
          next_attempt_at: string;
          schema_uid: string | null;
          shelter_checkin_id: string | null;
          shelter_report_id: string | null;
          state: Database["public"]["Enums"]["attestation_job_state"];
          transaction_hash: string | null;
          updated_at: string;
          verified_at: string | null;
        };
        Insert: {
          attempt_count?: number;
          attestation_uid?: string | null;
          care_event_id?: string | null;
          chain_id?: number | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          idempotency_key: string;
          issuer?: string | null;
          last_attempt_at?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          schema_uid?: string | null;
          shelter_checkin_id?: string | null;
          shelter_report_id?: string | null;
          state?: Database["public"]["Enums"]["attestation_job_state"];
          transaction_hash?: string | null;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          attempt_count?: number;
          attestation_uid?: string | null;
          care_event_id?: string | null;
          chain_id?: number | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          idempotency_key?: string;
          issuer?: string | null;
          last_attempt_at?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          schema_uid?: string | null;
          shelter_checkin_id?: string | null;
          shelter_report_id?: string | null;
          state?: Database["public"]["Enums"]["attestation_job_state"];
          transaction_hash?: string | null;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attestation_jobs_care_event_id_fkey";
            columns: ["care_event_id"];
            isOneToOne: false;
            referencedRelation: "care_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attestation_jobs_shelter_checkin_id_fkey";
            columns: ["shelter_checkin_id"];
            isOneToOne: false;
            referencedRelation: "shelter_checkins";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attestation_jobs_shelter_report_id_fkey";
            columns: ["shelter_report_id"];
            isOneToOne: false;
            referencedRelation: "shelter_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      barrier_segments: {
        Row: {
          barrier_type: string;
          confidence: string;
          coverage: string;
          created_at: string;
          geom: unknown;
          id: string;
          observed_at: string | null;
          release_id: string;
          slope_percent: number | null;
          slope_source: string | null;
          source_crs: string;
          source_feature_id: string;
          source_updated_at: string | null;
          target_crs: string;
          unknown_reason: string | null;
        };
        Insert: {
          barrier_type: string;
          confidence: string;
          coverage: string;
          created_at?: string;
          geom: unknown;
          id?: string;
          observed_at?: string | null;
          release_id: string;
          slope_percent?: number | null;
          slope_source?: string | null;
          source_crs: string;
          source_feature_id: string;
          source_updated_at?: string | null;
          target_crs?: string;
          unknown_reason?: string | null;
        };
        Update: {
          barrier_type?: string;
          confidence?: string;
          coverage?: string;
          created_at?: string;
          geom?: unknown;
          id?: string;
          observed_at?: string | null;
          release_id?: string;
          slope_percent?: number | null;
          slope_source?: string | null;
          source_crs?: string;
          source_feature_id?: string;
          source_updated_at?: string | null;
          target_crs?: string;
          unknown_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "barrier_segments_release_id_fkey";
            columns: ["release_id"];
            isOneToOne: false;
            referencedRelation: "spatial_data_releases";
            referencedColumns: ["id"];
          },
        ];
      };
      building_footprints: {
        Row: {
          confidence: string;
          coverage: string;
          created_at: string;
          geom: unknown;
          height_estimation_version: string | null;
          height_is_estimated: boolean;
          height_m: number;
          height_source: string;
          id: string;
          observed_at: string | null;
          release_id: string;
          source_crs: string;
          source_feature_id: string;
          source_updated_at: string | null;
          target_crs: string;
          unknown_reason: string | null;
        };
        Insert: {
          confidence: string;
          coverage: string;
          created_at?: string;
          geom: unknown;
          height_estimation_version?: string | null;
          height_is_estimated?: boolean;
          height_m: number;
          height_source: string;
          id?: string;
          observed_at?: string | null;
          release_id: string;
          source_crs: string;
          source_feature_id: string;
          source_updated_at?: string | null;
          target_crs?: string;
          unknown_reason?: string | null;
        };
        Update: {
          confidence?: string;
          coverage?: string;
          created_at?: string;
          geom?: unknown;
          height_estimation_version?: string | null;
          height_is_estimated?: boolean;
          height_m?: number;
          height_source?: string;
          id?: string;
          observed_at?: string | null;
          release_id?: string;
          source_crs?: string;
          source_feature_id?: string;
          source_updated_at?: string | null;
          target_crs?: string;
          unknown_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "building_footprints_release_id_fkey";
            columns: ["release_id"];
            isOneToOne: false;
            referencedRelation: "spatial_data_releases";
            referencedColumns: ["id"];
          },
        ];
      };
      care_events: {
        Row: {
          alert_transition_id: string | null;
          attestation_state: Database["public"]["Enums"]["attestation_state"];
          attestation_uid: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["care_event_type"];
          hri: number;
          id: string;
          idempotency_key: string;
          issuer: string | null;
          occurred_at: string;
          payload: Json;
          payload_hash: string;
          risk_level: Database["public"]["Enums"]["risk_level"];
          subject_hash: string;
          subject_id: string;
        };
        Insert: {
          alert_transition_id?: string | null;
          attestation_state?: Database["public"]["Enums"]["attestation_state"];
          attestation_uid?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["care_event_type"];
          hri: number;
          id?: string;
          idempotency_key: string;
          issuer?: string | null;
          occurred_at?: string;
          payload: Json;
          payload_hash: string;
          risk_level: Database["public"]["Enums"]["risk_level"];
          subject_hash: string;
          subject_id: string;
        };
        Update: {
          alert_transition_id?: string | null;
          attestation_state?: Database["public"]["Enums"]["attestation_state"];
          attestation_uid?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["care_event_type"];
          hri?: number;
          id?: string;
          idempotency_key?: string;
          issuer?: string | null;
          occurred_at?: string;
          payload?: Json;
          payload_hash?: string;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          subject_hash?: string;
          subject_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "care_events_alert_transition_subject_fk";
            columns: ["alert_transition_id", "subject_id"];
            isOneToOne: false;
            referencedRelation: "alert_transitions";
            referencedColumns: ["id", "subject_id"];
          },
          {
            foreignKeyName: "care_events_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_alerts: {
        Row: {
          accepted_at: string | null;
          alert_transition_id: string;
          attempt_count: number;
          channel: Database["public"]["Enums"]["guardian_channel"];
          claim_token: string | null;
          created_at: string;
          consent_revision: number;
          deep_link_path: string;
          delivered_at: string | null;
          error_code: string | null;
          id: string;
          idempotency_key: string;
          lease_until: string | null;
          next_attempt_at: string | null;
          payload_digest: string;
          provider: string;
          provider_message_id: string | null;
          recipient_ref: string;
          recorded_at: string | null;
          risk_level: Database["public"]["Enums"]["risk_level"];
          sent_at: string | null;
          status: Database["public"]["Enums"]["guardian_alert_status"];
          subject_id: string;
          template_key: Database["public"]["Enums"]["guardian_template"];
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          alert_transition_id: string;
          attempt_count?: number;
          channel: Database["public"]["Enums"]["guardian_channel"];
          claim_token?: string | null;
          created_at?: string;
          consent_revision?: number;
          deep_link_path: string;
          delivered_at?: string | null;
          error_code?: string | null;
          id?: string;
          idempotency_key: string;
          lease_until?: string | null;
          next_attempt_at?: string | null;
          payload_digest: string;
          provider?: string;
          provider_message_id?: string | null;
          recipient_ref: string;
          recorded_at?: string | null;
          risk_level: Database["public"]["Enums"]["risk_level"];
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["guardian_alert_status"];
          subject_id: string;
          template_key: Database["public"]["Enums"]["guardian_template"];
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          alert_transition_id?: string;
          attempt_count?: number;
          channel?: Database["public"]["Enums"]["guardian_channel"];
          claim_token?: string | null;
          created_at?: string;
          consent_revision?: number;
          deep_link_path?: string;
          delivered_at?: string | null;
          error_code?: string | null;
          id?: string;
          idempotency_key?: string;
          lease_until?: string | null;
          next_attempt_at?: string | null;
          payload_digest?: string;
          provider?: string;
          provider_message_id?: string | null;
          recipient_ref?: string;
          recorded_at?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["guardian_alert_status"];
          subject_id?: string;
          template_key?: Database["public"]["Enums"]["guardian_template"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_alerts_alert_transition_id_fkey";
            columns: ["alert_transition_id"];
            isOneToOne: false;
            referencedRelation: "alert_transitions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guardian_alerts_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_notification_preferences: {
        Row: {
          alimtalk_enabled: boolean;
          consent_evidence_id: string | null;
          consent_source: string | null;
          consent_text_version: string | null;
          consented_at: string | null;
          created_at: string;
          revision: number;
          recipient_ref: string | null;
          sms_enabled: boolean;
          subject_id: string;
          updated_at: string;
          withdrawn_at: string | null;
        };
        Insert: {
          alimtalk_enabled?: boolean;
          consent_evidence_id?: string | null;
          consent_source?: string | null;
          consent_text_version?: string | null;
          consented_at?: string | null;
          created_at?: string;
          revision?: number;
          recipient_ref?: string | null;
          sms_enabled?: boolean;
          subject_id: string;
          updated_at?: string;
          withdrawn_at?: string | null;
        };
        Update: {
          alimtalk_enabled?: boolean;
          consent_evidence_id?: string | null;
          consent_source?: string | null;
          consent_text_version?: string | null;
          consented_at?: string | null;
          created_at?: string;
          revision?: number;
          recipient_ref?: string | null;
          sms_enabled?: boolean;
          subject_id?: string;
          updated_at?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_notification_preferences_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: true;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      medication_api_cache: {
        Row: {
          api_kind: string;
          expires_at: string;
          fetched_at: string;
          request_hash: string;
          response: Json;
        };
        Insert: {
          api_kind: string;
          expires_at: string;
          fetched_at?: string;
          request_hash: string;
          response: Json;
        };
        Update: {
          api_kind?: string;
          expires_at?: string;
          fetched_at?: string;
          request_hash?: string;
          response?: Json;
        };
        Relationships: [];
      };
      medication_confirmation_receipts: {
        Row: {
          after_hri: number;
          after_level: Database["public"]["Enums"]["risk_level"];
          before_hri: number | null;
          before_level: Database["public"]["Enums"]["risk_level"] | null;
          confirmed_at: string;
          confirmed_by: string;
          created_at: string;
          medication_ids: string[];
          policy: string;
          request_id: string;
          risk_snapshot_id: number;
          scan_session_id: string | null;
          subject_id: string;
          transition_id: string | null;
        };
        Insert: {
          after_hri: number;
          after_level: Database["public"]["Enums"]["risk_level"];
          before_hri?: number | null;
          before_level?: Database["public"]["Enums"]["risk_level"] | null;
          confirmed_at: string;
          confirmed_by: string;
          created_at?: string;
          medication_ids: string[];
          policy: string;
          request_id: string;
          risk_snapshot_id: number;
          scan_session_id?: string | null;
          subject_id: string;
          transition_id?: string | null;
        };
        Update: {
          after_hri?: number;
          after_level?: Database["public"]["Enums"]["risk_level"];
          before_hri?: number | null;
          before_level?: Database["public"]["Enums"]["risk_level"] | null;
          confirmed_at?: string;
          confirmed_by?: string;
          created_at?: string;
          medication_ids?: string[];
          policy?: string;
          request_id?: string;
          risk_snapshot_id?: number;
          scan_session_id?: string | null;
          subject_id?: string;
          transition_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "medication_confirmation_receipts_confirmed_by_fkey";
            columns: ["confirmed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_confirmation_receipts_risk_snapshot_id_fkey";
            columns: ["risk_snapshot_id"];
            isOneToOne: false;
            referencedRelation: "risk_snapshots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_confirmation_receipts_scan_session_id_fkey";
            columns: ["scan_session_id"];
            isOneToOne: false;
            referencedRelation: "medication_scan_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_confirmation_receipts_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_confirmation_receipts_transition_id_fkey";
            columns: ["transition_id"];
            isOneToOne: false;
            referencedRelation: "alert_transitions";
            referencedColumns: ["id"];
          },
        ];
      };
      medication_image_cleanup_jobs: {
        Row: {
          attempt_count: number;
          cleanup_after: string;
          created_at: string;
          error_code: string | null;
          id: string;
          image_path: string;
          lease_token: string | null;
          lease_until: string | null;
          session_id: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          cleanup_after: string;
          created_at: string;
          error_code?: string | null;
          id: string;
          image_path: string;
          lease_token?: string | null;
          lease_until?: string | null;
          session_id: string;
          state?: string;
          updated_at: string;
        };
        Update: {
          attempt_count?: number;
          cleanup_after?: string;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          image_path?: string;
          lease_token?: string | null;
          lease_until?: string | null;
          session_id?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      medication_scan_sessions: {
        Row: {
          attempt_count: number;
          candidate_payload: Json;
          created_at: string;
          created_by: string | null;
          id: string;
          image_deleted_at: string | null;
          image_path: string | null;
          image_purge_attempt_count: number;
          image_purge_claimed_at: string | null;
          image_purge_error_code: string | null;
          image_purge_next_attempt_at: string;
          image_purge_state: string;
          image_quality: Database["public"]["Enums"]["medication_image_quality"] | null;
          input_method: string;
          model_id: string | null;
          purge_after: string;
          status: Database["public"]["Enums"]["medication_scan_status"];
          subject_id: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          candidate_payload?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          image_deleted_at?: string | null;
          image_path?: string | null;
          image_purge_attempt_count?: number;
          image_purge_claimed_at?: string | null;
          image_purge_error_code?: string | null;
          image_purge_next_attempt_at?: string;
          image_purge_state?: string;
          image_quality?: Database["public"]["Enums"]["medication_image_quality"] | null;
          input_method?: string;
          model_id?: string | null;
          purge_after?: string;
          status?: Database["public"]["Enums"]["medication_scan_status"];
          subject_id: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          candidate_payload?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          image_deleted_at?: string | null;
          image_path?: string | null;
          image_purge_attempt_count?: number;
          image_purge_claimed_at?: string | null;
          image_purge_error_code?: string | null;
          image_purge_next_attempt_at?: string;
          image_purge_state?: string;
          image_quality?: Database["public"]["Enums"]["medication_image_quality"] | null;
          input_method?: string;
          model_id?: string | null;
          purge_after?: string;
          status?: Database["public"]["Enums"]["medication_scan_status"];
          subject_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "medication_scan_sessions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medication_scan_sessions_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      medications: {
        Row: {
          confidence: number | null;
          confirmed_by: string | null;
          created_at: string;
          heat_class: string | null;
          id: string;
          ingredient_name: string | null;
          item_seq: string | null;
          product_name: string;
          risk_tier: Database["public"]["Enums"]["medication_risk_tier"];
          scan_session_id: string | null;
          source: Database["public"]["Enums"]["medication_source"];
          subject_id: string;
          updated_at: string;
        };
        Insert: {
          confidence?: number | null;
          confirmed_by?: string | null;
          created_at?: string;
          heat_class?: string | null;
          id?: string;
          ingredient_name?: string | null;
          item_seq?: string | null;
          product_name: string;
          risk_tier: Database["public"]["Enums"]["medication_risk_tier"];
          scan_session_id?: string | null;
          source: Database["public"]["Enums"]["medication_source"];
          subject_id: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number | null;
          confirmed_by?: string | null;
          created_at?: string;
          heat_class?: string | null;
          id?: string;
          ingredient_name?: string | null;
          item_seq?: string | null;
          product_name?: string;
          risk_tier?: Database["public"]["Enums"]["medication_risk_tier"];
          scan_session_id?: string | null;
          source?: Database["public"]["Enums"]["medication_source"];
          subject_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "medications_confirmed_by_fkey";
            columns: ["confirmed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medications_scan_session_id_fkey";
            columns: ["scan_session_id"];
            isOneToOne: false;
            referencedRelation: "medication_scan_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "medications_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["profile_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["profile_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["profile_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      rest_spots: {
        Row: {
          confidence: string;
          coverage: string;
          created_at: string;
          geom: unknown;
          id: string;
          observed_at: string | null;
          release_id: string;
          rest_type: string;
          source_crs: string;
          source_feature_id: string;
          source_updated_at: string | null;
          target_crs: string;
          unknown_reason: string | null;
        };
        Insert: {
          confidence: string;
          coverage: string;
          created_at?: string;
          geom: unknown;
          id?: string;
          observed_at?: string | null;
          release_id: string;
          rest_type: string;
          source_crs: string;
          source_feature_id: string;
          source_updated_at?: string | null;
          target_crs?: string;
          unknown_reason?: string | null;
        };
        Update: {
          confidence?: string;
          coverage?: string;
          created_at?: string;
          geom?: unknown;
          id?: string;
          observed_at?: string | null;
          release_id?: string;
          rest_type?: string;
          source_crs?: string;
          source_feature_id?: string;
          source_updated_at?: string | null;
          target_crs?: string;
          unknown_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rest_spots_release_id_fkey";
            columns: ["release_id"];
            isOneToOne: false;
            referencedRelation: "spatial_data_releases";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_batch_locks: {
        Row: {
          acquired_at: string;
          lease_until: string;
          lock_key: string;
          owner_id: string;
        };
        Insert: {
          acquired_at: string;
          lease_until: string;
          lock_key: string;
          owner_id: string;
        };
        Update: {
          acquired_at?: string;
          lease_until?: string;
          lock_key?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      risk_batch_runs: {
        Row: {
          created_at: string;
          duplicate_snapshots: number;
          failed_subject_ids: string[];
          failed_subjects: number;
          finished_at: string;
          id: string;
          started_at: string;
          status: string;
          succeeded_subjects: number;
          total_subjects: number;
          transition_count: number;
        };
        Insert: {
          created_at?: string;
          duplicate_snapshots: number;
          failed_subject_ids?: string[];
          failed_subjects: number;
          finished_at: string;
          id: string;
          started_at: string;
          status: string;
          succeeded_subjects: number;
          total_subjects: number;
          transition_count: number;
        };
        Update: {
          created_at?: string;
          duplicate_snapshots?: number;
          failed_subject_ids?: string[];
          failed_subjects?: number;
          finished_at?: string;
          id?: string;
          started_at?: string;
          status?: string;
          succeeded_subjects?: number;
          total_subjects?: number;
          transition_count?: number;
        };
        Relationships: [];
      };
      risk_episodes: {
        Row: {
          created_at: string;
          ended_at: string | null;
          entry_level: Database["public"]["Enums"]["risk_level"];
          id: string;
          started_at: string;
          subject_id: string;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          entry_level: Database["public"]["Enums"]["risk_level"];
          id?: string;
          started_at: string;
          subject_id: string;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          entry_level?: Database["public"]["Enums"]["risk_level"];
          id?: string;
          started_at?: string;
          subject_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_episodes_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_recompute_queue: {
        Row: {
          attempt_count: number;
          error_code: string | null;
          lease_until: string | null;
          next_attempt_at: string;
          processed_at: string | null;
          requested_at: string;
          shelter_checkin_id: string;
          subject_id: string;
        };
        Insert: {
          attempt_count?: number;
          error_code?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          processed_at?: string | null;
          requested_at?: string;
          shelter_checkin_id: string;
          subject_id: string;
        };
        Update: {
          attempt_count?: number;
          error_code?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          processed_at?: string | null;
          requested_at?: string;
          shelter_checkin_id?: string;
          subject_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_recompute_queue_shelter_checkin_id_fkey";
            columns: ["shelter_checkin_id"];
            isOneToOne: true;
            referencedRelation: "shelter_checkins";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_recompute_queue_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_snapshots: {
        Row: {
          breakdown: Json;
          bucket_start: string;
          computed_at: string;
          hri: number;
          id: number;
          input_hash: string;
          level: Database["public"]["Enums"]["risk_level"];
          reasons: string[];
          subject_id: string;
          weather_snapshot_id: number;
        };
        Insert: {
          breakdown: Json;
          bucket_start: string;
          computed_at?: string;
          hri: number;
          id?: number;
          input_hash: string;
          level: Database["public"]["Enums"]["risk_level"];
          reasons: string[];
          subject_id: string;
          weather_snapshot_id: number;
        };
        Update: {
          breakdown?: Json;
          bucket_start?: string;
          computed_at?: string;
          hri?: number;
          id?: number;
          input_hash?: string;
          level?: Database["public"]["Enums"]["risk_level"];
          reasons?: string[];
          subject_id?: string;
          weather_snapshot_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "risk_snapshots_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_snapshots_weather_snapshot_id_fkey";
            columns: ["weather_snapshot_id"];
            isOneToOne: false;
            referencedRelation: "weather_snapshots";
            referencedColumns: ["id"];
          },
        ];
      };
      route_cache: {
        Row: {
          cache_key: string;
          created_at: string;
          destination_shelter_id: string;
          expires_at: string;
          route_result: Json;
          solar_bucket: string;
          spatial_version: string;
        };
        Insert: {
          cache_key: string;
          created_at?: string;
          destination_shelter_id: string;
          expires_at: string;
          route_result: Json;
          solar_bucket: string;
          spatial_version: string;
        };
        Update: {
          cache_key?: string;
          created_at?: string;
          destination_shelter_id?: string;
          expires_at?: string;
          route_result?: Json;
          solar_bucket?: string;
          spatial_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "route_cache_destination_shelter_id_fkey";
            columns: ["destination_shelter_id"];
            isOneToOne: false;
            referencedRelation: "shelters";
            referencedColumns: ["id"];
          },
        ];
      };
      shelter_checkins: {
        Row: {
          actor_ref_hash: string;
          actor_scope: Database["public"]["Enums"]["checkin_actor_scope"];
          attestation_state: Database["public"]["Enums"]["attestation_state"];
          attestation_uid: string | null;
          attestation_verified_at: string | null;
          checked_in_at: string;
          client_request_id: string | null;
          created_at: string;
          id: string;
          shelter_id: string;
          subject_id: string;
        };
        Insert: {
          actor_ref_hash: string;
          actor_scope: Database["public"]["Enums"]["checkin_actor_scope"];
          attestation_state?: Database["public"]["Enums"]["attestation_state"];
          attestation_uid?: string | null;
          attestation_verified_at?: string | null;
          checked_in_at: string;
          client_request_id?: string | null;
          created_at?: string;
          id?: string;
          shelter_id: string;
          subject_id: string;
        };
        Update: {
          actor_ref_hash?: string;
          actor_scope?: Database["public"]["Enums"]["checkin_actor_scope"];
          attestation_state?: Database["public"]["Enums"]["attestation_state"];
          attestation_uid?: string | null;
          attestation_verified_at?: string | null;
          checked_in_at?: string;
          client_request_id?: string | null;
          created_at?: string;
          id?: string;
          shelter_id?: string;
          subject_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shelter_checkins_shelter_id_fkey";
            columns: ["shelter_id"];
            isOneToOne: false;
            referencedRelation: "shelters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shelter_checkins_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      shelter_reports: {
        Row: {
          attestation_state: Database["public"]["Enums"]["attestation_state"];
          attestation_uid: string | null;
          client_request_id: string;
          created_at: string;
          crowd_level: number | null;
          id: string;
          is_open: boolean;
          observed_at: string;
          reporter_hash: string;
          shelter_id: string;
        };
        Insert: {
          attestation_state?: Database["public"]["Enums"]["attestation_state"];
          attestation_uid?: string | null;
          client_request_id: string;
          created_at?: string;
          crowd_level?: number | null;
          id?: string;
          is_open: boolean;
          observed_at: string;
          reporter_hash: string;
          shelter_id: string;
        };
        Update: {
          attestation_state?: Database["public"]["Enums"]["attestation_state"];
          attestation_uid?: string | null;
          client_request_id?: string;
          created_at?: string;
          crowd_level?: number | null;
          id?: string;
          is_open?: boolean;
          observed_at?: string;
          reporter_hash?: string;
          shelter_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shelter_reports_shelter_id_fkey";
            columns: ["shelter_id"];
            isOneToOne: false;
            referencedRelation: "shelters";
            referencedColumns: ["id"];
          },
        ];
      };
      shelters: {
        Row: {
          facility_type: string;
          geocode_result: string;
          gu: string;
          id: string;
          imported_at: string;
          is_im_bank: boolean;
          kma_nx: number;
          kma_ny: number;
          location: unknown;
          name: string;
          road_address: string;
          source_geo_idn: string;
          updated_at: string;
        };
        Insert: {
          facility_type: string;
          geocode_result: string;
          gu: string;
          id: string;
          imported_at?: string;
          is_im_bank?: boolean;
          kma_nx: number;
          kma_ny: number;
          location: unknown;
          name: string;
          road_address: string;
          source_geo_idn: string;
          updated_at?: string;
        };
        Update: {
          facility_type?: string;
          geocode_result?: string;
          gu?: string;
          id?: string;
          imported_at?: string;
          is_im_bank?: boolean;
          kma_nx?: number;
          kma_ny?: number;
          location?: unknown;
          name?: string;
          road_address?: string;
          source_geo_idn?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      spatial_data_releases: {
        Row: {
          activated_at: string | null;
          active: boolean;
          attribution: string;
          confidence: string;
          coverage: string;
          coverage_geom: unknown;
          dataset: string;
          expected_feature_count: number | null;
          id: string;
          import_completed_at: string | null;
          imported_at: string;
          quality_audit: Json;
          quality_checked_at: string | null;
          source_crs: string;
          source_license: string;
          source_name: string;
          source_updated_at: string | null;
          source_url: string;
          target_crs: string;
          unknown_reason: string | null;
          version: string;
        };
        Insert: {
          activated_at?: string | null;
          active?: boolean;
          attribution?: string;
          confidence: string;
          coverage: string;
          coverage_geom?: unknown;
          dataset: string;
          expected_feature_count?: number | null;
          id?: string;
          import_completed_at?: string | null;
          imported_at?: string;
          quality_audit?: Json;
          quality_checked_at?: string | null;
          source_crs: string;
          source_license: string;
          source_name: string;
          source_updated_at?: string | null;
          source_url: string;
          target_crs?: string;
          unknown_reason?: string | null;
          version: string;
        };
        Update: {
          activated_at?: string | null;
          active?: boolean;
          attribution?: string;
          confidence?: string;
          coverage?: string;
          coverage_geom?: unknown;
          dataset?: string;
          expected_feature_count?: number | null;
          id?: string;
          import_completed_at?: string | null;
          imported_at?: string;
          quality_audit?: Json;
          quality_checked_at?: string | null;
          source_crs?: string;
          source_license?: string;
          source_name?: string;
          source_updated_at?: string | null;
          source_url?: string;
          target_crs?: string;
          unknown_reason?: string | null;
          version?: string;
        };
        Relationships: [];
      };
      subject_assignments: {
        Row: {
          assigned_at: string;
          organization_id: string;
          profile_id: string;
          subject_id: string;
        };
        Insert: {
          assigned_at?: string;
          organization_id: string;
          profile_id: string;
          subject_id: string;
        };
        Update: {
          assigned_at?: string;
          organization_id?: string;
          profile_id?: string;
          subject_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subject_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subject_assignments_organization_id_profile_id_fkey";
            columns: ["organization_id", "profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "subject_assignments_organization_id_subject_id_fkey";
            columns: ["organization_id", "subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      subject_registration_receipts: {
        Row: {
          actor_profile_id: string | null;
          command_hash: string;
          created_at: string;
          organization_id: string;
          request_id: string;
          subject_id: string | null;
        };
        Insert: {
          actor_profile_id?: string | null;
          command_hash: string;
          created_at?: string;
          organization_id: string;
          request_id: string;
          subject_id?: string | null;
        };
        Update: {
          actor_profile_id?: string | null;
          command_hash?: string;
          created_at?: string;
          organization_id?: string;
          request_id?: string;
          subject_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subject_registration_receipts_organization_id_actor_profile_id_fkey";
            columns: ["organization_id", "actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "subject_registration_receipts_organization_id_subject_id_fkey";
            columns: ["organization_id", "subject_id"];
            isOneToOne: true;
            referencedRelation: "subjects";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      subjects: {
        Row: {
          address: string;
          birth_year: number;
          chronic_disease: boolean;
          consented_at: string;
          created_at: string;
          guardian_phone: string | null;
          has_cooling: boolean;
          id: string;
          kma_nx: number;
          kma_ny: number;
          lives_alone: boolean;
          location: unknown;
          medication_profile_registered_at: string | null;
          name: string;
          organization_id: string;
          phone: string | null;
          pii_updated_at: string;
          senior_mode: boolean;
          sex: Database["public"]["Enums"]["subject_sex"];
          updated_at: string;
        };
        Insert: {
          address: string;
          birth_year: number;
          chronic_disease?: boolean;
          consented_at: string;
          created_at?: string;
          guardian_phone?: string | null;
          has_cooling?: boolean;
          id?: string;
          kma_nx: number;
          kma_ny: number;
          lives_alone?: boolean;
          location: unknown;
          medication_profile_registered_at?: string | null;
          name: string;
          organization_id: string;
          phone?: string | null;
          pii_updated_at?: string;
          senior_mode?: boolean;
          sex: Database["public"]["Enums"]["subject_sex"];
          updated_at?: string;
        };
        Update: {
          address?: string;
          birth_year?: number;
          chronic_disease?: boolean;
          consented_at?: string;
          created_at?: string;
          guardian_phone?: string | null;
          has_cooling?: boolean;
          id?: string;
          kma_nx?: number;
          kma_ny?: number;
          lives_alone?: boolean;
          location?: unknown;
          medication_profile_registered_at?: string | null;
          name?: string;
          organization_id?: string;
          phone?: string | null;
          pii_updated_at?: string;
          senior_mode?: boolean;
          sex?: Database["public"]["Enums"]["subject_sex"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subjects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      weather_snapshots: {
        Row: {
          advisory: Database["public"]["Enums"]["heat_advisory"];
          collected_at: string;
          error_code: string | null;
          expires_at: string;
          feels_like_c: number;
          humidity_pct: number;
          id: number;
          is_partial: boolean;
          is_stale: boolean;
          kma_nx: number;
          kma_ny: number;
          location: unknown;
          location_key: string;
          observed_at: string;
          source: Database["public"]["Enums"]["weather_source"];
          temperature_c: number;
          tropical_night_streak: number;
        };
        Insert: {
          advisory?: Database["public"]["Enums"]["heat_advisory"];
          collected_at?: string;
          error_code?: string | null;
          expires_at: string;
          feels_like_c: number;
          humidity_pct: number;
          id?: number;
          is_partial?: boolean;
          is_stale?: boolean;
          kma_nx: number;
          kma_ny: number;
          location: unknown;
          location_key: string;
          observed_at: string;
          source: Database["public"]["Enums"]["weather_source"];
          temperature_c: number;
          tropical_night_streak?: number;
        };
        Update: {
          advisory?: Database["public"]["Enums"]["heat_advisory"];
          collected_at?: string;
          error_code?: string | null;
          expires_at?: string;
          feels_like_c?: number;
          humidity_pct?: number;
          id?: number;
          is_partial?: boolean;
          is_stale?: boolean;
          kma_nx?: number;
          kma_ny?: number;
          location?: unknown;
          location_key?: string;
          observed_at?: string;
          source?: Database["public"]["Enums"]["weather_source"];
          temperature_c?: number;
          tropical_night_streak?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      append_vworld_building_import: {
        Args: { p_features: Json; p_release_id: string };
        Returns: Json;
      };
      attach_medication_image_session: {
        Args: {
          p_attached_at: string;
          p_cleanup_job_id: string;
          p_image_path: string;
          p_profile_id: string;
          p_session_id: string;
          p_subject_id: string;
        };
        Returns: string;
      };
      begin_vworld_building_import: {
        Args: { p_audit: Json; p_manifest: Json };
        Returns: Json;
      };
      claim_attestation_jobs: {
        Args: { p_lease_until: string; p_limit: number; p_now: string };
        Returns: {
          attempt_count: number;
          idempotency_key: string;
          job_id: string;
          lease_until: string;
          target_id: string;
          target_kind: string;
        }[];
      };
      claim_guardian_alert_outbox: {
        Args: { p_lease_until: string; p_limit: number; p_now: string };
        Returns: {
          alert_id: string;
          attempt_count: number;
          channel: Database["public"]["Enums"]["guardian_channel"];
          claim_token: string;
          consent_revision: number;
          event_id: string;
          idempotency_key: string;
          lease_until: string;
          recipient_ref: string;
          risk_level: Database["public"]["Enums"]["risk_level"];
          template_key: Database["public"]["Enums"]["guardian_template"];
        }[];
      };
      claim_medication_image_cleanups: {
        Args: { p_batch_limit: number; p_now: string };
        Returns: {
          attempt_count: number;
          cleanup_job_id: string;
          image_path: string;
          lease_token: string;
        }[];
      };
      claim_risk_recompute_queue: {
        Args: { p_lease_until: string; p_limit: number; p_now: string };
        Returns: {
          attempt_count: number;
          lease_until: string;
          shelter_checkin_id: string;
          subject_id: string;
        }[];
      };
      commit_risk_computation: { Args: { p_command: Json }; Returns: Json };
      confirm_medication_scan: { Args: { p_command: Json }; Returns: Json };
      consume_alert_access_token: {
        Args: {
          p_event_id: string;
          p_now: string;
          p_session_expires_at: string;
          p_session_hash: string;
          p_token_hash: string;
        };
        Returns: boolean;
      };
      create_pending_shelter_checkin: {
        Args: {
          p_actor_ref_hash: string;
          p_actor_scope: Database["public"]["Enums"]["checkin_actor_scope"];
          p_checked_in_at: string;
          p_client_request_id: string;
          p_shelter_id: string;
          p_subject_id: string;
        };
        Returns: {
          attestation_job_state: Database["public"]["Enums"]["attestation_job_state"];
          attestation_state: Database["public"]["Enums"]["attestation_state"];
          checkin_id: string;
        }[];
      };
      finalize_attestation_job: {
        Args: {
          p_expected_lease_until: string;
          p_job_id: string;
          p_outcome: Json;
        };
        Returns: {
          disposition: string;
          state: Database["public"]["Enums"]["attestation_job_state"];
        }[];
      };
      finalize_vworld_building_import: {
        Args: { p_release_id: string };
        Returns: Json;
      };
      finalize_guardian_alert_outbox: {
        Args: {
          p_alert_id: string;
          p_claim_token: string;
          p_expected_lease_until: string;
          p_outcome: Json;
        };
        Returns: {
          disposition: string;
          status: Database["public"]["Enums"]["guardian_alert_status"];
        }[];
      };
      finalize_medication_image_cleanup: {
        Args: {
          p_cleanup_job_id: string;
          p_deleted: boolean;
          p_error_code: string;
          p_lease_token: string;
          p_now: string;
        };
        Returns: string;
      };
      finalize_risk_recompute_queue: {
        Args: {
          p_completed_at: string;
          p_error_code?: string;
          p_expected_lease_until: string;
          p_shelter_checkin_id: string;
          p_succeeded: boolean;
        };
        Returns: string;
      };
      get_shelter_by_id: {
        Args: { p_shelter_id: string };
        Returns: {
          facility_type: string;
          gu: string;
          is_im_bank: boolean;
          latitude: number;
          longitude: number;
          road_address: string;
          shelter_id: string;
          shelter_name: string;
        }[];
      };
      get_subject_shelter_origin: {
        Args: { p_subject_id: string };
        Returns: {
          latitude: number;
          longitude: number;
        }[];
      };
      import_phase6_spatial_release: {
        Args: { p_audit: Json; p_features: Json; p_manifest: Json };
        Returns: Json;
      };
      load_risk_history: {
        Args: { p_computed_at: string; p_subject_id: string };
        Returns: Json;
      };
      load_risk_subject_core: {
        Args: { p_computed_at: string; p_subject_id: string };
        Returns: Json;
      };
      prepare_medication_image_cleanup: {
        Args: {
          p_cleanup_job_id: string;
          p_image_path: string;
          p_prepared_at: string;
          p_session_id: string;
        };
        Returns: string;
      };
      recheck_guardian_alert_eligibility: {
        Args: {
          p_alert_id: string;
          p_checked_at: string;
          p_claim_token: string;
          p_expected_consent_revision: number;
          p_expected_lease_until: string;
        };
        Returns: {
          disposition: string;
          reason_code: string;
        }[];
      };
      release_risk_batch_lock: {
        Args: { p_lock_key: string; p_owner_id: string };
        Returns: boolean;
      };
      replace_medication_image_session: {
        Args: {
          p_cleanup_job_id: string;
          p_expected_attempt_count: number;
          p_new_image_path: string;
          p_profile_id: string;
          p_replaced_at: string;
          p_session_id: string;
          p_subject_id: string;
        };
        Returns: number;
      };
      replace_medication_review_candidate: {
        Args: { p_command: Json };
        Returns: string;
      };
      replace_alert_access_grant: {
        Args: {
          p_alert_id: string;
          p_claim_token: string;
          p_event_id: string;
          p_expected_lease_until: string;
          p_expires_at: string;
          p_token_hash: string;
        };
        Returns: boolean;
      };
      register_subject_service_role: {
        Args: { p_command: Json };
        Returns: string;
      };
      resolve_alert_subject_session: {
        Args: { p_now: string; p_session_hash: string };
        Returns: {
          expires_at: string;
          session_id: string;
          subject_id: string;
        }[];
      };
      route_spatial_context: {
        Args: { p_buffer_m?: number; p_route: unknown };
        Returns: Json;
      };
      route_spatial_context_at_time: {
        Args: {
          p_buffer_m: number;
          p_max_shadow_m: number;
          p_route: unknown;
          p_shadow_factor: number;
        };
        Returns: Json;
      };
      run_retention_cleanup: {
        Args: { p_batch_limit: number; p_now: string };
        Returns: Json;
      };
      search_shelters: {
        Args: {
          p_gu: string;
          p_im_bank_only: boolean;
          p_lat: number;
          p_limit: number;
          p_lng: number;
          p_open_state: string;
          p_radius_m: number;
          p_sort: string;
        };
        Returns: {
          attestation_state: Database["public"]["Enums"]["attestation_state"];
          attestation_uid: string;
          crowd_level: number;
          distance_m: number;
          facility_type: string;
          gu: string;
          is_im_bank: boolean;
          latitude: number;
          longitude: number;
          operating_state: string;
          report_observed_at: string;
          road_address: string;
          shelter_id: string;
          shelter_name: string;
          walk_minutes: number;
        }[];
      };
      submit_shelter_report: {
        Args: {
          p_client_request_id: string;
          p_crowd_level: number;
          p_is_open: boolean;
          p_reporter_hash: string;
          p_shelter_id: string;
        };
        Returns: {
          attestation_job_state: Database["public"]["Enums"]["attestation_job_state"];
          attestation_state: Database["public"]["Enums"]["attestation_state"];
          outcome: string;
          report_id: string;
          retry_after: string;
        }[];
      };
      try_acquire_risk_batch_lock: {
        Args: {
          p_acquired_at: string;
          p_lease_until: string;
          p_lock_key: string;
          p_owner_id: string;
        };
        Returns: boolean;
      };
      validate_phase6_spatial_data: { Args: never; Returns: Json };
    };
    Enums: {
      alert_transition_type: "ENTER" | "ESCALATE" | "PERSIST_2H";
      attestation_job_state: "PENDING" | "PROCESSING" | "RETRY_WAIT" | "VERIFIED" | "FAILED";
      attestation_state: "UNVERIFIED" | "PENDING" | "VERIFIED" | "FAILED";
      care_event_type: "VISIT" | "SHELTER_CHECKIN" | "ALERT_SENT";
      checkin_actor_scope: "CAREGIVER" | "SUBJECT_SCOPED";
      guardian_alert_status:
        | "QUEUED"
        | "PROCESSING"
        | "DEMO_RECORDED"
        | "ACCEPTED"
        | "DELIVERED"
        | "RETRY_WAIT"
        | "FAILED_PERMANENT"
        | "SUPPRESSED";
      guardian_channel: "SMS" | "ALIMTALK";
      guardian_template: "HEAT_L3" | "HEAT_L4";
      heat_advisory: "NONE" | "WATCH" | "WARNING";
      medication_image_quality: "GOOD" | "BLURRY" | "PARTIAL" | "UNREADABLE";
      medication_risk_tier: "HIGH" | "MID" | "NONE";
      medication_scan_status:
        | "UPLOADED"
        | "EXTRACTING"
        | "NEEDS_RETAKE"
        | "NEEDS_CONFIRMATION"
        | "MANUAL_REQUIRED"
        | "COMPLETED"
        | "FAILED";
      medication_source: "AI_AUTO" | "AI_CONFIRMED" | "MANUAL";
      profile_role: "ADMIN" | "CARE_WORKER";
      risk_level: "L0" | "L1" | "L2" | "L3" | "L4";
      subject_sex: "FEMALE" | "MALE" | "OTHER" | "UNDISCLOSED";
      weather_source: "KMA_APIHUB_500M" | "KMA_VILLAGE_FCST";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      alert_transition_type: ["ENTER", "ESCALATE", "PERSIST_2H"],
      attestation_job_state: ["PENDING", "PROCESSING", "RETRY_WAIT", "VERIFIED", "FAILED"],
      attestation_state: ["UNVERIFIED", "PENDING", "VERIFIED", "FAILED"],
      care_event_type: ["VISIT", "SHELTER_CHECKIN", "ALERT_SENT"],
      checkin_actor_scope: ["CAREGIVER", "SUBJECT_SCOPED"],
      guardian_alert_status: [
        "QUEUED",
        "PROCESSING",
        "DEMO_RECORDED",
        "ACCEPTED",
        "DELIVERED",
        "RETRY_WAIT",
        "FAILED_PERMANENT",
        "SUPPRESSED",
      ],
      guardian_channel: ["SMS", "ALIMTALK"],
      guardian_template: ["HEAT_L3", "HEAT_L4"],
      heat_advisory: ["NONE", "WATCH", "WARNING"],
      medication_image_quality: ["GOOD", "BLURRY", "PARTIAL", "UNREADABLE"],
      medication_risk_tier: ["HIGH", "MID", "NONE"],
      medication_scan_status: [
        "UPLOADED",
        "EXTRACTING",
        "NEEDS_RETAKE",
        "NEEDS_CONFIRMATION",
        "MANUAL_REQUIRED",
        "COMPLETED",
        "FAILED",
      ],
      medication_source: ["AI_AUTO", "AI_CONFIRMED", "MANUAL"],
      profile_role: ["ADMIN", "CARE_WORKER"],
      risk_level: ["L0", "L1", "L2", "L3", "L4"],
      subject_sex: ["FEMALE", "MALE", "OTHER", "UNDISCLOSED"],
      weather_source: ["KMA_APIHUB_500M", "KMA_VILLAGE_FCST"],
    },
  },
} as const;
