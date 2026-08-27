import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

import type { AlertAccessRepository, AlertSubjectSessionRepository } from "./access-token.server";
import type { AlertDetailRecord, AlertDetailRepository } from "./service.server";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const TimestampSchema = z.string().datetime({ offset: true });

const GrantInputSchema = z
  .object({
    alertId: UuidSchema,
    eventId: UuidSchema,
    claimToken: UuidSchema,
    expectedLeaseUntil: z.date(),
    tokenHash: Sha256Schema,
    expiresAt: z.date(),
  })
  .strict();

const SessionRpcInputSchema = z
  .object({
    tokenHash: Sha256Schema,
    eventId: UuidSchema,
    now: z.date(),
    sessionHash: Sha256Schema,
    sessionExpiresAt: z.date(),
  })
  .strict();

const SessionLookupInputSchema = z
  .object({
    sessionHash: Sha256Schema,
    eventId: UuidSchema,
    now: z.date(),
  })
  .strict();

const SessionRowSchema = z.object({ alert_id: UuidSchema, event_id: UuidSchema }).strict();
const SubjectSessionRowsSchema = z.array(
  z
    .object({
      session_id: UuidSchema,
      subject_id: UuidSchema,
      expires_at: TimestampSchema,
    })
    .strict(),
);

const GuardianAlertRowSchema = z
  .object({
    id: UuidSchema,
    alert_transition_id: UuidSchema,
    subject_id: UuidSchema,
    risk_level: z.enum(["L3", "L4"]),
  })
  .strict();

const TransitionRowSchema = z
  .object({
    id: UuidSchema,
    subject_id: UuidSchema,
    to_level: z.enum(["L3", "L4"]),
    occurred_at: TimestampSchema,
  })
  .strict();

const SubjectNameRowSchema = z.object({ id: UuidSchema, name: z.string() }).strict();
const RiskSnapshotRowSchema = z
  .object({
    subject_id: UuidSchema,
    hri: z.number().int().min(0).max(100),
    level: z.enum(["L3", "L4"]),
    reasons: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
    computed_at: TimestampSchema,
  })
  .strict();

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;

export class AlertRepositoryError extends Error {
  constructor(readonly code: "QUERY_FAILED" | "INVALID_RESPONSE" | "INVALID_REQUEST") {
    super(code);
    this.name = "AlertRepositoryError";
  }
}

function invalidRequest(): never {
  throw new AlertRepositoryError("INVALID_REQUEST");
}

function queryData(result: QueryResult): unknown {
  if (result.error) throw new AlertRepositoryError("QUERY_FAILED");
  return result.data;
}

function strictRow<T>(schema: z.ZodType<T>, result: QueryResult): T | null {
  const data = queryData(result);
  if (data === null) return null;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AlertRepositoryError("INVALID_RESPONSE");
  return parsed.data;
}

function iso(date: Date): string {
  if (!Number.isFinite(date.getTime())) invalidRequest();
  return date.toISOString();
}

async function maybeSingle(query: unknown): Promise<QueryResult> {
  return (await query) as QueryResult;
}

export type AlertRepository = AlertAccessRepository &
  AlertSubjectSessionRepository &
  AlertDetailRepository;

