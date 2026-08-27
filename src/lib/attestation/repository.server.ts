import "@tanstack/react-start/server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";

import { createPayloadHash, createSubjectHash } from "./hashing.server";
import {
  CareEventValueSchema,
  ShelterStatusValueSchema,
  type CareEventValue,
  type ShelterStatusValue,
} from "./schemas";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/iu);
const Bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/iu)
  .transform((value) => value.toLowerCase() as `0x${string}`);
const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/iu)
  .transform((value) => value.toLowerCase() as `0x${string}`);
const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u);
const JobStateSchema = z.enum(["PENDING", "PROCESSING", "RETRY_WAIT", "VERIFIED", "FAILED"]);
const TargetKindSchema = z.enum(["CARE_EVENT", "SHELTER_REPORT", "SHELTER_CHECKIN"]);
const RpcDispositionSchema = z.enum(["APPLIED", "IDEMPOTENT", "LEASE_LOST"]);

const DurableSubmissionSchema = z
  .object({
    transactionHash: Bytes32Schema,
    chainId: z.literal(84532),
    schemaUid: Bytes32Schema,
    issuer: AddressSchema,
  })
  .strict();

const ClaimInputSchema = z
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
        message: "invalid lease window",
      });
    }
  });

const ClaimedRowSchema = z
  .object({
    job_id: UuidSchema,
    target_kind: TargetKindSchema,
    target_id: UuidSchema,
    idempotency_key: z.string().trim().min(1).max(256),
    attempt_count: z.number().int().min(1).max(32_767),
    lease_until: TimestampSchema,
    claim_token: UuidSchema,
    submission_started_at: TimestampSchema.nullable(),
    transaction_hash: Bytes32Schema.nullable(),
    chain_id: z.literal(84532).nullable(),
    schema_uid: Bytes32Schema.nullable(),
    issuer: AddressSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    const metadata = [row.transaction_hash, row.chain_id, row.schema_uid, row.issuer];
    const present = metadata.filter((value) => value !== null).length;
    if (present !== 0 && present !== metadata.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "partial submission metadata" });
    }
    if (present === metadata.length && row.submission_started_at === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "missing submission start" });
    }
    if (present === 0 && row.submission_started_at !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "submission outcome is not safely reclaimable",
      });
    }
  });

const JobGuardSchema = z
  .object({
    id: UuidSchema,
    state: JobStateSchema,
    attestation_uid: Bytes32Schema.nullable(),
    claim_token: UuidSchema.nullable(),
    lease_until: TimestampSchema.nullable(),
  })
  .strict();

const CareEventRowSchema = z
  .object({
    id: UuidSchema,
    event_type: z.enum(["VISIT", "SHELTER_CHECKIN", "ALERT_SENT"]),
    risk_level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
    hri: z.number().int().min(0).max(100),
    occurred_at: TimestampSchema,
    subject_hash: Hex64Schema,
    payload_hash: Hex64Schema,
    attestation_uid: Bytes32Schema.nullable(),
  })
  .strict();

const ShelterReportRowSchema = z
  .object({
    id: UuidSchema,
    shelter_id: z.string().regex(/^DG-\d{4}$/u),
    is_open: z.boolean(),
    crowd_level: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    observed_at: TimestampSchema,
    reporter_hash: Hex64Schema,
    attestation_uid: Bytes32Schema.nullable(),
  })
  .strict();

const ShelterCheckinRowSchema = z
  .object({
    id: UuidSchema,
    subject_id: UuidSchema,
    shelter_id: z.string().regex(/^DG-\d{4}$/u),
    checked_in_at: TimestampSchema,
    attestation_uid: Bytes32Schema.nullable(),
  })
  .strict();

const RiskSnapshotRowSchema = z
  .object({
    subject_id: UuidSchema,
    level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
    hri: z.number().int().min(0).max(100),
    computed_at: TimestampSchema,
  })
  .strict();

const FinalizeOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("VERIFIED"),
      attestationUid: Bytes32Schema,
      transactionHash: Bytes32Schema,
      chainId: z.literal(84532),
      schemaUid: Bytes32Schema,
      issuer: AddressSchema,
      verifiedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("RETRY_WAIT"),
      errorCode: ErrorCodeSchema,
      nextAttemptAt: TimestampSchema,
    })
    .strict(),
  z.object({ kind: z.literal("FAILED"), errorCode: ErrorCodeSchema }).strict(),
]);

const FinalizeInputSchema = z
  .object({
    jobId: UuidSchema,
    claimToken: UuidSchema,
    expectedLeaseUntil: TimestampSchema,
    outcome: FinalizeOutcomeSchema,
  })
  .strict();

const BeginSubmissionInputSchema = z
  .object({
    jobId: UuidSchema,
    claimToken: UuidSchema,
    expectedLeaseUntil: TimestampSchema,
    startedAt: TimestampSchema,
  })
  .strict();

const RecordSubmissionInputSchema = z
  .object({
    jobId: UuidSchema,
    claimToken: UuidSchema,
    submission: DurableSubmissionSchema,
    submittedAt: TimestampSchema,
  })
  .strict();

const FinalizeRowSchema = z
  .object({
    disposition: z.enum(["APPLIED", "IDEMPOTENT", "LEASE_LOST"]),
    state: JobStateSchema,
  })
  .strict();

export interface ClaimedAttestationJob {
  readonly jobId: string;
  readonly targetKind: "CARE_EVENT" | "SHELTER_REPORT" | "SHELTER_CHECKIN";
  readonly targetId: string;
  readonly idempotencyKey: string;
  readonly attemptCount: number;
  readonly leaseUntil: string;
  readonly claimToken: string;
  readonly submissionStartedAt: string | null;
  readonly submission: DurableAttestationSubmission | null;
}

export type DurableAttestationSubmission = z.output<typeof DurableSubmissionSchema>;

export type AttestationTarget =
  | Readonly<{
      schemaKind: "CARE_EVENT";
      value: CareEventValue;
      existingAttestationUid: `0x${string}` | null;
    }>
  | Readonly<{
      schemaKind: "SHELTER_STATUS";
      value: ShelterStatusValue;
      existingAttestationUid: `0x${string}` | null;
    }>;

export type AttestationFinalizeOutcome = z.output<typeof FinalizeOutcomeSchema>;

export interface AttestationFinalizeCommand {
  readonly jobId: string;
  readonly claimToken: string;
  readonly expectedLeaseUntil: string;
  readonly outcome: AttestationFinalizeOutcome;
}

export interface AttestationFinalizeResult {
  readonly disposition: "APPLIED" | "IDEMPOTENT" | "LEASE_LOST";
  readonly state: z.infer<typeof JobStateSchema>;
}

export interface AttestationRepository {
  claim(input: {
    readonly now: string;
    readonly leaseUntil: string;
    readonly limit: number;
  }): Promise<readonly ClaimedAttestationJob[]>;
  loadTarget(job: ClaimedAttestationJob): Promise<AttestationTarget>;
  beginSubmission(input: {
    readonly jobId: string;
    readonly claimToken: string;
    readonly expectedLeaseUntil: string;
    readonly startedAt: string;
  }): Promise<"APPLIED" | "IDEMPOTENT" | "LEASE_LOST">;
  recordSubmission(input: {
    readonly jobId: string;
    readonly claimToken: string;
    readonly submission: DurableAttestationSubmission;
    readonly submittedAt: string;
  }): Promise<"APPLIED" | "IDEMPOTENT" | "LEASE_LOST">;
  finalize(input: AttestationFinalizeCommand): Promise<AttestationFinalizeResult>;
}

export interface AttestationQueryResponse {
  readonly data: unknown;
  readonly error: unknown | null;
}

export interface AttestationQuery {
  select(columns: string): AttestationQuery;
  eq(column: string, value: unknown): AttestationQuery;
  lte(column: string, value: unknown): AttestationQuery;
  order(column: string, options: Readonly<{ ascending: boolean }>): AttestationQuery;
  limit(value: number): AttestationQuery;
  maybeSingle(): Promise<AttestationQueryResponse>;
}

export interface AttestationDatabaseClient {
  from(table: string): AttestationQuery;
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AttestationQueryResponse>;
}

