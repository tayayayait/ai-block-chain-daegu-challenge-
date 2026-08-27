import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ATTEST_STATES, MED_RISK_TIERS, MED_SOURCES, RISK_LEVELS } from "@/lib/domain-types";
import type { AuthorizationRepository } from "@/lib/auth/guards";
import type { StaffProfile, SubjectScope } from "@/lib/auth/access-policy";
import type { SubjectPrivateRecord } from "@/lib/subjects/dto";
import type { SubjectRepository } from "@/lib/subjects/service.server";

import { SUBJECT_CARE_EVENT_TYPES, SUBJECT_SEXES } from "./types";
import type { SubjectDetailRecord, SubjectDetailRepository } from "./service.server";

const profileRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    role: z.enum(["ADMIN", "CARE_WORKER"]),
  })
  .strict();

const subjectScopeRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
  })
  .strict();

const privateSubjectRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
    phone: z.string().nullable(),
    birth_year: z.number().int(),
    sex: z.enum(SUBJECT_SEXES),
    lives_alone: z.boolean(),
    senior_mode: z.boolean(),
    medication_profile_registered_at: z.string().nullable(),
  })
  .strict();

const riskRowSchema = z
  .object({
    hri: z.number().int(),
    level: z.enum(RISK_LEVELS),
    breakdown: z
      .object({
        E: z.number().int(),
        M: z.number().int(),
        P: z.number().int(),
        C: z.number().int(),
      })
      .strict(),
    reasons: z.array(z.string()),
    computed_at: z.string(),
  })
  .strict();

const medicationRowSchema = z
  .object({
    id: z.string().uuid(),
    product_name: z.string(),
    heat_class: z.string().nullable(),
    risk_tier: z.enum(MED_RISK_TIERS),
    source: z.enum(MED_SOURCES),
    confidence: z.number().nullable(),
    created_at: z.string(),
  })
  .strict();

const careEventRowSchema = z
  .object({
    id: z.string().uuid(),
    event_type: z.enum(SUBJECT_CARE_EVENT_TYPES),
    risk_level: z.enum(RISK_LEVELS),
    hri: z.number().int(),
    occurred_at: z.string(),
    attestation_state: z.enum(ATTEST_STATES),
    attestation_uid: z.string().nullable(),
    issuer: z.string().nullable(),
  })
  .strict();

function databaseFailure(code: string | undefined): Error {
  return new Error(code ? `SUBJECT_DETAIL_DATABASE_${code}` : "SUBJECT_DETAIL_DATABASE_INVALID");
}

export function createSubjectAuthorizationRepository(
  sessionClient: SupabaseClient,
): AuthorizationRepository {
  return {
    async findProfileByUserId(userId: string): Promise<StaffProfile | null> {
      const result = await sessionClient
        .from("profiles")
        .select("id,organization_id,role")
        .eq("id", userId)
        .maybeSingle();
      if (result.error) throw databaseFailure(result.error.code);
      if (!result.data) return null;
      const row = profileRowSchema.safeParse(result.data);
      if (!row.success) throw databaseFailure(undefined);
      return {
        id: row.data.id,
        organizationId: row.data.organization_id,
        role: row.data.role,
      };
    },

    async findSubjectScopeById(subjectId: string): Promise<SubjectScope | null> {
      const result = await sessionClient
        .from("subjects")
        .select("id,organization_id")
        .eq("id", subjectId)
        .maybeSingle();
      if (result.error) throw databaseFailure(result.error.code);
      if (!result.data) return null;
      const row = subjectScopeRowSchema.safeParse(result.data);
      if (!row.success) throw databaseFailure(undefined);
      return { id: row.data.id, organizationId: row.data.organization_id };
    },

    async isSubjectAssignedToProfile(input): Promise<boolean> {
      const result = await sessionClient
        .from("subject_assignments")
        .select("subject_id")
        .eq("organization_id", input.organizationId)
        .eq("subject_id", input.subjectId)
        .eq("profile_id", input.profileId)
        .maybeSingle();
      if (result.error) throw databaseFailure(result.error.code);
      return result.data !== null;
    },
  };
}