export function createSupabaseAlertRepository(
  client: SupabaseClient = createAdminSupabaseClient(),
): AlertRepository {
  return {
    async saveGrant(rawInput): Promise<void> {
      const input = GrantInputSchema.safeParse(rawInput);
      if (!input.success) invalidRequest();

      const result = (await client.rpc("replace_alert_access_grant", {
        p_alert_id: input.data.alertId,
        p_event_id: input.data.eventId,
        p_claim_token: input.data.claimToken,
        p_expected_lease_until: iso(input.data.expectedLeaseUntil),
        p_token_hash: input.data.tokenHash,
        p_expires_at: iso(input.data.expiresAt),
      })) as unknown as QueryResult;
      const accepted = z.boolean().safeParse(queryData(result));
      if (!accepted.success || !accepted.data) {
        throw new AlertRepositoryError("QUERY_FAILED");
      }
    },

    async consumeOnceAndCreateSession(rawInput): Promise<boolean> {
      const input = SessionRpcInputSchema.safeParse(rawInput);
      if (!input.success) invalidRequest();

      const result = (await client.rpc("consume_alert_access_token", {
        p_token_hash: input.data.tokenHash,
        p_event_id: input.data.eventId,
        p_now: iso(input.data.now),
        p_session_hash: input.data.sessionHash,
        p_session_expires_at: iso(input.data.sessionExpiresAt),
      })) as unknown as QueryResult;
      const parsed = z.boolean().safeParse(queryData(result));
      if (!parsed.success) throw new AlertRepositoryError("INVALID_RESPONSE");
      return parsed.data;
    },

    async findValidSession(rawInput): Promise<{ alertId: string; eventId: string } | null> {
      const input = SessionLookupInputSchema.safeParse(rawInput);
      if (!input.success) invalidRequest();

      const result = await maybeSingle(
        client
          .from("alert_access_sessions")
          .select("alert_id,event_id")
          .eq("session_hash", input.data.sessionHash)
          .eq("event_id", input.data.eventId)
          .is("revoked_at", null)
          .gt("expires_at", iso(input.data.now))
          .maybeSingle(),
      );
      const row = strictRow(SessionRowSchema, result);
      return row ? { alertId: row.alert_id, eventId: row.event_id } : null;
    },

    async findSubjectSession(rawInput) {
      const input = z
        .object({ sessionHash: Sha256Schema, now: z.date() })
        .strict()
        .safeParse(rawInput);
      if (!input.success) invalidRequest();

      const result = (await client.rpc("resolve_alert_subject_session", {
        p_session_hash: input.data.sessionHash,
        p_now: iso(input.data.now),
      })) as unknown as QueryResult;
      const rows = SubjectSessionRowsSchema.safeParse(queryData(result));
      if (!rows.success || rows.data.length > 1) {
        throw new AlertRepositoryError("INVALID_RESPONSE");
      }
      const row = rows.data[0];
      return row
        ? {
            sessionId: row.session_id,
            subjectId: row.subject_id,
            expiresAt: new Date(row.expires_at),
          }
        : null;
    },

    async findByAccess(rawAccess): Promise<AlertDetailRecord | null> {
      const access = z
        .object({ alertId: UuidSchema, eventId: UuidSchema })
        .strict()
        .safeParse(rawAccess);
      if (!access.success) invalidRequest();

      const guardian = strictRow(
        GuardianAlertRowSchema,
        await maybeSingle(
          client
            .from("guardian_alerts")
            .select("id,alert_transition_id,subject_id,risk_level")
            .eq("id", access.data.alertId)
            .eq("alert_transition_id", access.data.eventId)
            .maybeSingle(),
        ),
      );
      if (!guardian) return null;

      const [transitionResult, subjectResult] = await Promise.all([
        maybeSingle(
          client
            .from("alert_transitions")
            .select("id,subject_id,to_level,occurred_at")
            .eq("id", access.data.eventId)
            .eq("subject_id", guardian.subject_id)
            .maybeSingle(),
        ),
        maybeSingle(
          client.from("subjects").select("id,name").eq("id", guardian.subject_id).maybeSingle(),
        ),
      ]);
      const transition = strictRow(TransitionRowSchema, transitionResult);
      const subject = strictRow(SubjectNameRowSchema, subjectResult);
      if (!transition || !subject || transition.to_level !== guardian.risk_level) return null;

      const snapshot = strictRow(
        RiskSnapshotRowSchema,
        await maybeSingle(
          client
            .from("risk_snapshots")
            .select("subject_id,hri,level,reasons,computed_at")
            .eq("subject_id", guardian.subject_id)
            .eq("level", guardian.risk_level)
            .lte("computed_at", transition.occurred_at)
            .order("computed_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
      );
      if (!snapshot || snapshot.subject_id !== guardian.subject_id) return null;

      return {
        alertId: guardian.id,
        eventId: transition.id,
        subjectId: subject.id,
        subjectName: subject.name,
        riskLevel: guardian.risk_level,
        hri: snapshot.hri,
        occurredAt: transition.occurred_at,
        reasons: snapshot.reasons,
      };
    },
  };
}
