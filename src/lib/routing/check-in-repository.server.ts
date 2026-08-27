import "@tanstack/react-start/server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin.server";
import { ShelterIdSchema } from "@/lib/shelters/public-dto";

const UuidSchema = z.string().uuid();
const ClientRequestIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const ActorHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ActorScopeSchema = z.enum(["CAREGIVER", "SUBJECT_SCOPED"]);
const PendingAttestationJobStateSchema = z.enum(["PENDING", "PROCESSING", "RETRY_WAIT"]);

const PendingCheckInInputSchema = z
  .object({
    subjectId: UuidSchema,
    shelterId: ShelterIdSchema,
    checkedInAt: z.date(),
    clientRequestId: ClientRequestIdSchema,
    actorScope: ActorScopeSchema,
    actorRefHash: ActorHashSchema,
    attestationState: z.literal("PENDING"),
  })
  .strict()
  .refine((value) => Number.isFinite(value.checkedInAt.getTime()), { path: ["checkedInAt"] });

const PendingCheckInRpcRowSchema = z
  .object({
    checkin_id: UuidSchema,
    attestation_state: z.literal("PENDING"),
    attestation_job_state: PendingAttestationJobStateSchema,
  })
  .strict();

export interface CheckInRpcClient {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface PendingCheckInWrite {
  readonly subjectId: string;
  readonly shelterId: string;
  readonly checkedInAt: Date;
  readonly clientRequestId: string;
  readonly actorScope: "CAREGIVER" | "SUBJECT_SCOPED";
  readonly actorRefHash: string;
  readonly attestationState: "PENDING";
}

export interface PendingCheckInRecord {
  readonly id: string;
  readonly attestationState: "PENDING";
  readonly checkedInAt: Date;
  readonly jobState: z.infer<typeof PendingAttestationJobStateSchema>;
}

export interface CheckInRepository {
  createPending(input: PendingCheckInWrite): Promise<PendingCheckInRecord>;
}

export type CheckInRepositoryErrorCode =
  "INVALID_REQUEST" | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "WRITE_FAILED" | "INVALID_RESPONSE";

export class CheckInRepositoryError extends Error {
  constructor(readonly code: CheckInRepositoryErrorCode) {
    super(`Shelter check-in repository failed: ${code}`);
    this.name = "CheckInRepositoryError";
  }
}

function defaultClient(): CheckInRpcClient {
  return createAdminSupabaseClient() as unknown as CheckInRpcClient;
}

function databaseErrorCode(error: unknown): string | null {
  try {
    if (typeof error !== "object" || error === null || !("code" in error)) return null;
    return typeof error.code === "string" ? error.code : null;
  } catch {
    return null;
  }
}

function repositoryErrorForDatabase(error: unknown): CheckInRepositoryError {
  switch (databaseErrorCode(error)) {
    case "22023":
      return new CheckInRepositoryError("INVALID_REQUEST");
    case "23503":
      return new CheckInRepositoryError("NOT_FOUND");
    case "23505":
      return new CheckInRepositoryError("IDEMPOTENCY_CONFLICT");
    default:
      return new CheckInRepositoryError("WRITE_FAILED");
  }
}

export function createSupabaseCheckInRepository(
  client: CheckInRpcClient = defaultClient(),
): CheckInRepository {
  return Object.freeze({
    async createPending(rawInput: PendingCheckInWrite): Promise<PendingCheckInRecord> {
      const parsedInput = PendingCheckInInputSchema.safeParse(rawInput);
      if (!parsedInput.success) throw new CheckInRepositoryError("INVALID_REQUEST");
      const input = parsedInput.data;
      let response: { readonly data: unknown; readonly error: unknown };
      try {
        response = await client.rpc("create_pending_shelter_checkin", {
          p_subject_id: input.subjectId,
          p_shelter_id: input.shelterId,
          p_checked_in_at: input.checkedInAt.toISOString(),
          p_actor_scope: input.actorScope,
          p_actor_ref_hash: input.actorRefHash,
          p_client_request_id: input.clientRequestId,
        });
      } catch {
        throw new CheckInRepositoryError("WRITE_FAILED");
      }
      if (response.error !== null) throw repositoryErrorForDatabase(response.error);
      const parsedRows = z.array(PendingCheckInRpcRowSchema).length(1).safeParse(response.data);
      if (!parsedRows.success) throw new CheckInRepositoryError("INVALID_RESPONSE");
      const rows = parsedRows.data;
      const row = rows[0];
      if (row === undefined) throw new CheckInRepositoryError("INVALID_RESPONSE");
      return Object.freeze({
        id: row.checkin_id,
        attestationState: row.attestation_state,
        checkedInAt: input.checkedInAt,
        jobState: row.attestation_job_state,
      });
    },
  });
}