async function findPrivateSubject(
  adminClient: SupabaseClient,
  subjectId: string,
): Promise<z.infer<typeof privateSubjectRowSchema> | null> {
  const result = await adminClient
    .from("subjects")
    .select(
      "id,organization_id,name,address,phone,birth_year,sex,lives_alone,senior_mode,medication_profile_registered_at",
    )
    .eq("id", subjectId)
    .maybeSingle();
  if (result.error) throw databaseFailure(result.error.code);
  if (!result.data) return null;
  const row = privateSubjectRowSchema.safeParse(result.data);
  if (!row.success) throw databaseFailure(undefined);
  return row.data;
}

export function createPrivateSubjectRepository(adminClient: SupabaseClient): SubjectRepository {
  return {
    async findPrivateSubjectById(subjectId: string): Promise<SubjectPrivateRecord | null> {
      const row = await findPrivateSubject(adminClient, subjectId);
      if (!row) return null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        address: row.address,
        phone: row.phone ?? "",
      };
    },
  };
}

export function createSubjectDetailRepository(
  sessionClient: SupabaseClient,
  adminClient: SupabaseClient,
): SubjectDetailRepository {
  return {
    async findSubjectDetailById(subjectId: string): Promise<SubjectDetailRecord | null> {
      const [subject, riskResult, medicationsResult, careEventsResult] = await Promise.all([
        findPrivateSubject(adminClient, subjectId),
        sessionClient
          .from("risk_snapshots")
          .select("hri,level,breakdown,reasons,computed_at")
          .eq("subject_id", subjectId)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sessionClient
          .from("medications")
          .select("id,product_name,heat_class,risk_tier,source,confidence,created_at")
          .eq("subject_id", subjectId)
          .order("created_at", { ascending: false }),
        sessionClient
          .from("care_events")
          .select(
            "id,event_type,risk_level,hri,occurred_at,attestation_state,attestation_uid,issuer",
          )
          .eq("subject_id", subjectId)
          .order("occurred_at", { ascending: false })
          .limit(20),
      ]);

      if (!subject) return null;
      for (const result of [riskResult, medicationsResult, careEventsResult]) {
        if (result.error) throw databaseFailure(result.error.code);
      }

      const risk = riskResult.data === null ? null : riskRowSchema.safeParse(riskResult.data);
      const medications = z.array(medicationRowSchema).safeParse(medicationsResult.data ?? []);
      const careEvents = z.array(careEventRowSchema).safeParse(careEventsResult.data ?? []);
      if ((risk !== null && !risk.success) || !medications.success || !careEvents.success) {
        throw databaseFailure(undefined);
      }

      return {
        subject: {
          id: subject.id,
          organizationId: subject.organization_id,
          name: subject.name,
          address: subject.address,
          phone: subject.phone ?? "",
          birthYear: subject.birth_year,
          sex: subject.sex,
          livesAlone: subject.lives_alone,
          seniorMode: subject.senior_mode,
          medicationProfileRegisteredAt: subject.medication_profile_registered_at,
        },
        latestRisk:
          risk === null
            ? null
            : {
                score: risk.data.hri,
                level: risk.data.level,
                breakdown: risk.data.breakdown,
                reasons: risk.data.reasons,
                computedAt: risk.data.computed_at,
              },
        medications: medications.data.map((row) => ({
          id: row.id,
          productName: row.product_name,
          heatClass: row.heat_class,
          riskTier: row.risk_tier,
          source: row.source,
          confidence: row.confidence,
          createdAt: row.created_at,
        })),
        careEvents: careEvents.data.map((row) => ({
          id: row.id,
          type: row.event_type,
          riskLevel: row.risk_level,
          hri: row.hri,
          occurredAt: row.occurred_at,
          attestationState: row.attestation_state,
          attestationUid: row.attestation_uid,
          issuer: row.issuer,
        })),
      };
    },
  };
}