export type AttestationRepositoryErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_REQUEST"
  | "QUERY_FAILED"
  | "INVALID_RESPONSE"
  | "INVALID_TARGET"
  | "ALREADY_ATTESTED"
  | "LEASE_LOST";

/** Stable errors deliberately discard all database response details. */
export class AttestationRepositoryError extends Error {
  constructor(readonly code: AttestationRepositoryErrorCode) {
    super(code);
    this.name = "AttestationRepositoryError";
  }
}

const defaultClient = (): AttestationDatabaseClient =>
  createAdminSupabaseClient() as unknown as AttestationDatabaseClient;

const fail = (code: AttestationRepositoryErrorCode): never => {
  throw new AttestationRepositoryError(code);
};

const parseRequest = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
): z.output<Schema> => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fail("INVALID_REQUEST");
};

const parseResponse = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
): z.output<Schema> => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fail("INVALID_RESPONSE");
};

const assertQuery = (response: AttestationQueryResponse): unknown => {
  if (response.error !== null) return fail("QUERY_FAILED");
  return response.data;
};

const toUnixSeconds = (timestamp: string): bigint =>
  BigInt(Math.floor(Date.parse(timestamp) / 1_000));
const toBytes32 = (value: string): `0x${string}` => `0x${value.toLowerCase()}`;

const EVENT_TYPE = Object.freeze({ VISIT: 0, SHELTER_CHECKIN: 1, ALERT_SENT: 2 } as const);
const RISK_LEVEL = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 } as const);

const finalizePayload = (
  outcome: AttestationFinalizeOutcome,
): Readonly<Record<string, unknown>> => {
  switch (outcome.kind) {
    case "VERIFIED":
      return Object.freeze({
        kind: outcome.kind,
        attestation_uid: outcome.attestationUid.toLowerCase(),
        transaction_hash: outcome.transactionHash.toLowerCase(),
        chain_id: outcome.chainId,
        schema_uid: outcome.schemaUid.toLowerCase(),
        issuer: outcome.issuer.toLowerCase(),
        verified_at: outcome.verifiedAt,
      });
    case "RETRY_WAIT":
      return Object.freeze({
        kind: outcome.kind,
        error_code: outcome.errorCode,
        next_attempt_at: outcome.nextAttemptAt,
      });
    case "FAILED":
      return Object.freeze({ kind: outcome.kind, error_code: outcome.errorCode });
  }
};

