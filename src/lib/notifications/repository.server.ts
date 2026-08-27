import "@tanstack/react-start/server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
const RecipientRefSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u);
const DemoMessageIdSchema = z.string().regex(/^demo_[0-9a-f]{64}$/u);
const ChannelSchema = z.enum(["SMS", "ALIMTALK"]);
const RiskLevelSchema = z.enum(["L3", "L4"]);
const TemplateSchema = z.enum(["HEAT_L3", "HEAT_L4"]);

const ClaimRequestSchema = z
  .object({
    now: TimestampSchema,
    leaseUntil: TimestampSchema,
    limit: z.number().int().min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const now = Date.parse(value.now);
    const leaseUntil = Date.parse(value.leaseUntil);
    if (leaseUntil <= now || leaseUntil > now + 5 * 60_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leaseUntil"],
        message: "lease must end after the claim time",
      });
    }
  });

const ClaimedRowSchema = z
  .object({
    alert_id: UuidSchema,
    event_id: UuidSchema,
    recipient_ref: RecipientRefSchema,
    channel: ChannelSchema,
    template_key: TemplateSchema,
    risk_level: RiskLevelSchema,
    idempotency_key: z.string().trim().min(1).max(256),
    attempt_count: z.number().int().min(1).max(32_767),
    lease_until: TimestampSchema,
    claim_token: UuidSchema,
    consent_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.template_key !== `HEAT_${value.risk_level}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["template_key"],
        message: "template and risk level must match",
      });
    }
  });

const EligibilityRequestSchema = z
  .object({
    alertId: UuidSchema,
    claimToken: UuidSchema,
    expectedLeaseUntil: TimestampSchema,
    expectedConsentRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    checkedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.checkedAt) >= Date.parse(value.expectedLeaseUntil)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkedAt"],
        message: "eligibility must be checked during the active lease",
      });
    }
  });

export const NotificationSuppressionReasonSchema = z.enum([
  "NO_CONSENT",
  "CONSENT_WITHDRAWN",
  "CHANNEL_BLOCKED",
  "RECIPIENT_UNAVAILABLE",
  "CONSENT_CHANGED",
]);

const EligibilityRowSchema = z.discriminatedUnion("disposition", [
  z.object({ disposition: z.literal("ELIGIBLE"), reason_code: z.null() }).strict(),
  z.object({ disposition: z.literal("LEASE_LOST"), reason_code: z.null() }).strict(),
  z
    .object({
      disposition: z.literal("SUPPRESSED"),
      reason_code: NotificationSuppressionReasonSchema,
    })
    .strict(),
]);

const FinalizeOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DEMO_RECORDED"),
      providerMessageId: DemoMessageIdSchema,
      recordedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("SUPPRESSED"),
      reasonCode: NotificationSuppressionReasonSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("RETRY_WAIT"),
      errorCode: ErrorCodeSchema,
      nextAttemptAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("FAILED_PERMANENT"),
      errorCode: ErrorCodeSchema,
    })
    .strict(),
]);

const FinalizeCommandSchema = z
  .object({
    alertId: UuidSchema,
    claimToken: UuidSchema,
    expectedLeaseUntil: TimestampSchema,
    outcome: FinalizeOutcomeSchema,
  })
  .strict();

const SafeOutboxStatusSchema = z.enum([
  "QUEUED",
  "PROCESSING",
  "DEMO_RECORDED",
  "RETRY_WAIT",
  "FAILED_PERMANENT",
  "SUPPRESSED",
]);

const FinalizeRowSchema = z
  .object({
    disposition: z.enum(["APPLIED", "IDEMPOTENT", "LEASE_LOST"]),
    status: SafeOutboxStatusSchema,
  })
  .strict();

export type NotificationSuppressionReason = z.infer<typeof NotificationSuppressionReasonSchema>;

export interface ClaimedGuardianAlert {
  readonly alertId: string;
  readonly eventId: string;
  readonly recipientRef: string;
  readonly channel: "SMS" | "ALIMTALK";
  readonly templateKey: "HEAT_L3" | "HEAT_L4";
  readonly riskLevel: "L3" | "L4";
  readonly idempotencyKey: string;
  readonly attemptCount: number;
  readonly leaseUntil: string;
  readonly claimToken: string;
  readonly consentRevision: number;
}

export type NotificationEligibility =
  | Readonly<{ kind: "ELIGIBLE" }>
  | Readonly<{ kind: "LEASE_LOST" }>
  | Readonly<{ kind: "SUPPRESSED"; reasonCode: NotificationSuppressionReason }>;

export type NotificationFinalizeOutcome = z.infer<typeof FinalizeOutcomeSchema>;

export interface NotificationFinalizeCommand {
  readonly alertId: string;
  readonly claimToken: string;
  readonly expectedLeaseUntil: string;
  readonly outcome: NotificationFinalizeOutcome;
}

export interface NotificationFinalizeResult {
  readonly disposition: "APPLIED" | "IDEMPOTENT" | "LEASE_LOST";
  readonly status: z.infer<typeof SafeOutboxStatusSchema>;
}

export interface NotificationRepository {
  claim(input: {
    readonly now: string;
    readonly leaseUntil: string;
    readonly limit: number;
  }): Promise<readonly ClaimedGuardianAlert[]>;
  recheckEligibility(input: {
    readonly alertId: string;
    readonly claimToken: string;
    readonly expectedLeaseUntil: string;
    readonly expectedConsentRevision: number;
    readonly checkedAt: string;
  }): Promise<NotificationEligibility>;
  finalize(input: NotificationFinalizeCommand): Promise<NotificationFinalizeResult>;
}

export interface NotificationRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: unknown | null }>;
}

export class NotificationRepositoryError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "QUERY_FAILED" | "INVALID_RESPONSE") {
    super(code);
    this.name = "NotificationRepositoryError";
  }
}

const defaultClient = (): NotificationRpcClient =>
  createAdminSupabaseClient() as unknown as NotificationRpcClient;

const invalidRequest = (): never => {
  throw new NotificationRepositoryError("INVALID_REQUEST");
};

const parseRequest = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  return parsed.data;
};

const parseResponse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new NotificationRepositoryError("INVALID_RESPONSE");
  return parsed.data;
};

const callRpc = async (
  client: NotificationRpcClient,
  functionName: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  let response: { readonly data: unknown; readonly error: unknown | null };
  try {
    response = await client.rpc(functionName, parameters);
  } catch {
    throw new NotificationRepositoryError("QUERY_FAILED");
  }
  if (response.error !== null) throw new NotificationRepositoryError("QUERY_FAILED");
  return response.data;
};

const toClaim = (row: z.infer<typeof ClaimedRowSchema>): ClaimedGuardianAlert =>
  Object.freeze({
    alertId: row.alert_id,
    eventId: row.event_id,
    recipientRef: row.recipient_ref,
    channel: row.channel,
    templateKey: row.template_key,
    riskLevel: row.risk_level,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    leaseUntil: row.lease_until,
    claimToken: row.claim_token,
    consentRevision: row.consent_revision,
  });

const outcomePayload = (
  outcome: NotificationFinalizeOutcome,
): Readonly<Record<string, unknown>> => {
  switch (outcome.kind) {
    case "DEMO_RECORDED":
      return Object.freeze({
        kind: outcome.kind,
        provider_message_id: outcome.providerMessageId,
        recorded_at: outcome.recordedAt,
      });
    case "SUPPRESSED":
      return Object.freeze({ kind: outcome.kind, reason_code: outcome.reasonCode });
    case "RETRY_WAIT":
      return Object.freeze({
        kind: outcome.kind,
        error_code: outcome.errorCode,
        next_attempt_at: outcome.nextAttemptAt,
      });
    case "FAILED_PERMANENT":
      return Object.freeze({ kind: outcome.kind, error_code: outcome.errorCode });
  }
};

const expectedStatus = (
  outcome: NotificationFinalizeOutcome,
): NotificationFinalizeResult["status"] => outcome.kind;

export const createSupabaseNotificationRepository = (
  client: NotificationRpcClient = defaultClient(),
): NotificationRepository => {
  const repository: NotificationRepository = {
    async claim(rawInput) {
      const input = parseRequest(ClaimRequestSchema, rawInput);
      const rows = parseResponse(
        z.array(ClaimedRowSchema).max(input.limit),
        await callRpc(client, "claim_guardian_alert_outbox", {
          p_now: input.now,
          p_lease_until: input.leaseUntil,
          p_limit: input.limit,
        }),
      );
      return Object.freeze(rows.map(toClaim));
    },

    async recheckEligibility(rawInput) {
      const input = parseRequest(EligibilityRequestSchema, rawInput);
      const rows = parseResponse(
        z.array(EligibilityRowSchema).length(1),
        await callRpc(client, "recheck_guardian_alert_eligibility", {
          p_alert_id: input.alertId,
          p_claim_token: input.claimToken,
          p_expected_lease_until: input.expectedLeaseUntil,
          p_expected_consent_revision: input.expectedConsentRevision,
          p_checked_at: input.checkedAt,
        }),
      );
      const row = rows[0];
      if (!row) throw new NotificationRepositoryError("INVALID_RESPONSE");
      if (row.disposition === "ELIGIBLE") return Object.freeze({ kind: "ELIGIBLE" as const });
      if (row.disposition === "LEASE_LOST") {
        return Object.freeze({ kind: "LEASE_LOST" as const });
      }
      return Object.freeze({ kind: "SUPPRESSED" as const, reasonCode: row.reason_code });
    },

    async finalize(rawInput) {
      const input = parseRequest(FinalizeCommandSchema, rawInput);
      const rows = parseResponse(
        z.array(FinalizeRowSchema).length(1),
        await callRpc(client, "finalize_guardian_alert_outbox", {
          p_alert_id: input.alertId,
          p_claim_token: input.claimToken,
          p_expected_lease_until: input.expectedLeaseUntil,
          p_outcome: outcomePayload(input.outcome),
        }),
      );
      const row = rows[0];
      if (!row) throw new NotificationRepositoryError("INVALID_RESPONSE");
      if (row.disposition !== "LEASE_LOST" && row.status !== expectedStatus(input.outcome)) {
        throw new NotificationRepositoryError("INVALID_RESPONSE");
      }
      return Object.freeze({ disposition: row.disposition, status: row.status });
    },
  };
  return Object.freeze(repository);
};