export const createSupabaseAttestationRepository = (input: {
  readonly client?: AttestationDatabaseClient;
  readonly subjectHashSecret: string | Uint8Array;
}): AttestationRepository => {
  const client = input.client ?? defaultClient();
  try {
    createSubjectHash("00000000-0000-4000-8000-000000000000", input.subjectHashSecret);
  } catch {
    return fail("INVALID_CONFIG");
  }

  const querySingle = async <T>(
    table: string,
    columns: string,
    schema: z.ZodType<T>,
    configure: (query: AttestationQuery) => AttestationQuery,
  ): Promise<T> => {
    let response: AttestationQueryResponse;
    try {
      response = await configure(client.from(table).select(columns)).maybeSingle();
    } catch {
      return fail("QUERY_FAILED");
    }
    const data = assertQuery(response);
    if (data === null) return fail("INVALID_TARGET");
    const parsed = schema.safeParse(data);
    return parsed.success ? parsed.data : fail("INVALID_TARGET");
  };

  const assertUnattestedJob = async (job: ClaimedAttestationJob): Promise<void> => {
    const row = await querySingle(
      "attestation_jobs",
      "id,state,attestation_uid,claim_token,lease_until",
      JobGuardSchema,
      (query) => query.eq("id", job.jobId),
    );
    if (row.id !== job.jobId) return fail("INVALID_TARGET");
    if (row.attestation_uid !== null) return fail("ALREADY_ATTESTED");
    if (
      row.state !== "PROCESSING" ||
      row.claim_token !== job.claimToken ||
      row.lease_until !== job.leaseUntil
    ) {
      return fail("LEASE_LOST");
    }
  };

  const loadCareEvent = async (job: ClaimedAttestationJob): Promise<AttestationTarget> => {
    const row = await querySingle(
      "care_events",
      "id,event_type,risk_level,hri,occurred_at,subject_hash,payload_hash,attestation_uid",
      CareEventRowSchema,
      (query) => query.eq("id", job.targetId),
    );
    if (row.id !== job.targetId) return fail("INVALID_TARGET");
    if (row.attestation_uid !== null) return fail("ALREADY_ATTESTED");
    const value = CareEventValueSchema.parse({
      subjectHash: toBytes32(row.subject_hash),
      eventType: EVENT_TYPE[row.event_type],
      riskLevel: RISK_LEVEL[row.risk_level],
      hriScore: row.hri,
      occurredAt: toUnixSeconds(row.occurred_at),
      payloadHash: toBytes32(row.payload_hash),
    });
    return Object.freeze({ schemaKind: "CARE_EVENT", value, existingAttestationUid: null });
  };

  const loadShelterReport = async (job: ClaimedAttestationJob): Promise<AttestationTarget> => {
    const row = await querySingle(
      "shelter_reports",
      "id,shelter_id,is_open,crowd_level,observed_at,reporter_hash,attestation_uid",
      ShelterReportRowSchema,
      (query) => query.eq("id", job.targetId),
    );
    if (row.id !== job.targetId) return fail("INVALID_TARGET");
    if (row.attestation_uid !== null) return fail("ALREADY_ATTESTED");
    if (row.crowd_level === null) return fail("INVALID_TARGET");
    const value = ShelterStatusValueSchema.parse({
      shelterId: row.shelter_id,
      isOpen: row.is_open,
      crowdLevel: row.crowd_level,
      observedAt: toUnixSeconds(row.observed_at),
      reporterHash: toBytes32(row.reporter_hash),
    });
    return Object.freeze({ schemaKind: "SHELTER_STATUS", value, existingAttestationUid: null });
  };

  const loadShelterCheckin = async (job: ClaimedAttestationJob): Promise<AttestationTarget> => {
    const row = await querySingle(
      "shelter_checkins",
      "id,subject_id,shelter_id,checked_in_at,attestation_uid",
      ShelterCheckinRowSchema,
      (query) => query.eq("id", job.targetId),
    );
    if (row.id !== job.targetId) return fail("INVALID_TARGET");
    if (row.attestation_uid !== null) return fail("ALREADY_ATTESTED");
    const risk = await querySingle(
      "risk_snapshots",
      "subject_id,level,hri,computed_at",
      RiskSnapshotRowSchema,
      (query) =>
        query
          .eq("subject_id", row.subject_id)
          .lte("computed_at", row.checked_in_at)
          .order("computed_at", { ascending: false })
          .limit(1),
    );
    if (risk.subject_id !== row.subject_id) return fail("INVALID_TARGET");
    const value = CareEventValueSchema.parse({
      subjectHash: createSubjectHash(row.subject_id, input.subjectHashSecret),
      eventType: EVENT_TYPE.SHELTER_CHECKIN,
      riskLevel: RISK_LEVEL[risk.level],
      hriScore: risk.hri,
      occurredAt: toUnixSeconds(row.checked_in_at),
      payloadHash: createPayloadHash({
        eventType: "SHELTER_CHECKIN",
        shelterId: row.shelter_id,
        checkedInAt: row.checked_in_at,
      }),
    });
    return Object.freeze({ schemaKind: "CARE_EVENT", value, existingAttestationUid: null });
  };

  const repository: AttestationRepository = {
    async claim(rawInput: {
      readonly now: string;
      readonly leaseUntil: string;
      readonly limit: number;
    }) {
      const request = parseRequest(ClaimInputSchema, rawInput);
      let response: AttestationQueryResponse;
      try {
        response = await client.rpc("claim_attestation_jobs", {
          p_now: request.now,
          p_lease_until: request.leaseUntil,
          p_limit: request.limit,
        });
      } catch {
        return fail("QUERY_FAILED");
      }
      const rows = parseResponse(
        z.array(ClaimedRowSchema).max(request.limit),
        assertQuery(response),
      );
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            jobId: row.job_id,
            targetKind: row.target_kind,
            targetId: row.target_id,
            idempotencyKey: row.idempotency_key,
            attemptCount: row.attempt_count,
            leaseUntil: row.lease_until,
            claimToken: row.claim_token,
            submissionStartedAt: row.submission_started_at,
            submission:
              row.transaction_hash === null
                ? null
                : Object.freeze({
                    transactionHash: row.transaction_hash,
                    chainId: row.chain_id as 84532,
                    schemaUid: row.schema_uid!,
                    issuer: row.issuer!,
                  }),
          }),
        ),
      );
    },

    async loadTarget(rawJob: ClaimedAttestationJob) {
      const parsed = ClaimedRowSchema.safeParse({
        job_id: rawJob.jobId,
        target_kind: rawJob.targetKind,
        target_id: rawJob.targetId,
        idempotency_key: rawJob.idempotencyKey,
        attempt_count: rawJob.attemptCount,
        lease_until: rawJob.leaseUntil,
        claim_token: rawJob.claimToken,
        submission_started_at: rawJob.submissionStartedAt,
        transaction_hash: rawJob.submission?.transactionHash ?? null,
        chain_id: rawJob.submission?.chainId ?? null,
        schema_uid: rawJob.submission?.schemaUid ?? null,
        issuer: rawJob.submission?.issuer ?? null,
      });
      if (!parsed.success) return fail("INVALID_REQUEST");
      const job = rawJob;
      await assertUnattestedJob(job);
      switch (job.targetKind) {
        case "CARE_EVENT":
          return loadCareEvent(job);
        case "SHELTER_REPORT":
          return loadShelterReport(job);
        case "SHELTER_CHECKIN":
          return loadShelterCheckin(job);
        default:
          return fail("INVALID_REQUEST");
      }
    },

    async beginSubmission(rawInput) {
      const request = parseRequest(BeginSubmissionInputSchema, rawInput);
      let response: AttestationQueryResponse;
      try {
        response = await client.rpc("begin_attestation_submission", {
          p_job_id: request.jobId,
          p_claim_token: request.claimToken,
          p_expected_lease_until: request.expectedLeaseUntil,
          p_started_at: request.startedAt,
        });
      } catch {
        return fail("QUERY_FAILED");
      }
      return parseResponse(RpcDispositionSchema, assertQuery(response));
    },

    async recordSubmission(rawInput) {
      const request = parseRequest(RecordSubmissionInputSchema, rawInput);
      let response: AttestationQueryResponse;
      try {
        response = await client.rpc("record_attestation_submission", {
          p_job_id: request.jobId,
          p_claim_token: request.claimToken,
          p_transaction_hash: request.submission.transactionHash.toLowerCase(),
          p_chain_id: request.submission.chainId,
          p_schema_uid: request.submission.schemaUid.toLowerCase(),
          p_issuer: request.submission.issuer.toLowerCase(),
          p_submitted_at: request.submittedAt,
        });
      } catch {
        return fail("QUERY_FAILED");
      }
      return parseResponse(RpcDispositionSchema, assertQuery(response));
    },

    async finalize(rawInput: AttestationFinalizeCommand) {
      const request = parseRequest(FinalizeInputSchema, rawInput);
      let response: AttestationQueryResponse;
      try {
        response = await client.rpc("finalize_attestation_job", {
          p_job_id: request.jobId,
          p_claim_token: request.claimToken,
          p_expected_lease_until: request.expectedLeaseUntil,
          p_outcome: finalizePayload(request.outcome),
        });
      } catch {
        return fail("QUERY_FAILED");
      }
      const rows = parseResponse(z.array(FinalizeRowSchema).length(1), assertQuery(response));
      const row = rows[0];
      if (!row) return fail("INVALID_RESPONSE");
      if (row.disposition !== "LEASE_LOST" && row.state !== request.outcome.kind) {
        return fail("INVALID_RESPONSE");
      }
      return Object.freeze({ disposition: row.disposition, state: row.state });
    },
  };
  return Object.freeze(repository);
};
